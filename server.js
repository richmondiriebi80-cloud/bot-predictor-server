const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const API_URL = "https://v3.football.api-sports.io";

function apiHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

function todayUTC() {
  const d = new Date();

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  return y + "-" + m + "-" + day;
}

async function apiGet(path) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY manquante dans les variables Render.");
  }

  const response = await fetch(API_URL + path, {
    method: "GET",
    headers: apiHeaders()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Réponse API non JSON. HTTP " +
      response.status +
      "."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      ": " +
      JSON.stringify(data)
    );
  }

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data;
}

function numberPercent(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const n = parseFloat(String(value).replace("%", ""));

  if (Number.isNaN(n)) {
    return fallback;
  }

  return Math.round(n);
}

function percentText(value) {
  if (value === null || value === undefined) {
    return "Non disponible";
  }

  return String(Math.round(value)) + "%";
}

function cleanName(value) {
  if (!value) {
    return "Inconnu";
  }

  return String(value);
}

function extractWinner(prediction, homeName, awayName) {
  if (!prediction || !prediction.winner) {
    return null;
  }

  if (prediction.winner.name) {
    return prediction.winner.name;
  }

  if (prediction.winner.id) {
    return String(prediction.winner.id);
  }

  return null;
}

function calculateConfidence(probabilities) {
  const values = [
    probabilities.v1,
    probabilities.draw,
    probabilities.v2
  ].filter(function (v) {
    return typeof v === "number";
  });

  if (values.length === 0) {
    return 0;
  }

  return Math.max.apply(null, values);
}

function normalizeScore(score) {
  if (!score) {
    return "Non disponible";
  }

  const home =
    score.home !== undefined &&
    score.home !== null
      ? score.home
      : null;

  const away =
    score.away !== undefined &&
    score.away !== null
      ? score.away
      : null;

  if (home === null || away === null) {
    return "Non disponible";
  }

  return String(home) + "-" + String(away);
}

function buildAdvice(mainPick, winOrDraw, underOver) {
  if (!mainPick) {
    return "Aucun conseil disponible";
  }

  if (winOrDraw === "Oui" && underOver) {
    return "Double chance : " + mainPick + " ou nul et " + underOver + " buts";
  }

  if (underOver) {
    return "Victoire " + mainPick + " et " + underOver + " buts";
  }

  if (winOrDraw === "Oui") {
    return "Double chance : " + mainPick + " ou nul";
  }

  return "Victoire " + mainPick;
}

function normalizePrediction(item) {
  const fixture = item.fixture || {};
  const teams = item.teams || {};
  const predictions = item.predictions || {};
  const percent = predictions.percent || {};

  const home = teams.home || {};
  const away = teams.away || {};

  const homeName = cleanName(home.name);
  const awayName = cleanName(away.name);

  const v1 = numberPercent(percent.home, null);
  const draw = numberPercent(percent.draw, null);
  const v2 = numberPercent(percent.away, null);

  const probabilities = {
    v1: v1,
    draw: draw,
    v2: v2
  };

  const confidence = calculateConfidence(probabilities);

  const winnerName = extractWinner(
    predictions,
    homeName,
    awayName
  );

  let mainPick = winnerName;

  if (!mainPick && v1 !== null && v2 !== null) {
    if (v1 >= v2 && v1 >= draw) {
      mainPick = homeName;
    } else if (v2 >= v1 && v2 >= draw) {
      mainPick = awayName;
    } else {
      mainPick = "Match nul";
    }
  }

  const goals = predictions.goals || {};

  const predictedScore = normalizeScore({
    home: goals.home,
    away: goals.away
  });

  let winOrDraw = "Non";

  if (predictions.win_or_draw !== undefined) {
    winOrDraw =
      predictions.win_or_draw === true ||
      String(predictions.win_or_draw).toLowerCase() === "true"
        ? "Oui"
        : "Non";
  } else if (v1 !== null && draw !== null) {
    if (mainPick === homeName && v1 + draw >= 50) {
      winOrDraw = "Oui";
    }

    if (mainPick === awayName && v2 !== null && v2 + draw >= 50) {
      winOrDraw = "Oui";
    }
  }

  let underOver = predictions.under_over || "Non disponible";

  if (underOver !== "Non disponible") {
    underOver = String(underOver);
  }

  let btts = predictions.btts || "Non disponible";

  if (btts !== "Non disponible") {
    btts = String(btts);
  }

  const score = predictions.score || {};

  const halftimeScore = normalizeScore(score.halftime);
  const exactScore = normalizeScore(score.fulltime);

  const advice = buildAdvice(
    mainPick,
    winOrDraw,
    underOver !== "Non disponible"
      ? underOver
      : null
  );

  return {
    match: {
      id: fixture.id || null,
      date: fixture.date || null,
      league: item.league
        ? item.league.name
        : "Inconnue",
      country: item.league
        ? item.league.country
        : "Inconnu",

      home: {
        id: home.id || null,
        name: homeName,
        logo: home.logo || null
      },

      away: {
        id: away.id || null,
        name: awayName,
        logo: away.logo || null
      }
    },

    prediction: {
      main_pick:
        mainPick || "Non disponible",

      confidence:
        confidence > 0
          ? percentText(confidence)
          : "Non disponible",

      probabilities: {
        v1: percentText(v1),
        draw: percentText(draw),
        v2: percentText(v2),

        "1x":
          v1 !== null && draw !== null
            ? percentText(v1 + draw)
            : "Non disponible",

        "x2":
          v2 !== null && draw !== null
            ? percentText(v2 + draw)
            : "Non disponible"
      },

      predicted_score:
        predictedScore,

      api_winner:
        winnerName || "Non disponible",

      win_or_draw:
        winOrDraw,

      under_over:
        underOver,

      btts:
        btts,

      halftime_score:
        halftimeScore,

      exact_score:
        exactScore,

      exact_score_probability:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        advice
    },

    available: true
  };
}

