from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import numpy as np
import pydantic
import urllib.request
import json
import os

app = FastAPI(title="Moteur XGBoost FIFA 1xbet Multi-Marchés")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# INITIALISATION ET ENTRAÎNEMENT DU VRAI MODÈLE XGBOOST AU DÉMARRAGE
# ---------------------------------------------------------------------------
MODEL_HOME_PATH = "xgb_fifa_home.json"
MODEL_AWAY_PATH = "xgb_fifa_away.json"

def entrainer_modeles_xgboost():
    print("Entraînement des arbres de décision XGBoost pour FIFA...")
    np.random.seed(42)
    N = 2500
    
    # Features: [cote_home, cote_away, hist_buts_home, hist_buts_away]
    c_home = np.random.uniform(1.15, 6.0, N)
    c_away = np.random.uniform(1.15, 6.0, N)
    h_home = np.random.uniform(0.5, 3.5, N)
    h_away = np.random.uniform(0.5, 3.5, N)
    X = np.column_stack([c_home, c_away, h_home, h_away])
    
    # Distribution des buts FIFA eSports (moyenne 3.2 à 4.8 buts par match)
    lambda_h = np.clip((3.2 / c_home) * 0.75 + (h_home * 0.35), 0.2, 5.5)
    lambda_a = np.clip((3.2 / c_away) * 0.75 + (h_away * 0.35), 0.2, 5.5)
    y_home = np.random.poisson(lambda_h)
    y_away = np.random.poisson(lambda_a)
    
    params = {
        'max_depth': 4,
        'eta': 0.08,
        'objective': 'reg:squarederror',
        'eval_metric': 'rmse'
    }
    
    dtrain_h = xgb.DMatrix(X, label=y_home)
    dtrain_a = xgb.DMatrix(X, label=y_away)
    
    bst_h = xgb.train(params, dtrain_h, num_boost_round=80)
    bst_a = xgb.train(params, dtrain_a, num_boost_round=80)
    
    bst_h.save_model(MODEL_HOME_PATH)
    bst_a.save_model(MODEL_AWAY_PATH)
    print("Modèles XGBoost opérationnels et sauvegardés.")
    return bst_h, bst_a

# Chargement ou entraînement des boosters
if not os.path.exists(MODEL_HOME_PATH) or not os.path.exists(MODEL_AWAY_PATH):
    model_home, model_away = entrainer_modeles_xgboost()
else:
    model_home = xgb.Booster()
    model_home.load_model(MODEL_HOME_PATH)
    model_away = xgb.Booster()
    model_away.load_model(MODEL_AWAY_PATH)

# ---------------------------------------------------------------------------
# FLUX 1XBET
# ---------------------------------------------------------------------------
URL_1XBET = "https://1xbet.ci/service-api/LiveFeed/Get1x2_VZip?sports=85&count=120&lng=fr&mode=4&virtualSports=true"

LIGUES_AUTORISEES = [
    "FC 26. England Championship",
    "FC 26. Champions League",
    "FC 26. Championnat du monde",
    "FC 25. Italy Championship",
    "FC 25. Ligue européenne",
    "FC 26. Germany Championship",
    "FC 26. Spain Championship"
]

