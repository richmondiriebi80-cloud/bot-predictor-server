const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

const MAX_CANDIDATES = 7;
const MAX_DISPLAYED = 2;

app.use(express.json());

/* =========================================================
   CORS SANS MODULE EXTERNE
========================================================= */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =========================================================
   OUTILS
========================================================= */

function number(value, fallback = 0) {
  if (typeof value === "string") {
    value = value.replace("%", "").trim();
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}

function average(values) {
  if (!values.length) return 0;

  return (
    values.reduce((a, b) => a + b, 0) /
    values.length
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(lambda, goals) {
  lambda = Math.max(0.01, lambda);

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals)
  ) / factorial(goals);
}

/* =========================================================
   REQUÊTE API-FOOTBALL
========================================================= */

async function apiRequest(endpoint, params = {}) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render"
    );
  }

  const query =
    new URLSearchParams(params);

  const url =
    API_URL +
    endpoint +
    "?" +
    query.toString();

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    });

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Réponse API invalide"
    );
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      " : " +
      JSON.stringify(data.errors || {})
    );
  }

  if (
    data.errors &&
    Object.keys(data.errors).length
  ) {
    throw new Error(
      JSON.stringify(data.errors)
    );
  }

  return data;
}

/* =========================================================
   MATCHS DU JOUR
========================================================= */

async function getTodayFixtures() {

  const date =
    new Date()
      .toISOString()
      .slice(0, 10);

  const data =
    await apiRequest(
      "/fixtures",
      {
        date
      }
    );

  const fixtures =
    Array.isArray(data.response)
      ? data.response
      : [];

  return fixtures.filter((item) => {

    const status =
      item.fixture?.status?.short;

    return (
      status === "NS" ||
      status === "TBD"
    );
  });
}

/* =========================================================
   PREDICTION API
========================================================= */

async function getPrediction(fixtureId) {

  try {

    const data =
      await apiRequest(
        "/predictions",
        {
          fixture:
            String(fixtureId)
        }
      );

    const prediction =
      Array.isArray(data.response) &&
      data.response.length
        ? data.response[0]
        : null;

    return {
      prediction,
      error: null
    };

  } catch (error) {

    return {
      prediction: null,
      error: error.message
    };
  }
}

/* =========================================================
   H2H
   IMPORTANT :
   Aucun paramètre "last" n'est utilisé.
========================================================= */

async function getH2H(homeId, awayId) {

  try {

    const data =
      await apiRequest(
        "/fixtures/headtohead",
        {
          h2h:
            String(homeId) +
            "-" +
            String(awayId)
        }
      );

    const matches =
      Array.isArray(data.response)
        ? data.response
        : [];

    return {
      matches,
      error: null
    };

  } catch (error) {

    return {
      matches: [],
      error: error.message
    };
  }
}

/* =========================================================
   STATISTIQUES DISPONIBLES
========================================================= */

async function getTeamStatistics(
  teamId,
  leagueId,
  season
) {

  try {

    if (!leagueId || !season) {
      return {
        data: null,
        error: "League ou saison indisponible"
      };
    }

    const data =
      await apiRequest(
        "/teams/statistics",
        {
          team:
            String(teamId),

          league:
            String(leagueId),

          season:
            String(season)
        }
      );

    return {
      data:
        data.response || null,

      error: null
    };

  } catch (error) {

    return {
      data: null,
      error: error.message
    };
  }
}

/* =========================================================
   EXTRACTION PROBABILITÉS API
========================================================= */

function getApiPercentages(prediction) {

  if (!prediction) {
    return null;
  }

  const percent =
    prediction.percent ||
    prediction.predictions?.percent ||
    null;

  if (!percent) {
    return null;
  }

  const home =
    number(percent.home, NaN);

  const draw =
    number(percent.draw, NaN);

  const away =
    number(percent.away, NaN);

  if (
    !Number.isFinite(home) ||
    !Number.isFinite(draw) ||
    !Number.isFinite(away)
  ) {
    return null;
  }

  return {
    home,
    draw,
    away
  };
}

/* =========================================================
   POISSON
========================================================= */

