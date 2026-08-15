const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io";

const cache = new Map();
const CACHE_TIME = 5 * 60 * 1000;

function headers() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

async function apiGet(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY n'est pas configurée");
  }

  const now = Date.now();
  const cached = cache.get(endpoint);

  if (cached && now - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const response = await fetch(API_URL + endpoint, {
    method: "GET",
    headers: headers()
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse API non JSON. HTTP " + response.status
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      ": " +
      JSON.stringify(data)
    );
  }

  if (
    data.errors &&
    typeof data.errors === "object" &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(JSON.stringify(data.errors));
  }

  cache.set(endpoint, {
    time: now,
    data: data
  });

  return data;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  if (!Number.isFinite(value)) {
    return "Non disponible";
  }

  return Math.round(clamp(value, 0, 100)) + "%";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/*
==================================================
POISSON
==================================================
*/

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(lambda, goals) {
  if (lambda <= 0) {
    return goals === 0 ? 1 : 0;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

/*
==================================================
MATRICE DES SCORES
==================================================
*/

function scoreMatrix(homeExpected, awayExpected) {
  const matrix = [];

  for (let home = 0; home <= 8; home++) {
    matrix[home] = [];

    for (let away = 0; away <= 8; away++) {
      matrix[home][away] =
        poisson(homeExpected, home) *
        poisson(awayExpected, away);
    }
  }

  return matrix;
}

function probabilitiesFromMatrix(matrix) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let over15 = 0;
  let over25 = 0;
  let over35 = 0;

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
      if (h + a >= 4) over35 += p;

      if (h > 0 && a > 0) {
        btts += p;
      }
    }
  }

  if (total > 0) {
    homeWin /= total;
    draw /= total;
    awayWin /= total;
    over15 /= total;
    over25 /= total;
    over35 /= total;
    btts /= total;
  }

  return {
    homeWin: homeWin * 100,
    draw: draw * 100,
    awayWin: awayWin * 100,
    over15: over15 * 100,
    over25: over25 * 100,
    over35: over35 * 100,
    btts: btts * 100
  };
}

/*
==================================================
STATISTIQUES ÉQUIPE
==================================================
*/

function extractGoals(fixture, teamId) {
  const goals = fixture.goals || {};

  const homeId =
    fixture.teams &&
    fixture.teams.home
      ? fixture.teams.home.id
      : null;

  const awayId =
    fixture.teams &&
    fixture.teams.away
      ? fixture.teams.away.id
      : null;

  const isHome = homeId === teamId;
  const isAway = awayId === teamId;

  if (!isHome && !isAway) {
    return null;
  }

  const gf = isHome
    ? number(goals.home, 0)
    : number(goals.away, 0);

  const ga = isHome
    ? number(goals.away, 0)
    : number(goals.home, 0);

  return {
    gf: gf,
    ga: ga,
    home: isHome,
    away: isAway
  };
}

async function getRecentMatches(teamId, leagueId = null, season = null) {
  let endpoint =
    "/fixtures?team=" +
    encodeURIComponent(teamId) +
    "&last=10";

  if (leagueId) {
    endpoint +=
      "&league=" +
      encodeURIComponent(leagueId);
  }

  if (season) {
    endpoint +=
      "&season=" +
      encodeURIComponent(season);
  }

  const data = await apiGet(endpoint);

  return Array.isArray(data.response)
    ? data.response
    : [];
}

