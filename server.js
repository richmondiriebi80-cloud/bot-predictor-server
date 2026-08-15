const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"]
}));

app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io";

if (!API_KEY) {
  console.error("ERREUR : API_FOOTBALL_KEY est absente.");
}

async function apiFootball(endpoint, params = {}) {
  const url = new URL(API_URL + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
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
    throw new Error("Réponse API invalide : " + text.substring(0, 300));
  }

  if (!response.ok) {
    throw new Error(
      `API Football HTTP ${response.status}: ${JSON.stringify(data.errors || data)}`
    );
  }

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data;
}

// ----------------------------------------------------
// SANTÉ DU SERVEUR
// ----------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Football Prediction Server",
    status: "online",
    prediction_engine: "recent form + poisson + h2h",
    recent_matches: 10,
    seasons_used: false,
    date: new Date().toISOString().slice(0, 10)
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured: !!API_KEY,
    prediction_engine: "recent form + poisson + h2h",
    recent_matches: 10,
    seasons_used: false,
    date: new Date().toISOString().slice(0, 10)
  });
});

// ----------------------------------------------------
// OUTILS
// ----------------------------------------------------

function finishedFixture(f) {
  const status = f?.fixture?.status?.short;
  return ["FT", "AET", "PEN"].includes(status);
}

function goalsForTeam(fixture, teamId) {
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;

  const homeGoals = Number(fixture.goals?.home ?? 0);
  const awayGoals = Number(fixture.goals?.away ?? 0);

  if (homeId === teamId) {
    return {
      scored: homeGoals,
      conceded: awayGoals,
      home: true
    };
  }

  if (awayId === teamId) {
    return {
      scored: awayGoals,
      conceded: homeGoals,
      home: false
    };
  }

  return null;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function poissonProbability(lambda, goals) {
  if (lambda <= 0) {
    return goals === 0 ? 1 : 0;
  }

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

function matchProbabilities(homeExpected, awayExpected) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p =
        poissonProbability(homeExpected, h) *
        poissonProbability(awayExpected, a);

      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }

  const total = homeWin + draw + awayWin;

  return {
    home: homeWin / total,
    draw: draw / total,
    away: awayWin / total
  };
}

function mostLikelyScore(homeExpected, awayExpected) {
  let best = {
    home: 0,
    away: 0,
    probability: 0
  };

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p =
        poissonProbability(homeExpected, h) *
        poissonProbability(awayExpected, a);

      if (p > best.probability) {
        best = {
          home: h,
          away: a,
          probability: p
        };
      }
    }
  }

  return best;
}

async function getRecentForm(teamId) {
  const data = await apiFootball("/fixtures", {
    team: teamId,
    last: 10
  });

  const fixtures = (data.response || [])
    .filter(finishedFixture)
    .sort(
      (a, b) =>
        new Date(b.fixture.date) -
        new Date(a.fixture.date)
    )
    .slice(0, 10);

  const matches = [];

  for (const fixture of fixtures) {
    const result = goalsForTeam(fixture, teamId);

    if (!result) continue;

    let outcome = "D";

    if (result.scored > result.conceded) outcome = "W";
    if (result.scored < result.conceded) outcome = "L";

    matches.push({
      fixture_id: fixture.fixture.id,
      date: fixture.fixture.date,
      opponent:
        result.home
          ? fixture.teams.away.name
          : fixture.teams.home.name,
      scored: result.scored,
      conceded: result.conceded,
      outcome
    });
  }

  const scored = matches.map(m => m.scored);
  const conceded = matches.map(m => m.conceded);

  return {
    matches,
    goals_scored_avg: average(scored),
    goals_conceded_avg: average(conceded),
    wins: matches.filter(m => m.outcome === "W").length,
    draws: matches.filter(m => m.outcome === "D").length,
    losses: matches.filter(m => m.outcome === "L").length
  };
}

