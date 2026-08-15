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

async function apiGet(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY n'est pas configurée.");
  }

  const response = await fetch(API_URL + endpoint, {
    method: "GET",
    headers: apiHeaders()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse API non JSON. HTTP " + response.status
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

function safeNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const n = Number(
    String(value)
      .replace("%", "")
      .replace(",", ".")
      .trim()
  );

  return Number.isFinite(n) ? n : null;
}

function percent(value) {
  const n = safeNumber(value);

  if (n === null || n < 0 || n > 100) {
    return "Non disponible";
  }

  return Math.round(n) + "%";
}

/*
 * Ne considère comme score que deux entiers.
 * Les valeurs comme +1.5, -2.5 ou 2.5 sont refusées.
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

  const h = String(home).trim();
  const a = String(away).trim();

  if (!/^\d+$/.test(h) || !/^\d+$/.test(a)) {
    return "Non disponible";
  }

  const hn = Number(h);
  const an = Number(a);

  if (
    !Number.isInteger(hn) ||
    !Number.isInteger(an) ||
    hn < 0 ||
    an < 0 ||
    hn > 20 ||
    an > 20
  ) {
    return "Non disponible";
  }

  return hn + "-" + an;
}

/*
 * Récupération des informations du match
 * directement depuis /fixtures?id=...
 */
async function getFixture(fixtureId) {
  const data = await apiGet(
    "/fixtures?id=" +
    encodeURIComponent(fixtureId)
  );

  if (
    !data.response ||
    !Array.isArray(data.response) ||
    data.response.length === 0
  ) {
    return null;
  }

  return data.response[0];
}

/*
 * Récupération de la prédiction
 */
async function getPrediction(fixtureId) {
  const data = await apiGet(
    "/predictions?fixture=" +
    encodeURIComponent(fixtureId)
  );

  if (
    !data.response ||
    !Array.isArray(data.response) ||
    data.response.length === 0
  ) {
    return null;
  }

  return data.response[0];
}

/*
 * Probabilités API-Football
 */
function getProbabilities(predictions) {
  const p =
    predictions &&
    predictions.percent
      ? predictions.percent
      : {};

  return {
    home: safeNumber(p.home),
    draw: safeNumber(p.draw),
    away: safeNumber(p.away)
  };
}

/*
 * 1X = victoire domicile + nul
 * X2 = nul + victoire extérieur
 */
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

/*
 * Gagnant fourni par API-Football
 */
function getWinner(predictions) {
  if (!predictions) {
    return null;
  }

  if (
    predictions.winner &&
    typeof predictions.winner === "object"
  ) {
    return predictions.winner.name || null;
  }

  if (typeof predictions.winner === "string") {
    return predictions.winner;
  }

  return null;
}

/*
 * Score exact : uniquement si l'API fournit
 * réellement deux nombres entiers.
 */
function getPredictedScore(predictions) {
  if (!predictions) {
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

  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const score = realScore(
      item.home,
      item.away
    );

    if (score !== "Non disponible") {
      return score;
    }
  }

  return "Non disponible";
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

  /*
   * Ne jamais utiliser une valeur de marché
   * comme score exact.
   */
  return "Non disponible";
}

function getBTTS(predictions) {
  if (
    predictions &&
    predictions.btts !== undefined &&
    predictions.btts !== null
  ) {
    return String(predictions.btts);
  }

  return "Non disponible";
}

function getConfidence(probabilities) {
  const values = [
    probabilities.home,
    probabilities.draw,
    probabilities.away
  ].filter(
    value =>
      value !== null &&
      value >= 0 &&
      value <= 100
  );

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function getMainPick(
  winner,
  probabilities,
  homeName,
  awayName
) {
  /*
   * Si API-Football fournit un gagnant,
   * on le conserve.
   */
  if (winner) {
    return winner;
  }

  const candidates = [];

  if (probabilities.home !== null) {
    candidates.push({
      name: homeName,
      probability: probabilities.home
    });
  }

  if (probabilities.draw !== null) {
    candidates.push({
      name: "Match nul",
      probability: probabilities.draw
    });
  }

  if (probabilities.away !== null) {
    candidates.push({
      name: awayName,
      probability: probabilities.away
    });
  }

  if (candidates.length === 0) {
    return "Non disponible";
  }

  candidates.sort(
    (a, b) =>
      b.probability - a.probability
  );

  return candidates[0].name;
}

function getWinOrDraw(
  mainPick,
  probabilities,
  homeName,
  awayName
) {
  const oneX =
    calculate1X(probabilities);

  const xTwo =
    calculateX2(probabilities);

  if (mainPick === homeName) {
    if (oneX === null) {
      return "Non disponible";
    }

    return oneX >= 50 ? "Oui" : "Non";
  }

  if (mainPick === awayName) {
    if (xTwo === null) {
      return "Non disponible";
    }

    return xTwo >= 50 ? "Oui" : "Non";
  }

  return "Non disponible";
}

function buildAdvice(
  mainPick,
  winOrDraw,
  underOver,
  homeName,
  awayName
) {
  if (
    !mainPick ||
    mainPick === "Non disponible" ||
    mainPick === "Match nul"
  ) {
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

      return (
        "Double chance : " +
        homeName +
        " ou nul"
      );
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

      return (
        "Double chance : " +
        awayName +
        " ou nul"
      );
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

/*
 * Construction finale d'une prédiction.
 *
 * On utilise :
 * - /fixtures pour ID/date/équipes
 * - /predictions pour les probabilités
 */
function buildResult(fixture, prediction) {
  const fixtureInfo =
    fixture && fixture.fixture
      ? fixture.fixture
      : {};

  const fixtureTeams =
    fixture && fixture.teams
      ? fixture.teams
      : {};

  const fixtureLeague =
    fixture && fixture.league
      ? fixture.league
      : {};

  const home =
    fixtureTeams.home || {};

  const away =
    fixtureTeams.away || {};

  const homeName =
    home.name || "Inconnu";

  const awayName =
    away.name || "Inconnu";

  const predictions =
    prediction &&
    prediction.predictions
      ? prediction.predictions
      : {};

  const probabilities =
    getProbabilities(predictions);

  const winner =
    getWinner(predictions);

  const mainPick =
    getMainPick(
      winner,
      probabilities,
      homeName,
      awayName
    );

  const confidenceValue =
    getConfidence(probabilities);

  const oneX =
    calculate1X(probabilities);

  const xTwo =
    calculateX2(probabilities);

  const underOver =
    getUnderOver(predictions);

  const btts =
    getBTTS(predictions);

  const winOrDraw =
    getWinOrDraw(
      mainPick,
      probabilities,
      homeName,
      awayName
    );

  const predictedScore =
    getPredictedScore(predictions);

  let halftimeScore =
    "Non disponible";

  if (
    predictions.score &&
    predictions.score.halftime
  ) {
    halftimeScore =
      realScore(
        predictions.score.halftime.home,
        predictions.score.halftime.away
      );
  }

  return {
    match: {
      id:
        fixtureInfo.id ||
        null,

      date:
        fixtureInfo.date ||
        null,

      league:
        fixtureLeague.name ||
        "Inconnu",

      country:
        fixtureLeague.country ||
        "Inconnu",

      home: {
        id:
          home.id ||
          null,

        name:
          homeName,

        logo:
          home.logo ||
          null
      },

      away: {
        id:
          away.id ||
          null,

        name:
          awayName,

        logo:
          away.logo ||
          null
      }
    },

    prediction: {
      main_pick:
        mainPick,

      confidence:
        confidenceValue === null
          ? "Non disponible"
          : percent(confidenceValue),

      probabilities: {
        v1:
          percent(probabilities.home),

        draw:
          percent(probabilities.draw),

        v2:
          percent(probabilities.away),

        "1x":
          percent(oneX),

        "x2":
          percent(xTwo)
      },

      /*
       * IMPORTANT :
       * ici il ne peut plus y avoir
       * -3.5--1.5 ou -2.5--3.5.
       */
      predicted_score:
        predictedScore,

      api_winner:
        winner ||
        "Non disponible",

      win_or_draw:
        winOrDraw,

      under_over:
        underOver,

      btts:
        btts,

      halftime_score:
        halftimeScore,

      exact_score:
        predictedScore,

      exact_score_probability:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        buildAdvice(
          mainPick,
          winOrDraw,
          underOver,
          homeName,
          awayName
        )
    },

    available: true
  };
}

/*
 * ACCUEIL
 */
app.get("/", (req, res) => {
  res.json({
    success: true,
    service:
      "Football Prediction Server",
    status: "online",
    date: new Date()
      .toISOString()
      .slice(0, 10)
  });
});

/*
 * HEALTH
 */
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured:
      Boolean(API_KEY),

    date: new Date()
      .toISOString()
      .slice(0, 10)
  });
});