function calculateTeamStats(matches, teamId) {
  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  let homePlayed = 0;
  let homeGoalsFor = 0;
  let homeGoalsAgainst = 0;

  let awayPlayed = 0;
  let awayGoalsFor = 0;
  let awayGoalsAgainst = 0;

  for (const fixture of matches) {
    const status =
      fixture.fixture &&
      fixture.fixture.status
        ? fixture.fixture.status.short
        : null;

    if (
      status !== "FT" &&
      status !== "AET" &&
      status !== "PEN"
    ) {
      continue;
    }

    const result =
      extractGoals(fixture, teamId);

    if (!result) continue;

    played++;

    goalsFor += result.gf;
    goalsAgainst += result.ga;

    if (result.gf > result.ga) {
      wins++;
    } else if (result.gf === result.ga) {
      draws++;
    } else {
      losses++;
    }

    if (result.home) {
      homePlayed++;
      homeGoalsFor += result.gf;
      homeGoalsAgainst += result.ga;
    }

    if (result.away) {
      awayPlayed++;
      awayGoalsFor += result.gf;
      awayGoalsAgainst += result.ga;
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

    drawRate:
      played > 0
        ? draws / played
        : 0,

    lossRate:
      played > 0
        ? losses / played
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
        ? homeGoalsFor / homePlayed
        : 1.2,

    homeGoalsAgainstAvg:
      homePlayed > 0
        ? homeGoalsAgainst / homePlayed
        : 1,

    awayGoalsForAvg:
      awayPlayed > 0
        ? awayGoalsFor / awayPlayed
        : 1,

    awayGoalsAgainstAvg:
      awayPlayed > 0
        ? awayGoalsAgainst / awayPlayed
        : 1
  };
}

/*
==================================================
H2H
==================================================
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
  } catch {
    return [];
  }
}

function h2hFactor(matches, homeId) {
  if (!matches || matches.length === 0) {
    return {
      home: 0,
      away: 0,
      draw: 0
    };
  }

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let count = 0;

  for (const match of matches) {
    const status =
      match.fixture &&
      match.fixture.status
        ? match.fixture.status.short
        : null;

    if (
      status !== "FT" &&
      status !== "AET" &&
      status !== "PEN"
    ) {
      continue;
    }

    const homeGoals =
      match.goals &&
      match.goals.home !== null
        ? number(match.goals.home)
        : null;

    const awayGoals =
      match.goals &&
      match.goals.away !== null
        ? number(match.goals.away)
        : null;

    if (
      homeGoals === null ||
      awayGoals === null
    ) {
      continue;
    }

    const matchHomeId =
      match.teams &&
      match.teams.home
        ? match.teams.home.id
        : null;

    const actualHomeIsRequested =
      matchHomeId === homeId;

    const requestedHomeGoals =
      actualHomeIsRequested
        ? homeGoals
        : awayGoals;

    const requestedAwayGoals =
      actualHomeIsRequested
        ? awayGoals
        : homeGoals;

    count++;

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

  if (count === 0) {
    return {
      home: 0,
      away: 0,
      draw: 0
    };
  }

  return {
    home: homeWins / count,
    away: awayWins / count,
    draw: draws / count
  };
}

/*
==================================================
MOTEUR DE PRÉDICTION
==================================================
*/

function calculateExpectedGoals(
  homeStats,
  awayStats
) {
  /*
   * Attaque domicile + défense extérieure
   */
  const homeAttack =
    homeStats.homeGoalsForAvg;

  const awayDefense =
    awayStats.awayGoalsAgainstAvg;

  /*
   * Attaque extérieure + défense domicile
   */
  const awayAttack =
    awayStats.awayGoalsForAvg;

  const homeDefense =
    homeStats.homeGoalsAgainstAvg;

  let homeExpected =
    (homeAttack + awayDefense) / 2;

  let awayExpected =
    (awayAttack + homeDefense) / 2;

  /*
   * Avantage domicile léger.
   */
  homeExpected *= 1.08;

  /*
   * On évite les valeurs absurdes.
   */
  homeExpected =
    clamp(homeExpected, 0.15, 4.5);

  awayExpected =
    clamp(awayExpected, 0.15, 4.5);

  return {
    home: homeExpected,
    away: awayExpected
  };
}

function applyFormAdjustment(
  probabilities,
  homeStats,
  awayStats,
  h2h
) {
  /*
   * Forme récente.
   */
  const homeForm =
    homeStats.winRate;

  const awayForm =
    awayStats.winRate;

  const formDifference =
    homeForm - awayForm;

  probabilities.homeWin +=
    formDifference * 8;

  probabilities.awayWin -=
    formDifference * 8;

  /*
   * H2H : influence faible volontairement.
   */
  if (h2h) {
    probabilities.homeWin +=
      h2h.home * 3;

    probabilities.awayWin +=
      h2h.away * 3;

    probabilities.draw +=
      h2h.draw * 2;
  }

  probabilities.homeWin =
    Math.max(0, probabilities.homeWin);

  probabilities.draw =
    Math.max(0, probabilities.draw);

  probabilities.awayWin =
    Math.max(0, probabilities.awayWin);

  /*
   * Renormalisation.
   */
  const total =
    probabilities.homeWin +
    probabilities.draw +
    probabilities.awayWin;

  if (total > 0) {
    probabilities.homeWin =
      probabilities.homeWin /
      total *
      100;

    probabilities.draw =
      probabilities.draw /
      total *
      100;

    probabilities.awayWin =
      probabilities.awayWin /
      total *
      100;
  }

  return probabilities;
}

function confidenceFromProbabilities(p) {
  const sorted = [
    p.homeWin,
    p.draw,
    p.awayWin
  ].sort((a, b) => b - a);

  const best = sorted[0];
  const second = sorted[1];

  /*
   * Confiance basée sur :
   * - probabilité du meilleur résultat
   * - écart avec le deuxième
   *
   * Cela évite d'afficher artificiellement 90-100%.
   */
  const margin =
    Math.max(0, best - second);

  const confidence =
    best * 0.7 +
    margin * 0.6;

  return clamp(
    confidence,
    30,
    92
  );
}

function predictedWinner(
  p,
  homeName,
  awayName
) {
  if (
    p.homeWin >= p.draw &&
    p.homeWin >= p.awayWin
  ) {
    return homeName;
  }

  if (
    p.awayWin >= p.homeWin &&
    p.awayWin >= p.draw
  ) {
    return awayName;
  }

  return "Match nul";
}

function bestScore(matrix) {
  let best = -1;
  let score = null;

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      if (matrix[h][a] > best) {
        best = matrix[h][a];
        score = h + "-" + a;
      }
    }
  }

  return score || "Non disponible";
}