async function getH2H(homeId, awayId) {
  try {
    const data = await apiFootball("/fixtures/headtohead", {
      h2h: `${homeId}-${awayId}`,
      last: 10
    });

    const fixtures = (data.response || [])
      .filter(finishedFixture)
      .sort(
        (a, b) =>
          new Date(b.fixture.date) -
          new Date(a.fixture.date)
      )
      .slice(0, 10);

    return fixtures.map(f => ({
      fixture_id: f.fixture.id,
      date: f.fixture.date,
      home: f.teams.home.name,
      away: f.teams.away.name,
      home_goals: f.goals.home,
      away_goals: f.goals.away
    }));
  } catch (error) {
    console.log("H2H indisponible :", error.message);
    return [];
  }
}

// ----------------------------------------------------
// ANALYSE D'UN MATCH
// ----------------------------------------------------

async function analyzeMatch(fixture) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;

  const [homeForm, awayForm, h2h] = await Promise.all([
    getRecentForm(home.id),
    getRecentForm(away.id),
    getH2H(home.id, away.id)
  ]);

  /*
    Modèle basé principalement sur les 10 derniers matchs.
    Aucun season=XXXX n'est utilisé.
  */

  let homeExpected =
    (homeForm.goals_scored_avg +
      awayForm.goals_conceded_avg) / 2;

  let awayExpected =
    (awayForm.goals_scored_avg +
      homeForm.goals_conceded_avg) / 2;

  // Petit ajustement domicile
  homeExpected *= 1.08;

  // H2H : influence limitée pour éviter de trop
  // dépendre d'anciens matchs.
  if (h2h.length > 0) {
    let h2hHomeGoals = 0;
    let h2hAwayGoals = 0;

    for (const match of h2h) {
      h2hHomeGoals += Number(match.home_goals ?? 0);
      h2hAwayGoals += Number(match.away_goals ?? 0);
    }

    const h2hHomeAvg =
      h2hHomeGoals / h2h.length;

    const h2hAwayAvg =
      h2hAwayGoals / h2h.length;

    homeExpected =
      homeExpected * 0.85 +
      h2hHomeAvg * 0.15;

    awayExpected =
      awayExpected * 0.85 +
      h2hAwayAvg * 0.15;
  }

  homeExpected = Math.max(
    0.05,
    Math.min(homeExpected, 5)
  );

  awayExpected = Math.max(
    0.05,
    Math.min(awayExpected, 5)
  );

  const probabilities =
    matchProbabilities(
      homeExpected,
      awayExpected
    );

  const score =
    mostLikelyScore(
      homeExpected,
      awayExpected
    );

  let mainPick = "Match nul";
  let winner = null;

  if (
    probabilities.home >= probabilities.away &&
    probabilities.home >= probabilities.draw
  ) {
    mainPick = `Victoire ${home.name}`;
    winner = home.name;
  } else if (
    probabilities.away >= probabilities.home &&
    probabilities.away >= probabilities.draw
  ) {
    mainPick = `Victoire ${away.name}`;
    winner = away.name;
  }

  const doubleChanceHome =
    probabilities.home + probabilities.draw;

  const doubleChanceAway =
    probabilities.away + probabilities.draw;

  let doubleChance = "Aucune préférence";

  if (doubleChanceHome >= 0.65) {
    doubleChance = `${home.name} ou nul`;
  } else if (doubleChanceAway >= 0.65) {
    doubleChance = `${away.name} ou nul`;
  }

  const confidence =
    Math.max(
      probabilities.home,
      probabilities.draw,
      probabilities.away
    );

  const totalExpected =
    homeExpected + awayExpected;

  let underOver = "Non disponible";

  if (totalExpected >= 1.5) {
    underOver = "+1.5 buts";
  }

  const bttsProbability =
    (1 - Math.exp(-homeExpected)) *
    (1 - Math.exp(-awayExpected));

  let btts = "Non disponible";

  if (bttsProbability >= 0.60) {
    btts = "Oui";
  } else if (bttsProbability <= 0.35) {
    btts = "Non";
  }

  let advice;

  if (doubleChanceHome >= 0.75) {
    advice =
      `Double chance : ${home.name} ou nul`;
  } else if (doubleChanceAway >= 0.75) {
    advice =
      `Double chance : ${away.name} ou nul`;
  } else if (winner) {
    advice = `Victoire ${winner}`;
  } else {
    advice = "Match nul";
  }

  if (totalExpected >= 1.5) {
    advice += " et +1.5 buts";
  }

  return {
    match: {
      id: fixture.fixture.id,
      date: fixture.fixture.date,
      league: fixture.league.name,
      country: fixture.league.country,
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
      main_pick: mainPick,

      confidence:
        Math.round(confidence * 100) + "%",

      probabilities: {
        v1:
          Math.round(probabilities.home * 100) + "%",
        draw:
          Math.round(probabilities.draw * 100) + "%",
        v2:
          Math.round(probabilities.away * 100) + "%",

        "1x":
          Math.round(doubleChanceHome * 100) + "%",

        x2:
          Math.round(doubleChanceAway * 100) + "%"
      },

      predicted_score:
        `${score.home}-${score.away}`,

      expected_goals: {
        home:
          Number(homeExpected.toFixed(2)),
        away:
          Number(awayExpected.toFixed(2))
      },

      api_winner: winner,

      win_or_draw:
        doubleChanceHome >= doubleChanceAway
          ? `${home.name} ou nul`
          : `${away.name} ou nul`,

      under_over: underOver,

      btts,

      recent_form: {
        home: {
          matches: homeForm.matches,
          wins: homeForm.wins,
          draws: homeForm.draws,
          losses: homeForm.losses,
          goals_scored_avg:
            Number(
              homeForm.goals_scored_avg.toFixed(2)
            ),
          goals_conceded_avg:
            Number(
              homeForm.goals_conceded_avg.toFixed(2)
            )
        },

        away: {
          matches: awayForm.matches,
          wins: awayForm.wins,
          draws: awayForm.draws,
          losses: awayForm.losses,
          goals_scored_avg:
            Number(
              awayForm.goals_scored_avg.toFixed(2)
            ),
          goals_conceded_avg:
            Number(
              awayForm.goals_conceded_avg.toFixed(2)
            )
        }
      },

      h2h_last_10: h2h,

      advice
    },

    available: true
  };
}

