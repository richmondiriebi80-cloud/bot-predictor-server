const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.API_KEY ||
  process.env.FOOTBALL_API_KEY;

const API_BASE = "https://v3.football.api-sports.io";

const RECENT_MATCHES = 10;
const MAX_MATCHES = 5;

// --------------------------------------------------
// OUTILS
// --------------------------------------------------

function todayUTC() {
  const d = new Date();

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value) {
  return Math.round(value) + "%";
}

function poissonProbability(lambda, k) {
  if (lambda <= 0) {
    return k === 0 ? 1 : 0;
  }

  let factorial = 1;

  for (let i = 2; i <= k; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial
  );
}

// --------------------------------------------------
// APPEL API-FOOTBALL
// --------------------------------------------------

async function apiFootball(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error(
      "API key absente. Configure API_FOOTBALL_KEY dans Render."
    );
  }

  const url = new URL(API_BASE + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  });

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
      "Réponse API invalide : " + text.substring(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      " : " +
      JSON.stringify(data.errors || data)
    );
  }

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(
      "API-Football : " +
      JSON.stringify(data.errors)
    );
  }

  return data;
}

// --------------------------------------------------
// FORMES DES ÉQUIPES
// --------------------------------------------------

function calculateForm(fixtures, teamId) {
  const finished = fixtures
    .filter((item) => {
      const status = item.fixture?.status?.short;

      return [
        "FT",
        "AET",
        "PEN"
      ].includes(status);
    })
    .sort((a, b) => {
      return (
        safeNumber(b.fixture?.timestamp) -
        safeNumber(a.fixture?.timestamp)
      );
    })
    .slice(0, RECENT_MATCHES);

  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const match of finished) {
    const homeId = match.teams?.home?.id;
    const awayId = match.teams?.away?.id;

    const homeGoals = safeNumber(match.goals?.home);
    const awayGoals = safeNumber(match.goals?.away);

    if (homeId === teamId) {
      goalsFor += homeGoals;
      goalsAgainst += awayGoals;

      if (homeGoals > awayGoals) {
        wins++;
      } else if (homeGoals === awayGoals) {
        draws++;
      } else {
        losses++;
      }

      played++;
    }

    if (awayId === teamId) {
      goalsFor += awayGoals;
      goalsAgainst += homeGoals;

      if (awayGoals > homeGoals) {
        wins++;
      } else if (awayGoals === homeGoals) {
        draws++;
      } else {
        losses++;
      }

      played++;
    }
  }

  const points =
    wins * 3 +
    draws;

  const pointsPerGame =
    played > 0 ? points / played : 0;

  const goalsForPerGame =
    played > 0 ? goalsFor / played : 0;

  const goalsAgainstPerGame =
    played > 0 ? goalsAgainst / played : 0;

  const formScore =
    played > 0
      ? pointsPerGame / 3
      : 0.5;

  return {
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalsForPerGame,
    goalsAgainstPerGame,
    points,
    pointsPerGame,
    formScore
  };
}

// --------------------------------------------------
// H2H RÉCENT
// --------------------------------------------------

function calculateH2H(fixtures, homeId, awayId) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let total = 0;

  const ordered = fixtures
    .filter((item) => {
      const status = item.fixture?.status?.short;

      return [
        "FT",
        "AET",
        "PEN"
      ].includes(status);
    })
    .sort((a, b) => {
      return (
        safeNumber(b.fixture?.timestamp) -
        safeNumber(a.fixture?.timestamp)
      );
    })
    .slice(0, 5);

  for (const match of ordered) {
    const h = match.teams?.home?.id;
    const a = match.teams?.away?.id;

    const hg = safeNumber(match.goals?.home);
    const ag = safeNumber(match.goals?.away);

    if (h === homeId && a === awayId) {
      total++;

      if (hg > ag) {
        homeWins++;
      } else if (hg === ag) {
        draws++;
      } else {
        awayWins++;
      }
    } else if (h === awayId && a === homeId) {
      total++;

      if (ag > hg) {
        homeWins++;
      } else if (hg === ag) {
        draws++;
      } else {
        awayWins++;
      }
    }
  }

  if (total === 0) {
    return {
      total: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0
    };
  }

  return {
    total,
    homeWins,
    draws,
    awayWins
  };
}

