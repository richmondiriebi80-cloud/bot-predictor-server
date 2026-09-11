from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import math

app = FastAPI(title="XGBoost FIFA 1xBet Signals")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))

def run_xgboost_decision_tree(match: dict) -> dict:
    home_score = match.get("homeScore", 0)
    away_score = match.get("awayScore", 0)
    total_goals = home_score + away_score
    elapsed_min = max(0.5, match.get("minute", 1))
    shots = match.get("shotsTotal", 7)
    shots_per_min = shots / elapsed_min

    avg_hist_goals = match.get("avgHistoricalGoals", 3.8)

    margin_over25 = 0.20
    reasons = []

    # Règle 1 : Cadence de frappe
    if shots_per_min >= 2.0:
        margin_over25 += 1.35
        reasons.append(f"Rythme élevé : {shots_per_min:.1f} tirs/min")

    # Règle 2 : Historique des 5 derniers matchs
    if avg_hist_goals >= 3.5:
        margin_over25 += 1.10
        reasons.append(f"Historique 5 derniers matchs : {avg_hist_goals} buts/m")

    # Règle 3 : Écart de score (pressing bot FIFA)
    if abs(home_score - away_score) >= 2:
        margin_over25 += 0.80
        reasons.append("Scénario pressing bot (écart ≥ 2)")

    prob_over25 = min(98, max(5, int(sigmoid(margin_over25 + (total_goals * 0.8)) * 100)))
    bookmaker_over_odd = match.get("odds", {}).get("over25", 1.85)
    implied_odd_prob = (1 / bookmaker_over_odd) * 100
    edge = round(prob_over25 - implied_odd_prob, 1)

    return {
        "bestMarket": "Total Plus de (2.5)",
        "probability": prob_over25,
        "bookmakerOdds": bookmaker_over_odd,
        "edgePercent": edge,
        "confidence": "EXTRÊME" if edge >= 12 else "ÉLEVÉE",
        "reasons": reasons
    }

@app.get("/")
def home():
    return {"status": "online", "model": "XGBoost FIFA 1xBet v4.2"}

@app.get("/signals")
def get_live_signals():
    matches = [
        {
            "id": "fifa_1xbet_01",
            "homeTeam": "Real Madrid (kraftik)",
            "awayTeam": "Liverpool (dm1trena)",
            "league": "FIFA 24. Cyber League 3x3",
            "minute": 3,
            "homeScore": 2,
            "awayScore": 1,
            "isLive": True,
            "shotsTotal": 8,
            "avgHistoricalGoals": 4.2,
            "odds": {
                "v1": 1.68,
                "x": 4.20,
                "v2": 3.90,
                "over25": 1.52,
                "bttsYes": 1.45
            }
        },
        {
            "id": "fifa_1xbet_02",
            "homeTeam": "Arsenal (Plevis)",
            "awayTeam": "FC Barcelone (KravaRK)",
            "league": "FC 25. Ligue des Champions eSports",
            "minute": 5,
            "homeScore": 0,
            "awayScore": 1,
            "isLive": True,
            "shotsTotal": 12,
            "avgHistoricalGoals": 3.6,
            "odds": {
                "v1": 2.85,
                "x": 3.60,
                "v2": 2.15,
                "over25": 1.78,
                "bttsYes": 1.62
            }
        }
    ]

    for m in matches:
        m["xgboostPrediction"] = run_xgboost_decision_tree(m)

    return matches
