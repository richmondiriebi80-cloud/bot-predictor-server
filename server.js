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
    "GET,POST,OPTIONS"
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

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


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

  } catch (error) {
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

      history =
        JSON.parse(content);

      if (!Array.isArray(history)) {
        history = [];
      }

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
      "Impossible de sauvegarder:",
      error.message
    );
  }
}


chargerHistorique();


/* ==================================================
   MATCH À VENIR
================================================== */

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

  if (
    termines.includes(status) ||
    live.includes(status)
  ) {
    return false;
  }

  return (
    new Date(
      match.fixture.date
    ) > new Date()
  );
}


/* ==================================================
   MEILLEURE PRÉDICTION
================================================== */

function meilleurePrediction(
  prediction
) {

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


/* ==================================================
   SCORE PRÉVU
   IMPORTANT :
   On accepte uniquement un vrai score
   numérique du type 1-0, 2-1, etc.
================================================== */

function scorePrevu(prediction) {

  const goals =
    prediction?.predictions?.goals;

  if (
    goals &&
    Number.isFinite(
      Number(goals.home)
    ) &&
    Number.isFinite(
      Number(goals.away)
    ) &&
    Number(goals.home) >= 0 &&
    Number(goals.away) >= 0
  ) {

    return (
      Number(goals.home) +
      "-" +
      Number(goals.away)
    );
  }

  return "Non disponible";
}


/* ==================================================
   SCORE RÉEL
================================================== */

function scoreReel(fixture) {

  const score =
    fixture?.score;

  if (!score) {

    return {
      halftime: null,
      fulltime: null
    };
  }

  const ht =
    score.halftime || {};

  const ft =
    score.fulltime || {};

  let halftime = null;
  let fulltime = null;

  if (
    Number.isFinite(Number(ht.home)) &&
    Number.isFinite(Number(ht.away))
  ) {

    halftime =
      Number(ht.home) +
      "-" +
      Number(ht.away);
  }

  if (
    Number.isFinite(Number(ft.home)) &&
    Number.isFinite(Number(ft.away))
  ) {

    fulltime =
      Number(ft.home) +
      "-" +
      Number(ft.away);
  }

  return {
    halftime,
    fulltime
  };
}


/* ==================================================
   MATCH TERMINÉ
================================================== */

function matchTermine(status) {

  return [
    "FT",
    "AET",
    "PEN"
  ].includes(status);
}


/* ==================================================
   RÉSULTAT PRÉDICTION
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

  const homeGoals =
    fixture.goals?.home;

  const awayGoals =
    fixture.goals?.away;

  if (
    homeGoals === null ||
    homeGoals === undefined ||
    awayGoals === null ||
    awayGoals === undefined
  ) {

    return "EN_ATTENTE";
  }

  if (selection?.type === "1") {

    return homeGoals > awayGoals
      ? "GAGNE"
      : "PERDU";
  }

  if (selection?.type === "2") {

    return awayGoals > homeGoals
      ? "GAGNE"
      : "PERDU";
  }

  if (selection?.type === "N") {

    return homeGoals === awayGoals
      ? "GAGNE"
      : "PERDU";
  }

  return "EN_ATTENTE";
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
   TEST API-FOOTBALL
================================================== */

app.get(
  "/api-test",
  async (req, res) => {

    try {

      const data =
        await footballApi(
          "/status"
        );

      res.json({
        success: true,
        message:
          "Connexion API-Football OK",
        results:
          data.results || 0,
        response:
          data.response || null
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message:
          "Connexion API-Football échouée",
        error:
          error.message
      });
    }
  }
);


/* ==================================================
   MATCHS DU JOUR
================================================== */

app.get(
  "/matches",
  async (req, res) => {

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
  }
);


/* ==================================================
   PRÉDICTION D'UN MATCH
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
   PRÉDICTIONS DU JOUR
================================================== */

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
        matches.filter(
          matchAVenir
        );

      matches.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ) -
          new Date(
            b.fixture.date
          )
      );

      const candidats =
        matches.slice(0, 8);

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
            match,
            prediction,
            selection
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
        analyses
          .filter(
            x =>
              x.selection.confidence >= 45
          )
          .slice(0, 2);


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

        const score =
          scorePrevu(p);


        const historyItem = {

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
              m.teams?.home?.id,

            name:
              m.teams?.home?.name ||
              "",

            logo:
              m.teams?.home?.logo ||
              ""

          },

          away: {

            id:
              m.teams?.away?.id,

            name:
              m.teams?.away?.name ||
              "",

            logo:
              m.teams?.away?.logo ||
              ""

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

          under_over:
            pred.under_over ||
            "Non disponible",

          advice:
            pred.advice ||
            "Non disponible"

        };


        const existing =
          history.find(
            h =>
              h.fixture_id ===
              historyItem.fixture_id
          );


        if (!existing) {

          history.push(
            historyItem
          );

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

            home:
              historyItem.home,

            away:
              historyItem.away

          },

          prediction: {

            main_pick:
              s.text,

            type:
              s.type,

            home:
              pct(
                pred.percent?.home
              ).toFixed(0) +
              "%",

            draw:
              pct(
                pred.percent?.draw
              ).toFixed(0) +
              "%",

            away:
              pct(
                pred.percent?.away
              ).toFixed(0) +
              "%",

            goals:
              score,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            btts:
              pred.btts ||
              "Non disponible",

            over_under:
              pred.under_over ||
              "Non disponible",

            corners:
              pred.corners ||
              "Non disponible",

            yellow_cards:
              pred.yellow_cards ||
              "Non disponible",

            half_time_score:
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

            api_football: true,

            recent_form: false,

            h2h: false

          },

          analysis:
            "Analyse basée sur les données réellement disponibles dans API-Football. " +
            "Probabilités : 1 = " +
            pct(pred.percent?.home).toFixed(0) +
            "%, N = " +
            pct(pred.percent?.draw).toFixed(0) +
            "%, 2 = " +
            pct(pred.percent?.away).toFixed(0) +
            "%. " +
            "Pronostic principal : " +
            s.text +
            ". " +
            "Conseil API-Football : " +
            (pred.advice ||
              "Non disponible") +
            ". " +
            "Un score exact n'est affiché que lorsque l'API fournit réellement des buts."

        });

      }


      res.json({

        success: true,

        date,

        analyzed_candidates:
          candidats.length,

        analyzed_with_data:
          analyses.length,

        selected:
          result.length,

        matches:
          result,

        message:
          result.length
            ? "Analyse terminée."
            : "Aucun match suffisamment fiable disponible."

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
   STATISTIQUES MATCH
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
   DERNIERS MATCHS ÉQUIPE
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
       * IMPORTANT :
       * Le plan Free API-Football n'accepte pas
       * le paramètre ids.
       *
       * On récupère donc chaque fixture
       * individuellement.
       */

      const recent =
        history
          .slice(-10);

      const updated = [];


      for (
        const item of recent
      ) {

        try {

          const data =
            await footballApi(
              "/fixtures?id=" +
              encodeURIComponent(
                item.fixture_id
              ) +
              "&timezone=Africa/Abidjan"
            );

          const fixture =
            data.response?.[0];

          if (!fixture) {

            updated.push({
              ...item,
              status:
                "EN_ATTENTE",
              halftime_score:
                null,
              final_score:
                null,
              result:
                "EN_ATTENTE"
            });

            continue;
          }


          const scores =
            scoreReel(
              fixture
            );

          const result =
            resultatPrediction(
              item.selection,
              fixture
            );


          updated.push({

            ...item,

            status:
              fixture.fixture.status?.short ||
              "NS",

            halftime_score:
              scores.halftime,

            final_score:
              scores.fulltime,

            result

          });

        } catch (error) {

          updated.push({
            ...item,
            status:
              "EN_ATTENTE",
            halftime_score:
              null,
            final_score:
              null,
            result:
              "EN_ATTENTE"
          });
        }
      }


      /*
       * Conserver les anciens éléments
       * non vérifiés dans l'historique.
       */

      const old =
        history.filter(
          h =>
            !recent.some(
              r =>
                r.fixture_id ===
                h.fixture_id
            )
        );


      history =
        old.concat(updated);

      sauvegarderHistorique();


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
              (
                gagne /
                termines
              ) *
              100
            )
          : 0;


      history.sort(
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
          history.length,

        stats: {

          gagne,

          perdu,

          attente,

          taux_reussite:
            taux

        },

        matches:
          history

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
            h.fixture_id ===
            fixtureId
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
          encodeURIComponent(
            fixtureId
          )
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
            item.selection,
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
   FIFA VIRTUEL 1XBET
   TEST DE CONNEXION AUX FLUX
================================================== */

const XBET_LIVE_API =
  "https://1xbet.com/LiveFeed/";


app.get(
  "/virtual-fifa",
  async (req, res) => {

    try {

      const params =
        new URLSearchParams({
          sports: "0",
          lng: "fr",
          tf: "1000000",
          country: "1"
        });


      const response =
        await fetch(
          XBET_LIVE_API +
          "GetSportsShortZip?" +
          params.toString(),
          {
            method: "GET",

            headers: {
              "User-Agent":
                "Mozilla/5.0",
              "Accept":
                "application/json,text/plain,*/*"
            }
          }
        );


      if (!response.ok) {

        throw new Error(
          "1xBet HTTP " +
          response.status
        );
      }


      const data =
        await response.json();


      const sports =
        Array.isArray(
          data.Value
        )
          ? data.Value
          : [];


      const fifa =
        sports.filter(
          sport => {

            const name =
              String(
                sport.N ||
                sport.Name ||
                ""
              ).toLowerCase();

            return (
              name.includes("fifa") ||
              name.includes("esports football") ||
              name.includes("virtual football")
            );

          }
        );


      res.json({

        success: true,

        source:
          "1xBet LiveFeed",

        fifa_found:
          fifa.length > 0,

        fifa_sports:
          fifa.map(
            sport => ({
              id:
                sport.I ??
                sport.Id ??
                null,

              name:
                sport.N ||
                sport.Name ||
                "FIFA"
            })
          ),

        message:
          fifa.length > 0
            ? "FIFA virtuel détecté."
            : "Aucun FIFA virtuel détecté dans le flux actuel."

      });

    } catch (error) {

      console.error(
        "Erreur FIFA 1xBet:",
        error.message
      );

      res.status(500).json({

        success: false,

        source:
          "1xBet LiveFeed",

        error:
          error.message

      });
    }
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
