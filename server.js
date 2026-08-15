const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io";

const cache = new Map();
const CACHE_TIME = 5 * 60 * 1000;

function apiHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

async function apiGet(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY non configurée");
  }

  const cached = cache.get(endpoint);

  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const response = await fetch(API_URL + endpoint, {
    headers: apiHeaders()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse API non JSON : HTTP " + response.status
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      " : " +
      JSON.stringify(data)
    );
  }

  if (
    data.errors &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(JSON.stringify(data.errors));
  }

  cache.set(endpoint, {
    time: Date.now(),
    data
  });

  return data;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value) {
  return Math.round(clamp(value, 0, 100)) + "%";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/*
====================================================
10 DERNIERS MATCHS
IMPORTANT :
AUCUN PARAMETRE season
====================================================
*/

async function getLastMatches(teamId) {
  const endpoint =
    "/fixtures?team=" +
    encodeURIComponent(teamId) +
    "&last=10";

  const data = await apiGet(endpoint);

  return Array.isArray(data.response)
    ? data.response
    : [];
}

/*
====================================================
STATISTIQUES DES 10 DERNIERS MATCHS
====================================================
*/

function getTeamStats(matches, teamId) {
  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  let homePlayed = 0;
  let homeGF = 0;
  let homeGA = 0;

  let awayPlayed = 0;
  let awayGF = 0;
  let awayGA = 0;

  for (const match of matches) {
    const status =
      match.fixture &&
      match.fixture.status
        ? match.fixture.status.short
        : "";

    if (
      status !== "FT" &&
      status !== "AET" &&
      status !== "PEN"
    ) {
      continue;
    }

    const homeTeam =
      match.teams &&
      match.teams.home;

    const awayTeam =
      match.teams &&
      match.teams.away;

    const goals =
      match.goals || {};

    if (!homeTeam || !awayTeam) continue;

    const isHome =
      homeTeam.id === teamId;

    const isAway =
      awayTeam.id === teamId;

    if (!isHome && !isAway) continue;

    const gf = isHome
      ? num(goals.home)
      : num(goals.away);

    const ga = isHome
      ? num(goals.away)
      : num(goals.home);

    played++;

    goalsFor += gf;
    goalsAgainst += ga;

    if (gf > ga) wins++;
    else if (gf === ga) draws++;
    else losses++;

    if (isHome) {
      homePlayed++;
      homeGF += gf;
      homeGA += ga;
    }

    if (isAway) {
      awayPlayed++;
      awayGF += gf;
      awayGA += ga;
    }
  }

  return {
    played,
    wins,
    draws,
    losses,

    winRate:
      played > 0
        ? wins / played
        : 0,

    goalsForAvg:
      played > 0
        ? goalsFor / played
        : 1,

    goalsAgainstAvg:
      played > 0
        ? goalsAgainst / played
        : 1,

    homeGoalsForAvg:
      homePlayed > 0
        ? homeGF / homePlayed
        : goalsFor / Math.max(played, 1),

    homeGoalsAgainstAvg:
      homePlayed > 0
        ? homeGA / homePlayed
        : goalsAgainst / Math.max(played, 1),

    awayGoalsForAvg:
      awayPlayed > 0
        ? awayGF / awayPlayed
        : goalsFor / Math.max(played, 1),

    awayGoalsAgainstAvg:
      awayPlayed > 0
        ? awayGA / awayPlayed
        : goalsAgainst / Math.max(played, 1)
  };
}

/*
====================================================
H2H
====================================================
*/

async function getH2H(homeId, awayId) {
  try {
    const endpoint =
      "/fixtures/headtohead?h2h=" +
      encodeURIComponent(homeId) +
      "-" +
      encodeURIComponent(awayId) +
      "&last=5";

    const data = await apiGet(endpoint);

    return Array.isArray(data.response)
      ? data.response
      : [];
  } catch (error) {
    console.log(
      "H2H indisponible :",
      error.message
    );

    return [];
  }
}

function calculateH2H(matches, homeId) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let total = 0;

  for (const match of matches) {
    const status =
      match.fixture &&
      match.fixture.status
        ? match.fixture.status.short
        : "";

    if (
      status !== "FT" &&
      status !== "AET" &&
      status !== "PEN"
    ) {
      continue;
    }

    const gh =
      match.goals &&
      match.goals.home != null
        ? num(match.goals.home)
        : null;

    const ga =
      match.goals &&
      match.goals.away != null
        ? num(match.goals.away)
        : null;

    if (gh === null || ga === null) {
      continue;
    }

    const actualHomeId =
      match.teams &&
      match.teams.home
        ? match.teams.home.id
        : null;

    const requestedHomeGoals =
      actualHomeId === homeId
        ? gh
        : ga;

    const requestedAwayGoals =
      actualHomeId === homeId
        ? ga
        : gh;

    total++;

    if (
      requestedHomeGoals >
      requestedAwayGoals
    ) {
      homeWins++;
    } else if (
      requestedHomeGoals <
      requestedAwayGoals
    ) {
      awayWins++;
    } else {
      draws++;
    }
  }

  if (total === 0) {
    return {
      home: 0,
      draw: 0,
      away: 0
    };
  }

  return {
    home: homeWins / total,
    draw: draws / total,
    away: awayWins / total
  };
}