/*
 * PRÉDICTION D'UN MATCH
 *
 * /api/prediction/1533065
 */
app.get(
  "/api/prediction/:fixtureId",
  async (req, res) => {
    try {
      const fixtureId =
        req.params.fixtureId;

      if (!fixtureId) {
        return res.status(400).json({
          success: false,
          error:
            "fixtureId manquant"
        });
      }

      /*
       * IMPORTANT :
       * On fait DEUX appels séparés.
       */
      const fixture =
        await getFixture(
          fixtureId
        );

      const prediction =
        await getPrediction(
          fixtureId
        );

      if (!fixture) {
        return res.status(404).json({
          success: false,
          fixture: fixtureId,
          error:
            "Match introuvable dans API-Football."
        });
      }

      if (!prediction) {
        return res.json({
          success: true,
          fixture: fixtureId,
          data: {
            match: {
              id:
                fixture.fixture &&
                fixture.fixture.id
                  ? fixture.fixture.id
                  : Number(fixtureId),

              date:
                fixture.fixture &&
                fixture.fixture.date
                  ? fixture.fixture.date
                  : null,

              league:
                fixture.league &&
                fixture.league.name
                  ? fixture.league.name
                  : "Inconnu",

              country:
                fixture.league &&
                fixture.league.country
                  ? fixture.league.country
                  : "Inconnu",

              home:
                fixture.teams &&
                fixture.teams.home
                  ? fixture.teams.home
                  : {},

              away:
                fixture.teams &&
                fixture.teams.away
                  ? fixture.teams.away
                  : {}
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
                "Aucune prédiction disponible"
            },

            available: false
          }
        });
      }

      const result =
        buildResult(
          fixture,
          prediction
        );

      res.json({
        success: true,
        fixture: fixtureId,
        data: result
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/*
 * PRÉDICTIONS DU JOUR
 *
 * /api/predictions
 */
app.get(
  "/api/predictions",
  async (req, res) => {
    try {
      const date =
        req.query.date ||
        new Date()
          .toISOString()
          .slice(0, 10);

      let limit =
        Number(req.query.limit || 5);

      if (!Number.isFinite(limit)) {
        limit = 5;
      }

      limit = Math.max(
        1,
        Math.min(
          20,
          Math.floor(limit)
        )
      );

      const fixtureData =
        await apiGet(
          "/fixtures?date=" +
          encodeURIComponent(date)
        );

      const fixtures =
        Array.isArray(
          fixtureData.response
        )
          ? fixtureData.response
          : [];

      const upcoming =
        fixtures.filter(
          fixture => {
            const status =
              fixture.fixture &&
              fixture.fixture.status
                ? fixture.fixture.status.short
                : null;

            return (
              status === "NS" ||
              status === "TBD"
            );
          }
        );

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
          const prediction =
            await getPrediction(
              fixtureId
            );

          if (prediction) {
            matches.push(
              buildResult(
                fixture,
                prediction
              )
            );
          }

        } catch (error) {
          console.error(
            "Erreur match " +
            fixtureId,
            error
          );
        }
      }

      res.json({
        success: true,
        date: date,
        analyzed:
          selected.length,

        predictions:
          matches.length,

        matches:
          matches
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error:
          error.message
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
  () => {
    console.log(
      "Football Prediction Server actif sur le port " +
      PORT
    );
  }
);