@app.get("/flux-1xbet")
def get_flux_1xbet():
    try:
        req = urllib.request.Request(
            URL_1XBET,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
        
        matches = data.get("Value", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        matchs_filtres = [m for m in matches if m.get("L") in LIGUES_AUTORISEES]
        
        return {
            "status": "success",
            "total": len(matchs_filtres),
            "data": matchs_filtres
        }
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}

# ---------------------------------------------------------------------------
# ANALYSE PAR VRAIE INFÉRENCE XGBOOST
# ---------------------------------------------------------------------------
class MatchInput(pydantic.BaseModel):
    home_team: str
    away_team: str
    historique_buts_home: float
    historique_buts_away: float
    cote_home: float
    cote_away: float

@app.post("/analyser-complet")
def analyser_match(data: MatchInput):
    nom_complet_home = data.home_team   
    nom_complet_away = data.away_team   
    
    # 1. Matrice XGBoost avec les 4 caractéristiques du match
    features = np.array([[data.cote_home, data.cote_away, data.historique_buts_home, data.historique_buts_away]])
    dmatrix = xgb.DMatrix(features)
    
    # 2. VRAIE PRÉDICTION XGBOOST
    pred_h = float(model_home.predict(dmatrix)[0])
    pred_a = float(model_away.predict(dmatrix)[0])
    
    # Buts prédits par l'IA
    b_home_f = max(0, int(round(pred_h)))
    b_away_f = max(0, int(round(pred_a)))
    
    # Ajustement si l'écart de cote est très net
    if data.cote_home <= 1.80 and b_home_f <= b_away_f:
        b_home_f = b_away_f + 1
    elif data.cote_away <= 1.80 and b_away_f <= b_home_f:
        b_away_f = b_home_f + 1

    total_match = b_home_f + b_away_f
    
    # Estimation Mi-temps
    buts_home_ht = 1 if b_home_f >= 2 else (0 if b_home_f == 0 else (1 if pred_h > pred_a else 0))
    buts_away_ht = 1 if b_away_f >= 2 else (0 if b_away_f == 0 else (1 if pred_a > pred_h else 0))
    total_ht = buts_home_ht + buts_away_ht

    # 3. Probabilités 1X2 réelles
    p_h_brut = (1.0 / max(data.cote_home, 1.05))
    p_a_brut = (1.0 / max(data.cote_away, 1.05))
    diff_cotes = abs(p_h_brut - p_a_brut)
    p_x_brut = max(0.18, 0.28 - (diff_cotes * 0.15))
    somme_p = p_h_brut + p_a_brut + p_x_brut

    p_home = round((p_h_brut / somme_p) * 100, 1)
    p_away = round((p_a_brut / somme_p) * 100, 1)
    p_nul = round((p_x_brut / somme_p) * 100, 1)

    res_1x2 = "1" if b_home_f > b_away_f else ("2" if b_away_f > b_home_f else "X")
    res_ht = "1" if buts_home_ht > buts_away_ht else ("2" if buts_away_ht > buts_home_ht else "X")
    mt_fin = f"{res_ht}/{res_1x2}"

    # Marchés dérivés
    btts = "OUI" if b_home_f > 0 and b_away_f > 0 else "NON"
    chaque_equipe_1_plus = "OUI" if b_home_f >= 1 and b_away_f >= 1 else "NON"
    pair_impair = "Pair" if total_match % 2 == 0 else "Impair"

    return {
        "status": "success",
        "match": f"{nom_complet_home} vs {nom_complet_away}",
        "marches": {
            "marche_1X2": {"resultat": res_1x2, "probabilites": f"1: {p_home}% | X: {p_nul}% | 2: {p_away}%"},
            "double_chance": {"1X": "OUI" if res_1x2 in ["1", "X"] else "NON", "12": "OUI" if res_1x2 in ["1", "2"] else "NON", "2X": "OUI" if res_1x2 in ["2", "X"] else "NON"},
            "total_buts": {"prediction": total_match, "over_2_5": "OUI" if total_match > 2.5 else "NON"},
            "total_equipe_1": b_home_f,
            "total_equipe_2": b_away_f,
            "les_2_marquent": btts,
            "chaque_equipe_N_plus": chaque_equipe_1_plus,
            "total_1ere_MT": total_ht,
            "total_2eme_MT": max(0, total_match - total_ht),
            "pair_impair": pair_impair,
            "score_exact": f"{b_home_f} - {b_away_f}",
            "score_exact_1ere_MT": f"{buts_home_ht} - {buts_away_ht}",
            "nombre_exact_de_buts": total_match,
            "mi_temps_fin_de_match": mt_fin
        }
    }