// --------------------------------------------------
// POISSON
// --------------------------------------------------

function calculatePrediction(homeForm, awayForm, h2h) {
  // Attaque + défense récente.
  // Aucune saison n'est utilisée ici.

  let homeExpected =
    (
      homeForm.goalsForPerGame +
      awayForm.goalsAgainstPerGame
    ) / 2;

  let awayExpected =
    (
      awayForm.goalsForPerGame +
      homeForm.goalsAgainstPerGame
    ) / 2;

  // Avantage domicile léger.
  homeExpected *= 1.08;

  // Influence de la forme récente.
  const homeFormFactor =
    0.85 + homeForm.formScore * 0.30;

  const awayFormFactor =
    0.85 + awayForm.formScore * 0.30;

  homeExpected *= homeFormFactor;
  awayExpected *= awayFormFactor;

  // Valeurs raisonnables.
  homeExpected = clamp(homeExpected, 0.15, 4.5);
  awayExpected = clamp(awayExpected, 0.15, 4.5);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestScore = "0-0";
  let bestScoreProbability = 0;

  for (let homeGoals = 0; homeGoals <= 7; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals++) {
      const probability =
        poissonProbability(homeExpected, homeGoals) *
        poissonProbability(awayExpected, awayGoals);

      if (homeGoals > awayGoals) {
        homeWin += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (probability > bestScoreProbability) {
        bestScoreProbability = probability;

        bestScore =
          homeGoals +
          "-" +
          awayGoals;
      }
    }
  }

  // Petite correction avec H2H si disponible.
  if (h2h.total > 0) {
    const h2hHome =
      h2h.homeWins / h2h.total;

    const h2hDraw =
      h2h.draws / h2h.total;

    const h2hAway =
      h2h.awayWins / h2h.total;

    homeWin =
      homeWin * 0.80 +
      h2hHome * 0.20;

    draw =
      draw * 0.80 +
      h2hDraw * 0.20;

    awayWin =
      awayWin * 0.80 +
      h2hAway * 0.20;
  }

  const total =
    homeWin +
    draw +
    awayWin;

  homeWin /= total;
  draw /= total;
  awayWin /= total;

  const over15 =
    1 -
    (
      poissonProbability(homeExpected + awayExpected, 0) +
      poissonProbability(homeExpected + awayExpected, 1)
    );

  let mainPick = "Nul";
  let winnerProbability = draw;

  if (homeWin > winnerProbability) {
    mainPick = "Domicile";
    winnerProbability = homeWin;
  }

  if (awayWin > winnerProbability) {
    mainPick = "Extérieur";
    winnerProbability = awayWin;
  }

  const confidence =
    clamp(winnerProbability * 100, 0, 100);

  const doubleChance1X =
    homeWin + draw;

  const doubleChanceX2 =
    draw + awayWin;

  let advice = "Match équilibré";

  if (
    mainPick === "Domicile" &&
    over15 >= 0.55
  ) {
    advice =
      "Victoire domicile et +1.5 buts";
  } else if (
    mainPick === "Extérieur" &&
    over15 >= 0.55
  ) {
    advice =
      "Victoire extérieur et +1.5 buts";
  } else if (doubleChance1X >= 0.70) {
    advice =
      "Double chance : domicile ou nul";
  } else if (doubleChanceX2 >= 0.70) {
    advice =
      "Double chance : extérieur ou nul";
  } else if (over15 >= 0.60) {
    advice =
      "+1.5 buts";
  }

  return {
    main_pick: mainPick,
    confidence: percent(confidence),

    probabilities: {
      v1: percent(homeWin * 100),
      draw: percent(draw * 100),
      v2: percent(awayWin * 100),
      "1x": percent(doubleChance1X * 100),
      "x2": percent(doubleChanceX2 * 100)
    },

    predicted_score: bestScore,

    expected_goals: {
      home: Number(homeExpected.toFixed(2)),
      away: Number(awayExpected.toFixed(2))
    },

    under_over:
      over15 >= 0.50
        ? "+1.5"
        : "Moins de +1.5",

    advice
  };
}