/*
====================================================
POISSON
====================================================
*/

function factorial(n) {
  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(lambda, goals) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

function createScoreMatrix(homeExpected, awayExpected) {
  const matrix = [];

  for (let h = 0; h <= 8; h++) {
    matrix[h] = [];

    for (let a = 0; a <= 8; a++) {
      matrix[h][a] =
        poisson(homeExpected, h) *
        poisson(awayExpected, a);
    }
  }

  return matrix;
}

/*
====================================================
PROBABILITÉS
====================================================
*/

function calculateProbabilities(matrix) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let over15 = 0;
  let over25 = 0;
  let under25 = 0;

  let btts = 0;
  let total = 0;

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];

      total += p;

      if (h > a) homeWin += p;
      if (h === a) draw += p;
      if (h < a) awayWin += p;

      if (h + a >= 2) over15 += p;
      if (h + a >= 3) over25 += p;
      if (h + a < 3) under25 += p;

      if (h > 0 && a > 0) {
        btts += p;
      }
    }
  }

  if (total === 0) {
    return {
      homeWin: 33.33,
      draw: 33.33,
      awayWin: 33.34,
      over15: 50,
      over25: 50,
      under25: 50,
      btts: 50
    };
  }

  return {
    homeWin: homeWin / total * 100,
    draw: draw / total * 100,
    awayWin: awayWin / total * 100,
    over15: over15 / total * 100,
    over25: over25 / total * 100,
    under25: under25 / total * 100,
    btts: btts / total * 100
  };
}

/*
====================================================
SCORE LE PLUS PROBABLE
====================================================
*/

function mostLikelyScore(matrix) {
  let bestProbability = -1;
  let bestScore = "Non disponible";

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      if (matrix[h][a] > bestProbability) {
        bestProbability = matrix[h][a];
        bestScore = h + "-" + a;
      }
    }
  }

  return {
    score: bestScore,
    probability:
      bestProbability >= 0
        ? bestProbability * 100
        : 0
  };
}

/*
====================================================
BUTS ATTENDUS
====================================================
*/

function expectedGoals(homeStats, awayStats) {
  let homeExpected =
    (
      homeStats.homeGoalsForAvg +
      awayStats.awayGoalsAgainstAvg
    ) / 2;

  let awayExpected =
    (
      awayStats.awayGoalsForAvg +
      homeStats.homeGoalsAgainstAvg
    ) / 2;

  /*
   * Petit avantage domicile.
   */
  homeExpected *= 1.08;

  homeExpected =
    clamp(
      homeExpected,
      0.15,
      4.5
    );

  awayExpected =
    clamp(
      awayExpected,
      0.15,
      4.5
    );

  return {
    home: homeExpected,
    away: awayExpected
  };
}

/*
====================================================
AJUSTEMENT FORME RÉCENTE
====================================================
*/

function adjustForRecentForm(
  probabilities,
  homeStats,
  awayStats,
  h2h
) {
  /*
   * La forme récente a un poids important.
   */
  const formDifference =
    homeStats.winRate -
    awayStats.winRate;

  probabilities.homeWin +=
    formDifference * 10;

  probabilities.awayWin -=
    formDifference * 10;

  /*
   * H2H = poids plus faible.
   */
  if (h2h) {
    probabilities.homeWin +=
      h2h.home * 3;

    probabilities.draw +=
      h2h.draw * 2;

    probabilities.awayWin +=
      h2h.away * 3;
  }

  probabilities.homeWin =
    Math.max(0, probabilities.homeWin);

  probabilities.draw =
    Math.max(0, probabilities.draw);

  probabilities.awayWin =
    Math.max(0, probabilities.awayWin);

  const total =
    probabilities.homeWin +
    probabilities.draw +
    probabilities.awayWin;

  if (total > 0) {
    probabilities.homeWin =
      probabilities.homeWin /
      total * 100;

    probabilities.draw =
      probabilities.draw /
      total * 100;

    probabilities.awayWin =
      probabilities.awayWin /
      total * 100;
  }

  return probabilities;
}

