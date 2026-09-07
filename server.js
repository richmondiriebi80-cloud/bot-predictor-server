// ============================================================
// FIFA LIVE PRO BET
// Serveur API - 1xBet + prédictions statistiques
// Node.js 18+ / Express
// ============================================================

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// ------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const ONEBET_URL =
  process.env.ONEBET_URL ||
  "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=120&lng=fr&mode=4&virtualSports=true";

// Historique reçu par le serveur.
// Il est conservé en mémoire pendant que le serveur fonctionne.
const historyStore = new Map();

// ------------------------------------------------------------
// PAGE PRINCIPALE
// ------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    application: "FIFA LIVE PRO BET",
    version: "3.0.0",
    status: "online",
    endpoints: {
      live: "/api/live",
      prediction: "/api/prediction",
      history: "/api/history",
      health: "/api/health"
    }
  });
});

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// OUTILS STATISTIQUES
// ============================================================

// Factorielle
function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

// Loi de Poisson
function poisson(lambda, goals) {
  return (
    Math.pow(lambda, goals) *
    Math.exp(-lambda) /
    factorial(goals)
  );
}

// Limite d'une valeur
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ------------------------------------------------------------
// Matrice des scores
// ------------------------------------------------------------

function createScoreMatrix(lambdaHome, lambdaAway, maxGoals = 8) {

  const matrix = [];

  for (let home = 0; home <= maxGoals; home++) {

    const row = [];

    for (let away = 0; away <= maxGoals; away++) {

      const probability =
        poisson(lambdaHome, home) *
        poisson(lambdaAway, away);

      row.push({
        home,
        away,
        probability
      });
    }

    matrix.push(row);
  }

  return matrix;
}

// ------------------------------------------------------------
// Extraction des meilleurs scores
// ------------------------------------------------------------

function topScores(matrix, count = 3) {

  const scores = [];

  for (const row of matrix) {
    for (const item of row) {
      scores.push(item);
    }
  }

  scores.sort(
    (a, b) => b.probability - a.probability
  );

  return scores.slice(0, count).map(item => ({
    score: `${item.home}-${item.away}`,
    homeGoals: item.home,
    awayGoals: item.away,
    probability: Number(
      (item.probability * 100).toFixed(2)
    )
  }));
}

// ------------------------------------------------------------
// Analyse de la matrice
// ------------------------------------------------------------

function analyzeMatrix(matrix) {

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let over15 = 0;
  let over25 = 0;
  let over35 = 0;

  let btts = 0;

  let homeGoalProb = 0;
  let awayGoalProb = 0;

  for (const row of matrix) {

    for (const item of row) {

      const p = item.probability;
      const total = item.home + item.away;

      if (item.home > item.away) {
        homeWin += p;
      }

      if (item.home === item.away) {
        draw += p;
      }

      if (item.home < item.away) {
        awayWin += p;
      }

      if (total >= 2) {
        over15 += p;
      }

      if (total >= 3) {
        over25 += p;
      }

      if (total >= 4) {
        over35 += p;
      }

      if (item.home >= 1 && item.away >= 1) {
        btts += p;
      }

      if (item.home >= 1) {
        homeGoalProb += p;
      }

      if (item.away >= 1) {
        awayGoalProb += p;
      }
    }
  }

  return {
    winner: {
      home: Number((homeWin * 100).toFixed(2)),
      draw: Number((draw * 100).toFixed(2)),
      away: Number((awayWin * 100).toFixed(2))
    },

    doubleChance: {
      "1X": Number(((homeWin + draw) * 100).toFixed(2)),
      "X2": Number(((draw + awayWin) * 100).toFixed(2)),
      "12": Number(((homeWin + awayWin) * 100).toFixed(2))
    },

    overUnder: {
      over15: Number((over15 * 100).toFixed(2)),
      under15: Number(((1 - over15) * 100).toFixed(2)),

      over25: Number((over25 * 100).toFixed(2)),
      under25: Number(((1 - over25) * 100).toFixed(2)),

      over35: Number((over35 * 100).toFixed(2)),
      under35: Number(((1 - over35) * 100).toFixed(2))
    },

    btts: {
      yes: Number((btts * 100).toFixed(2)),
      no: Number(((1 - btts) * 100).toFixed(2))
    },

    teamGoals: {
      home: Number((homeGoalProb * 100).toFixed(2)),
      away: Number((awayGoalProb * 100).toFixed(2))
    }
  };
}

