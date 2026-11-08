import os, math, json
from datetime import datetime
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import xgboost as xgb
from sklearn.metrics import mean_squared_error

app = FastAPI(title="FIFA Virtual AI Predictor Multi-App", version="6.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_FILE_H  = "fifa_xgb_home.json"
MODEL_FILE_A  = "fifa_xgb_away.json"
META_FILE     = "fifa_xgb_meta.json"
REPORT_FILE   = "backtest_report.json"

model_home = None
model_away = None
model_meta = {"reliable": False}

# ⚠️ LES DEUX APPLICATIONS LOVABLE SONT CONNECTÉES ICI
LOVABLE_EXPORTS = [
    "https://goal-predictor-prov1.lovable.app/api/public/export-matches",
    "https://fifaliveprobet.lovable.app/api/public/export-matches"
]

def charger_modele():
    global model_home, model_away, model_meta
    if os.path.exists(MODEL_FILE_H) and os.path.exists(MODEL_FILE_A) and os.path.exists(META_FILE):
        try:
            model_meta = json.load(open(META_FILE))
            if model_meta.get("reliable"):
                model_home = xgb.XGBRegressor(); model_home.load_model(MODEL_FILE_H)
                model_away = xgb.XGBRegressor(); model_away.load_model(MODEL_FILE_A)
                print("✅ Modèles xG chargés.")
            else:
                print("⚠️ Modèles présents mais NON fiables — ignorés.")
        except Exception as e:
            print(f"Erreur chargement : {e}")
charger_modele()

class AnalyseRequest(BaseModel):
    home_team: str
    away_team: str
    cote_home: float
    cote_draw: float
    cote_away: float
    cote_over55: Optional[float] = None
    cote_under55: Optional[float] = None
    cote_btts_oui: Optional[float] = None

def devig_3way(oh, od, oa):
    ph, pd_, pa = 1/oh, 1/od, 1/oa
    s = ph + pd_ + pa
    return ph/s, pd_/s, pa/s

def poisson_matrix(lambda_h, mu_a, max_goals=10):
    matrice = np.zeros((max_goals, max_goals))
    for i in range(max_goals):
        p_i = (lambda_h ** i * math.exp(-lambda_h)) / math.factorial(i)
        for j in range(max_goals):
            p_j = (mu_a ** j * math.exp(-mu_a)) / math.factorial(j)
            matrice[i, j] = p_i * p_j
    return matrice

@app.post("/analyser-complet")
def analyser(req: AnalyseRequest):
    p_h, p_d, p_a = devig_3way(req.cote_home, req.cote_draw, req.cote_away)

    if model_home is None or not model_meta.get("reliable"):
        return {
            "status": "refused",
            "message": "❌ Modèle IA non prêt. Laissez les applications enregistrer des matchs avec cotes.",
            "raison": model_meta.get("reason", "En attente de données")
        }

    # L'IA prédit les buts attendus (xG)
    feats = np.array([[req.cote_home, req.cote_draw, req.cote_away,
                       1/req.cote_home + 1/req.cote_draw + 1/req.cote_away,
                       np.log(req.cote_home/req.cote_away)]])
    
    xg_home = float(model_home.predict(feats)[0])
    xg_away = float(model_away.predict(feats)[0])
    
    # Loi de Poisson pour générer tous les marchés
    matrice = poisson_matrix(xg_home, xg_away)
    indices = np.indices(matrice.shape)
    somme_buts = indices[0] + indices[1]
    
    p_over55 = float(np.sum(matrice[somme_buts > 5])) * 100
    p_btts = float(np.sum(matrice[1:, 1:])) * 100
    
    best_i, best_j = np.unravel_index(np.argmax(matrice), matrice.shape)
    score_exact = f"{best_i}-{best_j}"

    # Détection des failles (Value Bets)
    alerts = []
    if req.cote_over55:
        edge_over55 = (p_over55 / 100) - (1 / req.cote_over55)
        if edge_over55 > 0.03:
            alerts.append(f"🔥 VALUE OVER 5.5 (Edge: +{edge_over55*100:.1f}%)")
            
    if req.cote_btts_oui:
        edge_btts = (p_btts / 100) - (1 / req.cote_btts_oui)
        if edge_btts > 0.03:
            alerts.append(f"🔥 VALUE BTTS OUI (Edge: +{edge_btts*100:.1f}%)")

    return {
        "status": "success",
        "match": f"{req.home_team} vs {req.away_team}",
        "predictions_ia": {
            "xg_home": round(xg_home, 2),
            "xg_away": round(xg_away, 2),
            "total_xg": round(xg_home + xg_away, 2)
        },
        "probabilites": {
            "over_5_5": f"{p_over55:.1f}%",
            "btts_oui": f"{p_btts:.1f}%",
            "score_exact": score_exact
        },
        "value_bets": alerts if alerts else ["Aucun value bet détecté."]
    }

@app.get("/reentrainer")
def reentrainer(bt: BackgroundTasks):
    bt.add_task(_pipeline)
    return {"message": "Fusion des deux applications et entraînement lancés."}

def _pipeline():
    global model_home, model_away, model_meta
    try:
        print("=== 1. Récupération des données (App 1 + App 2) ===")
        dfs = []
        for url in LOVABLE_EXPORTS:
            try:
                r = requests.get(url, timeout=30)
                data = r.json()
                if data:
                    dfs.append(pd.DataFrame(data))
                    print(f"✅ {len(data)} matchs lus depuis {url[:35]}...")
            except Exception as e:
                print(f"⚠️ Impossible de lire {url} : {e}")
                
        if not dfs: raise ValueError("Aucune donnée trouvée.")
        df = pd.concat(dfs, ignore_index=True)
        
        # Suppression des doublons si un match a été enregistré dans les 2 apps
        if "match_id" in df.columns: 
            df = df.drop_duplicates(subset=["match_id"])

        rename = {"homeScore": "score_home", "awayScore": "score_away", "home_score": "score_home", "away_score": "score_away", "coteHome": "cote_home", "coteDraw": "cote_draw", "coteAway": "cote_away"}
        df = df.rename(columns={k:v for k,v in rename.items() if k in df.columns})
        
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date","score_home","score_away"]).sort_values("date").reset_index(drop=True)
        
        print(f"Total : {len(df)} matchs uniques combinés.")
        print("=== 2. Calcul de la forme des équipes et préparation IA ===")
        
        team_history = {}
        X_data, y_home, y_away = [], [], []

        for _, row in df.iterrows():
            h, a = row['home_team'], row['away_team']
            sh, sa = row['score_home'], row['score_away']
            
            hist_h_scored = np.mean([x[0] for x in team_history.get(h, [[1.5, 1.5]])[-5:]])
            hist_h_conceded = np.mean([x[1] for x in team_history.get(h, [[1.5, 1.5]])[-5:]])
            hist_a_scored = np.mean([x[0] for x in team_history.get(a, [[1.5, 1.5]])[-5:]])
            hist_a_conceded = np.mean([x[1] for x in team_history.get(a, [[1.5, 1.5]])[-5:]])
            
            # On entraîne l'IA uniquement sur les matchs ayant des cotes
            if pd.notna(row.get('cote_home')) and pd.notna(row.get('cote_away')):
                try:
                    marge = 1/row['cote_home'] + 1/row.get('cote_draw', 3.0) + 1/row['cote_away']
                    X_data.append([
                        float(row['cote_home']), float(row.get('cote_draw', 3.0)), float(row['cote_away']), marge,
                        np.log(float(row['cote_home'])/float(row['cote_away'])),
                        hist_h_scored, hist_h_conceded, hist_a_scored, hist_a_conceded
                    ])
                    y_home.append(sh)
                    y_away.append(sa)
                except:
                    pass
            
            if h not in team_history: team_history[h] = []
            if a not in team_history: team_history[a] = []
            team_history[h].append([sh, sa])
            team_history[a].append([sa, sh])

        if len(X_data) < 50:
            raise ValueError(f"Seulement {len(X_data)} matchs avec cotes. Laissez les applications tourner.")

        X = np.array(X_data)
        y_h = np.array(y_home)
        y_a = np.array(y_away)

        print(f"=== 3. Entraînement sur {len(X)} matchs avec cotes ===")
        split = int(len(X) * 0.8)
        
        clf_h = xgb.XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.05, objective='count:poisson')
        clf_a = xgb.XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.05, objective='count:poisson')
        
        clf_h.fit(X[:split], y_h[:split])
        clf_a.fit(X[:split], y_a[:split])

        preds_h = clf_h.predict(X[split:])
        preds_a = clf_a.predict(X[split:])
        rmse_h = np.sqrt(mean_squared_error(y_h[split:], preds_h))
        rmse_a = np.sqrt(mean_squared_error(y_a[split:], preds_a))
        
        clf_h.save_model(MODEL_FILE_H)
        clf_a.save_model(MODEL_FILE_A)
        model_home, model_away = clf_h, clf_a
        
        model_meta = {
            "reliable": True,
            "matchs_entrainement": len(X),
            "erreur_moyenne_buts_dom": round(rmse_h, 2),
            "erreur_moyenne_buts_ext": round(rmse_a, 2),
            "date": datetime.utcnow().isoformat()
        }
        json.dump(model_meta, open(META_FILE, "w"), indent=2)
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)
        print("✅ L'IA est prête et connaît la forme des équipes des 2 applications !")

    except Exception as e:
        print(f"❌ Erreur : {e}")
        model_meta = {"reliable": False, "reason": str(e)}
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)

@app.get("/rapport")
def rapport():
    if not os.path.exists(REPORT_FILE):
        return {"status": "no_report", "message": "Lance /reentrainer d'abord."}
    return json.load(open(REPORT_FILE))

@app.get("/")
def health():
    return {"status": "online", "model_ready": model_home is not None and model_meta.get("reliable")}