/*
====================================================
VAINQUEUR
====================================================
*/

function winner(
  probabilities,
  homeName,
  awayName
) {
  if (
    probabilities.homeWin >=
    probabilities.draw &&
    probabilities.homeWin >=
    probabilities.awayWin
  ) {
    return homeName;
  }

  if (
    probabilities.awayWin >=
    probabilities.homeWin &&
    probabilities.awayWin >=
    probabilities.draw
  ) {
    return awayName;
  }

  return "Match nul";
}

/*
====================================================
CONFIANCE
====================================================
*/

function confidence(probabilities) {
  const values = [
    probabilities.homeWin,
    probabilities.draw,
    probabilities.awayWin
  ].sort((a, b) => b - a);

  const best = values[0];
  const second = values[1];

  const margin =
    best - second;

  /*
   * Confiance limitée pour éviter
   * les faux 90-100%.
   */
  return clamp(
    best * 0.75 +
    margin * 0.5,
    30,
    92
  );
}

/*
====================================================
OVER / UNDER
====================================================
*/

function overUnder(probabilities) {
  if (probabilities.over25 >= 55) {
    return "Over 2.5";
  }

  if (probabilities.over15 >= 65) {
    return "Over 1.5";
  }

  return "Under 2.5";
}

/*
====================================================
CONSEIL
====================================================
*/

function createAdvice(
  pick,
  homeName,
  awayName,
  probabilities
) {
  const oneX =
    probabilities.homeWin +
    probabilities.draw;

  const xTwo =
    probabilities.draw +
    probabilities.awayWin;

  const goals =
    overUnder(probabilities);

  if (
    pick === homeName &&
    oneX >= 65
  ) {
    return (
      "Double chance : " +
      homeName +
      " ou nul et " +
      goals
    );
  }

  if (
    pick === awayName &&
    xTwo >= 65
  ) {
    return (
      "Double chance : " +
      awayName +
      " ou nul et " +
      goals
    );
  }

  if (
    pick !== "Match nul" &&
    Math.max(
      probabilities.homeWin,
      probabilities.awayWin
    ) >= 55
  ) {
    return (
      "Victoire " +
      pick +
      " et " +
      goals
    );
  }

  return goals;
}

/*
====================================================
PRÉDICTION D'UN MATCH
====================================================
*/

async function predictFixture(fixture) {
  const info =
    fixture.fixture || {};

  const teams =
    fixture.teams || {};

  const league =
    fixture.league || {};

  const home =
    teams.home || {};

  const away =
    teams.away || {};

  if (!home.id || !away.id) {
    throw new Error(
      "Équipes introuvables"
    );
  }

  /*
   * IMPORTANT :
   * aucune saison n'est envoyée.
   */
  const [
    homeMatches,
    awayMatches,
    h2hMatches
  ] = await Promise.all([
    getLastMatches(home.id),
    getLastMatches(away.id),
    getH2H(home.id, away.id)
  ]);

  const homeStats =
    getTeamStats(
      homeMatches,
      home.id
    );

  const awayStats =
    getTeamStats(
      awayMatches,
      away.id
    );

  const goals =
    expectedGoals(
      homeStats,
      awayStats
    );

  const matrix =
    createScoreMatrix(
      goals.home,
      goals.away
    );

  let probabilities =
    calculateProbabilities(
      matrix
    );

  const h2h =
    calculateH2H(
      h2hMatches,
      home.id
    );

  probabilities =
    adjustForRecentForm(
      probabilities,
      homeStats,
      awayStats,
      h2h
    );

  const pick =
    winner(
      probabilities,
      home.name,
      away.name
    );

  const score =
    mostLikelyScore(matrix);

  const conf =
    confidence(probabilities);

  const oneX =
    probabilities.homeWin +
    probabilities.draw;

  const xTwo =
    probabilities.draw +
    probabilities.awayWin;

  return {
    match: {
      id:
        info.id || null,

      date:
        info.date || null,

      league:
        league.name || "Inconnu",

      country:
        league.country || "Inconnu",

      home: {
        id:
          home.id || null,

        name:
          home.name || "Inconnu",

        logo:
          home.logo || null
      },

      away: {
        id:
          away.id || null,

        name:
          away.name || "Inconnu",

        logo:
          away.logo || null
      }
    },

    prediction: {
      main_pick:
        pick,

      confidence:
        percent(conf),

      probabilities: {
        v1:
          percent(
            probabilities.homeWin
          ),

        draw:
          percent(
            probabilities.draw
          ),

        v2:
          percent(
            probabilities.awayWin
          ),

        "1x":
          percent(oneX),

        "x2":
          percent(xTwo)
      },

      predicted_score:
        score.score,

      exact_score:
        score.score,

      exact_score_probability:
        percent(
          score.probability
        ),

      under_over:
        overUnder(
          probabilities
        ),

      btts:
        probabilities.btts >= 55
          ? "Oui"
          : "Non",

      api_winner:
        "Modèle statistique",

      win_or_draw:
        pick === home.name
          ? oneX >= 50
            ? "Oui"
            : "Non"
          : pick === away.name
            ? xTwo >= 50
              ? "Oui"
              : "Non"
            : "Oui",

      advice:
        createAdvice(
          pick,
          home.name,
          away.name,
          probabilities
        ),

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible"
    },

    model: {
      data_source:
        "10 derniers matchs disponibles",

      seasons_used:
        false,

      home_recent_matches:
        homeStats.played,

      away_recent_matches:
        awayStats.played,

      home_recent_wins:
        homeStats.wins,

      away_recent_wins:
        awayStats.wins,

      home_recent_draws:
        homeStats.draws,

      away_recent_draws:
        awayStats.draws,

      home_recent_losses:
        homeStats.losses,

      away_recent_losses:
        awayStats.losses,

      home_goals_for_avg:
        Number(
          homeStats.goalsForAvg.toFixed(2)
        ),

      home_goals_against_avg:
        Number(
          homeStats.goalsAgainstAvg.toFixed(2)
        ),

      away_goals_for_avg:
        Number(
          awayStats.goalsForAvg.toFixed(2)
        ),

      away_goals_against_avg:
        Number(
          awayStats.goalsAgainstAvg.toFixed(2)
        ),

      expected_home_goals:
        Number(
          goals.home.toFixed(2)
        ),

      expected_away_goals:
        Number(
          goals.away.toFixed(2)
        ),

      h2h_matches:
        h2hMatches.length
    },

    available: true
  };
}

