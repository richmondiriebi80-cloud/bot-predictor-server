const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

/* ==================================================
   CORS
================================================== */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


/* ==================================================
   API-FOOTBALL
================================================== */

const API_KEY = process.env.API_FOOTBALL_KEY;
const API = "https://v3.football.api-sports.io";

async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(
    API + endpoint,
    {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse API-Football invalide."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status
    );
  }

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

  } catch {
    return "";
  }
}


/* ==================================================
   POURCENTAGE
================================================== */

function pct(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  return (
    parseFloat(
      String(value)
        .replace("%", "")
    ) || 0
  );
}


/* ==================================================
   HISTORIQUE
================================================== */

const HISTORY_FILE =
  path.join(
    __dirname,
    "history.json"
  );

let history = [];

function chargerHistorique() {

  try {

    if (
      fs.existsSync(
        HISTORY_FILE
      )
    ) {

      const content =
        fs.readFileSync(
          HISTORY_FILE,
          "utf8"
        );

      const parsed =
        JSON.parse(content);

      history =
        Array.isArray(parsed)
          ? parsed
          : [];

    }

  } catch (error) {

    console.log(
      "Historique non chargé:",
      error.message
    );

    history = [];
  }
}


function sauvegarderHistorique() {

  try {

    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(
        history,
        null,
        2
      )
    );

  } catch (error) {

    console.log(
      "Erreur sauvegarde historique:",
      error.message
    );
  }
}


chargerHistorique();


/* ==================================================
   MATCH A VENIR
================================================== */

function matchAVenir(match) {

  if (!match?.fixture?.date) {
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

  if (
    termines.includes(status) ||
    live.includes(status)
  ) {
    return false;
  }

  return (
    new Date(match.fixture.date) >
    new Date()
  );
}


/* ==================================================
   SCORE PREVU
================================================== */

function scorePrevu(prediction) {

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


/* ==================================================
   NORMALISATION SCORE
================================================== */

function scoreTexte(home, away) {

  if (
    home === null ||
    home === undefined ||
    away === null ||
    away === undefined
  ) {
    return "Non disponible";
  }

  return (
    String(home) +
    "-" +
    String(away)
  );
}


/* ==================================================
   SCORE MI-TEMPS / FINAL
================================================== */

function scoreReel(fixture) {

  const score =
    fixture?.score || {};

  const ht =
    score.halftime || {};

  const ft =
    score.fulltime || {};

  return {

    halftime:
      scoreTexte(
        ht.home,
        ht.away
      ),

    fulltime:
      scoreTexte(
        ft.home,
        ft.away
      )
  };
}


/* ==================================================
   MATCH TERMINE
================================================== */

function matchTermine(status) {

  return [
    "FT",
    "AET",
    "PEN"
  ].includes(status);
}


/* ==================================================
   RESULTAT PREDICTION
================================================== */

function resultatPrediction(
  selection,
  fixture
) {

  if (
    !fixture ||
    !matchTermine(
      fixture.fixture?.status?.short
    )
  ) {
    return "EN_ATTENTE";
  }

  const home =
    fixture.goals?.home;

  const away =
    fixture.goals?.away;

  if (
    home === null ||
    home === undefined ||
    away === null ||
    away === undefined
  ) {
    return "EN_ATTENTE";
  }

  if (selection === "1") {
    return home > away
      ? "GAGNE"
      : "PERDU";
  }

  if (selection === "2") {
    return away > home
      ? "GAGNE"
      : "PERDU";
  }

  if (selection === "N") {
    return home === away
      ? "GAGNE"
      : "PERDU";
  }

  return "EN_ATTENTE";
}


/* ==================================================
   SELECTION PRINCIPALE
================================================== */

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

  /*
   * On ne rejette plus automatiquement
   * le match si les pourcentages sont absents.
   */

  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {

    const winner =
      p.winner;

    if (winner?.id) {

      return {
        type:
          winner.id ===
          prediction.teams?.home?.id
            ? "1"
            : "2",

        text:
          "Victoire " +
          (winner.name || ""),

        confidence: 50
      };
    }

    return {
      type: "-",
      text:
        "Données insuffisantes",
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
          "équipe à domicile"
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
          "équipe extérieure"
        ),

      confidence: away
    };
  }


  return {

    type: "N",

    text:
      "Match nul",

    confidence: draw
  };
}


/* ==================================================
   RACINE
================================================== */

app.get("/", (req, res) => {

  res.json({

    status: "ok",

    service:
      "BOT PREDICTOR",

    message:
      "Serveur actif",

    timezone:
      "Africa/Abidjan"
  });
});


/* ==================================================
   HEALTH
================================================== */

app.get("/health", (req, res) => {

  res.json({

    status: "online",

    service:
      "BOT PREDICTOR",

    api_configured:
      Boolean(API_KEY),

    history_records:
      history.length,

    timezone:
      "Africa/Abidjan"
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

      date,

      matches:
        data.response || []
    });

  } catch (error) {

    res.status(500).json({

      success: false,

      error:
        error.message
    });
  }
});


