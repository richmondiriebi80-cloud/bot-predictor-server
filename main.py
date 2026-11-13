import os, math, json, gc
from datetime import datetime
import numpy as np
import requests
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict
import xgboost as xgb

# On force XGBoost à utiliser le CPU et à limiter les threads
xgb.set_config(verbosity=0, nthread=1)

app = FastAPI(title="FIFA Predictor - Low Memory", version="31.0.0")
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
    marge_max: Optional[float] = 100.0 
    
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

def get_real_team_stats(home_team, away_team):
    h_scored, h_conceded, a_scored, a_conceded = 2.5, 2.0, 2.0, 2.5
    try:
        all_matches = []
        for url in LOVABLE_EXPORTS:
            try:
                r = requests.get(url, timeout=5)
                data = r.json()
                if isinstance(data, dict) and "matches" in data: data = data["matches"]
                if isinstance(data, list): all_matches.extend(data)
            except: pass
        
        if not all_matches: return h_scored, h_conceded, a_scored, a_conceded

        # Remplacement de pandas par des dictionnaires pour économiser la RAM
        h_scored_list, h_conceded_list = [], []
        a_scored_list, a_conceded_list = [], []

        for m in all_matches[-20:]: # On ne regarde que les 20 derniers pour la RAM
            h, a = m.get("home"), m.get("away")
            sh, sa = m.get("hs"), m.get("as")
            if sh is None or sa is None: continue
            
            if h == home_team:
                h_scored_list.append(sh); h_conceded_list.append(sa)
            elif a == home_team:
                h_scored_list.append(sa); h_conceded_list.append(sh)
                
            if h == away_team:
                a_scored_list.append(sh); a_conceded_list.append(sa)
            elif a == away_team:
                a_scored_list.append(sa); a_conceded_list.append(sh)

        if h_scored_list: h_scored, h_conceded = np.mean(h_scored_list[-5:]), np.mean(h_conceded_list[-5:])
        if a_scored_list: a_scored, a_conceded = np.mean(a_scored_list[-5:]), np.mean(a_conceded_list[-5:])
            
    except Exception as e:
        print(f"Erreur stats: {e}")
        
    return round(h_scored, 2), round(h_conceded, 2), round(a_scored, 2), round(a_conceded, 2)

@app.post("/analyser-complet")
def analyser(req: AnalyseRequest):
    try:
        c1 = float(req.cote_1) if req.cote_1 else 2.0
        cx = float(req.cote_x) if req.cote_x else 3.0
        c2 = float(req.cote_2) if req.cote_2 else 2.0

        marge_brute = (1/c1) + (1/cx) + (1/c2)
        marge_pct = round((marge_brute - 1) * 100, 2)

        if marge_pct > req.marge_max:
            return {"status": "refused", "message": f"Match rejeté : Marge {marge_pct}%", "marge_match": marge_pct}

        hist_h_scored, hist_h_conceded, hist_a_scored, hist_a_conceded = get_real_team_stats(req.home_team, req.away_team)

        if model_home is not None and model_meta.get("reliable"):
            feats = np.array([[c1, cx, c2, marge_brute, np.log(c1/c2), hist_h_scored, hist_h_conceded, hist_a_scored, hist_a_conceded]])
            xg_home = float(model_home.predict(feats)[0])
            xg_away = float(model_away.predict(feats)[0])
        else:
            p_h, p_d, p_a = devig_3way(c1, cx, c2)
            xg_home = (hist_h_scored * 0.4) + (hist_a_conceded * 0.3) + (p_h * 2.0)
            xg_away = (hist_a_scored * 0.4) + (hist_h_conceded * 0.3) + (p_a * 2.0)
        
        xg_home = max(0.5, xg_home)
        xg_away = max(0.5, xg_away)
        
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
                    
                    if edge > 1.0:
                        if key.startswith("U") and (not model_meta.get("reliable") or edge < 10.0):
                            continue
                        value_bets.append({"marche": key, "proba_ia": round(p_ia, 1), "cote": float(cote), "edge": round(edge, 1)})

        value_bets = sorted(value_bets, key=lambda x: x["edge"], reverse=True)
        if not value_bets and resultats_marches:
            top_probas = sorted(resultats_marches.items(), key=lambda x: x[1]["probabilite_ia"], reverse=True)[:3]
            for k, v in top_probas:
                value_bets.append({"marche": k, "proba_ia": v["probabilite_ia"], "cote": v["cote"], "edge": v["edge"]})

        # Libération de la mémoire après chaque calcul
        gc.collect()

        return {
            "status": "success",
            "predictions_ia": {
                "xg_home": round(xg_home, 2), 
                "xg_away": round(xg_away, 2),
                "forme_domicile": f"{hist_h_scored} buts marqués / {hist_h_conceded} encaissés",
                "forme_exterieur": f"{hist_a_scored} buts marqués / {hist_a_conceded} encaissés"
            },
            "top_scores_exacts": top_scores,
            "resultats_marches": resultats_marches,
            "marge_match": marge_pct,
            "value_bets": value_bets[:10]
        }

    except Exception as e:
        gc.collect()
        return {"status": "error", "message": str(e), "value_bets": []}

