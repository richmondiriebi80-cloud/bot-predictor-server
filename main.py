import os, math, json
from datetime import datetime
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict
import xgboost as xgb
from sklearn.metrics import mean_squared_error

app = FastAPI(title="FIFA Predictor - Force Coupons", version="25.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_FILE_H  = "fifa_xgb_home.json"
MODEL_FILE_A  = "fifa_xgb_away.json"
META_FILE     = "fifa_xgb_meta.json"
REPORT_FILE   = "backtest_report.json"

model_home = None
model_away = None
model_meta = {"reliable": False}

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
        except Exception as e:
            print(f"Erreur chargement : {e}")
charger_modele()

class AnalyseRequest(BaseModel):
    home_team: Optional[str] = "Équipe A"
    away_team: Optional[str] = "Équipe B"
    cote_1: Optional[float] = 2.0
    cote_x: Optional[float] = 3.0
    cote_2: Optional[float] = 2.0
    cotes: Optional[Dict[str, float]] = {}
    
    class Config:
        extra = "allow"

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

def get_top_scores(xg_home, xg_away):
    mat = poisson_matrix(xg_home, xg_away, 10)
    flat_indices = np.argsort(mat.ravel())[::-1][:3]
    return [{"score": f"{np.unravel_index(idx, mat.shape)[0]}-{np.unravel_index(idx, mat.shape)[1]}", "probabilite": round(float(mat[np.unravel_index(idx, mat.shape)]*100), 1)} for idx in flat_indices]

@app.post("/analyser-complet")
def analyser(req: AnalyseRequest):
    try:
        c1 = float(req.cote_1) if req.cote_1 else 2.0
        cx = float(req.cote_x) if req.cote_x else 3.0
        c2 = float(req.cote_2) if req.cote_2 else 2.0

        if model_home is not None and model_meta.get("reliable"):
            feats = np.array([[c1, cx, c2, 1/c1 + 1/cx + 1/c2, np.log(c1/c2), 2.5, 2.0, 2.0, 2.5]])
            xg_home = float(model_home.predict(feats)[0])
            xg_away = float(model_away.predict(feats)[0])
        else:
            p_h, p_d, p_a = devig_3way(c1, cx, c2)
            xg_home = 2.2 + (p_h * 1.5)
            xg_away = 1.8 + (p_a * 1.5)
        
        xg_home = max(2.2, xg_home)
        xg_away = max(1.8, xg_away)
        
        top_scores = get_top_scores(xg_home, xg_away)
        mat = poisson_matrix(xg_home, xg_away, 10)
        i, j = np.indices(mat.shape)
        somme_buts = i + j

        probas = {}
        probas["1"] = float(np.sum(mat[i > j])) * 100
        probas["X"] = float(np.sum(mat[i == j])) * 100
        probas["2"] = float(np.sum(mat[i < j])) * 100
        
        for seuil in [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]:
            probas[f"O{seuil}"] = float(np.sum(mat[somme_buts > seuil])) * 100
            probas[f"U{seuil}"] = 100 - probas[f"O{seuil}"]
            
        probas["BTTS_Oui"] = float(np.sum(mat[1:, 1:])) * 100
        probas["BTTS_Non"] = 100 - probas["BTTS_Oui"]
        
        value_bets = []
        resultats_marches = {}
        
        if req.cotes and isinstance(req.cotes, dict):
            for key, cote in req.cotes.items():
                if key in probas and isinstance(probas[key], (int, float)) and cote and float(cote) > 1.01:
                    p_ia = probas[key]
                    p_marche = (1 / float(cote)) * 100
                    edge = p_ia - p_marche
                    
                    resultats_marches[key] = {"probabilite_ia": round(p_ia, 1), "cote": float(cote), "edge": round(edge, 1)}
                    
                    # ⚠️ SEUIL BAISSÉ À 1% POUR FORCER LES COUPONS
                    if edge > 1.0:
                        if key.startswith("U") and (not model_meta.get("reliable") or edge < 10.0):
                            continue
                        value_bets.append({"marche": key, "proba_ia": round(p_ia, 1), "cote": float(cote), "edge": round(edge, 1)})

        value_bets = sorted(value_bets, key=lambda x: x["edge"], reverse=True)

        # Si aucun value bet trouvé, on renvoie les 3 paris avec la plus grande probabilité
        if not value_bets and resultats_marches:
            top_probas = sorted(resultats_marches.items(), key=lambda x: x[1]["probabilite_ia"], reverse=True)[:3]
            for k, v in top_probas:
                value_bets.append({"marche": k, "proba_ia": v["probabilite_ia"], "cote": v["cote"], "edge": v["edge"]})

        return {
            "status": "success",
            "predictions_ia": {"xg_home": round(xg_home, 2), "xg_away": round(xg_away, 2)},
            "top_scores_exacts": top_scores,
            "resultats_marches": resultats_marches,
            "value_bets": value_bets[:10]
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "predictions_ia": {"xg_home": 2.5, "xg_away": 1.8},
            "top_scores_exacts": get_top_scores(2.5, 1.8), 
            "value_bets": []
        }

@app.get("/reentrainer")
def reentrainer(bt: BackgroundTasks):
    bt.add_task(_pipeline)
    return {"message": "Entraînement lancé."}

def _pipeline():
    global model_home, model_away, model_meta
    try:
        dfs = []
        for url in LOVABLE_EXPORTS:
            try:
                r = requests.get(url, timeout=30)
                data = r.json()
                if isinstance(data, dict) and "matches" in data:
                    data = data["matches"]
                if data and isinstance(data, list): 
                    dfs.append(pd.DataFrame(data))
            except: pass
                
        if not dfs: raise ValueError("Aucune donnée.")
        
        df = pd.concat(dfs, ignore_index=True)
        if "id" in df.columns: df = df.drop_duplicates(subset=["id"])
        elif "match_id" in df.columns: df = df.drop_duplicates(subset=["match_id"])

        rename = {"hs": "score_home", "as": "score_away", "home": "home_team", "away": "away_team", "homeScore": "score_home", "awayScore": "score_away", "home_score": "score_home", "away_score": "score_away", "coteHome": "cote_home", "coteDraw": "cote_draw", "coteAway": "cote_away"}
        df = df.rename(columns={k:v for k,v in rename.items() if k in df.columns})
        
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date","score_home","score_away"]).sort_values("date").reset_index(drop=True)
        
        team_history, X_data, y_home, y_away = {}, [], [], []

        for _, row in df.iterrows():
            h, a, sh, sa = row['home_team'], row['away_team'], row['score_home'], row['score_away']
            hist_h_scored = np.mean([x[0] for x in team_history.get(h, [[2.5, 2.0]])[-5:]])
            hist_h_conceded = np.mean([x[1] for x in team_history.get(h, [[2.5, 2.0]])[-5:]])
            hist_a_scored = np.mean([x[0] for x in team_history.get(a, [[2.0, 2.5]])[-5:]])
            hist_a_conceded = np.mean([x[1] for x in team_history.get(a, [[2.0, 2.5]])[-5:]])
            
            if pd.notna(row.get('cote_home')) and pd.notna(row.get('cote_away')):
                try:
                    marge = 1/row['cote_home'] + 1/row.get('cote_draw', 3.0) + 1/row['cote_away']
                    X_data.append([float(row['cote_home']), float(row.get('cote_draw', 3.0)), float(row['cote_away']), marge, np.log(float(row['cote_home'])/float(row['cote_away'])), hist_h_scored, hist_h_conceded, hist_a_scored, hist_a_conceded])
                    y_home.append(sh); y_away.append(sa)
                except: pass
            if h not in team_history: team_history[h] = []
            if a not in team_history: team_history[a] = []
            team_history[h].append([sh, sa]); team_history[a].append([sa, sh])

        if len(X_data) < 50: raise ValueError(f"Pas assez de matchs avec cotes ({len(X_data)}).")
        X, y_h, y_a = np.array(X_data), np.array(y_home), np.array(y_away)
        split = int(len(X) * 0.8)
        
        clf_h = xgb.XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.05, objective='count:poisson')
        clf_a = xgb.XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.05, objective='count:poisson')
        clf_h.fit(X[:split], y_h[:split]); clf_a.fit(X[:split], y_a[:split])

        clf_h.save_model(MODEL_FILE_H); clf_a.save_model(MODEL_FILE_A)
        model_home, model_away = clf_h, clf_a
        model_meta = {"reliable": True, "matchs_entrainement": len(X), "date": datetime.utcnow().isoformat()}
        json.dump(model_meta, open(META_FILE, "w"), indent=2)
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)
    except Exception as e:
        model_meta = {"reliable": False, "reason": str(e)}
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)

@app.get("/rapport")
def rapport():
    return json.load(open(REPORT_FILE)) if os.path.exists(REPORT_FILE) else {"status": "no_report"}

@app.api_route("/", methods=["GET", "HEAD"])
def health():
    return {"status": "online", "model_ready": model_home is not None}