function calculatePoisson(
  homeStats,
  awayStats
) {

  let homeLambda = 1.2;
  let awayLambda = 1.0;

  /*
   * On utilise les statistiques
   * seulement lorsqu'elles existent.
   */

  if (homeStats) {

    const gf =
      number(
        homeStats.goals?.for?.average?.total,
        NaN
      );

    const ga =
      number(
        homeStats.goals?.against?.average?.total,
        NaN
      );

    if (Number.isFinite(gf)) {
      homeLambda =
        Math.max(0.2, gf);
    }

    if (Number.isFinite(ga)) {
      awayLambda =
        Math.max(0.2, ga);
    }
  }

  if (awayStats) {

    const gf =
      number(
        awayStats.goals?.for?.average?.total,
        NaN
      );

    if (Number.isFinite(gf)) {
      awayLambda =
        Math.max(
          0.2,
          (
            awayLambda +
            gf
          ) / 2
        );
    }
  }

  homeLambda =
    clamp(
      homeLambda,
      0.2,
      4
    );

  awayLambda =
    clamp(
      awayLambda,
      0.2,
      4
    );

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = 0;
  let bestHome = 0;
  let bestAway = 0;

  for (
    let homeGoals = 0;
    homeGoals <= 6;
    homeGoals++
  ) {

    for (
      let awayGoals = 0;
      awayGoals <= 6;
      awayGoals++
    ) {

      const probability =
        poisson(
          homeLambda,
          homeGoals
        ) *
        poisson(
          awayLambda,
          awayGoals
        );

      if (homeGoals > awayGoals) {
        homeWin += probability;

      } else if (
        homeGoals === awayGoals
      ) {
        draw += probability;

      } else {
        awayWin += probability;
      }

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        bestHome =
          homeGoals;

        bestAway =
          awayGoals;
      }
    }
  }

  return {
    home:
      homeWin * 100,

    draw:
      draw * 100,

    away:
      awayWin * 100,

    score:
      bestHome +
      "-" +
      bestAway,

    scoreProbability:
      bestProbability * 100,

    homeLambda,
    awayLambda
  };
}

/* =========================================================
   SCORE DE SÉLECTION
========================================================= */

function selectionScore(
  apiPercent,
  poissonData,
  h2hCount
) {

  let score = 0;

  /*
   * API prediction :
   * facteur principal.
   */

  if (apiPercent) {

    const best =
      Math.max(
        apiPercent.home,
        apiPercent.draw,
        apiPercent.away
      );

    score +=
      clamp(best, 0, 100) *
      0.65;
  }

  /*
   * Poisson.
   */

  const poissonBest =
    Math.max(
      poissonData.home,
      poissonData.draw,
      poissonData.away
    );

  score +=
    poissonBest * 0.25;

  /*
   * H2H.
   */

  if (h2hCount > 0) {
    score += 10;
  }

  return clamp(
    score,
    0,
    100
  );
}

/* =========================================================
   ANALYSE D'UN MATCH
========================================================= */

