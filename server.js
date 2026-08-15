const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

app.use(express.json());

/* =========================================================
   CORS
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
   UTILITAIRES
========================================================= */

function num(value, fallback = 0) {
  if (typeof value === "string") {
    value = value.replace("%", "").trim();
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) return 0;

  return (
    values.reduce((a, b) => a + b, 0) /
    values.length
  );
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
   API FOOTBALL
========================================================= */

async function apiRequest(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante"
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

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Réponse API non JSON"
    );
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      " - " +
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

  const data = await apiRequest(
    "/fixtures",
    {
      date: date
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
   DERNIERS MATCHS D'UNE EQUIPE
========================================================= */

async function getRecentMatches(teamId) {
  try {
    const data =
      await apiRequest(
        "/fixtures",
        {
          team: String(teamId),
          last: "10"
        }
      );

    const matches =
      Array.isArray(data.response)
        ? data.response
        : [];

    return {
      matches: matches,
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
   H2H
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
            String(awayId),

          last: "10"
        }
      );

    const matches =
      Array.isArray(data.response)
        ? data.response
        : [];

    return {
      matches: matches,
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
   PREDICTION API
========================================================= */

async function getPrediction(fixtureId) {
  try {
    const data =
      await apiRequest(
        "/predictions",
        {
          fixture: String(fixtureId)
        }
      );

    const prediction =
      Array.isArray(data.response) &&
      data.response.length
        ? data.response[0]
        : null;

    return {
      prediction: prediction,
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
   FORM RECENTE
========================================================= */

function analyzeForm(
  matches,
  teamId
) {
  let wins = 0;
  let draws = 0;
  let losses = 0;

  const goalsFor = [];
  const goalsAgainst = [];

  for (const match of matches) {

    const home =
      match.teams?.home;

    const away =
      match.teams?.away;

    const goals =
      match.goals || {};

    if (!home || !away) {
      continue;
    }

    const isHome =
      home.id === teamId;

    const isAway =
      away.id === teamId;

    if (!isHome && !isAway) {
      continue;
    }

    const gf =
      isHome
        ? num(goals.home)
        : num(goals.away);

    const ga =
      isHome
        ? num(goals.away)
        : num(goals.home);

    goalsFor.push(gf);
    goalsAgainst.push(ga);

    if (gf > ga) {
      wins++;
    } else if (gf === ga) {
      draws++;
    } else {
      losses++;
    }
  }

  const total =
    wins + draws + losses;

  const points =
    wins * 3 + draws;

  return {
    matches: total,
    wins,
    draws,
    losses,
    points,

    pointsPerGame:
      total
        ? points / total
        : 0,

    winRate:
      total
        ? wins / total
        : 0,

    avgGoalsFor:
      average(goalsFor),

    avgGoalsAgainst:
      average(goalsAgainst)
  };
}

/* =========================================================
   H2H ANALYSE
========================================================= */

function analyzeH2H(
  matches,
  homeId,
  awayId
) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let goals = 0;
  let count = 0;

  for (const match of matches) {

    const home =
      match.teams?.home;

    const away =
      match.teams?.away;

    if (!home || !away) {
      continue;
    }

    const hg =
      num(match.goals?.home);

    const ag =
      num(match.goals?.away);

    goals += hg + ag;
    count++;

    if (
      home.id === homeId &&
      away.id === awayId
    ) {

      if (hg > ag) {
        homeWins++;
      } else if (hg === ag) {
        draws++;
      } else {
        awayWins++;
      }

    } else if (
      home.id === awayId &&
      away.id === homeId
    ) {

      if (hg > ag) {
        awayWins++;
      } else if (hg === ag) {
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
        ? goals / count
        : 0
  };
}

/* =========================================================
   POISSON
========================================================= */

function calculatePoisson(
  homeForm,
  awayForm
) {
  let homeLambda;
  let awayLambda;

  if (
    homeForm.matches > 0 &&
    awayForm.matches > 0
  ) {

    homeLambda =
      (
        homeForm.avgGoalsFor +
        awayForm.avgGoalsAgainst
      ) / 2;

    awayLambda =
      (
        awayForm.avgGoalsFor +
        homeForm.avgGoalsAgainst
      ) / 2;

  } else if (homeForm.matches > 0) {

    homeLambda =
      Math.max(
        0.3,
        homeForm.avgGoalsFor
      );

    awayLambda = 1.0;

  } else if (awayForm.matches > 0) {

    homeLambda = 1.0;

    awayLambda =
      Math.max(
        0.3,
        awayForm.avgGoalsFor
      );

  } else {

    homeLambda = 1.2;
    awayLambda = 1.0;
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

  for (let h = 0; h <= 6; h++) {

    for (let a = 0; a <= 6; a++) {

      const p =
        poisson(homeLambda, h) *
        poisson(awayLambda, a);

      if (h > a) {
        homeWin += p;
      } else if (h === a) {
        draw += p;
      } else {
        awayWin += p;
      }

      if (
        p >
        bestProbability
      ) {
        bestProbability = p;
        bestHome = h;
        bestAway = a;
      }
    }
  }

  return {
    home: homeWin * 100,
    draw: draw * 100,
    away: awayWin * 100,

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
   EXTRACTION DES PROBABILITES API
========================================================= */

function getApiPercentages(
  prediction
) {
  if (!prediction?.percent) {
    return null;
  }

  const home =
    num(prediction.percent.home, NaN);

  const draw =
    num(prediction.percent.draw, NaN);

  const away =
    num(prediction.percent.away, NaN);

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
   SCORE DE SELECTION
========================================================= */

function calculateSelectionScore(
  homeForm,
  awayForm,
  h2h,
  prediction,
  poissonData
) {
  const apiPercent =
    getApiPercentages(
      prediction
    );

  /*
   * Si API-Football fournit sa prédiction,
   * elle devient le facteur principal.
   */

  let score = 0;

  let weight = 0;

  if (apiPercent) {

    const apiBest =
      Math.max(
        apiPercent.home,
        apiPercent.draw,
        apiPercent.away
      );

    score +=
      clamp(apiBest, 0, 100) *
      0.45;

    weight += 0.45;
  }

  /*
   * Forme récente.
   */

  if (
    homeForm.matches > 0 ||
    awayForm.matches > 0
  ) {

    const formDifference =
      homeForm.pointsPerGame -
      awayForm.pointsPerGame;

    const formStrength =
      clamp(
        50 +
        formDifference * 15,
        0,
        100
      );

    score +=
      formStrength * 0.25;

    weight += 0.25;
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

  weight += 0.20;

  /*
   * H2H.
   */

  if (h2h.matches > 0) {

    const h2hBest =
      Math.max(
        h2h.homeWins,
        h2h.draws,
        h2h.awayWins
      );

    const h2hStrength =
      (
        h2hBest /
        h2h.matches
      ) * 100;

    score +=
      h2hStrength * 0.10;

    weight += 0.10;
  }

  if (!weight) {
    return 0;
  }

  return clamp(
    score / weight,
    0,
    100
  );
}

/* =========================================================
   ANALYSE COMPLETE
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
    !fixtureId ||
    !home?.id ||
    !away?.id
  ) {
    return null;
  }

  /*
   * 4 sources.
   */

  const [
    homeRecentResult,
    awayRecentResult,
    h2hResult,
    predictionResult
  ] = await Promise.all([
    getRecentMatches(home.id),
    getRecentMatches(away.id),
    getH2H(home.id, away.id),
    getPrediction(fixtureId)
  ]);

  const homeRecent =
    homeRecentResult.matches;

  const awayRecent =
    awayRecentResult.matches;

  const h2hMatches =
    h2hResult.matches;

  const prediction =
    predictionResult.prediction;

  const homeForm =
    analyzeForm(
      homeRecent,
      home.id
    );

  const awayForm =
    analyzeForm(
      awayRecent,
      away.id
    );

  const h2h =
    analyzeH2H(
      h2hMatches,
      home.id,
      away.id
    );

  const poissonData =
    calculatePoisson(
      homeForm,
      awayForm
    );

  /*
   * Probabilités API.
   */

  const apiPercent =
    getApiPercentages(
      prediction
    );

  /*
   * Si API-Football donne des probabilités,
   * on les utilise réellement.
   * Sinon Poisson.
   */

  const probabilities =
    apiPercent
      ? {
          home: apiPercent.home,
          draw: apiPercent.draw,
          away: apiPercent.away
        }
      : {
          home: poissonData.home,
          draw: poissonData.draw,
          away: poissonData.away
        };

  /*
   * Score prévu API en priorité.
   */

  const apiScore =
    prediction?.goals?.home !== undefined &&
    prediction?.goals?.away !== undefined
      ? (
          prediction.goals.home +
          "-" +
          prediction.goals.away
        )
      : null;

  const predictedScore =
    apiScore ||
    poissonData.score;

  /*
   * Choix principal.
   */

  let mainPick;

  if (
    probabilities.home >=
      probabilities.draw &&
    probabilities.home >=
      probabilities.away
  ) {
    mainPick = home.name;

  } else if (
    probabilities.away >=
      probabilities.home &&
    probabilities.away >=
      probabilities.draw
  ) {
    mainPick = away.name;

  } else {
    mainPick = "Nul";
  }

  /*
   * Si l'API fournit son vainqueur,
   * on le conserve.
   */

  if (
    prediction?.winner?.name
  ) {
    mainPick =
      prediction.winner.name;
  }

  /*
   * Score de classement.
   */

  const selectionScore =
    calculateSelectionScore(
      homeForm,
      awayForm,
      h2h,
      prediction,
      poissonData
    );

  /*
   * Qualité des données.
   */

  let quality = 0;

  if (homeForm.matches > 0) {
    quality += 30;
  }

  if (awayForm.matches > 0) {
    quality += 30;
  }

  if (h2h.matches > 0) {
    quality += 15;
  }

  if (apiPercent) {
    quality += 25;
  }

  /*
   * Conseil.
   */

  let advice;

  if (selectionScore >= 70) {
    advice =
      "Très bon candidat";
  } else if (selectionScore >= 60) {
    advice =
      "Candidat intéressant";
  } else if (selectionScore >= 50) {
    advice =
      "Candidat moyen";
  } else {
    advice =
      "Données insuffisantes";
  }

  /*
   * Données buts.
   */

  const totalLambda =
    poissonData.homeLambda +
    poissonData.awayLambda;

  const btts =
    poissonData.homeLambda >= 0.8 &&
    poissonData.awayLambda >= 0.8
      ? "Oui"
      : "Non";

  return {
    match: {
      id: fixtureId,

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
        id: home.id,
        name: home.name,
        logo: home.logo || ""
      },

      away: {
        id: away.id,
        name: away.name,
        logo: away.logo || ""
      }
    },

    prediction: {
      main_pick:
        mainPick,

      confidence:
        selectionScore.toFixed(1) +
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
        prediction?.winner?.name ||
        "Non disponible",

      win_or_draw:
        prediction?.win_or_draw ||
        "Non disponible",

      under_over:
        prediction?.under_over ||
        (
          totalLambda >= 2.5
            ? "Over 2.5"
            : "Under 2.5"
        ),

      btts:
        prediction?.btts ||
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
          selectionScore.toFixed(2)
        ),

      data_quality:
        quality,

      recent_matches:
        10,

      home_recent_count:
        homeRecent.length,

      away_recent_count:
        awayRecent.length,

      h2h_count:
        h2h.matches,

      home_form: {
        matches:
          homeForm.matches,

        wins:
          homeForm.wins,

        draws:
          homeForm.draws,

        losses:
          homeForm.losses,

        points:
          homeForm.points,

        points_per_game:
          Number(
            homeForm.pointsPerGame
              .toFixed(2)
          ),

        avg_goals_for:
          Number(
            homeForm.avgGoalsFor
              .toFixed(2)
          ),

        avg_goals_against:
          Number(
            homeForm.avgGoalsAgainst
              .toFixed(2)
          )
      },

      away_form: {
        matches:
          awayForm.matches,

        wins:
          awayForm.wins,

        draws:
          awayForm.draws,

        losses:
          awayForm.losses,

        points:
          awayForm.points,

        points_per_game:
          Number(
            awayForm.pointsPerGame
              .toFixed(2)
          ),

        avg_goals_for:
          Number(
            awayForm.avgGoalsFor
              .toFixed(2)
          ),

        avg_goals_against:
          Number(
            awayForm.avgGoalsAgainst
              .toFixed(2)
          )
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
            h2h.avgGoals
              .toFixed(2)
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
        Boolean(apiPercent),

      data_sources: {
        home_recent:
          homeRecentResult.error
            ? "error"
            : "ok",

        away_recent:
          awayRecentResult.error
            ? "error"
            : "ok",

        h2h:
          h2hResult.error
            ? "error"
            : "ok",

        prediction:
          predictionResult.error
            ? "error"
            : "ok"
      },

      errors: {
        home_recent:
          homeRecentResult.error,

        away_recent:
          awayRecentResult.error,

        h2h:
          h2hResult.error,

        prediction:
          predictionResult.error
      },

      seasons_used:
        false,

      engine:
        "recent form + poisson + h2h + API prediction"
    },

    available: true
  };
}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

  res.json({
    success: true,
    status: "ok",
    service: "BOT PREDICTOR",

    prediction_engine:
      "recent form + poisson + h2h + API prediction",

    candidates:
      "up to 10",

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
    success: true,
    status: "ok",

    api_key_configured:
      Boolean(API_KEY),

    recent_matches:
      10,

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
     * 2. Jusqu'à 10 candidats.
     */

    const candidates =
      fixtures.slice(0, 10);

    const analyzed = [];

    /*
     * 3. Analyse des 10 candidats.
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
          "Analyse impossible pour fixture:",
          fixture.fixture?.id,
          error.message
        );
      }
    }

    /*
     * 4. On privilégie les matchs
     * réellement documentés.
     *
     * D'abord score de sélection,
     * puis qualité des données.
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
     * 5. TOP 2.
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

    /*
     * 6. Réponse.
     */

    return res.json({

      success: true,

      status: "ok",

      prediction_engine:
        "recent form + poisson + h2h + API prediction",

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
   START
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
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
      "CANDIDATES: UP TO 10"
    );

    console.log(
      "DISPLAYED: MAX 2"
    );

    console.log(
      "RECENT MATCHES: 10"
    );

    console.log(
      "SEASONS USED: false"
    );

    console.log(
      "SERVER READY"
    );

    console.log(
      "================================"
    );
  }
);