// ----------------------------------------------------
// PREDICTIONS DU JOUR
// ----------------------------------------------------

app.get("/predictions", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "API_FOOTBALL_KEY non configurée sur Render."
      });
    }

    const requestedDate =
      req.query.date ||
      new Date().toISOString().slice(0, 10);

    const data = await apiFootball("/fixtures", {
      date: requestedDate
    });

    const upcoming = (data.response || [])
      .filter(f => {
        const status = f.fixture?.status?.short;
        return status === "NS" || status === "TBD";
      })
      .sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );

    const limit = Math.min(
      Number(req.query.limit || 5),
      10
    );

    const selected = upcoming.slice(0, limit);

    const predictions = [];

    for (const fixture of selected) {
      try {
        const result =
          await analyzeMatch(fixture);

        predictions.push(result);
      } catch (error) {
        console.error(
          "Erreur analyse fixture",
          fixture.fixture.id,
          error.message
        );
      }
    }

    return res.json({
      success: true,
      date: requestedDate,
      analyzed: predictions.length,
      predictions: predictions.length,
      engine: {
        recent_matches: 10,
        seasons_used: false,
        poisson: true,
        h2h: true
      },
      matches: predictions
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
      hint:
        "Vérifie API_FOOTBALL_KEY et les logs Render."
    });
  }
});

// ----------------------------------------------------
// ANALYSE D'UN FIXTURE PRECIS
// ----------------------------------------------------

app.get("/prediction", async (req, res) => {
  try {
    const fixtureId = req.query.fixture;

    if (!fixtureId) {
      return res.status(400).json({
        success: false,
        error: "Paramètre fixture obligatoire."
      });
    }

    const data = await apiFootball("/fixtures", {
      id: fixtureId
    });

    if (!data.response || !data.response.length) {
      return res.status(404).json({
        success: false,
        error: "Match introuvable."
      });
    }

    const result =
      await analyzeMatch(data.response[0]);

    return res.json({
      success: true,
      fixture: fixtureId,
      data: result
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ----------------------------------------------------
// DEMARRAGE
// ----------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Football Prediction Server démarré sur le port ${PORT}`
  );
});
