const express = require("express");

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = "https://v3.football.api-sports.io";

function apiHeaders() {
  return {
    "x-apisports-key": API_KEY
  };
}

async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method: "GET",
    headers: apiHeaders()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Réponse API invalide : " + text.slice(0, 200));
  }

  if (!response.ok) {
    throw new Error(
      "API Football HTTP " +
        response.status +
        " : " +
        JSON.stringify(data)
    );
  }

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error("API Football : " + JSON.stringify(data.errors));
  }

  return data;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getGoals(match, teamId) {
  const homeId = match?.teams?.home?.id;
  const awayId = match?.teams?.away?.id;

  const homeGoals = safeNumber(match?.goals?.home);
  const awayGoals = safeNumber(match?.goals?.away);

  if (homeId === teamId) {
    return {
      scored: homeGoals,
      conceded: awayGoals
    };
  }

  if (awayId === teamId) {
    return {
      scored: awayGoals,
      conceded: homeGoals
    };
  }

  return {
    scored: 0,
    conceded: 0
  };
}

function calculateForm(matches, teamId) {
  const finished = matches
    .filter((match) => {
      const status = match?.fixture?.status?.short;
      return ["FT", "AET", "PEN"].includes(status);
    })
    .sort(
      (a, b) =>
        safeNumber(b?.fixture?.timestamp) -
        safeNumber(a?.fixture?.timestamp)
    )
    .slice(0, 10);

  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const match of finished) {
    const homeId = match?.teams?.home?.id;
    const awayId = match?.teams?.away?.id;

    const homeGoals = safeNumber(match?.goals?.home);
    const awayGoals = safeNumber(match?.goals?.away);

    const teamGoals =
      homeId === teamId ? homeGoals : awayId === teamId ? awayGoals : 0;

    const opponentGoals =
      homeId === teamId ? awayGoals : awayId === teamId ? homeGoals : 0;

    goalsFor += teamGoals;
    goalsAgainst += opponentGoals;

    if (teamGoals > opponentGoals) {
      wins++;
      points += 3;
    } else if (teamGoals === opponentGoals) {
      draws++;
      points += 1;
    } else {
      losses++;
    }
  }

  const games = finished.length;

  return {
    games,
    wins,
    draws,
    losses,
    points,
    goalsFor,
    goalsAgainst,
    goalsPerGame: games ? goalsFor / games : 0,
    concededPerGame: games ? goalsAgainst / games : 0,
    form: finished.map((match) => {
      const g = getGoals(match, teamId);

      if (g.scored > g.conceded) return "W";
      if (g.scored === g.conceded) return "D";
      return "L";
    })
  };
}

function poissonProbability(lambda, goals) {
  let factorial = 1;

  for (let i = 2; i <= goals; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial
  );
}

function calculatePoisson(homeLambda, awayLambda) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let homeGoals = 0; homeGoals <= 6; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals++) {
      const probability =
        poissonProbability(homeLambda, homeGoals) *
        poissonProbability(awayLambda, awayGoals);

      if (homeGoals > awayGoals) {
        homeWin += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        awayWin += probability;
      }
    }
  }

  const total = homeWin + draw + awayWin;

  return {
    home: homeWin / total,
    draw: draw / total,
    away: awayWin / total
  };
}