/* ==================================================
   PREDICTION D'UN MATCH
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
          data.response?.[0] ||
          null
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);


/* ==================================================
   PREDICTIONS DU JOUR
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();


      /*
       * 1 seule requête pour les matchs du jour.
       */

      const fixtures =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );


      let matches =
        fixtures.response || [];


      /*
       * Garder uniquement les matchs
       * réellement à venir.
       */

      matches =
        matches.filter(
          matchAVenir
        );


      matches.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );


      /*
       * On analyse jusqu'à 6 matchs.
       */

      const candidats =
        matches.slice(0, 6);

      const analyses = [];


      /*
       * Les prédictions API-Football
       * sont mises à jour environ une fois
       * par heure : on les utilise directement.
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

          /*
           * Certaines compétitions peuvent
           * ne pas avoir de prédiction.
           */

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

            match,

            prediction,

            selection
          });

        } catch (error) {

          console.log(
            "Prediction indisponible pour",
            match.fixture.id,
            error.message
          );
        }
      }


      /*
       * Trier par confiance.
       */

      analyses.sort(
        (a, b) =>
          b.selection.confidence -
          a.selection.confidence
      );


      /*
       * Prendre les 2 meilleurs.
       */

      const selected =
        analyses.slice(0, 2);


      const result = [];


      for (
        const item of selected
      ) {

        const m =
          item.match;

        const p =
          item.prediction;

        const s =
          item.selection;

        const pred =
          p.predictions || {};

        const home =
          m.teams?.home || {};

        const away =
          m.teams?.away || {};


        /*
         * Analyse enrichie.
         */

        const percent =
          pred.percent || {};


        const h =
          pct(percent.home);

        const d =
          pct(percent.draw);

        const a =
          pct(percent.away);


        const score =
          scorePrevu(p);


        let analyseTexte =
          "Analyse basée sur les données disponibles dans API-Football.";


        if (
          h ||
          d ||
          a
        ) {

          analyseTexte +=
            " Probabilités du modèle : " +
            "1 = " +
            h.toFixed(0) +
            "%, " +
            "N = " +
            d.toFixed(0) +
            "%, " +
            "2 = " +
            a.toFixed(0) +
            "%.";
        }


        if (
          pred.advice
        ) {

          analyseTexte +=
            " Conseil du modèle : " +
            pred.advice +
            ".";
        }


        if (
          score !==
          "Non disponible"
        ) {

          analyseTexte +=
            " Score prévu par le modèle : " +
            score +
            ".";
        }


        /*
         * HISTORIQUE
         *
         * Une prédiction est enregistrée
         * une seule fois.
         */

        const existing =
          history.find(
            h =>
              Number(h.fixture_id) ===
              Number(m.fixture.id)
          );


        if (!existing) {

          history.push({

            fixture_id:
              m.fixture.id,

            created_at:
              new Date().toISOString(),

            date:
              m.fixture.date,

            league:
              m.league?.name ||
              "Compétition",

            country:
              m.league?.country ||
              "",

            home: {

              id:
                home.id,

              name:
                home.name || "",

              logo:
                home.logo || ""
            },

            away: {

              id:
                away.id,

              name:
                away.name || "",

              logo:
                away.logo || ""
            },

            selection: {

              type:
                s.type,

              text:
                s.text,

              confidence:
                s.confidence
            },

            predicted_score:
              score,

            half_time_score:
              pred.half_time_score ||
              pred.halftime ||
              "Non disponible",

            full_time_score:
              score,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            status:
              "NS",

            result:
              "EN_ATTENTE"
          });

          sauvegarderHistorique();
        }


        result.push({

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

              id:
                home.id,

              name:
                home.name ||
                "",

              logo:
                home.logo ||
                ""
            },

            away: {

              id:
                away.id,

              name:
                away.name ||
                "",

              logo:
                away.logo ||
                ""
            }
          },

          prediction: {

            main_pick:
              s.text,

            type:
              s.type,

            home:
              h.toFixed(0) +
              "%",

            draw:
              d.toFixed(0) +
              "%",

            away:
              a.toFixed(0) +
              "%",

            goals:
              score,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            /*
             * Ces champs restent présents
             * pour ton interface actuelle.
             */

            btts:
              pred.btts ||
              "Non disponible",

            over_under:
              pred.under_over ||
              "Non disponible",

            corners:
              "Non disponible",

            yellow_cards:
              "Non disponible",

            half_time_score:
              pred.half_time_score ||
              pred.halftime ||
              "Non disponible",

            full_time_score:
              score
          },

          consensus: {

            confidence:
              s.confidence.toFixed(0) +
              "%",

            score:
              score
          },

          sources: {

            api_football:
              true,

            sportmonks:
              false,

            football_data:
              false
          },

          analysis:
            analyseTexte
        });
      }


      /*
       * NE PAS considérer "0 match" comme
       * une erreur serveur.
       */

      res.json({

        success: true,

        date,

        analyzed_candidates:
          candidats.length,

        selected:
          result.length,

        matches:
          result,

        message:
          result.length === 0
            ? "Aucune prédiction API-Football disponible pour les matchs sélectionnés."
            : "Analyse terminée."
      });


    } catch (error) {

      console.error(
        "Erreur predictions:",
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

          error:
            "fixture manquant"
        });
      }

      const data =
        await footballApi(
          "/fixtures/statistics?fixture=" +
          encodeURIComponent(fixture)
        );

      res.json({

        success: true,

        fixture,

        statistics:
          data.response || []
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);


/* ==================================================
   DERNIERS MATCHS D'UNE EQUIPE
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

          error:
            "team manquant"
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

        team,

        matches:
          data.response || []
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);


/* ==================================================
   H2H
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
            "teams manquant"
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

        teams,

        h2h:
          data.response || []
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
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

        league,

        season,

        standings:
          data.response || []
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);


/* ==================================================
   HISTORIQUE
================================================== */

app.get(
  "/history",
  async (req, res) => {

    try {

      /*
       * Aucun historique.
       */

      if (!history.length) {

        return res.json({

          success: true,

          total: 0,

          stats: {

            gagne: 0,

            perdu: 0,

            attente: 0,

            taux_reussite: 0
          },

          matches: []
        });
      }


      /*
       * Les 20 derniers matchs maximum.
       * L'API accepte jusqu'à 20 IDs.
       */

      const ids =
        history
          .map(
            h =>
              h.fixture_id
          )
          .filter(Boolean)
          .slice(-20);


      let fixtures = [];


      if (ids.length) {

        const data =
          await footballApi(
            "/fixtures?ids=" +
            ids.join("-") +
            "&timezone=Africa/Abidjan"
          );

        fixtures =
          data.response || [];
      }


      const fixtureMap =
        new Map();


      fixtures.forEach(
        fixture => {

          fixtureMap.set(
            Number(
              fixture.fixture.id
            ),
            fixture
          );
        }
      );


      /*
       * Mettre à jour les résultats.
       */

      history =
        history.map(item => {

          const fixture =
            fixtureMap.get(
              Number(
                item.fixture_id
              )
            );

          if (!fixture) {

            return item;
          }


          const scores =
            scoreReel(
              fixture
            );


          const status =
            fixture.fixture.status?.short ||
            "NS";


          const result =
            resultatPrediction(
              item.selection?.type,
              fixture
            );


          return {

            ...item,

            status,

            halftime_score:
              scores.halftime,

            final_score:
              scores.fulltime,

            result
          };
        });


      sauvegarderHistorique();


      /*
       * Statistiques.
       */

      const gagne =
        history.filter(
          x =>
            x.result ===
            "GAGNE"
        ).length;


      const perdu =
        history.filter(
          x =>
            x.result ===
            "PERDU"
        ).length;


      const attente =
        history.filter(
          x =>
            x.result ===
            "EN_ATTENTE"
        ).length;


      const termines =
        gagne + perdu;


      const taux =
        termines > 0
          ? Math.round(
              gagne /
              termines *
              100
            )
          : 0;


      /*
       * Plus récent en premier.
       */

      const sorted =
        [...history].sort(
          (a, b) =>
            new Date(
              b.created_at
            ) -
            new Date(
              a.created_at
            )
        );


      res.json({

        success: true,

        total:
          sorted.length,

        stats: {

          gagne,

          perdu,

          attente,

          taux_reussite:
            taux
        },

        matches:
          sorted
      });


    } catch (error) {

      console.error(
        "Erreur historique:",
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


/* ==================================================
   HISTORIQUE D'UN MATCH
================================================== */

app.get(
  "/history/:fixture",
  async (req, res) => {

    try {

      const fixtureId =
        Number(
          req.params.fixture
        );


      const item =
        history.find(
          h =>
            Number(
              h.fixture_id
            ) === fixtureId
        );


      if (!item) {

        return res.status(404).json({

          success: false,

          error:
            "Aucune prédiction enregistrée pour ce match."
        });
      }


      const data =
        await footballApi(
          "/fixtures?id=" +
          fixtureId
        );


      const fixture =
        data.response?.[0];


      if (fixture) {

        const scores =
          scoreReel(
            fixture
          );


        item.status =
          fixture.fixture.status?.short ||
          "NS";


        item.halftime_score =
          scores.halftime;


        item.final_score =
          scores.fulltime;


        item.result =
          resultatPrediction(
            item.selection?.type,
            fixture
          );


        sauvegarderHistorique();
      }


      res.json({

        success: true,

        match:
          item
      });


    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);


/* ==================================================
   SUPPRESSION HISTORIQUE
================================================== */

app.delete(
  "/history",
  (req, res) => {

    history = [];

    sauvegarderHistorique();

    res.json({

      success: true,

      message:
        "Historique supprimé",

      total: 0
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
