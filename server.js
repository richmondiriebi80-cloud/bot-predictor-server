const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

/* =========================
   CORS
========================= */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
  next();
});


/* =========================
   API FOOTBALL
========================= */

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


async function footballApi(path) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante sur Render."
    );
  }

  const response =
    await fetch(API + path, {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    });

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status
    );
  }

  const data =
    await response.json();

  if (
    data.errors &&
    Object.keys(data.errors).length > 0
  ) {
    throw new Error(
      Object.values(data.errors).join(" ")
    );
  }

  return data;
}


/* =========================
   DATE ABIDJAN
========================= */

function dateAbidjan() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Africa/Abidjan",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(new Date());

  const x = {};

  parts.forEach(p => {
    x[p.type] = p.value;
  });

  return (
    x.year +
    "-" +
    x.month +
    "-" +
    x.day
  );
}


/* =========================
   HEURE ABIDJAN
========================= */

function heureAbidjan(date) {

  try {

    return new Intl.DateTimeFormat(
      "fr-FR",
      {
        timeZone: "Africa/Abidjan",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(new Date(date));

  } catch (e) {

    return "";

  }
}


/* =========================
   POURCENTAGE
========================= */

function pct(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  return (
    parseFloat(
      String(value).replace("%", "")
    ) || 0
  );
}


/* =========================
   RACINE
========================= */

app.get("/", (req, res) => {

  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif",
    timezone: "Africa/Abidjan"
  });

});


/* =========================
   MATCHS DU JOUR
========================= */

app.get("/matches", async (req, res) => {

  try {

    const date =
      req.query.date ||
      dateAbidjan();

    const data =
      await footballApi(
        "/fixtures?date=" +
        encodeURIComponent(date) +
        "&timezone=Africa/Abidjan"
      );

    res.json({
      success: true,
      date: date,
      matches:
        data.response || []
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      error: error.message
    });

  }

});


/* =========================
   VERIFIER MATCH A VENIR
========================= */

function matchAVenir(match) {

  if (!match?.fixture) {
    return false;
  }

  const status =
    match.fixture.status?.short;

  const termines = [
    "FT",
    "AET",
    "PEN",
    "CANC",
    "ABD",
    "AWD",
    "WO"
  ];

  const live = [
    "1H",
    "HT",
    "2H",
    "ET",
    "BT",
    "P",
    "LIVE"
  ];

  if (termines.includes(status)) {
    return false;
  }

  if (live.includes(status)) {
    return false;
  }

  return (
    new Date(match.fixture.date) >
    new Date()
  );
}


/* =========================
   MEILLEURE PREDICTION
========================= */

function meilleurePrediction(prediction) {

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const home =
    pct(percent.home);

  const draw =
    pct(percent.draw);

  const away =
    pct(percent.away);

  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {
    return {
      type: "-",
      text: "Données insuffisantes",
      confidence: 0
    };
  }

  if (
    home >= draw &&
    home >= away
  ) {

    return {
      type: "1",
      text:
        "Victoire " +
        (
          prediction.teams?.home?.name ||
          "domicile"
        ),
      confidence: home
    };

  }

  if (
    away >= home &&
    away >= draw
  ) {

    return {
      type: "2",
      text:
        "Victoire " +
        (
          prediction.teams?.away?.name ||
          "extérieur"
        ),
      confidence: away
    };

  }

  return {
    type: "N",
    text: "Match nul",
    confidence: draw
  };
}


/* =========================
   SCORE PREVISIONNEL
========================= */

function scorePrediction(prediction) {

  const goals =
    prediction?.predictions?.goals;

  if (
    goals &&
    goals.home !== null &&
    goals.home !== undefined &&
    goals.away !== null &&
    goals.away !== undefined
  ) {

    return (
      goals.home +
      "-" +
      goals.away
    );

  }

  return "Non disponible";
}


/* =========================
   PREDICTION D'UN MATCH
========================= */

app.get(
  "/prediction/:fixture",
  async (req, res) => {

    try {

      const fixture =
        req.params.fixture;

      const data =
        await footballApi(
          "/predictions?fixture=" +
          encodeURIComponent(fixture)
        );

      res.json({
        success: true,
        prediction:
          data.response?.[0] || null
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error: error.message
      });

    }

  }
);


