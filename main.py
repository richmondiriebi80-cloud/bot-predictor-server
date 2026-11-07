import os, math, json
from datetime import datetime
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import xgboost as xgb
from sklearn.metrics import brier_score_loss, log_loss

app = FastAPI(title="FIFA Predictor Honest v4", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_FILE  = "fifa_xgb_honest.json"
META_FILE   = "fifa_xgb_meta.json"
REPORT_FILE = "backtest_report.json"

model_xgb = None
model_meta = {"reliable": False, "roi_estimated": None}

# ⚠️ NOUVELLE URL VALIDÉE
LOVABLE_EXPORT = "https://goal-predictor-prov1.lovable.app/api/public/export-matches" 

def charger_modele():
    global model_xgb, model_meta
    if os.path.exists(MODEL_FILE) and os.path.exists(META_FILE):
        try:
            model_meta = json.load(open(META_FILE))
            if model_meta.get("reliable"):
                m = xgb.XGBClassifier(); m.load_model(MODEL_FILE)
                model_xgb = m
                print(f"✅ Modèle chargé (ROI backtest = {model_meta.get('roi_estimated')})")
            else:
                print("⚠️ Modèle présent mais NON fiable — ignoré.")
        except Exception as e:
            print(f"Erreur chargement : {e}")
charger_modele()

class AnalyseRequest(BaseModel):
    home_team: str
    away_team: str
    cote_home: float
    cote_draw: float
    cote_away: float
    cote_over55: Optional[float] = None
    cote_under55: Optional[float] = None

def devig_3way(oh, od, oa):
    ph, pd_, pa = 1/oh, 1/od, 1/oa
    s = ph + pd_ + pa
    return ph/s, pd_/s, pa/s

@app.post("/analyser-complet")
def analyser(req: AnalyseRequest):
    p_h, p_d, p_a = devig_3way(req.cote_home, req.cote_draw, req.cote_away)

    if model_xgb is None or not model_meta.get("reliable"):
        return {
            "status": "refused",
            "message": "❌ Modèle non fiable — backtest non concluant. NE MISEZ PAS.",
            "raison": model_meta.get("reason", "Pas de backtest positif"),
            "probabilites_marche": {"1": round(p_h*100,1), "X": round(p_d*100,1), "2": round(p_a*100,1)}
        }

    feats = np.array([[req.cote_home, req.cote_draw, req.cote_away,
                       req.cote_over55 or 1.9, req.cote_under55 or 1.9,
                       p_h, p_d, p_a,
                       np.log(req.cote_home/req.cote_away),
                       1/req.cote_home + 1/req.cote_draw + 1/req.cote_away]])
    p_over = float(model_xgb.predict_proba(feats)[0][1])
    p_mkt = (1/req.cote_over55) if req.cote_over55 else None
    edge = (p_over - p_mkt) if p_mkt else None

    reco = "Pas de pari (edge insuffisant)"
    if edge is not None and edge > 0.04:
        reco = f"VALUE sur OVER 5.5 (edge {edge*100:+.1f}%)"
    elif edge is not None and edge < -0.04:
        reco = f"VALUE sur UNDER 5.5 (edge {-edge*100:+.1f}%)"

    return {
        "status": "success",
        "p_modele_over55": f"{p_over*100:.1f}%",
        "p_marche_over55": f"{p_mkt*100:.1f}%" if p_mkt else "N/A",
        "edge": f"{edge*100:+.1f}%" if edge is not None else "N/A",
        "recommandation": reco,
        "meta": model_meta
    }

@app.get("/reentrainer")
def reentrainer(bt: BackgroundTasks):
    bt.add_task(_pipeline)
    return {"message": "Pipeline lancé. Consultez /rapport dans 1-2 min."}

def _pipeline():
    global model_xgb, model_meta
    try:
        print("=== Export Lovable ===")
        r = requests.get(LOVABLE_EXPORT, timeout=30)
        r.raise_for_status()
        
        try:
            data = r.json()
        except Exception:
            raise ValueError(f"L'URL n'a pas renvoyé de JSON. Réponse : {r.text[:100]}")
            
        df = pd.DataFrame(data)
        if df.empty:
            raise ValueError("Aucune donnée reçue.")

        # Correspondance des noms de colonnes
        rename = {
            "homeScore": "score_home", "awayScore": "score_away",
            "home_score": "score_home", "away_score": "score_away",
            "coteHome": "cote_home_open", "coteDraw": "cote_draw_open", "coteAway": "cote_away_open",
            "odds_home": "cote_home_open", "odds_draw": "cote_draw_open", "odds_away": "cote_away_open",
            "cote_over55": "cote_over55_open", "cote_under55": "cote_under55_open"
        }
        df = df.rename(columns={k:v for k,v in rename.items() if k in df.columns})
        
        if "date" not in df.columns or "score_home" not in df.columns:
            raise ValueError(f"Colonnes manquantes. Reçu : {list(df.columns)}")
            
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date","score_home","score_away"]).sort_values("date").reset_index(drop=True)
        
        # FIFA VIRTUEL : On regarde Over 5.5 buts
        df["total"] = df.score_home + df.score_away
        df["over55"] = (df.total > 5).astype(int)
        print(f"{len(df)} matchs au total. Taux Over 5.5 : {df.over55.mean()*100:.1f}%")

        # On supprime les matchs sans cotes (les anciens matchs de Lovable)
        cols_cotes = ["cote_home_open","cote_draw_open","cote_away_open","cote_over55_open","cote_under55_open"]
        
        # On s'assure que les colonnes existent 
        for c in cols_cotes:
            if c not in df.columns:
                df[c] = np.nan
                
        # Suppression des lignes sans cotes
        df = df.dropna(subset=cols_cotes)
        print(f"{len(df)} matchs valides avec cotes pour l'entraînement.")

        # Si on n'a pas assez de matchs avec cotes, on l'écrit dans le rapport
        if len(df) < 50:
            raise ValueError(
                f"Seulement {len(df)} matchs avec cotes. C'est NORMAL : les anciens matchs n'avaient pas de cotes. Laissez l'application tourner pour enregistrer de nouveaux matchs avec les cotes, puis revenez."
            )

        df["marge"] = 1/df.cote_home_open + 1/df.cote_draw_open + 1/df.cote_away_open
        df["p_h"] = (1/df.cote_home_open) / df["marge"]
        df["p_d"] = (1/df.cote_draw_open) / df["marge"]
        df["p_a"] = (1/df.cote_away_open) / df["marge"]
        df["log_ratio"] = np.log(df.cote_home_open / df.cote_away_open)

        feats = cols_cotes + ["p_h","p_d","p_a","log_ratio","marge"]
        X = df[feats].values.astype(float)
        y = df.over55.values.astype(int)

        split = int(len(df)*0.7)
        if split < 20:
            raise ValueError(f"Pas assez de matchs pour séparer Train/Test ({len(df)} matchs).")

        Xtr, Xte = X[:split], X[split:]
        ytr, yte = y[:split], y[split:]
        test = df.iloc[split:].copy()

        clf = xgb.XGBClassifier(n_estimators=100, max_depth=3, learning_rate=0.05,
                                 subsample=0.8, colsample_bytree=0.8,
                                 objective="binary:logistic", eval_metric="logloss")
        clf.fit(Xtr, ytr)

        proba = clf.predict_proba(Xte)[:,1]
        p_mkt_raw = (1/test.cote_over55_open).values
        p_mkt_n = p_mkt_raw / (p_mkt_raw + (1/test.cote_under55_open).values)

        brier_m = brier_score_loss(yte, proba)
        brier_mkt = brier_score_loss(yte, p_mkt_n)

        # ROI simulé
        gains, n_bets = [], 0
        for i, (_, r) in enumerate(test.iterrows()):
            edge = proba[i] - p_mkt_n[i]
            if edge > 0.04:
                gains.append((r.cote_over55_open - 1) if r.over55==1 else -1); n_bets += 1
            elif edge < -0.04:
                gains.append((r.cote_under55_open - 1) if r.over55==0 else -1); n_bets += 1
        roi = float(np.mean(gains)) if gains else None

        reliable = (roi is not None and roi > 0.02 and brier_m < brier_mkt and n_bets >= 30)
        reason = "OK" if reliable else (
            f"ROI={roi*100:+.1f}% (min +2%)" if roi is not None and roi <= 0.02 else
            f"Brier modèle {brier_m:.3f} ≥ marché {brier_mkt:.3f}" if brier_m >= brier_mkt else
            f"Seulement {n_bets} paris testés (min 30)"
        )

        meta = {
            "reliable": bool(reliable), "reason": reason,
            "n_train": split, "n_test": len(test),
            "roi_estimated": roi, "n_bets": n_bets,
            "date": datetime.utcnow().isoformat()
        }
        
        json.dump(meta, open(REPORT_FILE,"w"), indent=2, default=str)
        if reliable:
            clf.save_model(MODEL_FILE)
            model_xgb, model_meta = clf, meta
            json.dump(meta, open(META_FILE,"w"), indent=2, default=str)
            print("✅ MODÈLE DÉPLOYÉ")
        else:
            if os.path.exists(MODEL_FILE): os.remove(MODEL_FILE)
            model_xgb = None; model_meta = meta
            json.dump(meta, open(META_FILE,"w"), indent=2, default=str)
            print(f"❌ MODÈLE NON DÉPLOYÉ — {reason}")

    except Exception as e:
        print(f"❌ Pipeline : {e}")
        model_meta = {"reliable": False, "reason": str(e)}
        json.dump(model_meta, open(REPORT_FILE,"w"), indent=2, default=str)

@app.get("/rapport")
def rapport():
    if not os.path.exists(REPORT_FILE):
        return {"status": "no_report", "message": "Lance /reentrainer d'abord."}
    return json.load(open(REPORT_FILE))

@app.get("/")
def health():
    return {"status": "online", "model_deployed": model_xgb is not None,
            "reliable": model_meta.get("reliable", False),
            "roi": model_meta.get("roi_estimated")}