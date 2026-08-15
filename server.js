const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io";

function headers() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

function today() {
  const d = new Date();

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

async function apiGet(path) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY n'est pas configurée.");
  }

  const response = await fetch(API_URL + path, {
    method: "GET",
    headers: headers()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "API-Football a retourné une réponse qui n'est pas du JSON. HTTP " +
      response.status
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

  if (
    data.errors &&
    typeof data.errors === "object" &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data;
}

function safeName(value) {
  return value ? String(value) : "Inconnu";
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const n = Number(
    String(value)
      .replace("%", "")
      .replace(",", ".")
      .trim()
  );

  if (!Number.isFinite(n)) {
    return null;
  }

  return n;
}

function percent(value) {
  const n = toNumber(value);

  if (n === null) {
    return "Non disponible";
  }

  return Math.round(n) + "%";
}

function validPercentage(value) {
  const n = toNumber(value);

  if (n === null) {
    return null;
  }

  if (n < 0 || n > 100) {
    return null;
  }

  return n;
}

/*
 * IMPORTANT :
 * Cette fonction accepte uniquement un véritable score
 * composé de deux nombres entiers positifs.
 *
 * Exemples acceptés :
 * 0-0
 * 1-0
 * 2-1
 * 3-2
 *
 * Exemples REFUSÉS :
 * -3.5--1.5
 * -2.5--3.5
 * +1.5
 * 2.5
 */
function realScore(home, away) {
  if (
    home === null ||
    home === undefined ||
    away === null ||
    away === undefined
  ) {
    return "Non disponible";
  }

  const homeText = String(home).trim();
  const awayText = String(away).trim();

  if (!/^\d+$/.test(homeText)) {
    return "Non disponible";
  }

  if (!/^\d+$/.test(awayText)) {
    return "Non disponible";
  }

  const h = Number(homeText);
  const a = Number(awayText);

  if (!Number.isInteger(h) || !Number.isInteger(a)) {
    return "Non disponible";
  }

  if (h < 0 || a < 0) {
    return "Non disponible";
  }

  if (h > 20 || a > 20) {
    return "Non disponible";
  }

  return h + "-" + a;
}

/*
 * Cherche un vrai score prévisionnel.
 *
 * On ne prend JAMAIS :
 * - under_over
 * - over
 * - under
 * - +1.5
 * - -2.5
 * comme score.
 */
function findPredictedScore(predictions) {
  if (!predictions || typeof predictions !== "object") {
    return "Non disponible";
  }

  const candidates = [];

  if (predictions.score) {
    candidates.push(predictions.score);
  }

  if (predictions.predicted_score) {
    candidates.push(predictions.predicted_score);
  }

  if (predictions.goals) {
    candidates.push(predictions.goals);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const h =
      candidate.home !== undefined
        ? candidate.home
        : null;

    const a =
      candidate.away !== undefined
        ? candidate.away
        : null;

    const result = realScore(h, a);

    if (result !== "Non disponible") {
      return result;
    }
  }

  return "Non disponible";
}

function findWinner(predictions, homeName, awayName) {
  if (!predictions) {
    return null;
  }

  if (predictions.winner) {
    if (typeof predictions.winner === "string") {
      return predictions.winner;
    }

    if (predictions.winner.name) {
      return predictions.winner.name;
    }
  }

  return null;
}

function getProbabilities(predictions) {
  const result = {
    home: null,
    draw: null,
    away: null
  };

  if (!predictions) {
    return result;
  }

  const p = predictions.percent || {};

  result.home = validPercentage(p.home);
  result.draw = validPercentage(p.draw);
  result.away = validPercentage(p.away);

  return result;
}

function confidence(probabilities) {
  const values = [
    probabilities.home,
    probabilities.draw,
    probabilities.away
  ].filter(function (v) {
    return v !== null;
  });

  if (values.length === 0) {
    return null;
  }

  return Math.max.apply(null, values);
}

function calculate1X(probabilities) {
  if (
    probabilities.home === null ||
    probabilities.draw === null
  ) {
    return null;
  }

  return Math.min(
    100,
    probabilities.home + probabilities.draw
  );
}

function calculateX2(probabilities) {
  if (
    probabilities.away === null ||
    probabilities.draw === null
  ) {
    return null;
  }

  return Math.min(
    100,
    probabilities.away + probabilities.draw
  );
}

function getUnderOver(predictions) {
  if (!predictions) {
    return "Non disponible";
  }

  if (predictions.under_over) {
    return String(predictions.under_over);
  }

  if (predictions.underOver) {
    return String(predictions.underOver);
  }

  if (predictions.goals && typeof predictions.goals === "string") {
    const value = String(predictions.goals);

    if (
      value.toLowerCase().includes("over") ||
      value.toLowerCase().includes("under")
    ) {
      return value;
    }
  }

  return "Non disponible";
}

function getBTTS(predictions) {
  if (!predictions) {
    return "Non disponible";
  }

  if (predictions.btts !== undefined) {
    return String(predictions.btts);
  }

  return "Non disponible";
}

function getWinOrDraw(mainPick, probabilities, homeName, awayName) {
  if (!mainPick) {
    return "Non disponible";
  }

  const oneX = calculate1X(probabilities);
  const xTwo = calculateX2(probabilities);

  if (mainPick === homeName && oneX !== null) {
    return oneX >= 50 ? "Oui" : "Non";
  }

  if (mainPick === awayName && xTwo !== null) {
    return xTwo >= 50 ? "Oui" : "Non";
  }

  return "Non";
}

function buildAdvice(
  mainPick,
  winOrDraw,
  underOver,
  homeName,
  awayName
) {
  if (!mainPick || mainPick === "Non disponible") {
    return "Aucun conseil disponible";
  }

  if (winOrDraw === "Oui") {
    if (mainPick === homeName) {
      if (underOver !== "Non disponible") {
        return (
          "Double chance : " +
          homeName +
          " ou nul et " +
          underOver
        );
      }

      return "Double chance : " + homeName + " ou nul";
    }

    if (mainPick === awayName) {
      if (underOver !== "Non disponible") {
        return (
          "Double chance : " +
          awayName +
          " ou nul et " +
          underOver
        );
      }

      return "Double chance : " + awayName + " ou nul";
    }
  }

  if (underOver !== "Non disponible") {
    return (
      "Victoire " +
      mainPick +
      " et " +
      underOver
    );
  }

  return "Victoire " + mainPick;
}

function normalizePrediction(item) {
  /*
   * API-Football retourne normalement :
   *
   * {
   *   predictions: {...},
   *   league: {...},
   *   teams: {...},
   *   fixture: {...}
   * }
   */

  const fixture = item.fixture || {};
  const teams = item.teams || {};
  const league = item.league || {};
  const predictions = item.predictions || {};

  const home = teams.home || {};
  const away = teams.away || {};

  const homeName = safeName(home.name);
  const awayName = safeName(away.name);

  const probabilities = getProbabilities(
    predictions
  );

  const winner = findWinner(
    predictions,
    homeName,
    awayName
  );

  let mainPick = winner;

  /*
   * Si l'API fournit un gagnant, on le conserve.
   *
   * Sinon, on choisit uniquement parmi les
   * probabilités réellement disponibles.
   */
  if (!mainPick) {
    const h = probabilities.home;
    const d = probabilities.draw;
    const a = probabilities.away;

    const candidates = [];

    if (h !== null) {
      candidates.push({
        name: homeName,
        value: h
      });
    }

    if (d !== null) {
      candidates.push({
        name: "Match nul",
        value: d
      });
    }

    if (a !== null) {
      candidates.push({
        name: awayName,
        value: a
      });
    }

    if (candidates.length > 0) {
      candidates.sort(function (x, y) {
        return y.value - x.value;
      });

      mainPick = candidates[0].name;
    }
  }

  if (!mainPick) {
    mainPick = "Non disponible";
  }

  const oneX = calculate1X(probabilities);
  const xTwo = calculateX2(probabilities);

  const conf = confidence(probabilities);

  const underOver = getUnderOver(
    predictions
  );

  const btts = getBTTS(
    predictions
  );

  const winOrDraw = getWinOrDraw(
    mainPick,
    probabilities,
    homeName,
    awayName
  );

  /*
   * SCORE EXACT :
   * on appelle uniquement findPredictedScore().
   *
   * Les valeurs comme +1.5 ou -2.5
   * ne peuvent donc plus apparaître ici.
   */
  const predictedScore =
    findPredictedScore(predictions);

  let halftimeScore = "Non disponible";

  if (
    predictions.score &&
    predictions.score.halftime
  ) {
    halftimeScore = realScore(
      predictions.score.halftime.home,
      predictions.score.halftime.away
    );
  }

  const advice = buildAdvice(
    mainPick,
    winOrDraw,
    underOver,
    homeName,
    awayName
  );

  return {
    match: {
      id: fixture.id || null,

      date: fixture.date || null,

      league: safeName(league.name),

      country: safeName(league.country),

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
      main_pick: mainPick,

      confidence:
        conf === null
          ? "Non disponible"
          : percent(conf),

      probabilities: {
        v1: percent(probabilities.home),
        draw: percent(probabilities.draw),
        v2: percent(probabilities.away),
        "1x": percent(oneX),
        "x2": percent(xTwo)
      },

      predicted_score: predictedScore,

      api_winner:
        winner || "Non disponible",

      win_or_draw: winOrDraw,

      under_over: underOver,

      btts: btts,

      halftime_score: halftimeScore,

      exact_score: predictedScore,

      exact_score_probability:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice: advice
    },

    available: true
  };
}

/*
 * PAGE PRINCIPALE
 */
app.get("/", function (req, res) {
  res.json({
    success: true,
    service: "Football Prediction Server",
    status: "online",
    date: today()
  });
});

/*
 * HEALTH CHECK
 */
app.get("/health", function (req, res) {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: Boolean(API_KEY),
    date: today()
  });
});