app.get("/", function (req, res) {
  res.json({
    success: true,
    service: "Football Prediction Server",
    status: "online",
    date: todayUTC()
  });
});

app.get("/health", function (req, res) {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: Boolean(API_KEY),
    date: todayUTC()
  });
});

app.get("/api/predictions", async function (req, res) {
  try {
    const date = req.query.date || todayUTC();

    const fixturesData = await apiGet(
      "/fixtures?date=" + encodeURIComponent(date)
    );

    const fixtures = Array.isArray(fixturesData.response)
      ? fixturesData.response
      : [];

    const limit = Math.min(
      Number(req.query.limit || 5),
      20
    );

    const selected = fixtures
      .filter(function (fixture) {
        return (
          fixture &&
          fixture.fixture &&
          fixture.fixture.status &&
          fixture.fixture.status.short &&
          ["NS", "TBD"].includes(
            fixture.fixture.status.short
          )
        );
      })
      .slice(0, limit);

    const results = [];

    for (const fixture of selected) {
      try {
        const id = fixture.fixture.id;

        const predictionData = await apiGet(
          "/predictions?fixture=" + encodeURIComponent(id)
        );

        if (
          predictionData.response &&
          predictionData.response.length > 0
        ) {
          const predictionItem =
            predictionData.response[0];

          results.push(
            normalizePrediction(predictionItem)
          );
        }
      } catch (error) {
        results.push({
          match: {
            id:
              fixture.fixture &&
              fixture.fixture.id
                ? fixture.fixture.id
                : null,

            date:
              fixture.fixture &&
              fixture.fixture.date
                ? fixture.fixture.date
                : null,

            league:
              fixture.league &&
              fixture.league.name
                ? fixture.league.name
                : "Inconnue",

            country:
              fixture.league &&
              fixture.league.country
                ? fixture.league.country
                : "Inconnu",

            home: {
              id:
                fixture.teams &&
                fixture.teams.home
                  ? fixture.teams.home.id
                  : null,

              name:
                fixture.teams &&
                fixture.teams.home
                  ? fixture.teams.home.name
                  : "Inconnu",

              logo:
                fixture.teams &&
                fixture.teams.home
                  ? fixture.teams.home.logo
                  : null
            },

            away: {
              id:
                fixture.teams &&
                fixture.teams.away
                  ? fixture.teams.away.id
                  : null,

              name:
                fixture.teams &&
                fixture.teams.away
                  ? fixture.teams.away.name
                  : "Inconnu",

              logo:
                fixture.teams &&
                fixture.teams.away
                  ? fixture.teams.away.logo
                  : null
            }
          },

          prediction: {
            main_pick: "Non disponible",
            confidence: "Non disponible",

            probabilities: {
              v1: "Non disponible",
              draw: "Non disponible",
              v2: "Non disponible",
              "1x": "Non disponible",
              "x2": "Non disponible"
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
            advice: "Données insuffisantes"
          },

          available: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      date: date,
      analyzed: selected.length,
      predictions: results.length,
      matches: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message:
        "Impossible de récupérer les prédictions."
    });
  }
});

app.get("/api/prediction/:fixtureId", async function (
  req,
  res
) {
  try {
    const fixtureId = req.params.fixtureId;

    if (!fixtureId) {
      return res.status(400).json({
        success: false,
        error: "fixtureId manquant"
      });
    }

    const data = await apiGet(
      "/predictions?fixture=" +
      encodeURIComponent(fixtureId)
    );

    if (!data.response || data.response.length === 0) {
      return res.json({
        success: false,
        fixture: fixtureId,
        message: "Aucune prédiction disponible."
      });
    }

    const prediction =
      normalizePrediction(data.response[0]);

    res.json({
      success: true,
      fixture: fixtureId,
      data: prediction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", function () {
  console.log(
    "Prediction server running on port " + PORT
  );
});
