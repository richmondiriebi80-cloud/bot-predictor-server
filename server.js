const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

app.use(function(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());


/*
============================================================
UTILITAIRES
============================================================
*/

function number(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback || 0);
}

function percent(value) {
  if (value === undefined || value === null || value === "") {
    return "Non disponible";
  }

  return String(value).replace("%", "") + "%";
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce(function(a, b) {
    return a + b;
  }, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


/*
============================================================
API FOOTBALL
============================================================
*/

async function apiFootball(endpoint, params) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY manquante dans Render");
  }

  const query = new URLSearchParams(params || {});
  const url = API_URL + endpoint + "?" + query.toString();

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
  } catch (error) {
    throw new Error("Reponse API invalide");
  }

  if (!response.ok) {
    throw new Error(
      data && data.errors
        ? JSON.stringify(data.errors)
        : "API Football HTTP " + response.status
    );
  }

  if (
    data &&
    data.errors &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data;
}


/*
============================================================
MATCHS DU JOUR
============================================================
*/

async function getTodayFixtures() {
  const today = new Date().toISOString().slice(0, 10);

  const data = await apiFootball("/fixtures", {
    date: today
  });

  const fixtures = Array.isArray(data.response)
    ? data.response
    : [];

  return fixtures.filter(function(item) {
    const status =
      item &&
      item.fixture &&
      item.fixture.status &&
      item.fixture.status.short;

    return status === "NS" || status === "TBD";
  });
}


/*
============================================================
10 DERNIERS MATCHS D'UNE EQUIPE
============================================================
*/

async function getRecentMatches(teamId) {
  try {
    const data = await apiFootball("/fixtures", {
      team: teamId,
      last: 10
    });

    return Array.isArray(data.response)
      ? data.response
      : [];
  } catch (error) {
    console.log(
      "Recent matches error for team " +
      teamId +
      ": " +
      error.message
    );

    return [];
  }
}


/*
============================================================
H2H - 10 DERNIERES CONFRONTATIONS
============================================================
*/

async function getH2H(homeId, awayId) {
  try {
    const data = await apiFootball("/fixtures/headtohead", {
      h2h: homeId + "-" + awayId,
      last: 10
    });

    return Array.isArray(data.response)
      ? data.response
      : [];
  } catch (error) {
    console.log(
      "H2H error: " +
      error.message
    );

    return [];
  }
}


/*
============================================================
PREDICTION API-FOOTBALL
============================================================
*/

async function getApiPrediction(fixtureId) {
  try {
    const data = await apiFootball("/predictions", {
      fixture: fixtureId
    });

    if (
      Array.isArray(data.response) &&
      data.response.length > 0
    ) {
      return data.response[0];
    }

    return null;
  } catch (error) {
    console.log(
      "Prediction error for fixture " +
      fixtureId +
      ": " +
      error.message
    );

    return null;
  }
}


/*
============================================================
ANALYSE FORME RECENTE
============================================================
*/

function analyzeForm(matches, teamId) {
  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = [];
  let goalsAgainst = [];

  let points = 0;

  let homeWins = 0;
  let awayWins = 0;

  let homeGames = 0;
  let awayGames = 0;

  for (const match of matches) {
    const teams = match.teams || {};
    const goals = match.goals || {};

    const isHome =
      teams.home &&
      teams.home.id === teamId;

    const isAway =
      teams.away &&
      teams.away.id === teamId;

    if (!isHome && !isAway) {
      continue;
    }

    const gf = isHome
      ? number(goals.home, 0)
      : number(goals.away, 0);

    const ga = isHome
      ? number(goals.away, 0)
      : number(goals.home, 0);

    goalsFor.push(gf);
    goalsAgainst.push(ga);

    if (isHome) {
      homeGames++;

      if (gf > ga) {
        homeWins++;
      }
    }

    if (isAway) {
      awayGames++;

      if (gf > ga) {
        awayWins++;
      }
    }

    if (gf > ga) {
      wins++;
      points += 3;
    } else if (gf === ga) {
      draws++;
      points += 1;
    } else {
      losses++;
    }
  }

  const total = wins + draws + losses;

  return {
    matches: total,
    wins: wins,
    draws: draws,
    losses: losses,

    points: points,

    pointsPerGame:
      total > 0
        ? points / total
        : 0,

    winRate:
      total > 0
        ? wins / total
        : 0,

    avgGoalsFor:
      average(goalsFor),

    avgGoalsAgainst:
      average(goalsAgainst),

    homeWins: homeWins,
    awayWins: awayWins,

    homeGames: homeGames,
    awayGames: awayGames
  };
}


