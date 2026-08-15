const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

app.use(express.json());

/* CORS sans dépendance */
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
   OUTILS
========================================================= */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
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
   API FOOTBALL
========================================================= */

async function api(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY manquante");
  }

  const query = new URLSearchParams(params);

  const response = await fetch(
    API_URL + endpoint + "?" + query.toString(),
    {
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Réponse API invalide");
  }

  if (!response.ok) {
    throw new Error(
      "API HTTP " + response.status
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
  const date = new Date()
    .toISOString()
    .slice(0, 10);

  const data = await api("/fixtures", {
    date
  });

  const fixtures = Array.isArray(data.response)
    ? data.response
    : [];

  return fixtures.filter(item => {
    const status =
      item.fixture?.status?.short;

    return status === "NS" || status === "TBD";
  });
}

/* =========================================================
   DERNIERS MATCHS
========================================================= */

async function getRecent(teamId) {
  try {
    const data = await api("/fixtures", {
      team: teamId,
      last: 10
    });

    return Array.isArray(data.response)
      ? data.response
      : [];
  } catch (error) {
    console.log(
      "Recent data unavailable:",
      teamId,
      error.message
    );

    return [];
  }
}

/* =========================================================
   H2H
========================================================= */

async function getH2H(homeId, awayId) {
  try {
    const data = await api(
      "/fixtures/headtohead",
      {
        h2h:
          homeId + "-" + awayId,
        last: 10
      }
    );

    return Array.isArray(data.response)
      ? data.response
      : [];
  } catch (error) {
    console.log(
      "H2H unavailable:",
      error.message
    );

    return [];
  }
}

/* =========================================================
   PREDICTION API
========================================================= */

async function getPrediction(fixtureId) {
  try {
    const data = await api(
      "/predictions",
      {
        fixture: fixtureId
      }
    );

    if (
      Array.isArray(data.response) &&
      data.response.length
    ) {
      return data.response[0];
    }

    return null;
  } catch (error) {
    console.log(
      "Prediction unavailable:",
      fixtureId,
      error.message
    );

    return null;
  }
}

/* =========================================================
   ANALYSE FORM
========================================================= */

function analyzeForm(matches, teamId) {
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = [];
  let goalsAgainst = [];

  for (const match of matches) {
    const home =
      match.teams?.home;

    const away =
      match.teams?.away;

    const goals =
      match.goals || {};

    if (!home || !away) continue;

    const isHome =
      home.id === teamId;

    const isAway =
      away.id === teamId;

    if (!isHome && !isAway) continue;

    const gf = isHome
      ? num(goals.home)
      : num(goals.away);

    const ga = isHome
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
      avg(goalsFor),

    avgGoalsAgainst:
      avg(goalsAgainst)
  };
}

/* =========================================================
   H2H
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
    const h = match.teams?.home;
    const a = match.teams?.away;
    const g = match.goals || {};

    if (!h || !a) continue;

    const hg = num(g.home);
    const ag = num(g.away);

    totalGoals += hg + ag;
    count++;

    const homeIsOurHome =
      h.id === homeId &&
      a.id === awayId;

    if (homeIsOurHome) {
      if (hg > ag) homeWins++;
      else if (hg === ag) draws++;
      else awayWins++;
      continue;
    }

    if (
      h.id === awayId &&
      a.id === homeId
    ) {
      if (hg > ag) awayWins++;
      else if (hg === ag) draws++;
      else homeWins++;
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
   POISSON
========================================================= */

function calculatePoisson(
  homeForm,
  awayForm
) {
  /*
   * Même avec des données partielles,
   * on conserve une estimation prudente.
   */

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
      4.0
    );

  awayLambda =
    clamp(
      awayLambda,
      0.2,
      4.0
    );

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;

  let bestProbability = 0;
  let bestHome = 0;
  let bestAway = 0;

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const probability =
        poisson(homeLambda, h) *
        poisson(awayLambda, a);

      if (h > a) {
        pHome += probability;
      } else if (h === a) {
        pDraw += probability;
      } else {
        pAway += probability;
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
    home: pHome * 100,
    draw: pDraw * 100,
    away: pAway * 100,

    score:
      bestHome + "-" + bestAway,

    scoreProbability:
      bestProbability * 100,

    homeLambda,
    awayLambda
  };
}

/* =========================================================
   SCORE DE SELECTION
========================================================= */

function selectionScore(
  homeForm,
  awayForm,
  h2h,
  prediction,
  poissonData
) {
  let score = 0;
  let availableFactors = 0;

  /*
   * FORME
   */

  if (
    homeForm.matches ||
    awayForm.matches
  ) {
    const difference =
      homeForm.pointsPerGame -
      awayForm.pointsPerGame;

    score += clamp(
      50 +
      difference * 12,
      0,
      100
    ) * 0.30;

    availableFactors += 30;
  }

  /*
   * POISSON
   */

  const poissonBest =
    Math.max(
      poissonData.home,
      poissonData.draw,
      poissonData.away
    );

  score +=
    poissonBest * 0.25;

  availableFactors += 25;

  /*
   * H2H
   */

  if (h2h.matches > 0) {
    const best =
      Math.max(
        h2h.homeWins,
        h2h.draws,
        h2h.awayWins
      );

    score +=
      (
        best /
        h2h.matches
      ) * 20;

    availableFactors += 20;
  }

  /*
   * API PREDICTION
   */

  if (
    prediction &&
    prediction.percent
  ) {
    const best =
      Math.max(
        num(prediction.percent.home),
        num(prediction.percent.draw),
        num(prediction.percent.away)
      );

    score +=
      best * 0.25;

    availableFactors += 25;
  }

  /*
   * NORMALISATION
   */

  if (!availableFactors) {
    return 0;
  }

  const normalized =
    (
      score /
      availableFactors
    ) * 100;

  /*
   * Petit bonus pour qualité des données.
   */

  const dataQuality =
    (
      Math.min(homeForm.matches, 10) +
      Math.min(awayForm.matches, 10)
    ) / 20;

  return clamp(
    normalized * (
      0.85 +
      dataQuality * 0.15
    ),
    0,
    100
  );
}

/* =========================================================
   ANALYSE D'UN MATCH
========================================================= */

async function analyzeMatch(fixture) {
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
   * On récupère les données.
   * Une erreur sur une source ne détruit
   * plus le candidat entier.
   */

  const [
    homeRecent,
    awayRecent,
    h2hMatches,
    apiPrediction
  ] = await Promise.all([
    getRecent(home.id),
    getRecent(away.id),
    getH2H(home.id, away.id),
    getPrediction(fixtureId)
  ]);

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

  const score =
    selectionScore(
      homeForm,
      awayForm,
      h2h,
      apiPrediction,
      poissonData
    );

  /*
   * Choix principal.
   */

  let mainPick =
    "Non disponible";

  if (
    poissonData.home >
    poissonData.draw &&
    poissonData.home >
    poissonData.away
  ) {
    mainPick = home.name;
  } else if (
    poissonData.away >
    poissonData.draw &&
    poissonData.away >
    poissonData.home
  ) {
    mainPick = away.name;
  } else {
    mainPick = "Nul";
  }

  /*
   * API winner : seulement si disponible.
   */

  if (
    apiPrediction?.winner?.name
  ) {
    mainPick =
      apiPrediction.winner.name;
  }

  const totalGoals =
    poissonData.homeLambda +
    poissonData.awayLambda;

  const btts =
    poissonData.homeLambda >= 0.8 &&
    poissonData.awayLambda >= 0.8
      ? "Oui"
      : "Non";

  let advice;

  if (score >= 75) {
    advice =
      "Très bon candidat pour le TOP 2";
  } else if (score >= 65) {
    advice =
      "Candidat intéressant";
  } else if (score >= 50) {
    advice =
      "Analyse prudente";
  } else {
    advice =
      "Données limitées";
  }

  /*
   * Informations API supplémentaires.
   */

  const apiWinner =
    apiPrediction?.winner?.name ||
    "Non disponible";

  const apiUnderOver =
    apiPrediction?.under_over ||
    "Non disponible";

  const apiWinDraw =
    apiPrediction?.win_or_draw ||
    "Non disponible";

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
        score.toFixed(1) + "%",

      probabilities: {
        v1:
          poissonData.home.toFixed(1) + "%",

        draw:
          poissonData.draw.toFixed(1) + "%",

        v2:
          poissonData.away.toFixed(1) + "%",

        "1x":
          (
            poissonData.home +
            poissonData.draw
          ).toFixed(1) + "%",

        x2:
          (
            poissonData.draw +
            poissonData.away
          ).toFixed(1) + "%"
      },

      predicted_score:
        poissonData.score,

      exact_score:
        poissonData.score,

      exact_score_probability:
        poissonData.scoreProbability
          .toFixed(1) + "%",

      api_winner:
        apiWinner,

      win_or_draw:
        apiWinDraw,

      under_over:
        apiUnderOver !==
        "Non disponible"
          ? apiUnderOver
          : (
              totalGoals >= 2.5
                ? "Over 2.5"
                : "Under 2.5"
            ),

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
        Number(score.toFixed(2)),

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
        Boolean(apiPrediction),

      seasons_used:
        false,

      engine:
        "recent form + poisson + h2h + API prediction"
    },

    available: true
  };
}

