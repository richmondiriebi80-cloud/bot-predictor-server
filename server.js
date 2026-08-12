const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

/* ==================================================
   CORS
   Permet à la section HTML de l'application
   d'appeler le serveur Render.
================================================== */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});


/* ==================================================
   API-FOOTBALL
================================================== */

const API_KEY = process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


/* ==================================================
   APPEL API
================================================== */

async function footballApi(path) {

  if (!API_KEY) {
    throw new Error(
      "La variable API_FOOTBALL_KEY n'est pas configurée sur Render."
    );
  }

  const response = await fetch(
    API + path,
    {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " + response.status
    );
  }

  const data = await response.json();

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


/* ==================================================
   DATE ABIDJAN
================================================== */

function dateAbidjan() {

  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Africa/Abidjan",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date());

  const values = {};

  parts.forEach(p => {
    values[p.type] = p.value;
  });

  return (
    values.year +
    "-" +
    values.month +
    "-" +
    values.day
  );
}


/* ==================================================
   HEURE ABIDJAN
================================================== */

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


/* ==================================================
   MATCH À VENIR
================================================== */

function estMatchAVenir(match) {

  if (!match || !match.fixture) {
    return false;
  }

  const status =
    match.fixture.status?.short;

  const statusesTermines = [
    "FT",
    "AET",
    "PEN",
    "CANC",
    "ABD",
    "PST",
    "AWD",
    "WO"
  ];

  const statusesLive = [
    "1H",
    "HT",
    "2H",
    "ET",
    "BT",
    "P",
    "LIVE"
  ];

  if (statusesTermines.includes(status)) {
    return false;
  }

  if (statusesLive.includes(status)) {
    return false;
  }

  return (
    new Date(match.fixture.date) >
    new Date()
  );
}


/* ==================================================
   POURCENTAGE
================================================== */

function pourcentage(value) {

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


/* ==================================================
   MEILLEURE SÉLECTION
================================================== */

function meilleureSelection(prediction) {

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const home =
    pourcentage(percent.home);

  const draw =
    pourcentage(percent.draw);

  const away =
    pourcentage(percent.away);

  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {

    return {
      text: "Données insuffisantes",
      type: "-",
      confidence: 0
    };

  }

  if (
    home >= draw &&
    home >= away
  ) {

    return {
      text:
        "Victoire " +
        (
          prediction.teams?.home?.name ||
          "domicile"
        ),
      type: "1",
      confidence: home
    };

  }

  if (
    away >= home &&
    away >= draw
  ) {

    return {
      text:
        "Victoire " +
        (
          prediction.teams?.away?.name ||
          "extérieur"
        ),
      type: "2",
      confidence: away
    };

  }

  return {
    text: "Match nul",
    type: "N",
    confidence: draw
  };
}


/* ==================================================
   SCORE PRÉVISIONNEL
================================================== */

function scorePrevisionnel(prediction) {

  const goals =
    prediction?.predictions?.goals || {};

  const home =
    goals.home;

  const away =
    goals.away;

  if (
    home !== null &&
    home !== undefined &&
    away !== null &&
    away !== undefined
  ) {

    return {
      home: home,
      away: away,
      text:
        String(home) +
        "-" +
        String(away)
    };

  }

  return {
    home: null,
    away: null,
    text: "Non disponible"
  };
}


/* ==================================================
   ANALYSE TEXTE
================================================== */

function construireAnalyse(
  match,
  prediction,
  selection
) {

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const score =
    scorePrevisionnel(prediction);

  const home =
    pourcentage(percent.home);

  const draw =
    pourcentage(percent.draw);

  const away =
    pourcentage(percent.away);

  let texte =
    "Analyse basée sur les données disponibles d'API-Football. ";

  if (selection.type === "1") {

    texte +=
      "L'algorithme donne l'avantage à " +
      match.teams.home.name +
      " avec " +
      home.toFixed(0) +
      "% pour la victoire à domicile.";

  } else if (selection.type === "2") {

    texte +=
      "L'algorithme donne l'avantage à " +
      match.teams.away.name +
      " avec " +
      away.toFixed(0) +
      "% pour la victoire à l'extérieur.";

  } else {

    texte +=
      "Le scénario du match nul est celui qui ressort " +
      "le plus fortement des probabilités disponibles.";

  }

  if (p.under_over) {

    texte +=
      " Tendance buts : " +
      p.under_over +
      ".";

  }

  if (p.advice) {

    texte +=
      " Conseil statistique API-Football : " +
      p.advice +
      ".";

  }

  if (
    score.home !== null &&
    score.away !== null
  ) {

    texte +=
      " Score prévisionnel fourni par l'API : " +
      score.text +
      ".";

  }

  return texte;
}


/* ==================================================
   RACINE
================================================== */

app.get("/", (req, res) => {

  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif",
    timezone: "Africa/Abidjan"
  });

});