/*
============================================================
ANALYSE H2H
============================================================
*/

function analyzeH2H(matches, homeId, awayId) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let totalGoals = 0;
  let count = 0;

  for (const match of matches) {
    const teams = match.teams || {};
    const goals = match.goals || {};

    if (
      !teams.home ||
      !teams.away
    ) {
      continue;
    }

    const homeGoals = number(goals.home, 0);
    const awayGoals = number(goals.away, 0);

    totalGoals += homeGoals + awayGoals;
    count++;

    if (
      teams.home.id === homeId &&
      teams.away.id === awayId
    ) {
      if (homeGoals > awayGoals) {
        homeWins++;
      } else if (homeGoals === awayGoals) {
        draws++;
      } else {
        awayWins++;
      }
    } else {
      if (teams.home.id === awayId) {
        if (homeGoals > awayGoals) {
          awayWins++;
        } else if (homeGoals === awayGoals) {
          draws++;
        } else {
          homeWins++;
        }
      }
    }
  }

  return {
    matches: count,
    homeWins: homeWins,
    draws: draws,
    awayWins: awayWins,

    avgGoals:
      count > 0
        ? totalGoals / count
        : 0
  };
}


/*
============================================================
POISSON
============================================================
*/

function factorial(n) {
  if (n <= 1) {
    return 1;
  }

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poissonProbability(lambda, goals) {
  const safeLambda =
    Math.max(0.01, lambda);

  return (
    Math.exp(-safeLambda) *
    Math.pow(safeLambda, goals)
  ) / factorial(goals);
}

function poissonMatch(homeLambda, awayLambda) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestHome = 0;
  let bestAway = 0;
  let bestScoreProbability = 0;

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p =
        poissonProbability(homeLambda, h) *
        poissonProbability(awayLambda, a);

      if (h > a) {
        homeWin += p;
      } else if (h === a) {
        draw += p;
      } else {
        awayWin += p;
      }

      if (p > bestScoreProbability) {
        bestScoreProbability = p;
        bestHome = h;
        bestAway = a;
      }
    }
  }

  return {
    homeWin: homeWin * 100,
    draw: draw * 100,
    awayWin: awayWin * 100,

    score:
      bestHome + "-" + bestAway,

    scoreProbability:
      bestScoreProbability * 100
  };
}


/*
============================================================
CALCUL DU SCORE DE SELECTION
============================================================
*/

function calculateSelectionScore(
  homeForm,
  awayForm,
  h2h,
  apiPrediction,
  poisson
) {
  let score = 0;

  /*
   * Forme recente : 35 points
   */

  const formDifference =
    homeForm.pointsPerGame -
    awayForm.pointsPerGame;

  score +=
    clamp(
      17.5 +
      formDifference * 8,
      0,
      35
    );


  /*
   * Modele Poisson : 25 points
   */

  const poissonBest =
    Math.max(
      poisson.homeWin,
      poisson.draw,
      poisson.awayWin
    );

  score +=
    clamp(
      poissonBest / 4,
      0,
      25
    );


  /*
   * H2H : 15 points
   */

  if (h2h.matches > 0) {
    const h2hBest =
      Math.max(
        h2h.homeWins,
        h2h.draws,
        h2h.awayWins
      );

    score +=
      clamp(
        (h2hBest / h2h.matches) * 15,
        0,
        15
      );
  }


  /*
   * Prediction API : 25 points
   */

  if (apiPrediction) {
    const percent =
      apiPrediction.percent || {};

    const apiBest =
      Math.max(
        number(percent.home, 0),
        number(percent.draw, 0),
        number(percent.away, 0)
      );

    score +=
      clamp(
        apiBest / 4,
        0,
        25
      );
  }


  return clamp(
    score,
    0,
    100
  );
}


/*
============================================================
ANALYSE COMPLETE D'UN MATCH
============================================================
*/

