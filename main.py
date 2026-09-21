from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import pydantic
import math
import os
import requests

app = FastAPI(title="Moteur XGBoost FIFA 1xbet Multi-Marchés")

# Configuration CORS pour autoriser Lovable à communiquer avec l'API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chargement sécurisé du modèle XGBoost (anti-crash si absent)
model = xgb.Booster()
if os.path.exists("modele_fifa_xgboost.json"):
    model.load_model("modele_fifa_xgboost.json")
    print("Modèle XGBoost chargé avec succès !")
else:
    print("Mode simulation activé.")

# Définition de la structure des données reçues pour l'analyse
class MatchInput(pydantic.BaseModel):
    home_team: str
    away_team: str
    historique_buts_home: float
    historique_buts_away: float
    cote_home: float
    cote_away: float

# --- ROUTE RELAIS RECOMMANDÉE POUR CONTOURNER LE CORS 1XBET ---
@app.get("/flux-1xbet")
def get_flux_1xbet():
    url = "https://1xbet.com"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la récupération 1xBet : {str(e)}")

# --- ROUTE PRINCIPALE D'ANALYSE PAR SCRIPT XGBOOST ---
@app.post("/analyser-complet")
def analyser_match(data: MatchInput):
    nom_complet_home = data.home_team   
    nom_complet_away = data.away_team   
    
    # 1. Préparation des variables
    features = [data.cote_home, data.cote_away, data.historique_buts_home, data.historique_buts_away]
    dmatrix = xgb.DMatrix([features])
    
    try:
        prediction = model.predict(dmatrix)
        import numpy as np
        if isinstance(prediction, np.ndarray):
            prediction = prediction.tolist()
        buts_totaux = float(prediction) if isinstance(prediction, list) else float(prediction)
    except Exception:
        # Algorithme de secours si le fichier JSON est vierge ou absent
        buts_totaux = (1 / data.cote_home * 3) + (1 / data.cote_away * 3)
    
    # Distribution statistique des buts
    ratio_home = data.cote_away / (data.cote_home + data.cote_away) if (data.cote_home + data.cote_away) > 0 else 0.5
    buts_home_fin = round(buts_totaux * ratio_home, 1)
    buts_away_fin = round(buts_totaux * (1 - ratio_home), 1)
    
    # Calcul Mi-Temps (~40% des buts totaux du match)
    buts_home_ht = math.floor(buts_home_fin * 0.4)
    buts_away_ht = math.floor(buts_away_fin * 0.4)
    
    # Arrondis pour scores exacts
    b_home_f = math.floor(buts_home_fin)
    b_away_f = math.floor(buts_away_fin)
    total_match = b_home_f + b_away_f
    total_ht = buts_home_ht + buts_away_ht
    
    # --- LOGIQUE D'ANALYSE DES MARCHÉS ---
    
    # 1X2 & Double Chance
    tendances = {"1": 1 / data.cote_home, "X": 0.25, "2": 1 / data.cote_away}
    total_tendance = sum(tendances.values())
    p_home = round((tendances["1"] / total_tendance) * 100, 1)
    p_away = round((tendances["2"] / total_tendance) * 100, 1)
    p_nul = round((tendances["X"] / total_tendance) * 100, 1)
    
    res_1x2 = "1" if b_home_f > b_away_f else ("2" if b_away_f > b_home_f else "X")
    
    # Les 2 marquent & Chaque équipe N+
    btts = "OUI" if b_home_f > 0 and b_away_f > 0 else "NON"
    chaque_equipe_1_plus = "OUI" if b_home_f >= 1 and b_away_f >= 1 else "NON"
    
    # Pair / Impair
    pair_impair = "Pair" if total_match % 2 == 0 else "Impair"
    
    # MT / Fin de match
    res_ht = "1" if buts_home_ht > buts_away_ht else ("2" if buts_away_ht > buts_home_ht else "X")
    mt_fin = f"{res_ht}/{res_1x2}"

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
            "total_2eme_MT": total_match - total_ht,
            "pair_impair": pair_impair,
            "score_exact": f"{b_home_f} - {b_away_f}",
            "score_exact_1ere_MT": f"{buts_home_ht} - {buts_away_ht}",
            "nombre_exact_de_buts": total_match,
            "mi_temps_fin_de_match": mt_fin
        }
    }