# ... (Le reste des routes /reentrainer, /rapport, /health reste identique à la version 30.0.0) ...
@app.get("/reentrainer")
def reentrainer(bt: BackgroundTasks):
    bt.add_task(_pipeline)
    return {"message": "Entraînement lancé."}

def _pipeline():
    global model_home, model_away, model_meta
    try:
        all_matches = []
        for url in LOVABLE_EXPORTS:
            try:
                r = requests.get(url, timeout=30)
                data = r.json()
                if isinstance(data, dict) and "matches" in data: data = data["matches"]
                if isinstance(data, list): all_matches.extend(data)
            except: pass
                
        if not all_matches: raise ValueError("Aucune donnée.")
        
        # Dédoublonnage sans pandas
        seen = set()
        unique_matches = []
        for m in all_matches:
            mid = m.get("id")
            if mid and mid not in seen:
                seen.add(mid)
                unique_matches.append(m)
        
        unique_matches.sort(key=lambda x: x.get("date", ""))
        
        team_history, X_data, y_home, y_away = {}, [], [], []

        for m in unique_matches:
            h, a, sh, sa = m.get("home"), m.get("away"), m.get("hs"), m.get("as")
            if not h or not a or sh is None or sa is None: continue
            
            hist_h_scored = np.mean([x[0] for x in team_history.get(h, [[2.5, 2.0]])[-5:]])
            hist_h_conceded = np.mean([x[1] for x in team_history.get(h, [[2.5, 2.0]])[-5:]])
            hist_a_scored = np.mean([x[0] for x in team_history.get(a, [[2.0, 2.5]])[-5:]])
            hist_a_conceded = np.mean([x[1] for x in team_history.get(a, [[2.0, 2.5]])[-5:]])
            
            if m.get('cote_home') and m.get('cote_away'):
                try:
                    marge = 1/m['cote_home'] + 1/m.get('cote_draw', 3.0) + 1/m['cote_away']
                    X_data.append([float(m['cote_home']), float(m.get('cote_draw', 3.0)), float(m['cote_away']), marge, np.log(float(m['cote_home'])/float(m['cote_away'])), hist_h_scored, hist_h_conceded, hist_a_scored, hist_a_conceded])
                    y_home.append(sh); y_away.append(sa)
                except: pass
            if h not in team_history: team_history[h] = []
            if a not in team_history: team_history[a] = []
            team_history[h].append([sh, sa]); team_history[a].append([sa, sh])

        if len(X_data) < 50: raise ValueError(f"Pas assez de matchs ({len(X_data)}).")
        X, y_h, y_a = np.array(X_data), np.array(y_home), np.array(y_away)
        split = int(len(X) * 0.8)
        
        clf_h = xgb.XGBRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, objective='count:poisson', nthread=1) # n_estimators réduit pour la RAM
        clf_a = xgb.XGBRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, objective='count:poisson', nthread=1)
        clf_h.fit(X[:split], y_h[:split]); clf_a.fit(X[:split], y_a[:split])

        clf_h.save_model(MODEL_FILE_H); clf_a.save_model(MODEL_FILE_A)
        model_home, model_away = clf_h, clf_a
        model_meta = {"reliable": True, "matchs_entrainement": len(X), "date": datetime.utcnow().isoformat()}
        json.dump(model_meta, open(META_FILE, "w"), indent=2)
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)
        
        gc.collect() # Libération mémoire
    except Exception as e:
        model_meta = {"reliable": False, "reason": str(e)}
        json.dump(model_meta, open(REPORT_FILE, "w"), indent=2)

@app.get("/rapport")
def rapport():
    return json.load(open(REPORT_FILE)) if os.path.exists(REPORT_FILE) else {"status": "no_report"}

@app.api_route("/", methods=["GET", "HEAD"])
def health():
    return {"status": "online", "model_ready": model_home is not None}