function calculatePrediction(homeForm, awayForm, h2hMatches, homeId, awayId) {
  const homeAttack =
    homeForm.goalsPerGame > 0
      ? homeForm.goalsPerGame
      : 1.0;

  const awayAttack =
    awayForm.goalsPerGame > 0
      ? awayForm.goalsPerGame
      : 1.0;

  const homeDefense =
    homeForm.concededPerGame > 0
      ? homeForm.concededPerGame
      : 1.0;

  const awayDefense =
    awayForm.concededPerGame > 0
      ? awayForm.concededPerGame
      : 1.0;

  let homeLambda =
    0.55 * homeAttack +
    0.45 * awayDefense;

  let awayLambda =
    0.55 * awayAttack +
    0.45 * homeDefense;

  if (h2hMatches.length > 0) {
    const h2hForm = calculateFormForH2H(
      h2hMatches,
      homeId,
      awayId
    );

    homeLambda =
      homeLambda * 0.8 +
      h2hForm.homeGoalsPerGame * 0.2;

    awayLambda =
      awayLambda * 0.8 +
      h2hForm.awayGoalsPerGame * 0.2;
  }

  homeLambda = Math.max(0.15, Math.min(homeLambda, 5));
  awayLambda = Math.max(0.15, Math.min(awayLambda, 5));

  const probabilities = calculatePoisson(
    homeLambda,
    awayLambda
  );

  const homePct = Math.round(probabilities.home * 100);
  const drawPct = Math.round(probabilities.draw * 100);
  const awayPct = Math.round(probabilities.away * 100);

  let mainPick = "Nul";
  let confidence = drawPct;

  if (homePct >= drawPct && homePct >= awayPct) {
    mainPick = "Victoire domicile";
    confidence = homePct;
  } else if (awayPct >= homePct && awayPct >= drawPct) {
    mainPick = "Victoire extérieur";
    confidence = awayPct;
  }

  const predictedHomeGoals = Math.max(
    0,
    Math.round(homeLambda)
  );

  const predictedAwayGoals = Math.max(
    0,
    Math.round(awayLambda)
  );

  const totalGoals = homeLambda + awayLambda;

  return {
    main_pick: mainPick,
    confidence: confidence + "%",
    probabilities: {
      v1: homePct + "%",
      draw: drawPct + "%",
      v2: awayPct + "%",
      "1x": Math.round((probabilities.home + probabilities.draw) * 100) + "%",
      x2: Math.round((probabilities.draw + probabilities.away) * 100) + "%"
    },
    predicted_score:
      predictedHomeGoals + "-" + predictedAwayGoals,
    under_over:
      totalGoals >= 1.5 ? "+1.5" : "-1.5",
    btts:
      homeLambda >= 0.8 && awayLambda >= 0.8
        ? "Oui"
        : "Non"
  };
}

function calculateFormForH2H(matches, homeId, awayId) {
  let homeGoals = 0;
  let awayGoals = 0;
  let count = 0;

  for (const match of matches.slice(0, 10)) {
    const homeTeam = match?.teams?.home?.id;
    const awayTeam = match?.teams?.away?.id;

    const hg = safeNumber(match?.goals?.home);
    const ag = safeNumber(match?.goals?.away);

    if (
      homeTeam === homeId &&
      awayTeam === awayId
    ) {
      homeGoals += hg;
      awayGoals += ag;
      count++;
    } else if (
      homeTeam === awayId &&
      awayTeam === homeId
    ) {
      homeGoals += ag;
      awayGoals += hg;
      count++;
    }
  }

  return {
    homeGoalsPerGame: count ? homeGoals / count : 1,
    awayGoalsPerGame: count ? awayGoals / count : 1
  };
}

async function getTeamRecentMatches(teamId) {
  const data = await apiGet("/fixtures", {
    team: teamId,
    last: 10
  });

  return Array.isArray(data.response)
    ? data.response
    : [];
}

async function getH2H(homeId, awayId) {
  const data = await apiGet("/fixtures/headtohead", {
    h2h: homeId + "-" + awayId,
    last: 10
  });

  return Array.isArray(data.response)
    ? data.response
    : [];
}

async function buildPrediction(fixture) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;

  const [homeRecent, awayRecent, h2h] =
    await Promise.all([
      getTeamRecentMatches(home.id),
      getTeamRecentMatches(away.id),
      getH2H(home.id, away.id)
    ]);

  const homeForm = calculateForm(
    homeRecent,
    home.id
  );

  const awayForm = calculateForm(
    awayRecent,
    away.id
  );

  const prediction = calculatePrediction(
    homeForm,
    awayForm,
    h2h,
    home.id,
    away.id
  );

  return {
    match: {
      id: fixture.fixture.id,
      date: fixture.fixture.date,
      league: fixture.league?.name || "Inconnue",
      country: fixture.league?.country || "",
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

    prediction,

    analysis: {
      engine:
        "recent form + poisson + h2h",

      recent_matches: 10,

      seasons_used: false,

      home_form: homeForm,

      away_form: awayForm,

      h2h_matches: Math.min(h2h.length, 10)
    },

    advice: buildAdvice(prediction)
  };
}