// ============================================================
// HISTORIQUE
// ============================================================

function calculateHistoricalParameters(history) {

  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const valid = history
    .filter(item =>
      Number.isFinite(Number(item.homeGoals)) &&
      Number.isFinite(Number(item.awayGoals))
    )
    .slice(-20);

  if (valid.length === 0) {
    return null;
  }

  let totalWeight = 0;
  let weightedHome = 0;
  let weightedAway = 0;

  valid.forEach((match, index) => {

    // Les résultats récents ont plus de poids.
    const weight = index + 1;

    weightedHome +=
      Number(match.homeGoals) * weight;

    weightedAway +=
      Number(match.awayGoals) * weight;

    totalWeight += weight;
  });

  return {
    homeAverage: weightedHome / totalWeight,
    awayAverage: weightedAway / totalWeight,
    samples: valid.length
  };
}

// ------------------------------------------------------------
// Calcul des paramètres attendus
// ------------------------------------------------------------

function calculateExpectedGoals(options) {

  let homeLambda = 1.45;
  let awayLambda = 1.25;

  const historical =
    calculateHistoricalParameters(options.history);

  // ----------------------------------------------------------
  // Si un historique est fourni, il est réellement utilisé.
  // ----------------------------------------------------------

  if (historical) {

    homeLambda =
      homeLambda * 0.45 +
      historical.homeAverage * 0.55;

    awayLambda =
      awayLambda * 0.45 +
      historical.awayAverage * 0.55;
  }

  // ----------------------------------------------------------
  // Situation LIVE
  // ----------------------------------------------------------

  const homeScore =
    Math.max(0, Number(options.homeScore) || 0);

  const awayScore =
    Math.max(0, Number(options.awayScore) || 0);

  const elapsed =
    clamp(Number(options.elapsed) || 0, 0, 100);

  const isLive =
    options.live === true ||
    elapsed > 0;

  if (isLive) {

    // Plus le match avance, moins il reste de buts potentiels.
    const remainingFactor =
      clamp(1 - elapsed / 100, 0.05, 1);

    // Les buts déjà marqués sont pris en compte.
    const baseHomeRemaining =
      homeLambda * remainingFactor;

    const baseAwayRemaining =
      awayLambda * remainingFactor;

    homeLambda = homeScore + baseHomeRemaining;
    awayLambda = awayScore + baseAwayRemaining;
  }

  // Évite les valeurs extrêmes.
  homeLambda = clamp(homeLambda, 0.05, 8);
  awayLambda = clamp(awayLambda, 0.05, 8);

  return {
    homeLambda,
    awayLambda,
    historical
  };
}

// ============================================================
// PRÉDICTION COMPLÈTE
// ============================================================

