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
# INITIALISATION DES ARBRES DE DÉCISION XGBOOST
# ---------------------------------------------------------------------------
MODEL_1X2 = "xgb_1x2.json"
MODEL_GOALS_H = "xgb_goals_h.json"
MODEL_GOALS_A = "xgb_goals_a.json"

def entrainer_suite_xgboost():
    print("Entraînement des modèles XGBoost (1X2, Buts, Probabilités)...")
    np.random.seed(42)
    N = 4000
    
    # 4 caractéristiques clés : [cote_home, cote_away, hist_buts_home, hist_buts_away]
    c_home = np.random.uniform(1.15, 6.0, N)
    c_away = np.random.uniform(1.15, 6.0, N)
    h_home = np.random.uniform(0.5, 3.5, N)
    h_away = np.random.uniform(0.5, 3.5, N)
    X = np.column_stack([c_home, c_away, h_home, h_away])
    
    # Simulation des distributions réelles de buts FIFA (3.5 buts en moyenne)
    l_h = np.clip((3.3 / c_home) * 0.72 + (h_home * 0.35), 0.3, 5.5)
    l_a = np.clip((3.3 / c_away) * 0.72 + (h_away * 0.35), 0.3, 5.5)
    y_h = np.random.poisson(l_h)
    y_a = np.random.poisson(l_a)
    
    # 1X2 : 0 = Victoire 1, 1 = Nul X, 2 = Victoire 2
    y_1x2 = np.where(y_h > y_a, 0, np.where(y_h < y_a, 2, 1))
    
    # 1. Modèle XGBoost multi-classes pour les probabilités 1X2
    d_1x2 = xgb.DMatrix(X, label=y_1x2)
    params_1x2 = {
        'max_depth': 4,
        'eta': 0.08,
        'objective': 'multi:softprob',
        'num_class': 3
    }
    bst_1x2 = xgb.train(params_1x2, d_1x2, num_boost_round=70)
    
    # 2. Modèles de régression XGBoost pour les scores
    d_h = xgb.DMatrix(X, label=y_h)
    d_a = xgb.DMatrix(X, label=y_a)
    params_reg = {'max_depth': 4, 'eta': 0.08, 'objective': 'reg:squarederror'}
    bst_h = xgb.train(params_reg, d_h, num_boost_round=70)
    bst_a = xgb.train(params_reg, d_a, num_boost_round=70)
    
    bst_1x2.save_model(MODEL_1X2)
    bst_h.save_model(MODEL_GOALS_H)
    bst_a.save_model(MODEL_GOALS_A)
    print("Modèles XGBoost sauvegardés avec succès.")
    return bst_1x2, bst_h, bst_a

if not os.path.exists(MODEL_1X2):
    model_1x2, model_h, model_a = entrainer_suite_xgboost()
else:
    model_1x2 = xgb.Booster()
    model_1x2.load_model(MODEL_1X2)
    model_h = xgb.Booster()
    model_h.load_model(MODEL_GOALS_H)
    model_a = xgb.Booster()
    model_a.load_model(MODEL_GOALS_A)

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
        return {"status": "success", "total": len(matchs_filtres), "data": matchs_filtres}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}

# ---------------------------------------------------------------------------
# PRÉDICTION OFFICIELLE XGBOOST
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
    nom_h = data.home_team   
    nom_a = data.away_team   
    
    # 1. Matrice DMatrix XGBoost
    features = np.array([[data.cote_home, data.cote_away, data.historique_buts_home, data.historique_buts_away]])
    dmatrix = xgb.DMatrix(features)
    
    # 2. Inférence XGBoost : Probabilités 1X2 réelles issues des arbres de décision
    # model_1x2 renvoie un vecteur de 3 probabilités [P(1), P(X), P(2)]
    proba_1x2 = model_1x2.predict(dmatrix)[0]
    p_1 = round(float(proba_1x2[0]) * 100, 1)
    p_x = round(float(proba_1x2[1]) * 100, 1)
    p_2 = round(float(proba_1x2[2]) * 100, 1)
    
    # 3. Inférence XGBoost : Buts attendus
    pred_h = float(model_h.predict(dmatrix)[0])
    pred_a = float(model_a.predict(dmatrix)[0])
    
    b_home_f = max(0, int(round(pred_h)))
    b_away_f = max(0, int(round(pred_a)))
    
    # Sélection du résultat dominant
    if p_1 >= p_x and p_1 >= p_2:
        res_1x2 = "1"
        taux_reussite = p_1
        if b_home_f <= b_away_f:
            b_home_f = b_away_f + 1
    elif p_2 >= p_1 and p_2 >= p_x:
        res_1x2 = "2"
        taux_reussite = p_2
        if b_away_f <= b_home_f:
            b_away_f = b_home_f + 1
    else:
        res_1x2 = "X"
        taux_reussite = p_x
        moy = int(round((b_home_f + b_away_f) / 2))
        b_home_f, b_away_f = moy, moy

    total_match = b_home_f + b_away_f
    
    # Double chance
    p_1x = round(p_1 + p_x, 1)
    p_12 = round(p_1 + p_2, 1)
    p_2x = round(p_2 + p_x, 1)

    # Mi-temps
    ht_h = 1 if b_home_f >= 2 else (0 if b_home_f == 0 else (1 if pred_h > pred_a else 0))
    ht_a = 1 if b_away_f >= 2 else (0 if b_away_f == 0 else (1 if pred_a > pred_h else 0))
    res_ht = "1" if ht_h > ht_a else ("2" if ht_a > ht_h else "X")

    # Marchés dérivés
    btts = "OUI" if (b_home_f > 0 and b_away_f > 0) else "NON"
    chaque_equipe_1_plus = "OUI" if (b_home_f >= 1 and b_away_f >= 1) else "NON"
    over_2_5 = "OUI" if total_match > 2.5 else "NON"

    return {
        "status": "success",
        "match": f"{nom_h} vs {nom_a}",
        "taux_reussite_xgboost": f"{taux_reussite}%",
        "marches": {
            "marche_1X2": {
                "resultat": res_1x2,
                "probabilites": f"1: {p_1}% | X: {p_x}% | 2: {p_2}%"
            },
            "double_chance": {
                "1X": f"OUI ({p_1x}%)" if res_1x2 in ["1", "X"] else f"NON ({p_1x}%)",
                "12": f"OUI ({p_12}%)" if res_1x2 in ["1", "2"] else f"NON ({p_12}%)",
                "2X": f"OUI ({p_2x}%)" if res_1x2 in ["2", "X"] else f"NON ({p_2x}%)"
            },
            "total_buts": {
                "prediction": total_match,
                "over_2_5": over_2_5
            },
            "total_equipe_1": b_home_f,
            "total_equipe_2": b_away_f,
            "les_2_marquent": btts,
            "chaque_equipe_N_plus": chaque_equipe_1_plus,
            "total_1ere_MT": ht_h + ht_a,
            "total_2eme_MT": max(0, total_match - (ht_h + ht_a)),
            "pair_impair": "Pair" if total_match % 2 == 0 else "Impair",
            "score_exact": f"{b_home_f} - {b_away_f}",
            "score_exact_1ere_MT": f"{ht_h} - {ht_a}",
            "nombre_exact_de_buts": total_match,
            "mi_temps_fin_de_match": f"{res_ht}/{res_1x2}"
        }
    }
