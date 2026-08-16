const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

const CANDIDATES = 7;
const DISPLAYED = 2;

app.use(express.json());

/* =========================
   CORS
========================= */

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

/* =========================
   OUTILS
========================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function number(value, fallback = null) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const n = Number(
    String(value)
      .replace("%", "")
      .trim()
  );

  return Number.isFinite(n)
    ? n
    : fallback;
}

function percentage(value) {
  const n = number(value);

  if (n === null) {
    return null;
  }

  return Math.max(
    0,
    Math.min(100, n)
  );
}

function poisson(lambda, goals) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals)
  ) / factorial(goals);
}

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

/* =========================
   CACHE
========================= */

let fixturesCache = null;
let fixturesCacheTime = 0;

const predictionCache = new Map();

const CACHE_TIME =
  60 * 1000;

/* =========================
   API FOOTBALL
========================= */

async function apiRequest(
  endpoint,
  params = {}
) {
  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante"
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
      headers: {
        "x-apisports-key":
          API_KEY,
        "Accept":
          "application/json"
      }
    });

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
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

/* =========================
   MATCHS DU JOUR
========================= */

async function getFixtures() {
  const now = Date.now();

  if (
    fixturesCache &&
    now - fixturesCacheTime <
      CACHE_TIME
  ) {
    return fixturesCache;
  }

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

  const response =
    Array.isArray(data.response)
      ? data.response
      : [];

  const upcoming =
    response.filter(item => {

      const status =
        item.fixture?.status?.short;

      return (
        status === "NS" ||
        status === "TBD"
      );
    });

  fixturesCache =
    upcoming;

  fixturesCacheTime =
    now;

  return upcoming;
}

/* =========================
   PREDICTION API
========================= */

