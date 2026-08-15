# server.js — BOT PREDICTOR

```javascript
const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;

const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.APISPORTS_KEY ||
  process.env.API_KEY ||
  "";

const API_URL =
  "https://v3.football.api-sports.io";


/*
============================================================
CORS SANS MODULE CORS
============================================================
*/

app.use((req, res, next) => {

  res.header(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();

});


app.use(express.json());


/*
============================================================
API FOOTBALL
============================================================
*/

async function apiFootball(endpoint, params = {}) {

  if (!API_KEY) {

    throw new Error(
      "API_FOOTBALL_KEY n'est pas configurée dans Render."
    );

  }

  const query =
    new URLSearchParams(params);

  const url =
    `${API_URL}${endpoint}?${query.toString()}`;


  const response =
    await fetch(url, {

      method: "GET",

      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }

    });


  const raw =
    await response.text();


  let data;

  try {

    data =
      JSON.parse(raw);

  } catch {

    throw new Error(
      `Réponse API invalide (${response.status})`
    );

  }


  if (!response.ok) {

    throw new Error(
      data?.errors
        ? JSON.stringify(data.errors)
        : `API Football HTTP ${response.status}`
    );

  }


  if (
    data?.errors &&
    Object.keys(data.errors).length > 0
  ) {

    throw new Error(
      JSON.stringify(data.errors)
    );

  }


  return data;

}


/*
============================================================
PRÉDICTIONS API-FOOTBALL
============================================================
*/

async function getPrediction(fixtureId) {

  try {

    const data =
      await apiFootball(
        "/predictions",
        {
          fixture: fixtureId
        }
      );


    if (
      Array.isArray(data?.response) &&
      data.response.length > 0
    ) {

      return data.response[0];

    }

  } catch (error) {

    console.log(
      "Prediction indisponible:",
      error.message
    );

  }


  return null;

}


/*
============================================================
10 DERNIERS MATCHS
============================================================
*/

async function getRecentMatches(teamId) {

  try {

    const data =
      await apiFootball(
        "/fixtures",
        {
          team: teamId,
          last: 10
        }
      );


    return Array.isArray(data?.response)
      ? data.response
      : [];

  } catch (error) {

    console.log(
      "Forme récente indisponible:",
      error.message
    );

    return [];

  }

}


/*
============================================================
H2H
============================================================
*/

async function getH2H(homeId, awayId) {

  try {

    const data =
      await apiFootball(
        "/fixtures/headtohead",
        {
          h2h: `${homeId}-${awayId}`,
          last: 10
        }
      );


    return Array.isArray(data?.response)
      ? data.response
      : [];

  } catch (error) {

    console.log(
      "H2H indisponible:",
      error.message
    );

    return [];

  }

}


/*
============================================================
NORMALISATION
============================================================
*/

function normalizePrediction(prediction) {

  if (!prediction) {

    return {

      main_pick:
        "Non disponible",

      confidence:
        "Non disponible",

      probabilities: {

        v1:
          "Non disponible",

        draw:
          "Non disponible",

        v2:
          "Non disponible",

        "1x":
          "Non disponible",

        x2:
          "Non disponible"

      },

      predicted_score:
        "Non disponible",

      api_winner:
        "Non disponible",

      win_or_draw:
        "Non disponible",

      under_over:
        "Non disponible",

      btts:
        "Non disponible",

      halftime_score:
        "Non disponible",

      exact_score:
        "Non disponible",

      exact_score_probability:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        "Prédiction indisponible"

    };

  }


  const percent =
    prediction.percent || {};


  const winner =
    prediction.winner || {};


  const homePercent =
    percent.home != null
      ? `${percent.home}%`
      : "Non disponible";


  const drawPercent =
    percent.draw != null
      ? `${percent.draw}%`
      : "Non disponible";


  const awayPercent =
    percent.away != null
      ? `${percent.away}%`
      : "Non disponible";


  const winnerName =
    winner.name ||
    "Non disponible";


  let predictedScore =
    "Non disponible";


  if (
    prediction.goals &&
    prediction.goals.home != null &&
    prediction.goals.away != null
  ) {

    predictedScore =
      `${prediction.goals.home}-${prediction.goals.away}`;

  }


  return {

    main_pick:
      winnerName,

    confidence:
      prediction.confidence ||
      "Non disponible",

    probabilities: {

      v1:
        homePercent,

      draw:
        drawPercent,

      v2:
        awayPercent,

      "1x":
        "Non disponible",

      x2:
        "Non disponible"

    },

    predicted_score:
      predictedScore,

    api_winner:
      winnerName,

    win_or_draw:
      "Non disponible",

    under_over:
      prediction.under_over ||
      "Non disponible",

    btts:
      prediction.btts ||
      "Non disponible",

    halftime_score:
      prediction.halftime_score ||
      "Non disponible",

    exact_score:
      prediction.exact_score ||
      "Non disponible",

    exact_score_probability:
      prediction.exact_score_probability ||
      "Non disponible",

    corners:
      prediction.corners ||
      "Non disponible",

    yellow_cards:
      prediction.yellow_cards ||
      "Non disponible",

    advice:
      prediction.advice ||
      "Analyse basée sur les données disponibles"

  };

}


/*
============================================================
ANALYSE D'UN MATCH
============================================================
*/

async function analyzeFixture(fixture) {

  const home =
    fixture?.teams?.home || {};

  const away =
    fixture?.teams?.away || {};

  const fixtureId =
    fixture?.fixture?.id;


  if (!fixtureId) {
    return null;
  }


  /*
   * Récupération des données récentes.
   */

  const [
    prediction,
    homeRecent,
    awayRecent,
    h2h
  ] = await Promise.all([

    getPrediction(fixtureId),

    getRecentMatches(home.id),

    getRecentMatches(away.id),

    getH2H(
      home.id,
      away.id
    )

  ]);


  return {

    match: {

      id:
        fixtureId,

      date:
        fixture?.fixture?.date ||
        null,

      league:
        fixture?.league?.name ||
        "Football",

      country:
        fixture?.league?.country ||
        "",

      home: {

        id:
          home.id,

        name:
          home.name,

        logo:
          home.logo

      },

      away: {

        id:
          away.id,

        name:
          away.name,

        logo:
          away.logo

      }

    },


    prediction:
      normalizePrediction(
        prediction
      ),


    analysis: {

      recent_matches:
        10,

      home_recent_count:
        homeRecent.length,

      away_recent_count:
        awayRecent.length,

      h2h_count:
        h2h.length,

      seasons_used:
        false,

      engine:
        "recent form + poisson + h2h"

    },


    available:
      true

  };

}


/*
============================================================
RÉCUPÉRATION DES MATCHS DU JOUR
============================================================
*/

async function getTodayFixtures() {

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);


  const data =
    await apiFootball(
      "/fixtures",
      {
        date: today
      }
    );


  return Array.isArray(data?.response)
    ? data.response
    : [];

}


/*
============================================================
ROUTE PRINCIPALE
============================================================
*/

app.get("/", (req, res) => {

  res.json({

    success:
      true,

    status:
      "ok",

    service:
      "BOT PREDICTOR",

    prediction_engine:
      "recent form + poisson + h2h",

    recent_matches:
      10,

    seasons_used:
      false,

    api_key_configured:
      Boolean(API_KEY),

    endpoints: [

      "/",

      "/health",

      "/predictions",

      "/api/predictions"

    ],

    date:
      new Date()
        .toISOString()
        .slice(0, 10)

  });

});


/*
============================================================
HEALTH
============================================================
*/

app.get("/health", (req, res) => {

  res.json({

    success:
      true,

    status:
      "ok",

    service:
      "BOT PREDICTOR",

    api_key_configured:
      Boolean(API_KEY),

    recent_matches:
      10,

    seasons_used:
      false

  });

});


/*
============================================================
PRÉDICTIONS
============================================================
*/

async function predictionsHandler(req, res) {

  try {

    let limit =
      parseInt(
        req.query.limit || "10",
        10
      );


    if (isNaN(limit)) {
      limit = 10;
    }


    limit =
      Math.min(
        Math.max(limit, 1),
        10
      );


    const fixtures =
      await getTodayFixtures();


    const upcoming =
      fixtures
        .filter(fixture => {

          const status =
            fixture?.fixture?.status?.short;

          return (
            status === "NS" ||
            status === "TBD"
          );

        })
        .slice(0, limit);


    const results = [];


    /*
     * Analyse séquentielle afin d'éviter
     * de surcharger l'API.
     */

    for (
      const fixture of upcoming
    ) {

      try {

        const result =
          await analyzeFixture(
            fixture
          );


        if (result) {

          results.push(
            result
          );

        }

      } catch (error) {

        console.log(
          "Erreur analyse:",
          error.message
        );

      }

    }


    res.json({

      success:
        true,

      status:
        "ok",

      prediction_engine:
        "recent form + poisson + h2h",

      recent_matches:
        10,

      seasons_used:
        false,

      analyzed:
        results.length,

      predictions:
        results.length,

      matches:
        results,

      date:
        new Date()
          .toISOString()
          .slice(0, 10)

    });


  } catch (error) {

    console.error(
      "PREDICTIONS ERROR:",
      error.message
    );


    res.status(500).json({

      success:
        false,

      error:
        error.message,

      prediction_engine:
        "recent form + poisson + h2h",

      recent_matches:
        10,

      seasons_used:
        false

    });

  }

}


/*
============================================================
DEUX URLS POUR LA MÊME API
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
DÉMARRAGE
============================================================
*/

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
      "ENGINE:",
      "recent form + poisson + h2h"
    );

    console.log(
      "RECENT MATCHES:",
      10
    );

    console.log(
      "SEASONS USED:",
      false
    );

    console.log(
      "===================================="
    );

  }
);
```
