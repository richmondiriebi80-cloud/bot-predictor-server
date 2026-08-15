const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";

app.use(function(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", function(req, res) {
  res.json({
    success: true,
    status: "ok",
    service: "BOT PREDICTOR",
    engine: "recent form + poisson + h2h",
    recent_matches: 10,
    seasons_used: false,
    api_key_configured: API_KEY.length > 0,
    message: "Serveur operationnel"
  });
});

app.get("/health", function(req, res) {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: API_KEY.length > 0
  });
});

app.get("/predictions", async function(req, res) {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "API_FOOTBALL_KEY manquante dans Render"
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    const url =
      "https://v3.football.api-sports.io/fixtures?date=" +
      encodeURIComponent(today);

    const response = await fetch(url, {
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.errors || "Erreur API Football"
      });
    }

    const fixtures = Array.isArray(data.response)
      ? data.response
      : [];

    const matches = fixtures
      .filter(function(item) {
        const status =
          item &&
          item.fixture &&
          item.fixture.status &&
          item.fixture.status.short;

        return status === "NS" || status === "TBD";
      })
      .slice(0, 10)
      .map(function(item) {
        const home =
          item.teams && item.teams.home
            ? item.teams.home
            : {};

        const away =
          item.teams && item.teams.away
            ? item.teams.away
            : {};

        return {
          match: {
            id: item.fixture ? item.fixture.id : null,
            date: item.fixture ? item.fixture.date : null,
            league: item.league ? item.league.name : "Football",
            country: item.league ? item.league.country : "",
            home: {
              id: home.id || null,
              name: home.name || "Equipe domicile",
              logo: home.logo || ""
            },
            away: {
              id: away.id || null,
              name: away.name || "Equipe exterieure",
              logo: away.logo || ""
            }
          },

          prediction: {
            main_pick: "Analyse en cours",
            confidence: "Non disponible",
            probabilities: {
              v1: "Non disponible",
              draw: "Non disponible",
              v2: "Non disponible",
              "1x": "Non disponible",
              x2: "Non disponible"
            },
            predicted_score: "Non disponible",
            api_winner: "Non disponible",
            win_or_draw: "Non disponible",
            under_over: "Non disponible",
            btts: "Non disponible",
            halftime_score: "Non disponible",
            exact_score: "Non disponible",
            exact_score_probability: "Non disponible",
            corners: "Non disponible",
            yellow_cards: "Non disponible",
            advice: "Match recupere avec les donnees recentes"
          },

          analysis: {
            recent_matches: 10,
            seasons_used: false,
            engine: "recent form + poisson + h2h"
          },

          available: true
        };
      });

    return res.json({
      success: true,
      status: "ok",
      prediction_engine: "recent form + poisson + h2h",
      recent_matches: 10,
      seasons_used: false,
      analyzed: matches.length,
      predictions: matches.length,
      matches: matches,
      date: today
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/predictions", function(req, res) {
  res.redirect("/predictions");
});

app.listen(PORT, "0.0.0.0", function() {
  console.log("BOT PREDICTOR SERVER");
  console.log("PORT: " + PORT);
  console.log("API KEY: " + (API_KEY ? "CONFIGURED" : "MISSING"));
  console.log("SERVER READY");
});
