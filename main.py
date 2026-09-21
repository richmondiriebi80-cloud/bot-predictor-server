from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import pydantic
import math
import os
import httpx

app = FastAPI(title="Moteur XGBoost FIFA 1xbet Multi-Marchés")

# Configuration CORS pour Lovable
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ligues FIFA ciblées
LIGUES_AUTORISEES = [
    "FC 26. England Championship",
    "FC 26. Champions League",
    "FC 26. Championnat du monde",
    "FC 25. Italy Championship",
    "FC 25. Ligue européenne",
    "FC 26. Germany Championship",
    "FC 26. Spain Championship",
]

URL_1XBET = "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=120&lng=fr&mode=4&virtualSports=true"

# Chargement sécurisé du modèle XGBoost
model = xgb.Booster()
if os.path.exists("modele_fifa_xgboost.json"):
    model.load_model("modele_fifa_xgboost.json")
    print("Modèle XGBoost chargé avec succès !")
else:
    print("Mode simulation activé.")

class MatchInput(pydantic.BaseModel):
    home_team: str
    away_team: str
    historique_buts_home: float
    historique_buts_away: float
    cote_home: float
    cote_away: float

# --- VOTRE ROUTE RELAIS FILTRÉE AVEC HTTPX ---
@app.get("/flux-1xbet")
async def recuperer_flux_1xbet():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(URL_1XBET, headers=headers)
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Erreur de réponse du fournisseur 1xBet")
            
            data = response.json()
            valeurs = data.get("Value", [])
            
            # Filtrage selon vos compétitions
            matchs_filtres = [
                m for m in valeurs 
                if any(ligue.lower() in m.get("L", "").lower() for ligue in LIGUES_AUTORISEES)
            ]
            
            return {
                "status": "success",
                "total": len(matchs_filtres),
                "data": matchs_filtres
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la récupération : {str(e)}")

# --- ROUTE PRINCIPALE D'ANALYSE PAR SCRIPT XGBOOST ---
@app.post("/analyser-complet")
def analyser_match(data: MatchInput):
    nom_complet_home = data.home_team   
    nom_complet_away = data.away_team   
    
    features = [data.cote_home, data.cote_away, data.historique_buts_home, data.historique_buts_away]
    dmatrix = xgb.DMatrix([features])
    
    try:
        prediction = model.predict(dmatrix)
        import numpy as np
        if isinstance(prediction, np.ndarray):
            prediction = prediction.tolist()
        buts_totaux = float(prediction) if isinstance(prediction, list) else float(prediction)
    except Exception:
        buts_totaux = (1 / data.cote_home * 3) + (1 / data.cote_away * 3)
    
    ratio_home = data.cote_away / (data.cote_home + data.cote_away) if (data.cote_home + data.cote_away) > 0 else 0.5
    buts_home_fin = round(buts_totaux * ratio_home, 1)
    buts_away_fin = round(buts_totaux * (1 - ratio_home), 1)
    
    buts_home_ht = math.floor(buts_home_fin * 0.4)
    buts_away_ht = math.floor(buts_away_fin * 0.4)
    
    b_home_f = math.floor(buts_home_fin)
    b_away_f = math.floor(buts_away_fin)
    total_match = b_home_f + b_away_f
    total_ht = buts_home_ht + buts_away_ht
    
    # 1X2 & Double Chance
    tendances = {"1": 1 / data.cote_home, "X": 0.25, "2": 1 / data.cote_away}
    total_tendance = sum(tendances.values())
    p_home = round((tendances["1"] / total_tendance) * 100, 1)
    p_away = round((tendances["2"] / total_tendance) * 100, 1)
    p_nul = round((tendances["X"] / total_tendance) * 100, 1)
    
    res_1x2 = "1" if b_home_f > b_away_f else ("2" if b_away_f > b_home_f else "X")
    btts = "OUI" if b_home_f > 0 and b_away_f > 0 else "NON"
    chaque_equipe_1_plus = "OUI" if b_home_f >= 1 and b_away_f >= 1 else "NON"
    pair_impair = "Pair" if total_match % 2 == 0 else "Impair"
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