function buildAdvice(prediction) {
  const p = prediction.probabilities;

  if (prediction.main_pick === "Victoire domicile") {
    return (
      "Victoire domicile ou double chance 1X, " +
      "avec " +
      prediction.under_over +
      " buts"
    );
  }

  if (prediction.main_pick === "Victoire extérieur") {
    return (
      "Victoire extérieur ou double chance X2, " +
      "avec " +
      prediction.under_over +
      " buts"
    );
  }

  return (
    "Double chance 1X/X2 à privilégier ; " +
    "match équilibré"
  );
}

function formatMatchForResponse(result) {
  return {
    match: result.match,
    prediction: {
      main_pick: result.prediction.main_pick,
      confidence: result.prediction.confidence,
      probabilities: result.prediction.probabilities,
      predicted_score: result.prediction.predicted_score,
      api_winner:
        result.prediction.main_pick === "Victoire domicile"
          ? result.match.home.name
          : result.prediction.main_pick === "Victoire extérieur"
          ? result.match.away.name
          : "Nul",
      win_or_draw:
        result.prediction.main_pick === "Victoire domicile"
          ? "Oui"
          : result.prediction.main_pick === "Victoire extérieur"
          ? "Oui"
          : "Oui",
      under_over: result.prediction.under_over,
      btts: result.prediction.btts,
      advice: result.advice
    },
    analysis: result.analysis,
    available: true
  };
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "BOT PREDICTOR",
    engine: "recent form + poisson + h2h",
    recent_matches: 10,
    seasons_used: false,
    message: "Serveur opérationnel"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: Boolean(API_KEY),
    engine: "recent form + poisson + h2h",
    recent_matches: 10,
    seasons_used: false
  });
});

app.get("/predictions", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "API_FOOTBALL_KEY n'est pas configurée dans Render."
      });
    }

    const date =
      typeof req.query.date === "string" &&
      req.query.date.trim()
        ? req.query.date.trim()
        : new Date().toISOString().slice(0, 10);

    const data = await apiGet("/fixtures", {
      date
    });

    const fixtures = Array.isArray(data.response)
      ? data.response
      : [];

    const upcoming = fixtures
      .filter((fixture) => {
        const status = fixture?.fixture?.status?.short;

        return [
          "NS",
          "TBD"
        ].includes(status);
      })
      .slice(0, 10);

    const results = [];

    for (const fixture of upcoming) {
      try {
        const result = await buildPrediction(fixture);
        results.push(formatMatchForResponse(result));
      } catch (error) {
        results.push({
          match: {
            id: fixture?.fixture?.id || null,
            date: fixture?.fixture?.date || null,
            league: fixture?.league?.name || "",
            country: fixture?.league?.country || "",
            home: fixture?.teams?.home || {},
            away: fixture?.teams?.away || {}
          },
          available: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      date,
      analyzed: results.length,
      predictions: results.filter(
        (item) => item.available
      ).length,
      matches: results
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/prediction/:fixtureId", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "API_FOOTBALL_KEY n'est pas configurée dans Render."
      });
    }

    const fixtureId = String(
      req.params.fixtureId || ""
    ).trim();

    if (!fixtureId) {
      return res.status(400).json({
        success: false,
        error: "fixtureId manquant"
      });
    }

    const data = await apiGet("/fixtures", {
      id: fixtureId
    });

    if (
      !Array.isArray(data.response) ||
      data.response.length === 0
    ) {
      return res.status(404).json({
        success: false,
        error: "Match introuvable"
      });
    }

    const result = await buildPrediction(
      data.response[0]
    );

    res.json({
      success: true,
      fixture: fixtureId,
      data: formatMatchForResponse(result)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route introuvable",
    route: req.path,
    available_routes: [
      "/",
      "/health",
      "/predictions",
      "/prediction/:fixtureId"
    ]
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "BOT PREDICTOR démarré sur le port " + PORT
  );
});
