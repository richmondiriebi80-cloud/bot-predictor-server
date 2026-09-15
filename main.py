from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import pydantic
import math

app = FastAPI(title="Moteur XGBoost FIFA 1xbet")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chargement du modèle XGBoost (ou des modèles si vous en avez un par catégorie)
model = xgb.Booster()
model.load_model("modele_fifa_xgboost.json")

# Les données que Lovable possède déjà et va envoyer à l'API
class MatchInput(pydantic.BaseModel):
    home_team: str
    away_team: str
    historique_buts_home: float  # Moyenne de buts marqués par l'équipe Domicile
    historique_buts_away: float  # Moyenne de buts marqués par l'équipe Extérieur
    cote_home: float             # Cote 1xbet Victoire Domicile
    cote_away: float             # Cote 1xbet Victoire Extérieur

@app.post("/analyser-complet")
def analyser_match(data: MatchInput):
    # 1. Préparation des données pour XGBoost (Exemple de features)
    features = [data.historique_buts_home, data.historique_buts_away, data.cote_home, data.cote_away]
    dmatrix = xgb.DMatrix([features])
    
    # 2. Simulation de la prédiction brute XGBoost (Buts attendus)
    # Dans un vrai modèle multi-output, XGBoost renvoie une liste de chiffres
    prediction = model.predict(dmatrix) 
    
    # Extraction des buts prédits (Exemple de répartition basée sur l'arbre XGBoost)
    buts_home_fin = round(float(prediction[0]), 1) if isinstance(prediction, list) else round(float(prediction) * 0.55, 1)
    buts_away_fin = round(float(prediction[1]), 1) if isinstance(prediction, list) else round(float(prediction) * 0.45, 1)
    
    # Calcul automatique de la Mi-Temps (souvent 40% à 45% des buts totaux sur FIFA virtuel)
    buts_home_ht = math.floor(buts_home_fin * 0.45)
    buts_away_ht = math.floor(buts_away_fin * 0.45)
    
    total_buts_predit = round(buts_home_fin + buts_away_fin, 2)
    
    # 3. Génération des pronostics Over/Under et Scores Exacts
    return {
        "status": "success",
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
        "conseil_principal": "Victoire Domicile & Over 1.5" if buts_home_fin > buts_away_fin else "Plus de 2.5 Buts"
    }