function generatePrediction(options) {

  const expected =
    calculateExpectedGoals(options);

  const homeLambda =
    expected.homeLambda;

  const awayLambda =
    expected.awayLambda;

  // ----------------------------------------------------------
  // SCORE FINAL
  // ----------------------------------------------------------

  const fullMatrix =
    createScoreMatrix(
      homeLambda,
      awayLambda,
      8
    );

  const fullAnalysis =
    analyzeMatrix(fullMatrix);

  const fullScores =
    topScores(fullMatrix, 3);

  // ----------------------------------------------------------
  // PREMIÈRE MI-TEMPS
  //
  // En moyenne, une partie des buts attendus est attribuée
  // à la première période.
  // ----------------------------------------------------------

  const htHomeLambda =
    homeLambda * 0.46;

  const htAwayLambda =
    awayLambda * 0.46;

  const halfMatrix =
    createScoreMatrix(
      htHomeLambda,
      htAwayLambda,
      6
    );

  const halfScores =
    topScores(halfMatrix, 3);

  // ----------------------------------------------------------
  // MEILLEUR PRONOSTIC 1X2
  // ----------------------------------------------------------

  const winner =
    fullAnalysis.winner;

  let winnerPrediction = "N";

  if (
    winner.home >= winner.draw &&
    winner.home >= winner.away
  ) {
    winnerPrediction = "1";
  } else if (
    winner.away >= winner.home &&
    winner.away >= winner.draw
  ) {
    winnerPrediction = "2";
  }

  // ----------------------------------------------------------
  // MEILLEURE DOUBLE CHANCE
  // ----------------------------------------------------------

  const dc =
    fullAnalysis.doubleChance;

  let bestDoubleChance = "1X";

  if (
    dc["X2"] > dc["1X"] &&
    dc["X2"] >= dc["12"]
  ) {
    bestDoubleChance = "X2";
  } else if (
    dc["12"] > dc["1X"] &&
    dc["12"] > dc["X2"]
  ) {
    bestDoubleChance = "12";
  }

  // ----------------------------------------------------------
  // MEILLEUR OVER/UNDER
  // ----------------------------------------------------------

  const ou =
    fullAnalysis.overUnder;

  let bestTotal = "Over 1.5";

  if (
    ou.over25 >= ou.under25 &&
    ou.over25 >= ou.over15
  ) {
    bestTotal = "Over 2.5";
  }

  if (
    ou.under25 > ou.over25 &&
    ou.under25 > ou.over15
  ) {
    bestTotal = "Under 2.5";
  }

  // ----------------------------------------------------------
  // SCORE ACTUEL
  // ----------------------------------------------------------

  const currentHome =
    Math.max(0, Number(options.homeScore) || 0);

  const currentAway =
    Math.max(0, Number(options.awayScore) || 0);

  return {

    success: true,

    match: {
      home: options.home || "Équipe A",
      away: options.away || "Équipe B",

      currentScore:
        `${currentHome}-${currentAway}`,

      live:
        options.live === true,

      elapsed:
        Number(options.elapsed) || 0
    },

    model: {
      method: "Poisson déterministe + historique pondéré",
      random: false,

      expectedGoals: {
        home: Number(homeLambda.toFixed(3)),
        away: Number(awayLambda.toFixed(3))
      },

      historyUsed:
        Boolean(expected.historical),

      historicalSamples:
        expected.historical
          ? expected.historical.samples
          : 0
    },

    winner: {
      prediction: winnerPrediction,

      probabilities: {
        "1": winner.home,
        "N": winner.draw,
        "2": winner.away
      }
    },

    doubleChance: {
      prediction: bestDoubleChance,
      probabilities: dc
    },

    firstHalf: {
      expectedGoals: {
        home: Number(htHomeLambda.toFixed(3)),
        away: Number(htAwayLambda.toFixed(3))
      },

      exactScores: halfScores
    },

    fullTime: {
      exactScores: fullScores
    },

    overUnder: ou,

    btts: fullAnalysis.btts,

    teamGoals: fullAnalysis.teamGoals
  };
}

// ============================================================
// RÉCUPÉRATION 1xBET
// ============================================================

