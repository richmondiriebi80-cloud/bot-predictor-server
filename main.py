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

app = FastAPI(title="FIFA Predictor - All Markets + Safe", version="14.0.0")
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
    home_team: str
    away_team: str
    cote_1: float
    cote_x: float
    cote_2: float
    cotes: Optional[Dict[str, float]] = None

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
    # 1. Prédiction des buts (avec sécurité si l'IA n'est pas prête)
    if model_home is not None and model_meta.get("reliable"):
        feats = np.array([[req.cote_1, req.cote_x, req.cote_2, 1/req.cote_1 + 1/req.cote_x + 1/req.cote_2, np.log(req.cote_1/req.cote_2)]])
        xg_home = float(model_home.predict(feats)[0])
        xg_away = float(model_away.predict(feats)[0])
    else:
        p_h, p_d, p_a = devig_3way(req.cote_1, req.cote_x, req.cote_2)
        xg_home = 1.8 + (p_h * 1.5)
        xg_away = 1.2 + (p_a * 1.5)
    
    # ⚠️ SÉCURITÉ FIFA VIRTUEL : L'IA ne peut pas prédire moins de 1.2 but à domicile et 0.8 à l'extérieur
    xg_home = max(1.2, xg_home)
    xg_away = max(0.8, xg_away)
    xg_total = xg_home + xg_away
    
    # 2. Matrices
    mat = poisson_matrix(xg_home, xg_away, 10)
    mat_mt1 = poisson_matrix(xg_home*0.45, xg_away*0.45, 10)
    mat_mt2 = poisson_matrix(xg_home*0.55, xg_away*0.55, 10)
    
    i, j = np.indices(mat.shape)
    somme_buts = i + j
    i_mt1, j_mt1 = np.indices(mat_mt1.shape)
    somme_mt1 = i_mt1 + j_mt1

    probas = {}
    
    # --- TOUS LES MARCHÉS ---
    
    # 1X2 & Double Chance
    probas["1"] = float(np.sum(mat[i > j])) * 100
    probas["X"] = float(np.sum(mat[i == j])) * 100
    probas["2"] = float(np.sum(mat[i < j])) * 100
    probas["1X"] = probas["1"] + probas["X"]
    probas["12"] = probas["1"] + probas["2"]
    probas["X2"] = probas["X"] + probas["2"]
    
    # Total buts (Over / Under)
    for seuil in [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]:
        probas[f"O{seuil}"] = float(np.sum(mat[somme_buts > seuil])) * 100
        probas[f"U{seuil}"] = 100 - probas[f"O{seuil}"]
        
    # Total Equipe 1 & 2
    for seuil in [0.5, 1.5, 2.5]:
        probas[f"Eq1_O{seuil}"] = float(np.sum(mat[i > seuil])) * 100
        probas[f"Eq1_U{seuil}"] = 100 - probas[f"Eq1_O{seuil}"]
        probas[f"Eq2_O{seuil}"] = float(np.sum(mat[j > seuil])) * 100
        probas[f"Eq2_U{seuil}"] = 100 - probas[f"Eq2_O{seuil}"]

    # Chaque Équipe va marquer N+
    for seuil in [0.5, 1.5, 2.5]:
        condition = (i > seuil) & (j > seuil)
        probas[f"Chaque_Equipe_O{seuil}"] = float(np.sum(mat[condition])) * 100
        probas[f"Chaque_Equipe_U{seuil}"] = 100 - probas[f"Chaque_Equipe_O{seuil}"]

    # Les 2 marquent (BTTS)
    probas["BTTS_Oui"] = float(np.sum(mat[1:, 1:])) * 100
    probas["BTTS_Non"] = 100 - probas["BTTS_Oui"]
    
    # Pair / Impair
    probas["Pair"] = float(np.sum(mat[somme_buts % 2 == 0])) * 100
    probas["Impair"] = 100 - probas["Pair"]
    
    # Mi-temps & But dans chaque MT
    probas["MT1_O0.5"] = float(np.sum(mat_mt1[somme_mt1 > 0.5])) * 100
    probas["MT1_O1.5"] = float(np.sum(mat_mt1[somme_mt1 > 1.5])) * 100
    probas["MT2_O0.5"] = float(np.sum(mat_mt2[somme_mt1 > 0.5])) * 100
    probas["MT2_O1.5"] = float(np.sum(mat_mt2[somme_mt1 > 1.5])) * 100
    
    p_but_mt1 = probas["MT1_O0.5"] / 100
    p_but_mt2 = probas["MT2_O0.5"] / 100
    probas["But_Chaque_MT_Oui"] = (p_but_mt1 * p_but_mt2) * 100
    probas["But_Chaque_MT_Non"] = 100 - probas["But_Chaque_MT_Oui"]
    
    # Scores exacts
    best_idx = np.unravel_index(np.argmax(mat), mat.shape)
    probas["Score_Exact_Principal"] = f"{best_idx[0]}-{best_idx[1]}"
    best_idx_mt1 = np.unravel_index(np.argmax(mat_mt1), mat_mt1.shape)
    probas["Score_MT1_Principal"] = f"{best_idx_mt1[0]}-{best_idx_mt1[1]}"
    
    # Nombre exact de buts
    for k in range(7):
        probas[f"Exact_Goals_{k}"] = float(np.sum(mat[somme_buts == k])) * 100

    # MT / Fin de match (HT/FT)
    ht_res = {"1": probas["1"]/100, "X": probas["X"]/100, "2": probas["2"]/100}
    mt1_res = {
        "1": float(np.sum(mat_mt1[i_mt1 > j_mt1])),
        "X": float(np.sum(mat_mt1[i_mt1 == j_mt1])),
        "2": float(np.sum(mat_mt1[i_mt1 < j_mt1]))
    }
    for h in ["1", "X", "2"]:
        for f in ["1", "X", "2"]:
            probas[f"HTFT_{h}_{f}"] = (mt1_res[h] * ht_res[f]) * 100

    # --- DÉTECTION DES VALUE BETS (avec sécurité Anti-Under) ---
    value_bets = []
    if req.cotes:
        for key, cote in req.cotes.items():
            if key in probas and isinstance(probas[key], (int, float)) and cote > 1.01:
                p_ia = probas[key]
                p_marche = (1 / cote) * 100
                edge = p_ia - p_marche
                
                if edge > 3.0:
                    # ⚠️ SÉCURITÉ : On bloque les Under 1.5, 2.5 et 3.5
                    if key.startswith("U") and len(key) <= 4:
                        try:
                            if float(key.replace("U", "")) <= 3.5:
                                continue
                        except: pass
                    
                    value_bets.append({"marche": key, "proba_ia": round(p_ia, 1), "cote": cote, "edge": round(edge, 1)})

    value_bets = sorted(value_bets, key=lambda x: x["edge"], reverse=True)

    return {
        "status": "success",
        "match": f"{req.home_team} vs {req.away_team}",
        "predictions_ia": {"xg_home": round(xg_home, 2), "xg_away": round(xg_away, 2)},
        "value_bets": value_bets[:10] if value_bets else ["Aucun value bet détecté."]
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
                if r.json(): dfs.append(pd.DataFrame(r.json()))
            except: pass
        if not dfs: raise ValueError("Aucune donnée.")
        df = pd.concat(dfs, ignore_index=True)
        if "match_id" in df.columns: df = df.drop_duplicates(subset=["match_id"])

        rename = {"homeScore": "score_home", "awayScore": "score_away", "home_score": "score_home", "away_score": "score_away", "coteHome": "cote_home", "coteDraw": "cote_draw", "coteAway": "cote_away"}
        df = df.rename(columns={k:v for k,v in rename.items() if k in df.columns})
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date","score_home","score_away"]).sort_values("date").reset_index(drop=True)
        
        team_history, X_data, y_home, y_away = {}, [], [], []

        for _, row in df.iterrows():
            h, a, sh, sa = row['home_team'], row['away_team'], row['score_home'], row['score_away']
            hist_h_scored = np.mean([x[0] for x in team_history.get(h, [[2.0, 1.5]])[-5:]])
            hist_h_conceded = np.mean([x[1] for x in team_history.get(h, [[2.0, 1.5]])[-5:]])
            hist_a_scored = np.mean([x[0] for x in team_history.get(a, [[1.5, 2.0]])[-5:]])
            hist_a_conceded = np.mean([x[1] for x in team_history.get(a, [[1.5, 2.0]])[-5:]])
            
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
        print("✅ IA Prête !")

    except Exception as e:
        model_meta = {"reliable": False, "reason": str(e)}
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)

@app.get("/rapport")
def rapport():
    return json.load(open(REPORT_FILE)) if os.path.exists(REPORT_FILE) else {"status": "no_report"}

@app.get("/")
def health():
    return {"status": "online", "model_ready": model_home is not None}