function underOverLabel(p) {
  if (p.over25 >= 55) {
    return "Over 2.5";
  }

  if (p.over15 >= 65) {
    return "Over 1.5";
  }

  return "Under 2.5";
}

function bttsLabel(value) {
  if (value >= 55) {
    return "Oui";
  }

  return "Non";
}

function advice(
  winner,
  homeName,
  awayName,
  p
) {
  const oneX =
    p.homeWin + p.draw;

  const xTwo =
    p.draw + p.awayWin;

  const over =
    underOverLabel(p);

  if (
    winner === homeName &&
    oneX >= 65
  ) {
    return (
      "Double chance : " +
      homeName +
      " ou nul et " +
      over
    );
  }

  if (
    winner === awayName &&
    xTwo >= 65
  ) {
    return (
      "Double chance : " +
      awayName +
      " ou nul et " +
      over
    );
  }

  if (
    winner !== "Match nul" &&
    Math.max(
      p.homeWin,
      p.awayWin
    ) >= 55
  ) {
    return (
      "Victoire " +
      winner +
      " et " +
      over
    );
  }

  return over;
}

/*
==================================================
PRÉDICTION COMPLÈTE
==================================================
*/

async function predictFixture(
  fixture
) {
  const fixtureInfo =
    fixture.fixture || {};

  const teams =
    fixture.teams || {};

  const league =
    fixture.league || {};

  const home =
    teams.home || {};

  const away =
    teams.away || {};

  const homeId =
    home.id;

  const awayId =
    away.id;

  if (!homeId || !awayId) {
    throw new Error(
      "Impossible de déterminer les équipes."
    );
  }

  const season =
    league.season || null;

  const leagueId =
    league.id || null;

  const [
    homeRecent,
    awayRecent,
    h2h
  ] = await Promise.all([
    getRecentMatches(
      homeId,
      leagueId,
      season
    ),

    getRecentMatches(
      awayId,
      leagueId,
      season
    ),

    getH2H(
      homeId,
      awayId
    )
  ]);

  const homeStats =
    calculateTeamStats(
      homeRecent,
      homeId
    );

  const awayStats =
    calculateTeamStats(
      awayRecent,
      awayId
    );

  const expected =
    calculateExpectedGoals(
      homeStats,
      awayStats
    );

  const matrix =
    scoreMatrix(
      expected.home,
      expected.away
    );

  let p =
    probabilitiesFromMatrix(
      matrix
    );

  const h2hData =
    h2hFactor(
      h2h,
      homeId
    );

  p =
    applyFormAdjustment(
      p,
      homeStats,
      awayStats,
      h2hData
    );

  const winner =
    predictedWinner(
      p,
      home.name || "Domicile",
      away.name || "Extérieur"
    );

  const confidence =
    confidenceFromProbabilities(p);

  const score =
    bestScore(matrix);

  const oneX =
    p.homeWin + p.draw;

  const xTwo =
    p.draw + p.awayWin;

  const underOver =
    underOverLabel(p);

  const btts =
    bttsLabel(p.btts);

  return {
    match: {
      id:
        fixtureInfo.id ||
        null,

      date:
        fixtureInfo.date ||
        null,

      league:
        league.name ||
        "Inconnu",

      country:
        league.country ||
        "Inconnu",

      home: {
        id:
          home.id ||
          null,

        name:
          home.name ||
          "Inconnu",

        logo:
          home.logo ||
          null
      },

      away: {
        id:
          away.id ||
          null,

        name:
          away.name ||
          "Inconnu",

        logo:
          away.logo ||
          null
      }
    },

    prediction: {
      main_pick:
        winner,

      confidence:
        pct(confidence),

      probabilities: {
        v1:
          pct(p.homeWin),

        draw:
          pct(p.draw),

        v2:
          pct(p.awayWin),

        "1x":
          pct(oneX),

        "x2":
          pct(xTwo)
      },

      predicted_score:
        score,

      under_over:
        underOver,

      btts:
        btts,

      api_winner:
        "Calcul statistique",

      win_or_draw:
        winner === home.name
          ? oneX >= 50
            ? "Oui"
            : "Non"
          : winner === away.name
            ? xTwo >= 50
              ? "Oui"
              : "Non"
            : "Oui",

      halftime_score:
        "Non disponible",

      exact_score:
        score,

      exact_score_probability:
        "Calculé par modèle",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        advice(
          winner,
          home.name,
          away.name,
          p
        )
    },

    model: {
      home_expected_goals:
        Number(
          expected.home.toFixed(2)
        ),

      away_expected_goals:
        Number(
          expected.away.toFixed(2)
        ),

      home_recent_matches:
        homeStats.played,

      home_recent_wins:
        homeStats.wins,

      home_goals_for_avg:
        Number(
          homeStats.goalsForAvg.toFixed(2)
        ),

      home_goals_against_avg:
        Number(
          homeStats.goalsAgainstAvg.toFixed(2)
        ),

      away_recent_matches:
        awayStats.played,

      away_recent_wins:
        awayStats.wins,

      away_goals_for_avg:
        Number(
          awayStats.goalsForAvg.toFixed(2)
        ),

      away_goals_against_avg:
        Number(
          awayStats.goalsAgainstAvg.toFixed(2)
        ),

      h2h_matches:
        h2h.length
    },

    available: true
  };
}

