import json
import urllib.request
from fastapi import HTTPException

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

@app.get("/flux-1xbet")
def recuperer_flux_1xbet():
    req = urllib.request.Request(
        URL_1XBET,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                raise HTTPException(status_code=502, detail="Erreur de réponse 1xBet")
            
            data = json.loads(response.read().decode("utf-8"))
            valeurs = data.get("Value", [])
            
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
        raise HTTPException(status_code=500, detail=f"Erreur : {str(e)}")
