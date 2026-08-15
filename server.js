```javascript
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

app.use(express.json());

/* =========================================================
   CORS SANS MODULE EXTERNE
========================================================= */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =========================================================
   UTILITAIRES
========================================================= */

function number(value, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const n = Number(
    String(value).replace("%", "").trim()
  );

  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function poisson(lambda, goals) {
  let factorial = 1;

  for (let i = 2; i <= goals; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals)
  ) / factorial;
}

/* =========================================================
   REQUÊTE API-FOOTBALL
========================================================= */

async function apiRequest(endpoint, params = {}) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY n'est pas configurée dans Render."
    );
  }

  const query = new URLSearchParams(params);

  const url =
    API_URL +
    endpoint +
    "?" +
    query.toString();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": API_KEY,
      "Accept": "application/json"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "L'API a retourné une réponse invalide."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API HTTP " +
      response.status +
      ": " +
      JSON.stringify(data.errors || {})
    );
  }

  if (
    data.errors &&
    Object.keys(data.errors).length > 0
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

  return fixtures.filter((fixture) => {

    const status =
      fixture.fixture?.status?.short;

    return (
      status === "NS" ||
      status === "TBD"
    );
  });
}

/* =========================================================
   PREDICTION API
========================================================= */

async function getApiPrediction(fixtureId) {

  try {

    const data =
      await apiRequest(
        "/predictions",
        {
          fixture: fixtureId
        }
      );

    const prediction =
      Array.isArray(data.response)
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
   PAS DE last=10
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

    return {
      matches:
        Array.isArray(data.response)
          ? data.response
          : [],

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
   EXTRACTION PROBABILITÉS API
========================================================= */

function getPercentages(prediction) {

  const percent =
    prediction?.percent;

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

function poissonAnalysis(prediction) {

  const goals =
    prediction?.goals || {};

  const home =
    number(goals.home, 1.2);

  const away =
    number(goals.away, 1.0);

  const homeLambda =
    clamp(home, 0.1, 5);

  const awayLambda =
    clamp(away, 0.1, 5);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = 0;
  let bestHome = 0;
  let bestAway = 0;

  for (let h = 0; h <= 6; h++) {

    for (let a = 0; a <= 6; a++) {

      const probability =
        poisson(homeLambda, h) *
        poisson(awayLambda, a);

      if (h > a) {
        homeWin += probability;
      }

      if (h === a) {
        draw += probability;
      }

      if (h < a) {
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

    homeLambda,

    awayLambda,

    score:
      bestHome +
      "-" +
      bestAway,

    exactProbability:
      bestProbability * 100
  };
}

/* =========================================================
   ANALYSE H2H
========================================================= */

function analyzeH2H(
  matches,
  homeId,
  awayId
) {

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let totalGoals = 0;
  let count = 0;

  for (const match of matches) {

    const home =
      match.teams?.home;

    const away =
      match.teams?.away;

    if (!home || !away) {
      continue;
    }

    const homeGoals =
      number(match.goals?.home);

    const awayGoals =
      number(match.goals?.away);

    totalGoals +=
      homeGoals +
      awayGoals;

    count++;

    if (
      home.id === homeId &&
      away.id === awayId
    ) {

      if (homeGoals > awayGoals) {
        homeWins++;
      } else if (
        homeGoals === awayGoals
      ) {
        draws++;
      } else {
        awayWins++;
      }

    } else if (
      home.id === awayId &&
      away.id === homeId
    ) {

      if (homeGoals > awayGoals) {
        awayWins++;
      } else if (
        homeGoals === awayGoals
      ) {
        draws++;
      } else {
        homeWins++;
      }
    }
  }

  return {

    matches: count,

    homeWins,

    draws,

    awayWins,

    avgGoals:
      count
        ? totalGoals / count
        : 0
  };
}

/* =========================================================
   SCORE DE SÉLECTION
========================================================= */

function selectionScore(
  percentages,
  poissonData,
  h2h
) {

  /*
   * L'API est la source principale.
   */

  let score = 0;

  if (percentages) {

    const apiBest =
      Math.max(
        percentages.home,
        percentages.draw,
        percentages.away
      );

    score +=
      apiBest * 0.70;

  } else {

    const poissonBest =
      Math.max(
        poissonData.home,
        poissonData.draw,
        poissonData.away
      );

    score +=
      poissonBest * 0.70;
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
    poissonBest * 0.20;

  /*
   * H2H uniquement s'il existe.
   */

  if (h2h.matches > 0) {

    const bestH2H =
      Math.max(
        h2h.homeWins,
        h2h.draws,
        h2h.awayWins
      );

    score +=
      (
        bestH2H /
        h2h.matches
      ) *
      100 *
      0.10;
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

async function analyzeMatch(
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
   * Seulement les appels réellement disponibles.
   */

  const [
    predictionResult,
    h2hResult
  ] = await Promise.all([

    getApiPrediction(
      fixtureId
    ),

    getH2H(
      home.id,
      away.id
    )
  ]);

  const prediction =
    predictionResult.prediction;

  const h2h =
    analyzeH2H(
      h2hResult.matches,
      home.id,
      away.id
    );

  /*
   * Probabilités API.
   */

  const percentages =
    getPercentages(
      prediction
    );

  /*
   * Poisson basé sur les buts
   * prévus par l'API quand disponibles.
   */

  const poissonData =
    poissonAnalysis(
      prediction
    );

  /*
   * Probabilités finales.
   */

  const finalProbabilities =
    percentages
      ? percentages
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

  let mainPick =
    prediction?.winner?.name ||
    null;

  if (!mainPick) {

    if (
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
  }

  /*
   * Score API.
   */

  let predictedScore =
    null;

  if (
    prediction?.goals?.home !==
      undefined &&
    prediction?.goals?.away !==
      undefined
  ) {

    predictedScore =
      prediction.goals.home +
      "-" +
      prediction.goals.away;
  }

  if (!predictedScore) {
    predictedScore =
      poissonData.score;
  }

  /*
   * Sélection.
   */

  const score =
    selectionScore(
      percentages,
      poissonData,
      h2h
    );

  /*
   * Qualité des données.
   */

  let dataQuality = 0;

  if (prediction) {
    dataQuality += 60;
  }

  if (percentages) {
    dataQuality += 25;
  }

  if (h2h.matches > 0) {
    dataQuality += 15;
  }

  /*
   * Conseil.
   */

  let advice;

  if (score >= 70) {

    advice =
      "Candidat fort après analyse";

  } else if (score >= 60) {

    advice =
      "Candidat intéressant";

  } else if (score >= 50) {

    advice =
      "Candidat moyen";

  } else {

    advice =
      "Données limitées";
  }

  /*
   * BTTS / Under Over.
   */

  let btts =
    "Non disponible";

  if (
    prediction?.under_over
  ) {
    btts =
      prediction.btts ||
      "Non disponible";
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
        score.toFixed(1) +
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
        poissonData.exactProbability
          .toFixed(1) +
        "%",

      api_winner:
        prediction?.winner?.name ||
        "Non disponible",

      win_or_draw:
        prediction?.win_or_draw ??
        "Non disponible",

      under_over:
        prediction?.under_over ||
        "Non disponible",

      btts,

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        prediction?.advice ||
        advice
    },

    analysis: {

      selection_score:
        Number(
          score.toFixed(2)
        ),

      data_quality:
        dataQuality,

      recent_matches:
        10,

      home_recent_count:
        0,

      away_recent_count:
        0,

      h2h_count:
        h2h.matches,

      home_form: {
        matches:
          0,

        wins:
          0,

        draws:
          0,

        losses:
          0,

        points:
          0,

        points_per_game:
          0,

        avg_goals_for:
          0,

        avg_goals_against:
          0
      },

      away_form: {
        matches:
          0,

        wins:
          0,

        draws:
          0,

        losses:
          0,

        points:
          0,

        points_per_game:
          0,

        avg_goals_for:
          0,

        avg_goals_against:
          0
      },

      h2h: {

        matches:
          h2h.matches,

        home_wins:
          h2h.homeWins,

        draws:
          h2h.draws,

        away_wins:
          h2h.awayWins,

        avg_goals:
          Number(
            h2h.avgGoals.toFixed(2)
          )
      },

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
        Boolean(percentages),

      data_sources: {

        api_prediction:
          prediction
            ? "ok"
            : "error",

        api_probabilities:
          percentages
            ? "ok"
            : "error",

        h2h:
          h2hResult.error
            ? "error"
            : "ok"
      },

      errors: {

        api_prediction:
          predictionResult.error,

        h2h:
          h2hResult.error
      },

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
   ROUTE PRINCIPALE
========================================================= */

app.get("/", (req, res) => {

  res.json({

    success:
      true,

    status:
      "ok",

    service:
      "BOT PREDICTOR",

    prediction_engine:
      "API prediction + poisson + h2h",

    candidates:
      10,

    displayed:
      2,

    recent_matches:
      10,

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

    success:
      true,

    status:
      "ok",

    api_key_configured:
      Boolean(API_KEY),

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

        success:
          false,

        error:
          "API_FOOTBALL_KEY manquante"
      });
    }

    /*
     * Récupération des matchs du jour.
     */

    const fixtures =
      await getTodayFixtures();

    /*
     * Maximum 10 candidats.
     */

    const candidates =
      fixtures.slice(0, 10);

    const analyzed = [];

    /*
     * Analyse des candidats.
     */

    for (
      const fixture of candidates
    ) {

      try {

        const result =
          await analyzeMatch(
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
     * Classement.
     *
     * 1. score d'analyse
     * 2. qualité des données
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
      analyzed.slice(0, 2);

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

    return res.json({

      success:
        true,

      status:
        "ok",

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
        "Top 2 after complete analysis",

      matches:
        topTwo,

      recent_matches:
        10,

      seasons_used:
        false,

      date
    });

  } catch (error) {

    console.error(
      "PREDICTIONS ERROR:",
      error
    );

    return res.status(500).json({

      success:
        false,

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
   SERVEUR
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "===================================="
    );

    console.log(
      "BOT PREDICTOR SERVER"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "API KEY:",
      API_KEY
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "CANDIDATES: 10 MAX"
    );

    console.log(
      "DISPLAYED: 2"
    );

    console.log(
      "SEASONS: FALSE"
    );

    console.log(
      "SERVER READY"
    );

    console.log(
      "===================================="
    );
  }
);
```
