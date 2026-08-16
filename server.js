const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

const MAX_CANDIDATES = 7;
const MAX_DISPLAYED = 2;

/*
=========================================================
CORS
=========================================================
*/

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/*
=========================================================
OUTILS
=========================================================
*/

function num(value, fallback = 0) {
  const n = Number(
    String(value ?? "")
      .replace("%", "")
      .trim()
  );

  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/*
=========================================================
CACHE
=========================================================
*/

const cache = {
  fixtures: null,
  fixturesTime: 0,
  predictions: new Map()
};

const CACHE_TIME = 60 * 1000;

/*
=========================================================
API FOOTBALL
=========================================================
*/

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
      JSON.stringify(
        data.errors || {
          http: response.status
        }
      )
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

/*
=========================================================
MATCHS DU JOUR
=========================================================
*/

async function getTodayFixtures() {

  const now = Date.now();

  if (
    cache.fixtures &&
    now - cache.fixturesTime < CACHE_TIME
  ) {
    return cache.fixtures;
  }

  const date =
    new Date()
      .toISOString()
      .slice(0, 10);

  const data =
    await apiRequest(
      "/fixtures",
      { date }
    );

  const fixtures =
    Array.isArray(data.response)
      ? data.response
      : [];

  const upcoming =
    fixtures.filter(item => {

      const status =
        item.fixture?.status?.short;

      return (
        status === "NS" ||
        status === "TBD"
      );
    });

  cache.fixtures = upcoming;
  cache.fixturesTime = now;

  return upcoming;
}

/*
=========================================================
PREDICTION
=========================================================

UN SEUL appel prediction par match.
Aucun "last=7".
Aucun "last=10".
=========================================================
*/

async function getPrediction(fixtureId) {

  if (
    cache.predictions.has(fixtureId)
  ) {
    return cache.predictions.get(
      fixtureId
    );
  }

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

    const result = {
      prediction,
      error: null
    };

    cache.predictions.set(
      fixtureId,
      result
    );

    return result;

  } catch (error) {

    const result = {
      prediction: null,
      error: error.message
    };

    return result;
  }
}

/*
=========================================================
PROBABILITÉS
=========================================================
*/

function getProbabilities(prediction) {

  if (!prediction) {
    return null;
  }

  const percent =
    prediction.predictions?.percent ||
    prediction.percent ||
    null;

  if (!percent) {
    return null;
  }

  const home =
    num(percent.home, NaN);

  const draw =
    num(percent.draw, NaN);

  const away =
    num(percent.away, NaN);

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

/*
=========================================================
POISSON
=========================================================
*/

function calculatePoisson() {

  /*
   * Valeurs neutres uniquement lorsque
   * l'API ne fournit pas assez de données.
   *
   * Elles ne sont pas présentées comme
   * des statistiques réelles des équipes.
   */

  const homeLambda = 1.20;
  const awayLambda = 1.00;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = 0;
  let bestHome = 0;
  let bestAway = 0;

  for (
    let h = 0;
    h <= 6;
    h++
  ) {

    for (
      let a = 0;
      a <= 6;
      a++
    ) {

      const probability =
        poisson(homeLambda, h) *
        poisson(awayLambda, a);

      if (h > a) {
        homeWin += probability;
      } else if (h === a) {
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

        bestHome = h;
        bestAway = a;
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
      `${bestHome}-${bestAway}`,

    scoreProbability:
      bestProbability * 100,

    homeLambda,
    awayLambda
  };
}

/*
=========================================================
SCORE DE SÉLECTION
=========================================================
*/

function calculateSelectionScore(
  probabilities,
  poissonData
) {

  const apiBest =
    probabilities
      ? Math.max(
          probabilities.home,
          probabilities.draw,
          probabilities.away
        )
      : 0;

  const poissonBest =
    Math.max(
      poissonData.home,
      poissonData.draw,
      poissonData.away
    );

  /*
   * La prédiction API est prioritaire.
   */

  if (probabilities) {

    return clamp(
      apiBest * 0.75 +
      poissonBest * 0.25,
      0,
      100
    );
  }

  return clamp(
    poissonBest,
    0,
    100
  );
}

/*
=========================================================
ANALYSE D'UN MATCH
=========================================================
*/

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
    !fixtureId ||
    !home?.id ||
    !away?.id
  ) {
    return null;
  }

  /*
   * UN SEUL appel API supplémentaire :
   * /predictions
   */

  const predictionResult =
    await getPrediction(
      fixtureId
    );

  const prediction =
    predictionResult.prediction;

  const probabilities =
    getProbabilities(
      prediction
    );

  const poissonData =
    calculatePoisson();

  /*
   * Probabilités finales.
   */

  const finalProbabilities =
    probabilities || {
      home: poissonData.home,
      draw: poissonData.draw,
      away: poissonData.away
    };

  /*
   * Vainqueur.
   */

  let mainPick;

  const apiWinner =
    prediction?.predictions?.winner?.name ||
    prediction?.winner?.name ||
    null;

  if (apiWinner) {

    mainPick =
      apiWinner;

  } else if (
    finalProbabilities.home >=
      finalProbabilities.draw &&
    finalProbabilities.home >=
      finalProbabilities.away
  ) {

    mainPick =
      home.name;

  } else if (
    finalProbabilities.away >=
      finalProbabilities.home &&
    finalProbabilities.away >=
      finalProbabilities.draw
  ) {

    mainPick =
      away.name;

  } else {

    mainPick =
      "Match nul";
  }

  /*
   * Score API.
   */

  const apiGoals =
    prediction?.predictions?.goals ||
    prediction?.goals ||
    null;

  let predictedScore =
    poissonData.score;

  if (
    apiGoals &&
    apiGoals.home !== undefined &&
    apiGoals.away !== undefined
  ) {

    predictedScore =
      `${num(apiGoals.home)}-${num(apiGoals.away)}`;
  }

  /*
   * Confiance.
   */

  const confidence =
    Math.max(
      finalProbabilities.home,
      finalProbabilities.draw,
      finalProbabilities.away
    );

  /*
   * Sélection.
   */

  const selectionScore =
    calculateSelectionScore(
      probabilities,
      poissonData
    );

  /*
   * Qualité.
   */

  let dataQuality = 0;

  if (prediction) {
    dataQuality += 70;
  }

  if (probabilities) {
    dataQuality += 30;
  }

  /*
   * BTTS.
   */

  const btts =
    prediction?.predictions?.under_over ||
    prediction?.predictions?.goals?.under_over ||
    "Non disponible";

  /*
   * Under / Over.
   */

  let underOver =
    prediction?.predictions?.under_over ||
    prediction?.under_over ||
    null;

  if (!underOver) {

    const total =
      poissonData.homeLambda +
      poissonData.awayLambda;

    underOver =
      total >= 2.5
        ? "Over 2.5"
        : "Under 2.5";
  }

  let advice;

  if (
    dataQuality >= 100
  ) {

    advice =
      "Analyse API complète";

  } else if (
    dataQuality >= 70
  ) {

    advice =
      "Analyse basée sur la prédiction API";

  } else {

    advice =
      "Données API limitées";
  }

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
          finalProbabilities.home
            .toFixed(1) +
          "%",

        draw:
          finalProbabilities.draw
            .toFixed(1) +
          "%",

        v2:
          finalProbabilities.away
            .toFixed(1) +
          "%",

        "1x":
          (
            finalProbabilities.home +
            finalProbabilities.draw
          ).toFixed(1) +
          "%",

        x2:
          (
            finalProbabilities.draw +
            finalProbabilities.away
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
        apiWinner ||
        "Non disponible",

      win_or_draw:
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
          selectionScore
            .toFixed(2)
        ),

      data_quality:
        dataQuality,

      recent_matches:
        "Non disponible avec le plan API actuel",

      h2h_count:
        0,

      poisson: {

        home_lambda:
          poissonData.homeLambda,

        away_lambda:
          poissonData.awayLambda,

        predicted_score:
          poissonData.score
      },

      api_prediction_available:
        Boolean(prediction),

      api_probabilities_available:
        Boolean(probabilities),

      data_sources: {

        prediction:
          prediction
            ? "ok"
            : "error",

        recent_form:
          "unavailable",

        h2h:
          "not_requested"
      },

      errors: {

        prediction:
          predictionResult.error,

        recent_form:
          "Le paramètre last est indisponible sur le plan API actuel",

        h2h:
          "Non demandé afin de respecter la limite de requêtes"
      },

      seasons_used:
        false,

      engine:
        "API prediction + poisson"
    },

    available:
      true
  };
}