async function getPrediction(
  fixtureId
) {
  if (
    predictionCache.has(
      fixtureId
    )
  ) {
    return predictionCache.get(
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
      Array.isArray(
        data.response
      ) &&
      data.response.length
        ? data.response[0]
        : null;

    const result = {
      prediction,
      error: null
    };

    predictionCache.set(
      fixtureId,
      result
    );

    return result;

  } catch (error) {

    return {
      prediction: null,
      error:
        error.message
    };
  }
}

/* =========================
   PROBABILITÉS API
========================= */

function readApiProbabilities(
  prediction
) {
  if (!prediction) {
    return null;
  }

  const percent =
    prediction.predictions
      ?.percent;

  if (!percent) {
    return null;
  }

  const home =
    percentage(percent.home);

  const draw =
    percentage(percent.draw);

  const away =
    percentage(percent.away);

  if (
    home === null ||
    draw === null ||
    away === null
  ) {
    return null;
  }

  return {
    home,
    draw,
    away
  };
}

/* =========================
   POISSON
========================= */

function calculatePoisson() {

  /*
   * Modèle de secours lorsque
   * l'API ne fournit pas toutes
   * les statistiques nécessaires.
   */

  const homeLambda =
    1.20;

  const awayLambda =
    1.00;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = 0;
  let bestHome = 0;
  let bestAway = 0;

  for (
    let home = 0;
    home <= 6;
    home++
  ) {

    for (
      let away = 0;
      away <= 6;
      away++
    ) {

      const p =
        poisson(
          homeLambda,
          home
        ) *
        poisson(
          awayLambda,
          away
        );

      if (home > away) {
        homeWin += p;
      } else if (home === away) {
        draw += p;
      } else {
        awayWin += p;
      }

      if (
        p >
        bestProbability
      ) {
        bestProbability = p;
        bestHome = home;
        bestAway = away;
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

/* =========================
   SCORE API
========================= */

function getApiScore(
  prediction
) {
  const goals =
    prediction
      ?.predictions
      ?.goals;

  if (!goals) {
    return null;
  }

  const home =
    number(goals.home);

  const away =
    number(goals.away);

  /*
   * On refuse les valeurs
   * qui ne sont pas des buts.
   */

  if (
    home === null ||
    away === null ||
    home < 0 ||
    away < 0 ||
    home > 20 ||
    away > 20 ||
    !Number.isInteger(home) ||
    !Number.isInteger(away)
  ) {
    return null;
  }

  return `${home}-${away}`;
}

/* =========================
   BTTS
========================= */

function getBTTS(
  prediction
) {
  const value =
    prediction
      ?.predictions
      ?.under_over;

  if (
    typeof value !==
    "string"
  ) {
    return "Non disponible";
  }

  const lower =
    value.toLowerCase();

  if (
    lower.includes("yes") ||
    lower.includes("oui")
  ) {
    return "Oui";
  }

  if (
    lower.includes("no") ||
    lower.includes("non")
  ) {
    return "Non";
  }

  return "Non disponible";
}

/* =========================
   UNDER / OVER
========================= */

function getUnderOver(
  prediction,
  poissonData
) {
  const value =
    prediction
      ?.predictions
      ?.under_over;

  if (
    typeof value ===
    "string"
  ) {

    const lower =
      value.toLowerCase();

    if (
      lower.includes("2.5") &&
      (
        lower.includes("under") ||
        lower.includes("moins")
      )
    ) {
      return "Moins de 2.5";
    }

    if (
      lower.includes("2.5") &&
      (
        lower.includes("over") ||
        lower.includes("plus")
      )
    ) {
      return "Plus de 2.5";
    }
  }

  const total =
    poissonData.homeLambda +
    poissonData.awayLambda;

  return total >= 2.5
    ? "Plus de 2.5"
    : "Moins de 2.5";
}

/* =========================
   ANALYSE
========================= */

async function analyzeFixture(
  fixture
) {
  const fixtureId =
    fixture.fixture?.id;

  const home =
    fixture.teams?.home;

  const away =
    fixture.teams?.away;

  if (
    !fixtureId ||
    !home ||
    !away
  ) {
    return null;
  }

  /*
   * UN SEUL appel supplémentaire
   * par match.
   */

  const predictionResult =
    await getPrediction(
      fixtureId
    );

  const prediction =
    predictionResult.prediction;

  const apiProbabilities =
    readApiProbabilities(
      prediction
    );

  const poissonData =
    calculatePoisson();

  /*
   * API prioritaire.
   */

  const probabilities =
    apiProbabilities || {
      home:
        poissonData.home,

      draw:
        poissonData.draw,

      away:
        poissonData.away
    };

  /*
   * Vainqueur API.
   */

  const apiWinner =
    prediction
      ?.predictions
      ?.winner
      ?.name || null;

  let mainPick;

  if (apiWinner) {

    mainPick =
      apiWinner;

  } else if (
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
   * Score.
   */

  const apiScore =
    getApiScore(
      prediction
    );

  const predictedScore =
    apiScore ||
    poissonData.score;

  /*
   * Confiance.
   */

  const confidence =
    Math.max(
      probabilities.home,
      probabilities.draw,
      probabilities.away
    );

  /*
   * Score de sélection.
   */

  const selectionScore =
    confidence;

  /*
   * Qualité des données.
   */

  let dataQuality = 0;

  if (prediction) {
    dataQuality += 70;
  }

  if (apiProbabilities) {
    dataQuality += 30;
  }

  /*
   * BTTS.
   */

  const btts =
    getBTTS(
      prediction
    );

  /*
   * Under / Over.
   */

  const underOver =
    getUnderOver(
      prediction,
      poissonData
    );

  /*
   * Conseil.
   */

  let advice;

  if (
    dataQuality === 100
  ) {

    advice =
      "Analyse basée sur la prédiction API + Poisson";

  } else if (
    dataQuality >= 70
  ) {

    advice =
      "Prédiction API disponible, données complémentaires limitées";

  } else {

    advice =
      "Données insuffisantes";
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
          probabilities.home
            .toFixed(1) +
          "%",

        draw:
          probabilities.draw
            .toFixed(1) +
          "%",

        v2:
          probabilities.away
            .toFixed(1) +
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
        poissonData
          .scoreProbability
          .toFixed(1) +
        "%",

      api_winner:
        apiWinner ||
        "Non disponible",

      win_or_draw:
        (
          probabilities.home +
          probabilities.draw
        ).toFixed(1) +
        "%",

      under_over:
        underOver,

      btts,

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

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
        Boolean(
          apiProbabilities
        ),

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
          "Non disponible avec le plan API actuel",

        h2h:
          "Non demandé afin de respecter la limite API"
      },

      seasons_used:
        false,

      engine:
        "Prédiction API + Poisson"
    },

    available:
      true
  };
}

/* =========================
   ROUTE RACINE
========================= */

app.get(
  "/",
  (req, res) => {

    res.json({

      success: true,

      status: "ok",

      service:
        "BOT PREDICTOR",

      prediction_engine:
        "Prédiction API + Poisson",

      candidates_requested:
        CANDIDATES,

      displayed:
        DISPLAYED,

      api_key_configured:
        Boolean(API_KEY),

      rate_limit_protection:
        true,

      message:
        "Serveur opérationnel"
    });
  }
);

/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({

      success: true,

      status: "ok",

      service:
        "BOT PREDICTOR",

      api_key_configured:
        Boolean(API_KEY),

      candidates_requested:
        CANDIDATES,

      displayed:
        DISPLAYED,

      rate_limit_protection:
        true
    });
  }
);

/* =========================
   PRÉDICTIONS
========================= */

async function predictionsHandler(
  req,
  res
) {

  try {

    if (!API_KEY) {

      return res.status(500)
        .json({

          success: false,

          error:
            "API_FOOTBALL_KEY manquante dans Render"
        });
    }

    /*
     * Récupération des matchs.
     */

    const fixtures =
      await getFixtures();

    /*
     * 7 candidats maximum.
     */

    const candidates =
      fixtures.slice(
        0,
        CANDIDATES
      );

    const analyzed = [];

    /*
     * IMPORTANT :
     * appels séquentiels.
     *
     * 7 secondes entre les appels.
     */

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {

      try {

        const result =
          await analyzeFixture(
            candidates[i]
          );

        if (result) {
          analyzed.push(result);
        }

      } catch (error) {

        console.error(
          "Erreur analyse match:",
          error.message
        );
      }

      if (
        i <
        candidates.length - 1
      ) {

        await sleep(7000);
      }
    }

    /*
     * Classement.
     *
     * Priorité :
     * 1. qualité des données
     * 2. score de sélection
     */

    analyzed.sort(
      (a, b) => {

        if (
          b.analysis.data_quality !==
          a.analysis.data_quality
        ) {

          return (
            b.analysis.data_quality -
            a.analysis.data_quality
          );
        }

        return (
          b.analysis.selection_score -
          a.analysis.selection_score
        );
      }
    );

    /*
     * Seulement les 2 meilleurs.
     */

    const top =
      analyzed.slice(
        0,
        DISPLAYED
      );

    top.forEach(
      (item, index) => {

        item.analysis.rank =
          index + 1;
      }
    );

    const date =
      new Date()
        .toISOString()
        .slice(0, 10);

    return res.json({

      success: true,

      status: "ok",

      prediction_engine:
        "Prédiction API + Poisson",

      candidates_requested:
        CANDIDATES,

      candidates_analyzed:
        analyzed.length,

      predictions:
        top.length,

      displayed:
        top.length,

      selection:
        "Top 2 après analyse complète",

      rate_limit_protection:
        true,

      matches:
        top,

      recent_matches:
        "Non disponible avec le plan API actuel",

      seasons_used:
        false,

      date
    });

  } catch (error) {

    console.error(
      "PREDICTIONS ERROR:",
      error
    );

    return res.status(500)
      .json({

        success: false,

        error:
          error.message
      });
  }
}

/* =========================
   ROUTES API
========================= */

app.get(
  "/predictions",
  predictionsHandler
);

app.get(
  "/api/predictions",
  predictionsHandler
);

/* =========================
   SERVEUR
========================= */

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
      CANDIDATES
    );

    console.log(
      "AFFICHAGE:",
      DISPLAYED
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