/*
==================================================
ROUTES
==================================================
*/

app.get("/", (req, res) => {
  res.json({
    success: true,
    service:
      "Football Prediction Server",
    status: "online",
    engine:
      "Statistical Prediction Engine",
    date: today()
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    api_key_configured:
      Boolean(API_KEY),
    prediction_engine:
      "statistics + poisson + form + h2h",
    date: today()
  });
});

/*
==================================================
PRÉDICTION D'UN MATCH
==================================================
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

      const fixture =
        data.response[0];

      const result =
        await predictFixture(
          fixture
        );

      res.json({
        success: true,
        fixture:
          fixtureId,
        data:
          result
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
==================================================
PRÉDICTIONS DU JOUR
==================================================
*/

app.get(
  "/api/predictions",
  async (req, res) => {
    try {
      const date =
        req.query.date ||
        today();

      let limit =
        Number(
          req.query.limit || 5
        );

      if (!Number.isFinite(limit)) {
        limit = 5;
      }

      limit =
        Math.max(
          1,
          Math.min(
            20,
            Math.floor(limit)
          )
        );

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
                : null;

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

          matches.push(
            result
          );

        } catch (error) {
          console.error(
            "Erreur prédiction fixture",
            fixture.fixture &&
            fixture.fixture.id,
            error
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
==================================================
START
==================================================
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