/* =========================
   2 MEILLEURS MATCHS
========================= */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();

      const fixtures =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );

      let matches =
        fixtures.response || [];

      matches =
        matches.filter(matchAVenir);

      matches.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );

      /*
       * Maximum 6 candidats afin
       * d'éviter de consommer trop
       * rapidement le quota.
       */

      const candidats =
        matches.slice(0, 6);

      const analyses = [];


      for (
        const match of candidats
      ) {

        try {

          const data =
            await footballApi(
              "/predictions?fixture=" +
              match.fixture.id
            );

          const prediction =
            data.response?.[0];

          if (!prediction) {
            continue;
          }

          const selection =
            meilleurePrediction(
              prediction
            );

          if (
            selection.confidence <= 0
          ) {
            continue;
          }

          analyses.push({

            match: match,

            prediction: prediction,

            selection: selection

          });

        } catch (error) {

          console.log(
            "Prediction indisponible:",
            match.fixture.id
          );

        }

      }


      analyses.sort(
        (a, b) =>
          b.selection.confidence -
          a.selection.confidence
      );


      const selected =
        analyses.slice(0, 2);


      const result =
        selected.map(item => {

          const m =
            item.match;

          const p =
            item.prediction;

          const s =
            item.selection;

          const pred =
            p.predictions || {};

          return {

            match: {

              id:
                m.fixture.id,

              date:
                m.fixture.date,

              time:
                heureAbidjan(
                  m.fixture.date
                ),

              league:
                m.league?.name ||
                "Compétition",

              country:
                m.league?.country ||
                "",

              home: {

                name:
                  m.teams?.home?.name ||
                  "",

                logo:
                  m.teams?.home?.logo ||
                  ""

              },

              away: {

                name:
                  m.teams?.away?.name ||
                  "",

                logo:
                  m.teams?.away?.logo ||
                  ""

              }

            },

            prediction: {

              main_pick:
                s.text,

              type:
                s.type,

              home:
                pct(
                  pred.percent?.home
                ).toFixed(0) + "%",

              draw:
                pct(
                  pred.percent?.draw
                ).toFixed(0) + "%",

              away:
                pct(
                  pred.percent?.away
                ).toFixed(0) + "%",

              goals:
                scorePrediction(
                  p
                ),

              under_over:
                pred.under_over ||
                "Non disponible",

              advice:
                pred.advice ||
                "Non disponible",

              half_time_score:
                "Non disponible",

              full_time_score:
                scorePrediction(p)

            },

            consensus: {

              confidence:
                s.confidence.toFixed(0) +
                "%",

              score:
                s.confidence.toFixed(0) +
                "%"

            },

            sources: {

              api_football: true,

              sportmonks: false,

              football_data: false

            },

            analysis:
              "Analyse basée sur les données et la prédiction API-Football. " +
              s.text +
              " avec une probabilité de " +
              s.confidence.toFixed(0) +
              "%."

          };

        });


      res.json({

        success: true,

        date: date,

        analyzed_candidates:
          candidats.length,

        selected:
          result.length,

        matches:
          result

      });

    } catch (error) {

      console.error(
        "Erreur predictions:",
        error
      );

      res.status(500).json({

        success: false,

        error: error.message

      });

    }

  }
);


/* ==================================================
   STATISTIQUES D'UN MATCH
================================================== */

app.get(
  "/statistics",
  async (req, res) => {

    try {

      const fixture =
        req.query.fixture;

      if (!fixture) {

        return res.status(400).json({
          success: false,
          error: "fixture manquant"
        });

      }

      const data =
        await footballApi(
          "/fixtures/statistics?fixture=" +
          encodeURIComponent(fixture)
        );

      res.json({

        success: true,

        fixture: fixture,

        statistics:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error: error.message

      });

    }

  }
);


/* ==================================================
   DERNIERS 5 MATCHS D'UNE EQUIPE
================================================== */

app.get(
  "/team-statistics",
  async (req, res) => {

    try {

      const team =
        req.query.team;

      if (!team) {

        return res.status(400).json({
          success: false,
          error: "team manquant"
        });

      }

      const data =
        await footballApi(
          "/fixtures?team=" +
          encodeURIComponent(team) +
          "&last=5"
        );

      res.json({

        success: true,

        team: team,

        matches:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error: error.message

      });

    }

  }
);


/* ==================================================
   H2H - 5 DERNIÈRES CONFRONTATIONS
================================================== */

app.get(
  "/h2h",
  async (req, res) => {

    try {

      const teams =
        req.query.teams;

      if (!teams) {

        return res.status(400).json({
          success: false,
          error:
            "teams manquant. Exemple: 33-34"
        });

      }

      const data =
        await footballApi(
          "/fixtures/headtohead?h2h=" +
          encodeURIComponent(teams) +
          "&last=5"
        );

      res.json({

        success: true,

        teams: teams,

        h2h:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error: error.message

      });

    }

  }
);


/* ==================================================
   CLASSEMENT
================================================== */

app.get(
  "/standings",
  async (req, res) => {

    try {

      const league =
        req.query.league;

      const season =
        req.query.season;

      if (!league || !season) {

        return res.status(400).json({

          success: false,

          error:
            "league et season sont requis"

        });

      }

      const data =
        await footballApi(
          "/standings?league=" +
          encodeURIComponent(league) +
          "&season=" +
          encodeURIComponent(season)
        );

      res.json({

        success: true,

        league: league,

        season: season,

        standings:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error: error.message

      });

    }

  }
);


/* ==================================================
   INFORMATIONS DU SERVEUR
================================================== */

app.get(
  "/health",
  (req, res) => {

    res.json({

      status: "online",

      service:
        "BOT PREDICTOR",

      api_configured:
        Boolean(API_KEY),

      timezone:
        "Africa/Abidjan"

    });

  }
);


/* ==================================================
   DEMARRAGE
================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      "BOT PREDICTOR SERVER actif sur le port " +
      PORT
    );

  }
);
