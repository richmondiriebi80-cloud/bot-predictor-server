
@app.post("/analyser-complet")
def analyser_match(data: MatchInput):
    # Récupération des noms pour des logs ou de la logique conditionnelle
    nom_complet_home = data.home_team   # ex: "Oll_22 (Real Madrid)"
    nom_complet_away = data.away_team   # ex: "Sno_11 (Barcelona)"
    
    # 1. Préparation des variables chiffrées (Features) pour votre XGBoost
    # Note : XGBoost a besoin d'historiques. Si Lovable ne lui envoie que les cotes, 
    # vous pouvez baser votre prédiction sur les cotes actuelles fournies par l'API 1xbet.
    features = [
        data.cote_home,               # Cote Victoire Équipe 1
        data.cote_away,               # Cote Victoire Équipe 2
        data.historique_buts_home,    # Envoyer 0 ou une valeur par défaut si indisponible
        data.historique_buts_away     # Envoyer 0 ou une valeur par défaut si indisponible
    ]
    
    dmatrix = xgb.DMatrix([features])
    
    try:
        prediction = model.predict(dmatrix)
        # Convertir en liste si c'est un tableau numpy
        import numpy as np
        if isinstance(prediction, np.ndarray):
            prediction = prediction.tolist()
            
        # Si votre modèle retourne une seule valeur (ex: total de buts attendus)
        buts_totaux = float(prediction[0]) if isinstance(prediction, list) else float(prediction)
    except Exception as e:
        # Algorithme de secours basé sur les cotes si le modèle JSON n'est pas chargé
        # Plus la cote est basse, plus l'équipe est censée marquer
        buts_totaux = (1 / data.cote_home * 3) + (1 / data.cote_away * 3)
    
    # Répartition statistique des buts selon la puissance des cotes
    ratio_home = data.cote_away / (data.cote_home + data.cote_away)
    buts_home_fin = round(buts_totaux * ratio_home, 1)
    buts_away_fin = round(buts_totaux * (1 - ratio_home), 1)
    
    # Calcul Mi-Temps (Scénario FIFA Virtuel standard : ~40% des buts en 1ère mi-temps)
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