/* =========================================================
   ROUTE PRINCIPALE
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

async function predictions(req, res) {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "API_FOOTBALL_KEY manquante dans Render"
      });
    }

    /*
     * Matchs du jour.
     */

    const fixtures =
      await getTodayFixtures();

    /*
     * Jusqu'à 10 candidats.
     */

    const candidates =
      fixtures.slice(0, 10);

    const analyzed = [];

    /*
     * Analyse séquentielle pour limiter
     * les problèmes de quota.
     */

    for (const fixture of candidates) {
      try {
        const result =
          await analyzeMatch(fixture);

        if (result) {
          analyzed.push(result);
        }
      } catch (error) {
        console.log(
          "Match ignoré:",
          error.message
        );
      }
    }

    /*
     * Classement.
     */

    analyzed.sort(
      (a, b) =>
        b.analysis.selection_score -
        a.analysis.selection_score
    );

    /*
     * TOP 2.
     */

    const topTwo =
      analyzed.slice(0, 2);

    topTwo.forEach(
      (item, index) => {
        item.analysis.rank =
          index + 1;
      }
    );

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

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
        "Top 2 after analysis",

      matches:
        topTwo,

      recent_matches:
        10,

      seasons_used:
        false,

      date:
        today
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
  predictions
);

app.get(
  "/api/predictions",
  predictions
);

/* =========================================================
   SERVEUR
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