/*
 * PRÉDICTION D'UN MATCH PRÉCIS
 *
 * Exemple :
 * /api/prediction/1533065
 */
app.get(
  "/api/prediction/:fixtureId",
  async function (req, res) {
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

      if (
        !data.response ||
        data.response.length === 0
      ) {
        return res.json({
          success: false,
          fixture: fixtureId,
          message:
            "Aucune prédiction disponible pour ce match."
        });
      }

      const item = data.response[0];

      res.json({
        success: true,
        fixture: fixtureId,
        data: normalizePrediction(item)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
 * PRÉDICTIONS DU JOUR
 *
 * Exemple :
 * /api/predictions
 *
 * Ou :
 * /api/predictions?date=2026-08-15&limit=5
 */
app.get(
  "/api/predictions",
  async function (req, res) {
    try {
      const date =
        req.query.date || today();

      let limit = Number(
        req.query.limit || 5
      );

      if (!Number.isFinite(limit)) {
        limit = 5;
      }

      limit = Math.max(
        1,
        Math.min(20, Math.floor(limit))
      );

      const fixturesData =
        await apiGet(
          "/fixtures?date=" +
          encodeURIComponent(date)
        );

      const fixtures =
        Array.isArray(fixturesData.response)
          ? fixturesData.response
          : [];

      const upcoming =
        fixtures.filter(function (fixture) {
          const status =
            fixture &&
            fixture.fixture &&
            fixture.fixture.status
              ? fixture.fixture.status.short
              : null;

          return (
            status === "NS" ||
            status === "TBD"
          );
        });

      const selected =
        upcoming.slice(0, limit);

      const matches = [];

      for (const fixture of selected) {
        const fixtureId =
          fixture.fixture &&
          fixture.fixture.id
            ? fixture.fixture.id
            : null;

        if (!fixtureId) {
          continue;
        }

        try {
          const predictionData =
            await apiGet(
              "/predictions?fixture=" +
              encodeURIComponent(
                fixtureId
              )
            );

          if (
            predictionData.response &&
            predictionData.response.length > 0
          ) {
            matches.push(
              normalizePrediction(
                predictionData.response[0]
              )
            );
          }
        } catch (error) {
          matches.push({
            match: {
              id: fixtureId,

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
              main_pick:
                "Non disponible",

              confidence:
                "Non disponible",

              probabilities: {
                v1:
                  "Non disponible",

                draw:
                  "Non disponible",

                v2:
                  "Non disponible",

                "1x":
                  "Non disponible",

                "x2":
                  "Non disponible"
              },

              predicted_score:
                "Non disponible",

              api_winner:
                "Non disponible",

              win_or_draw:
                "Non disponible",

              under_over:
                "Non disponible",

              btts:
                "Non disponible",

              halftime_score:
                "Non disponible",

              exact_score:
                "Non disponible",

              exact_score_probability:
                "Non disponible",

              corners:
                "Non disponible",

              yellow_cards:
                "Non disponible",

              advice:
                "Données insuffisantes"
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
        predictions: matches.length,
        matches: matches
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message:
          "Impossible de récupérer les prédictions."
      });
    }
  }
);

/*
 * DÉMARRAGE
 */
app.listen(
  PORT,
  "0.0.0.0",
  function () {
    console.log(
      "Football Prediction Server actif sur le port " +
      PORT
    );
  }
);
