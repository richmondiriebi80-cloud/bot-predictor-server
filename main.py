from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import pydantic
import math
import os

app = FastAPI(title="Moteur XGBoost FIFA 1xbet")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chargement sécurisé du modèle XGBoost
model = xgb.Booster()
if os.path.exists("modele_fifa_xgboost.json"):
    model.load_model("modele_fifa_xgboost.json")
    print("Modèle XGBoost chargé avec succès !")
else:
    print("ATTENTION : Le fichier 'modele_fifa_xgboost.json' est introuvable. Mode simulation activé.")

# Définition des données attendues de Lovable
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
    
    # 1. Préparation des variables chiffrées (Features) pour XGBoost
    features = [
        data.cote_home,               
        data.cote_away,               
        data.historique_buts_home,    
        data.historique_buts_away     
    ]
    
    dmatrix = xgb.DMatrix([features])
    
    # 2. Prédiction brute XGBoost (Buts attendus)
    try:
        prediction = model.predict(dmatrix)
        import numpy as np
        if isinstance(prediction, np.ndarray):
            prediction = prediction.tolist()
            
        buts_totaux = float(prediction[0]) if isinstance(prediction, list) else float(prediction)
    except Exception as e:
        # Algorithme de secours basé sur les cotes en cas d'absence du fichier JSON
        print(f"Erreur modèle : {e}. Calcul par défaut activé.")
        buts_totaux = (1 / data.cote_home * 3) + (1 / data.cote_away * 3)
    
    # Répartition statistique des buts
    ratio_home = data.cote_away / (data.cote_home + data.cote_away) if (data.cote_home + data.cote_away) > 0 else 0.5
    buts_home_fin = round(buts_totaux * ratio_home, 1)
    buts_away_fin = round(buts_totaux * (1 - ratio_home), 1)
    
    # Calcul Mi-Temps (~40% des buts totaux du match)
    buts_home_ht = math.floor(buts_home_fin * 0.4)
    buts_away_ht = math.floor(buts_away_fin * 0.4)
    
    total_buts_predit = round(buts_home_fin + buts_away_fin, 2)
    
    return {
        "status": "success",
        "match": f"{nom_complet_home} vs {nom_complet_away}",
        "statistiques_predites": {
            "buts_domicile_fin": math.floor(buts_home_fin),
            "buts_exterieur_fin": math.floor(buts_away_fin),
            "total_buts_match": total_buts_predit
        },
        "scores_exacts": {
            "mi_temps": f"{buts_home_ht} - {buts_away_ht}",
            "fin_du_match": f"{math.floor(buts_home_fin)} - {math.floor(buts_away_fin)}"
        },
        "over_under": {
            "over_1_5": "OUI" if total_buts_predit > 1.5 else "NON",
            "over_2_5": "OUI" if total_buts_predit > 2.5 else "NON",
            "over_3_5": "OUI" if total_buts_predit > 3.5 else "NON"
        },
        "conseil_principal": "Over 2.5 Buts" if total_buts_predit > 2.4 else "Victoire " + (nom_complet_home if buts_home_fin > buts_away_fin else nom_complet_away)
    }
