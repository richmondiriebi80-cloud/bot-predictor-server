import httpx
from fastapi import HTTPException

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