/* ==================================================
   MATCHS DU JOUR
================================================== */

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


/* ==================================================
   PRÉDICTIONS D'UN MATCH
================================================== */

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


/* ==================================================
   2 MEILLEURS MATCHS DU JOUR
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();


      /*
       * UNE seule requête pour récupérer
       * les matchs du jour.
       */

      const fixturesData =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );


      let matchs =
        fixturesData.response || [];


      /*
       * Garder uniquement les matchs
       * réellement à venir.
       */

      matchs =
        matchs.filter(
          estMatchAVenir
        );


      /*
       * Trier par heure.
       */

      matchs.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );


      /*
       * Pour éviter de consommer inutilement
       * le quota API, on analyse au maximum
       * les 6 premiers matchs à venir.
       *
       * Les 2 meilleurs seront ensuite retenus.
       */

      const candidats =
        matchs.slice(0, 6);


      if (candidats.length === 0) {

        return res.json({

          success: true,

          date: date,

          matches: [],

          message:
            "Aucun match à venir disponible aujourd'hui."

        });

      }


      const analyses = [];


      /*
       * Analyse réelle de chaque candidat
       * avec l'endpoint officiel predictions.
       */

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
            meilleureSelection(
              prediction
            );


          if (
            selection.confidence <= 0
          ) {

            continue;

          }


          const score =
            scorePrevisionnel(
              prediction
            );


          const analyse =
            construireAnalyse(
              match,
              prediction,
              selection
            );


          analyses.push({

            match: {

              id:
                match.fixture.id,

              date:
                match.fixture.date,

              time:
                heureAbidjan(
                  match.fixture.date
                ),

              league:
                match.league?.name ||
                "Compétition",

              country:
                match.league?.country ||
                "",

              home: {

                name:
                  match.teams?.home?.name ||
                  "Domicile",

                logo:
                  match.teams?.home?.logo ||
                  ""

              },

              away: {

                name:
                  match.teams?.away?.name ||
                  "Extérieur",

                logo:
                  match.teams?.away?.logo ||
                  ""

              }

            },


            prediction: {

              main_pick:
                selection.text,

              home:
                pourcentage(
                  prediction.predictions?.percent?.home
                ).toFixed(0) + "%",

              draw:
                pourcentage(
                  prediction.predictions?.percent?.draw
                ).toFixed(0) + "%",

              away:
                pourcentage(
                  prediction.predictions?.percent?.away
                ).toFixed(0) + "%",

              goals:
                prediction.predictions?.goals?.home !== undefined &&
                prediction.predictions?.goals?.away !== undefined
                  ?
                  prediction.predictions.goals.home +
                  "-" +
                  prediction.predictions.goals.away
                  :
                  "Non disponible",

              btts:
                prediction.predictions?.under_over ||
                "Non disponible",

              over_under:
                prediction.predictions?.under_over ||
                "Non disponible",

              corners:
                "Non disponible",

              yellow_cards:
                "Non disponible",

              half_time_score:
                "Non disponible",

              full_time_score:
                score.text

            },


            consensus: {

              score:
                selection.confidence.toFixed(0) + "%",

              confidence:
                selection.confidence.toFixed(0) + "%"

            },


            sources: {

              api_football: true,

              sportmonks: false,

              football_data: false

            },


            analysis:
              analyse,


            ranking:
              selection.confidence

          });


        } catch (predictionError) {

          /*
           * Si un match n'a pas de prédiction,
           * on passe au suivant.
           */

          console.log(
            "Prediction indisponible pour fixture",
            match.fixture.id,
            predictionError.message
          );

        }

      }


      /*
       * Classer les matchs selon
       * la confiance réelle retournée
       * par l'API.
       */

      analyses.sort(
        (a, b) =>
          b.ranking -
          a.ranking
      );


      /*
       * Garder exactement 2 matchs
       * lorsque deux analyses sont disponibles.
       */

      const meilleurs =
        analyses
          .slice(0, 2)
          .map(item => {

            delete item.ranking;

            return item;

          });


      res.json({

        success: true,

        date: date,

        analyzed_candidates:
          candidats.length,

        selected:
          meilleurs.length,

        matches:
          meilleurs

      });


    } catch (error) {

      console.error(
        "Erreur /predictions:",
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
   DÉMARRAGE
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