/*
=========================================================
RACINE
=========================================================
*/

app.get("/", (req, res) => {

  res.json({

    success: true,

    status: "ok",

    service:
      "BOT PREDICTOR",

    prediction_engine:
      "API prediction + poisson",

    candidates_requested:
      MAX_CANDIDATES,

    displayed:
      MAX_DISPLAYED,

    api_key_configured:
      Boolean(API_KEY),

    rate_limit_protection:
      true,

    message:
      "Serveur opérationnel"
  });
});

/*
=========================================================
HEALTH
=========================================================
*/

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

    rate_limit_protection:
      true
  });
});

/*
=========================================================
PREDICTIONS
=========================================================
*/

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
     * Récupération des matchs.
     *
     * Cette requête est mise en cache
     * pendant 60 secondes.
     */

    const fixtures =
      await getTodayFixtures();

    /*
     * Maximum 7 candidats.
     */

    const candidates =
      fixtures.slice(
        0,
        MAX_CANDIDATES
      );

    const analyzed = [];

    /*
     * IMPORTANT :
     *
     * Les appels sont séquentiels.
     * On attend entre les appels afin
     * de ne pas dépasser la limite.
     */

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {

      const fixture =
        candidates[i];

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
          "Analyse ignorée :",
          fixture.fixture?.id,
          error.message
        );
      }

      /*
       * Petite pause entre les appels.
       */

      if (
        i <
        candidates.length - 1
      ) {

        await sleep(7000);
      }
    }

    /*
     * Classement.
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
     * Seulement les 2 meilleurs.
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

    res.json({

      success: true,

      status: "ok",

      prediction_engine:
        "API prediction + poisson",

      candidates_requested:
        MAX_CANDIDATES,

      candidates_analyzed:
        analyzed.length,

      predictions:
        topTwo.length,

      displayed:
        topTwo.length,

      selection:
        "Top 2 after complete analysis",

      rate_limit_protection:
        true,

      matches:
        topTwo,

      recent_matches:
        "Non disponible sur le plan API actuel",

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

/*
=========================================================
ROUTES
=========================================================
*/

app.get(
  "/predictions",
  predictionsHandler
);

app.get(
  "/api/predictions",
  predictionsHandler
);

/*
=========================================================
START
=========================================================
*/

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
      "RATE LIMIT PROTECTION: ON"
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