async function analyzeFixture(
  fixture
) {

  const home =
    fixture.teams?.home;

  const away =
    fixture.teams?.away;

  const fixtureId =
    fixture.fixture?.id;

  if (
    !home?.id ||
    !away?.id ||
    !fixtureId
  ) {
    return null;
  }

  /*
   * On récupère les prédictions
   * et le H2H.
   *
   * Aucun last=7.
   */

  const [
    predictionResult,
    h2hResult
  ] =
    await Promise.all([
      getPrediction(
        fixtureId
      ),

      getH2H(
        home.id,
        away.id
      )
    ]);

  const prediction =
    predictionResult.prediction;

  const h2hMatches =
    h2hResult.matches;

  /*
   * Probabilités API.
   */

  const apiPercent =
    getApiPercentages(
      prediction
    );

  /*
   * Poisson indépendant.
   */

  const poissonData =
    calculatePoisson(
      null,
      null
    );

  /*
   * Probabilités finales.
   */

  const probabilities =
    apiPercent
      ? apiPercent
      : {
          home:
            poissonData.home,

          draw:
            poissonData.draw,

          away:
            poissonData.away
        };

  /*
   * Vainqueur.
   */

  let mainPick;

  if (
    probabilities.home >=
      probabilities.draw &&
    probabilities.home >=
      probabilities.away
  ) {

    mainPick =
      home.name;

  } else if (
    probabilities.away >=
      probabilities.home &&
    probabilities.away >=
      probabilities.draw
  ) {

    mainPick =
      away.name;

  } else {

    mainPick =
      "Match nul";
  }

  /*
   * Vainqueur fourni par API.
   */

  const apiWinner =
    prediction?.winner?.name ||
    prediction?.predictions?.winner?.name ||
    "Non disponible";

  if (
    apiWinner !==
    "Non disponible"
  ) {
    mainPick =
      apiWinner;
  }

  /*
   * Score API.
   */

  let apiScore = null;

  const predictionGoals =
    prediction?.goals ||
    prediction?.predictions?.goals ||
    null;

  if (
    predictionGoals &&
    predictionGoals.home !== undefined &&
    predictionGoals.away !== undefined
  ) {

    apiScore =
      number(
        predictionGoals.home
      ) +
      "-" +
      number(
        predictionGoals.away
      );
  }

  const predictedScore =
    apiScore ||
    poissonData.score;

  /*
   * Confiance.
   */

  const confidence =
    apiPercent
      ? Math.max(
          apiPercent.home,
          apiPercent.draw,
          apiPercent.away
        )
      : Math.max(
          poissonData.home,
          poissonData.draw,
          poissonData.away
        );

  /*
   * Score de sélection.
   */

  const score =
    selectionScore(
      apiPercent,
      poissonData,
      h2hMatches.length
    );

  /*
   * Qualité des données.
   */

  let dataQuality = 0;

  if (prediction) {
    dataQuality += 70;
  }

  if (apiPercent) {
    dataQuality += 20;
  }

  if (h2hMatches.length) {
    dataQuality += 10;
  }

  /*
   * Conseil.
   */

  let advice;

  if (dataQuality >= 90) {

    advice =
      "Analyse complète disponible";

  } else if (dataQuality >= 70) {

    advice =
      "Analyse API disponible";

  } else {

    advice =
      "Données limitées";
  }

  /*
   * BTTS.
   */

  const btts =
    prediction?.btts ||
    prediction?.predictions?.btts ||
    (
      poissonData.homeLambda >= 0.8 &&
      poissonData.awayLambda >= 0.8
        ? "Oui"
        : "Non"
    );

  /*
   * Under / Over.
   */

  const underOver =
    prediction?.under_over ||
    prediction?.predictions?.under_over ||
    (
      poissonData.homeLambda +
      poissonData.awayLambda >= 2.5
        ? "Over 2.5"
        : "Under 2.5"
    );

  return {

    match: {

      id:
        fixtureId,

      date:
        fixture.fixture?.date ||
        null,

      league:
        fixture.league?.name ||
        "Football",

      country:
        fixture.league?.country ||
        "",

      home: {

        id:
          home.id,

        name:
          home.name,

        logo:
          home.logo || ""
      },

      away: {

        id:
          away.id,

        name:
          away.name,

        logo:
          away.logo || ""
      }
    },

    prediction: {

      main_pick:
        mainPick,

      confidence:
        confidence.toFixed(1) +
        "%",

      probabilities: {

        v1:
          probabilities.home.toFixed(1) +
          "%",

        draw:
          probabilities.draw.toFixed(1) +
          "%",

        v2:
          probabilities.away.toFixed(1) +
          "%",

        "1x":
          (
            probabilities.home +
            probabilities.draw
          ).toFixed(1) +
          "%",

        x2:
          (
            probabilities.draw +
            probabilities.away
          ).toFixed(1) +
          "%"
      },

      predicted_score:
        predictedScore,

      exact_score:
        predictedScore,

      exact_score_probability:
        poissonData.scoreProbability
          .toFixed(1) +
        "%",

      api_winner:
        apiWinner,

      win_or_draw:
        prediction?.win_or_draw ||
        "Non disponible",

      under_over:
        underOver,

      btts:
        btts,

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        advice
    },

    analysis: {

      selection_score:
        Number(
          score.toFixed(2)
        ),

      data_quality:
        dataQuality,

      candidates_limit:
        MAX_CANDIDATES,

      h2h_count:
        h2hMatches.length,

      poisson: {

        home_lambda:
          Number(
            poissonData.homeLambda
              .toFixed(2)
          ),

        away_lambda:
          Number(
            poissonData.awayLambda
              .toFixed(2)
          ),

        predicted_score:
          poissonData.score
      },

      api_prediction_available:
        Boolean(prediction),

      api_probabilities_available:
        Boolean(apiPercent),

      data_sources: {

        prediction:
          prediction
            ? "ok"
            : "error",

        h2h:
          h2hResult.error
            ? "error"
            : "ok"
      },

      errors: {

        prediction:
          predictionResult.error,

        h2h:
          h2hResult.error
      },

      recent_matches:
        "Non disponible avec le plan API actuel",

      seasons_used:
        false,

      engine:
        "API prediction + poisson + h2h"
    },

    available:
      true
  };
}

