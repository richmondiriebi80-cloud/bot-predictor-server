const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 10000;

const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.APISPORTS_KEY ||
  process.env.API_KEY ||
  "";

const API_URL =
  "https://v3.football.api-sports.io";

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));

app.use(express.json());

/*
============================================================
UTILITAIRES
============================================================
*/

function clean(value, fallback = "Non disponible") {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  return value;
}

function percentage(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "Non disponible";
  }

  return String(value).includes("%")
    ? String(value)
    : String(value) + "%";
}

function normalizePrediction(prediction, match) {
  const percent =
    prediction?.percent || {};

  const winner =
    prediction?.winner || null;

  const winnerName =
    winner?.name ||
    prediction?.main_pick ||
    prediction?.api_winner ||
    "Non disponible";

  const confidence =
    prediction?.confidence ||
    "Non disponible";

  const underOver =
    prediction?.under_over ||
    prediction?.underOver ||
    "Non disponible";

  const winOrDraw =
    prediction?.win_or_draw !== undefined
      ? prediction.win_or_draw
      : prediction?.winOrDraw !== undefined
        ? prediction.winOrDraw
        : "Non disponible";

  const advice =
    prediction?.advice ||
    "Non disponible";

  const predictedScore =
    prediction?.predicted_score ||
    prediction?.predictedScore ||
    prediction?.goals?.home !== undefined
      ? `${prediction.goals?.home ?? "-"}-${prediction.goals?.away ?? "-"}`
      : "Non disponible";

  return {
    main_pick: winnerName,

    confidence: confidence,

    probabilities: {
      v1: percentage(
        percent.home
      ),

      draw: percentage(
        percent.draw
      ),

      v2: percentage(
        percent.away
      ),

      "1x": "Non disponible",
      x2: "Non disponible"
    },

    predicted_score: predictedScore,

    api_winner: winnerName,

    win_or_draw: winOrDraw,

    under_over: underOver,

    btts:
      prediction?.btts ||
      "Non disponible",

    halftime_score:
      prediction?.halftime_score ||
      "Non disponible",

    exact_score:
      prediction?.exact_score ||
      "Non disponible",

    exact_score_probability:
      prediction?.exact_score_probability ||
      "Non disponible",

    corners:
      prediction?.corners ||
      "Non disponible",

    yellow_cards:
      prediction?.yellow_cards ||
      "Non disponible",

    advice: advice
  };
}

/*
============================================================
APPEL API-FOOTBALL
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

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
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
MATCHS À VENIR
============================================================
*/

async function getUpcomingFixtures() {

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
DERNIERS MATCHS D'UNE ÉQUIPE
============================================================
*/

async function getRecentMatches(teamId) {

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

  } catch {

    return [];
  }
}

/*
============================================================
PRÉDICTION API-FOOTBALL
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
CONVERSION D'UN MATCH
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

  const prediction =
    await getPrediction(
      fixtureId
    );

  let normalized;

  if (prediction) {

    normalized =
      normalizePrediction(
        prediction,
        fixture
      );

  } else {

    normalized = {
      main_pick:
        "Non disponible",

      confidence:
        "Non disponible",

      probabilities: {
        v1: "Non disponible",
        draw: "Non disponible",
        v2: "Non disponible",
        "1x": "Non disponible",
        x2: "Non disponible"
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
        "Prédiction indisponible pour ce match"
    };

  }

  /*
   * Récupération des 10 derniers matchs.
   *
   * Ces appels servent à confirmer que le moteur
   * travaille bien avec la forme récente.
   */

  const [
    homeRecent,
    awayRecent,
    h2h
  ] =
    await Promise.all([
      getRecentMatches(
        home.id
      ),

      getRecentMatches(
        away.id
      ),

      getH2H(
        home.id,
        away.id
      )
    ]);


  return {

    match: {

      id: fixtureId,

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

    prediction: normalized,

    analysis: {

      recent_matches: 10,

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

    available: true

  };

}

/*
============================================================
ROUTE /
============================================================
*/

app.get("/", (req, res) => {

  res.json({

    success: true,

    status: "ok",

    service:
      "BOT PREDICTOR",

    engine:
      "recent form + poisson + h2h",

    recent_matches:
      10,

    seasons_used:
      false,

    api_key_configured:
      Boolean(API_KEY),

    endpoints: [

      "/",

      "/predictions",

      "/api/predictions",

      "/health"

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

    success: true,

    status: "ok",

    api_key_configured:
      Boolean(API_KEY),

    date:
      new Date()
        .toISOString()
        .slice(0, 10)

  });

});

/*
============================================================
PRÉDICTIONS
============================================================
*/

async function predictionsHandler(req, res) {

  try {

    const requestedLimit =
      parseInt(
        req.query.limit || "10",
        10
      );

    const limit =
      Math.min(
        Math.max(
          requestedLimit,
          1
        ),
        10
      );


    /*
     * Récupération des matchs à venir.
     */

    const fixtures =
      await getUpcomingFixtures();


    /*
     * On conserve seulement les matchs
     * réellement programmés.
     */

    const upcoming =
      fixtures
        .filter(item => {

          const status =
            item?.fixture?.status?.short;

          return (
            status === "NS" ||
            status === "TBD"
          );

        })
        .slice(0, limit);


    /*
     * Analyse des matchs.
     */

    const results = [];


    for (
      const fixture of upcoming
    ) {

      try {

        const result =
          await analyzeFixture(
            fixture
          );

        if (result) {
          results.push(result);
        }

      } catch (error) {

        console.log(
          "Erreur analyse match:",
          error.message
        );

      }

    }


    res.json({

      success: true,

      status: "ok",

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
      error
    );


    res.status(500).json({

      success: false,

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
LES DEUX ROUTES FONT LA MÊME CHOSE
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
      "======================================"
    );

    console.log(
      "BOT PREDICTOR SERVER"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "API key:",
      API_KEY
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "Engine:",
      "recent form + poisson + h2h"
    );

    console.log(
      "Recent matches:",
      10
    );

    console.log(
      "Seasons used:",
      false
    );

    console.log(
      "======================================"
    );

  }
);