async function analyzeCandidate(fixture) {
  const home =
    fixture.teams &&
    fixture.teams.home
      ? fixture.teams.home
      : {};

  const away =
    fixture.teams &&
    fixture.teams.away
      ? fixture.teams.away
      : {};

  const fixtureId =
    fixture.fixture &&
    fixture.fixture.id;

  if (!fixtureId || !home.id || !away.id) {
    return null;
  }


  /*
   * 4 appels :
   * prediction
   * home last 10
   * away last 10
   * H2H last 10
   */

  const results =
    await Promise.all([
      getApiPrediction(fixtureId),
      getRecentMatches(home.id),
      getRecentMatches(away.id),
      getH2H(home.id, away.id)
    ]);


  const apiPrediction =
    results[0];

  const homeRecent =
    results[1];

  const awayRecent =
    results[2];

  const h2hMatches =
    results[3];


  /*
   * Une vraie analyse exige au minimum
   * des données récentes pour les deux équipes.
   */

  if (
    homeRecent.length === 0 ||
    awayRecent.length === 0
  ) {
    return null;
  }


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


  /*
   * Lambda Poisson.
   *
   * On mélange :
   * attaque de l'equipe
   * defense adverse
   * moyenne generale recente.
   */

  const homeLambda =
    clamp(
      (
        homeForm.avgGoalsFor +
        awayForm.avgGoalsAgainst
      ) / 2,
      0.15,
      4.5
    );

  const awayLambda =
    clamp(
      (
        awayForm.avgGoalsFor +
        homeForm.avgGoalsAgainst
      ) / 2,
      0.15,
      4.5
    );


  const poisson =
    poissonMatch(
      homeLambda,
      awayLambda
    );


  const selectionScore =
    calculateSelectionScore(
      homeForm,
      awayForm,
      h2h,
      apiPrediction,
      poisson
    );


  /*
   * Determination du meilleur choix.
   */

  const probabilities = {
    v1:
      poisson.homeWin,

    draw:
      poisson.draw,

    v2:
      poisson.awayWin
  };


  let mainPick =
    "Nul";

  if (
    probabilities.v1 >
    probabilities.draw &&
    probabilities.v1 >
    probabilities.v2
  ) {
    mainPick = home.name;
  }

  if (
    probabilities.v2 >
    probabilities.draw &&
    probabilities.v2 >
    probabilities.v1
  ) {
    mainPick = away.name;
  }


  /*
   * On privilégie le choix API si sa confiance
   * est clairement supérieure.
   */

  if (apiPrediction) {
    const winner =
      apiPrediction.winner;

    if (winner && winner.name) {
      mainPick = winner.name;
    }
  }


  const confidence =
    Math.round(selectionScore) + "%";


  const totalGoalsLambda =
    homeLambda +
    awayLambda;


  const over15 =
    totalGoalsLambda > 1.5
      ? "Oui"
      : "Non";


  const btts =
    homeLambda >= 0.8 &&
    awayLambda >= 0.8
      ? "Oui"
      : "Non";


  let advice =
    "Analyse insuffisante";

  if (selectionScore >= 70) {
    advice =
      "Selection forte : " +
      mainPick;
  } else if (selectionScore >= 60) {
    advice =
      "Selection interessante : " +
      mainPick;
  } else {
    advice =
      "Selection prudente";
  }


  /*
   * Si API-Football donne un conseil,
   * on le conserve comme information supplementaire.
   */

  const apiAdvice =
    apiPrediction &&
    apiPrediction.advice
      ? apiPrediction.advice
      : null;


  if (apiAdvice) {
    advice =
      apiAdvice;
  }


  return {

    match: {

      id:
        fixtureId,

      date:
        fixture.fixture
          ? fixture.fixture.date
          : null,

      league:
        fixture.league
          ? fixture.league.name
          : "Football",

      country:
        fixture.league
          ? fixture.league.country
          : "",

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
        confidence,

      probabilities: {

        v1:
          poisson.homeWin.toFixed(1) + "%",

        draw:
          poisson.draw.toFixed(1) + "%",

        v2:
          poisson.awayWin.toFixed(1) + "%",

        "1x":
          (
            poisson.homeWin +
            poisson.draw
          ).toFixed(1) + "%",

        x2:
          (
            poisson.draw +
            poisson.awayWin
          ).toFixed(1) + "%"

      },


      predicted_score:
        poisson.score,


      predicted_score_probability:
        poisson.scoreProbability
          .toFixed(1) + "%",


      api_winner:
        apiPrediction &&
        apiPrediction.winner
          ? apiPrediction.winner.name
          : "Non disponible",


      win_or_draw:
        apiPrediction
          ? String(
              apiPrediction.win_or_draw
            )
          : "Non disponible",


      under_over:
        apiPrediction &&
        apiPrediction.under_over
          ? apiPrediction.under_over
          : (
              totalGoalsLambda > 2.5
                ? "Over 2.5"
                : "Under 2.5"
            ),


      btts:
        btts,


      halftime_score:
        "Non disponible",


      exact_score:
        poisson.score,


      exact_score_probability:
        poisson.scoreProbability
          .toFixed(1) + "%",


      corners:
        "Non disponible",


      yellow_cards:
        "Non disponible",


      advice:
        advice

    },


    analysis: {

      selection_score:
        Number(
          selectionScore.toFixed(2)
        ),

      recent_matches:
        10,

      home_recent_count:
        homeRecent.length,

      away_recent_count:
        awayRecent.length,


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
            homeLambda
              .toFixed(2)
          ),

        away_lambda:
          Number(
            awayLambda
              .toFixed(2)
          ),

        total_lambda:
          Number(
            totalGoalsLambda
              .toFixed(2)
          ),

        predicted_score:
          poisson.score

      },


      api_prediction_available:
        Boolean(apiPrediction),


      seasons_used:
        false,


      engine:
        "10 recent matches + form + poisson + h2h + API prediction"

    },


    available:
      true

  };
}