/* =========================================================
   RACINE
========================================================= */

app.get("/", (req, res) => {

  res.json({

    success: true,

    status: "ok",

    service:
      "BOT PREDICTOR",

    prediction_engine:
      "API prediction + poisson + h2h",

    candidates_requested:
      MAX_CANDIDATES,

    displayed:
      MAX_DISPLAYED,

    seasons_used:
      false,

    api_key_configured:
      Boolean(API_KEY),

    message:
      "Serveur opérationnel"
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    success: true,

    status: "ok",

    api_key_configured:
      Boolean(API_KEY),

    candidates:
      MAX_CANDIDATES,

    displayed:
      MAX_DISPLAYED,

    seasons_used:
      false
  });
});

/* =========================================================
   PREDICTIONS
========================================================= */

async function predictionsHandler(
  req,
  res
) {

  try {

    if (!API_KEY) {

      return res.status(500).json({

        success: false,

        error:
          "API_FOOTBALL_KEY manquante dans Render"
      });
    }

    /*
     * 1. Matchs du jour.
     */

    const fixtures =
      await getTodayFixtures();

    /*
     * 2. Maximum 7 candidats.
     */

    const candidates =
      fixtures.slice(
        0,
        MAX_CANDIDATES
      );

    const analyzed = [];

    /*
     * 3. Analyse.
     */

    for (
      const fixture of candidates
    ) {

      try {

        const result =
          await analyzeFixture(
            fixture
          );

        if (result) {
          analyzed.push(result);
        }

      } catch (error) {

        console.log(
          "Erreur analyse fixture",
          fixture.fixture?.id,
          error.message
        );
      }
    }

    /*
     * 4. Classement.
     */

    analyzed.sort(
      (a, b) => {

        if (
          b.analysis.selection_score !==
          a.analysis.selection_score
        ) {

          return (
            b.analysis.selection_score -
            a.analysis.selection_score
          );
        }

        return (
          b.analysis.data_quality -
          a.analysis.data_quality
        );
      }
    );

    /*
     * 5. Seulement les 2 meilleurs.
     */

    const topTwo =
      analyzed.slice(
        0,
        MAX_DISPLAYED
      );

    topTwo.forEach(
      (item, index) => {

        item.analysis.rank =
          index + 1;
      }
    );

    const date =
      new Date()
        .toISOString()
        .slice(0, 10);

    /*
     * 6. Réponse finale.
     */

    res.json({

      success: true,

      status: "ok",

      prediction_engine:
        "API prediction + poisson + h2h",

      candidates_requested:
        candidates.length,

      candidates_analyzed:
        analyzed.length,

      predictions:
        topTwo.length,

      displayed:
        topTwo.length,

      selection:
        "Top 2 after analysis",

      matches:
        topTwo,

      recent_matches:
        "Plan API actuel: paramètre last indisponible",

      seasons_used:
        false,

      date
    });

  } catch (error) {

    console.error(
      "PREDICTIONS ERROR:",
      error
    );

    res.status(500).json({

      success: false,

      error:
        error.message
    });
  }
}

/* =========================================================
   ROUTES
========================================================= */

app.get(
  "/predictions",
  predictionsHandler
);

app.get(
  "/api/predictions",
  predictionsHandler
);

/* =========================================================
   DÉMARRAGE
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "BOT PREDICTOR"
    );

    console.log(
      "SERVER READY"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "CANDIDATS:",
      MAX_CANDIDATES
    );

    console.log(
      "AFFICHAGE:",
      MAX_DISPLAYED
    );

    console.log(
      "LAST PARAMETER: DISABLED"
    );

    console.log(
      "API KEY:",
      API_KEY
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "================================"
    );
  }
);