/*
====================================================
SERVEUR
====================================================
*/

app.get("/", (req, res) => {
  res.json({
    success: true,
    service:
      "Football Prediction Server",
    status: "online",
    prediction_engine:
      "10 derniers matchs + Poisson + forme + H2H",
    season_analysis:
      false,
    date:
      today()
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured:
      Boolean(API_KEY),

    prediction_engine:
      "recent form + poisson + h2h",

    recent_matches:
      10,

    seasons_used:
      false,

    date:
      today()
  });
});

/*
====================================================
UNE PRÉDICTION
====================================================
*/

app.get(
  "/api/prediction/:fixtureId",
  async (req, res) => {
    try {
      const fixtureId =
        req.params.fixtureId;

      const data =
        await apiGet(
          "/fixtures?id=" +
          encodeURIComponent(
            fixtureId
          )
        );

      if (
        !data.response ||
        data.response.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Match introuvable"
        });
      }

      const result =
        await predictFixture(
          data.response[0]
        );

      res.json({
        success: true,
        fixture:
          fixtureId,
        data:
          result
      });

    } catch (error) {
      console.error(
        "Prediction error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/*
====================================================
PRÉDICTIONS DU JOUR
====================================================
*/

app.get(
  "/api/predictions",
  async (req, res) => {
    try {
      const date =
        req.query.date ||
        today();

      let limit =
        parseInt(
          req.query.limit || "5",
          10
        );

      if (!Number.isFinite(limit)) {
        limit = 5;
      }

      limit =
        clamp(
          limit,
          1,
          20
        );

      /*
       * IMPORTANT :
       * ici aussi aucune saison.
       */
      const data =
        await apiGet(
          "/fixtures?date=" +
          encodeURIComponent(date)
        );

      const fixtures =
        Array.isArray(data.response)
          ? data.response
          : [];

      const upcoming =
        fixtures.filter(
          fixture => {
            const status =
              fixture.fixture &&
              fixture.fixture.status
                ? fixture.fixture.status.short
                : "";

            return (
              status === "NS" ||
              status === "TBD"
            );
          }
        );

      const selected =
        upcoming.slice(0, limit);

      const matches = [];

      for (
        const fixture of selected
      ) {
        try {
          const result =
            await predictFixture(
              fixture
            );

          matches.push(result);

        } catch (error) {
          console.error(
            "Erreur fixture",
            fixture.fixture &&
            fixture.fixture.id,
            error.message
          );
        }
      }

      res.json({
        success: true,

        date:
          date,

        analyzed:
          selected.length,

        predictions:
          matches.length,

        matches:
          matches
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/*
====================================================
DÉMARRAGE
====================================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Football Prediction Server actif sur le port " +
      PORT
    );
  }
);