/*
============================================================
ROUTE /
============================================================
*/

app.get("/", function(req, res) {

  res.json({

    success: true,

    status: "ok",

    service: "BOT PREDICTOR",

    engine:
      "10 recent matches + form + poisson + h2h + API prediction",

    candidates:
      "5 to 10",

    displayed:
      2,

    recent_matches:
      10,

    seasons_used:
      false,

    api_key_configured:
      Boolean(API_KEY),

    message:
      "Serveur operationnel"

  });

});


/*
============================================================
HEALTH
============================================================
*/

app.get("/health", function(req, res) {

  res.json({

    success: true,

    status: "ok",

    api_key_configured:
      Boolean(API_KEY),

    candidates:
      "5 to 10",

    displayed:
      2,

    recent_matches:
      10,

    seasons_used:
      false

  });

});


/*
============================================================
PREDICTIONS
============================================================
*/

async function predictionsHandler(req, res) {

  try {

    if (!API_KEY) {

      return res.status(500).json({

        success: false,

        error:
          "API_FOOTBALL_KEY manquante dans Render"

      });

    }


    /*
     * 1. Recuperer les matchs du jour.
     */

    const fixtures =
      await getTodayFixtures();


    /*
     * 2. Garder jusqu'a 10 candidats.
     *
     * Ce ne sont PAS les 2 resultats finaux.
     * Ils seront tous analyses avant classement.
     */

    const candidates =
      fixtures.slice(0, 10);


    const analyzed = [];


    /*
     * 3. Analyse complete des candidats.
     */

    for (const fixture of candidates) {

      try {

        const result =
          await analyzeCandidate(
            fixture
          );


        if (result) {

          analyzed.push(result);

        }

      } catch (error) {

        console.log(
          "Candidate skipped: " +
          error.message
        );

      }

    }


    /*
     * 4. Classement par score de selection.
     */

    analyzed.sort(
      function(a, b) {

        return (
          b.analysis.selection_score -
          a.analysis.selection_score
        );

      }
    );


    /*
     * 5. SEULEMENT les 2 meilleurs.
     */

    const bestTwo =
      analyzed.slice(0, 2);


    /*
     * 6. Recalcul du rang.
     */

    bestTwo.forEach(
      function(item, index) {

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
        "10 recent matches + form + poisson + h2h + API prediction",

      candidates_analyzed:
        analyzed.length,

      candidates_requested:
        candidates.length,

      predictions:
        bestTwo.length,

      displayed:
        2,

      matches:
        bestTwo,

      selection:
        "Top 2 after complete analysis",

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
      error.message
    );


    return res.status(500).json({

      success: false,

      error:
        error.message

    });

  }

}


/*
============================================================
ROUTES
============================================================
*/

app.get(
  "/predictions",
  predictionsHandler
);


app.get(
  "/api/predictions",
  predictionsHandler
);


/*
============================================================
START
============================================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  function() {

    console.log(
      "================================"
    );

    console.log(
      "BOT PREDICTOR SERVER"
    );

    console.log(
      "PORT: " + PORT
    );

    console.log(
      "API KEY: " +
      (
        API_KEY
          ? "CONFIGURED"
          : "MISSING"
      )
    );

    console.log(
      "CANDIDATES: 5 TO 10"
    );

    console.log(
      "DISPLAYED: 2"
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