async function fetchOneBet() {

  const response =
    await fetch(ONEBET_URL, {
      method: "GET",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",

        "Accept":
          "application/json,text/plain,*/*",

        "Accept-Language":
          "fr-FR,fr;q=0.9,en;q=0.8"
      },

      signal:
        AbortSignal.timeout(20000)
    });

  if (!response.ok) {

    throw new Error(
      `1xBet HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  return data;
}

// ============================================================
// OUTILS DE LECTURE 1xBET
// ============================================================

function getScore(event) {

  let homeScore = 0;
  let awayScore = 0;

  try {

    if (
      event.SC &&
      event.SC.FS
    ) {

      homeScore =
        Number(event.SC.FS.S1) || 0;

      awayScore =
        Number(event.SC.FS.S2) || 0;
    }

    else if (event.S1 !== undefined) {

      homeScore =
        Number(event.S1) || 0;

      awayScore =
        Number(event.S2) || 0;
    }

  } catch (error) {}

  return {
    homeScore,
    awayScore
  };
}

// ------------------------------------------------------------
// Détermination du statut
// ------------------------------------------------------------

function getStatus(event) {

  if (event.S) {
    return String(event.S);
  }

  if (event.SC && event.SC.T) {
    return String(event.SC.T);
  }

  return "LIVE";
}

// ------------------------------------------------------------
// Conversion événement
// ------------------------------------------------------------

function normalizeEvent(event, index) {

  const score =
    getScore(event);

  const id =
    event.I ||
    event.Id ||
    event.id ||
    `match-${index}`;

  const home =
    event.O1 ||
    event.HomeTeam ||
    event.home ||
    "Équipe A";

  const away =
    event.O2 ||
    event.AwayTeam ||
    event.away ||
    "Équipe B";

  const league =
    event.L ||
    event.LeagueName ||
    event.league ||
    "";

  const leagueId =
    event.LI ||
    event.LeagueId ||
    null;

  return {

    id: String(id),

    home: String(home),
    away: String(away),

    league: String(league),

    leagueId,

    homeScore:
      score.homeScore,

    awayScore:
      score.awayScore,

    score:
      `${score.homeScore}-${score.awayScore}`,

    status:
      getStatus(event),

    raw: event
  };
}

// ============================================================
// API LIVE
// ============================================================

app.get("/api/live", async (req, res) => {

  try {

    const data =
      await fetchOneBet();

    let events = [];

    if (Array.isArray(data)) {
      events = data;
    }

    else if (Array.isArray(data.Value)) {
      events = data.Value;
    }

    else if (Array.isArray(data.value)) {
      events = data.value;
    }

    else if (Array.isArray(data.Events)) {
      events = data.Events;
    }

    const matches =
      events.map(normalizeEvent);

    // --------------------------------------------------------
    // Enregistrement de l'historique disponible.
    // --------------------------------------------------------

    matches.forEach(match => {

      if (!historyStore.has(match.id)) {
        historyStore.set(match.id, []);
      }

      const history =
        historyStore.get(match.id);

      history.push({

        timestamp:
          new Date().toISOString(),

        homeGoals:
          match.homeScore,

        awayGoals:
          match.awayScore
      });

      // Maximum 30 observations par match.
      if (history.length > 30) {
        history.shift();
      }
    });

    res.json({

      success: true,

      count:
        matches.length,

      updatedAt:
        new Date().toISOString(),

      matches

    });

  } catch (error) {

    console.error(
      "Erreur 1xBet:",
      error.message
    );

    res.status(502).json({

      success: false,

      error:
        "Impossible de récupérer le flux 1xBet.",

      details:
        error.message
    });
  }
});

// ============================================================
// API PRÉDICTION GET
// ============================================================

app.get("/api/prediction", (req, res) => {

  try {

    const history =
      parseHistory(req.query.history);

    const prediction =
      generatePrediction({

        home:
          req.query.home,

        away:
          req.query.away,

        homeScore:
          Number(req.query.homeScore) || 0,

        awayScore:
          Number(req.query.awayScore) || 0,

        elapsed:
          Number(req.query.elapsed) || 0,

        live:
          req.query.live === "true",

        history
      });

    res.json(prediction);

  } catch (error) {

    res.status(400).json({

      success: false,

      error:
        error.message
    });
  }
});

// ============================================================
// API PRÉDICTION POST
// ============================================================

app.post("/api/prediction", (req, res) => {

  try {

    const body =
      req.body || {};

    const prediction =
      generatePrediction({

        home:
          body.home,

        away:
          body.away,

        homeScore:
          Number(body.homeScore) || 0,

        awayScore:
          Number(body.awayScore) || 0,

        elapsed:
          Number(body.elapsed) || 0,

        live:
          body.live === true,

        history:
          Array.isArray(body.history)
            ? body.history
            : []
      });

    res.json(prediction);

  } catch (error) {

    res.status(400).json({

      success: false,

      error:
        error.message
    });
  }
});

// ============================================================
// HISTORIQUE
// ============================================================

app.get("/api/history", (req, res) => {

  const result = [];

  for (
    const [matchId, history]
    of historyStore.entries()
  ) {

    result.push({

      matchId,

      observations:
        history
    });
  }

  res.json({

    success: true,

    count:
      result.length,

    history:
      result
  });
});

// ------------------------------------------------------------
// Parse historique envoyé en GET
// ------------------------------------------------------------

function parseHistory(value) {

  if (!value) {
    return [];
  }

  try {

    const parsed =
      JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {

    return [];
  }
}

// ============================================================
// 404
// ============================================================

app.use((req, res) => {

  res.status(404).json({

    success: false,

    error: "Route introuvable",

    path: req.path
  });
});

// ============================================================
// DÉMARRAGE
// ============================================================

app.listen(PORT, () => {

  console.log(
    "=============================================="
  );

  console.log(
    " FIFA LIVE PRO BET - SERVEUR DEMARRE"
  );

  console.log(
    ` Port: ${PORT}`
  );

  console.log(
    "=============================================="
  );
});