// --------------------------------------------------
// ANALYSE D'UN MATCH
// --------------------------------------------------

async function analyzeMatch(match) {
  const home = match.teams?.home;
  const away = match.teams?.away;

  if (!home?.id || !away?.id) {
    throw new Error("Équipe invalide dans le fixture.");
  }

  const [
    homeRecent,
    awayRecent,
    h2h
  ] = await Promise.all([
    apiFootball("/fixtures", {
      team: home.id,
      last: RECENT_MATCHES
    }),

    apiFootball("/fixtures", {
      team: away.id,
      last: RECENT_MATCHES
    }),

    apiFootball("/fixtures/headtohead", {
      h2h: home.id + "-" + away.id,
      last: 5
    })
  ]);

  const homeForm = calculateForm(
    homeRecent.response || [],
    home.id
  );

  const awayForm = calculateForm(
    awayRecent.response || [],
    away.id
  );

  const h2hData = calculateH2H(
    h2h.response || [],
    home.id,
    away.id
  );

  const prediction = calculatePrediction(
    homeForm,
    awayForm,
    h2hData
  );

  return {
    match: {
      id: match.fixture?.id || null,
      date: match.fixture?.date || null,

      league:
        match.league?.name || "Inconnue",

      country:
        match.league?.country || "",

      home: {
        id: home.id,
        name: home.name,
        logo: home.logo
      },

      away: {
        id: away.id,
        name: away.name,
        logo: away.logo
      }
    },

    prediction: {
      ...prediction,

      api_winner:
        prediction.main_pick === "Domicile"
          ? home.name
          : prediction.main_pick === "Extérieur"
            ? away.name
            : "Nul",

      win_or_draw:
        prediction.probabilities["1x"] >= "70%"
          ? "Oui"
          : "Non",

      btts: "Non disponible",
      halftime_score: "Non disponible",
      exact_score: prediction.predicted_score,
      exact_score_probability: "Non disponible",
      corners: "Non disponible",
      yellow_cards: "Non disponible",

      recent_form: {
        home: homeForm,
        away: awayForm
      },

      h2h: h2hData
    },

    available: true
  };
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: Boolean(API_KEY),
    prediction_engine:
      "recent form + poisson + h2h",
    recent_matches: RECENT_MATCHES,
    seasons_used: false,
    date: todayUTC()
  });
});

// --------------------------------------------------
// ROOT
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Football Prediction Server",
    status: "online",
    date: todayUTC(),
    endpoints: [
      "/health",
      "/predictions",
      "/predictions?date=YYYY-MM-DD"
    ]
  });
});

// --------------------------------------------------
// PREDICTIONS
// --------------------------------------------------

app.get("/predictions", async (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayUTC();

    const data = await apiFootball("/fixtures", {
      date: requestedDate,
      timezone: "UTC"
    });

    const fixtures = (data.response || [])
      .filter((item) => {
        const status =
          item.fixture?.status?.short;

        return status === "NS";
      })
      .sort((a, b) => {
        return (
          safeNumber(a.fixture?.timestamp) -
          safeNumber(b.fixture?.timestamp)
        );
      })
      .slice(0, MAX_MATCHES);

    const matches = [];

    for (const fixture of fixtures) {
      try {
        const result =
          await analyzeMatch(fixture);

        matches.push(result);
      } catch (error) {
        console.error(
          "Erreur analyse fixture",
          fixture.fixture?.id,
          error.message
        );
      }
    }

    res.json({
      success: true,
      date: requestedDate,
      analyzed: matches.length,
      predictions: matches.length,
      recent_matches: RECENT_MATCHES,
      seasons_used: false,
      prediction_engine:
        "recent form + poisson + h2h",
      matches
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
      date: todayUTC()
    });
  }
});

// --------------------------------------------------
// DEMARRAGE
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Football Prediction Server running on port " +
    PORT
  );
});
