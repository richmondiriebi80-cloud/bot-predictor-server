const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY;
const API = "https://v3.football.api-sports.io";

const HISTORY_FILE = path.join(__dirname, "history.json");

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
   HISTORIQUE
================================================== */

let history = [];

function chargerHistorique() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      );

      const parsed = JSON.parse(data);

      history = Array.isArray(parsed)
        ? parsed
        : [];
    }
  } catch (error) {
    console.log(
      "Erreur chargement historique:",
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
   API FOOTBALL
================================================== */

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
      "Réponse invalide de API-Football."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      ": " +
      JSON.stringify(data.errors || {})
    );
  }

  if (
    data.errors &&
    Object.keys(data.errors).length
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
    return "--:--";
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
   VALEUR PROPRE
================================================== */

function valeur(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Non disponible";
  }

  return value;
}


/* ==================================================
   MATCH A VENIR
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
    new Date(match.fixture.date) >
    new Date()
  );
}


/* ==================================================
   MEILLEURE SELECTION
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
          "équipe domicile"
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
    text: "Match nul",
    confidence: draw
  };
}


/* ==================================================
   SCORE INDICATIF
   IMPORTANT :
   Les valeurs -1.5/-2.5/-3.5 de l'API
   sont des seuils, PAS des scores exacts.
================================================== */

function scoreIndicatif(prediction) {

  const goals =
    prediction?.predictions?.goals || {};

  const home =
    goals.home;

  const away =
    goals.away;

  if (
    home === null ||
    home === undefined ||
    away === null ||
    away === undefined
  ) {
    return "Non disponible";
  }

  const convert = value => {

    const n =
      parseFloat(
        String(value)
          .replace("+", "")
          .replace("-", "")
      );

    if (!Number.isFinite(n)) {
      return null;
    }

    /*
     * -1.5 signifie maximum 1 but.
     * On ne prétend PAS que c'est
     * un score exact.
     */

    if (String(value).startsWith("-")) {
      if (n <= 1.5) return 1;
      if (n <= 2.5) return 2;
      if (n <= 3.5) return 3;
      return 4;
    }

    if (String(value).startsWith("+")) {
      if (n <= 1.5) return 2;
      if (n <= 2.5) return 3;
      if (n <= 3.5) return 4;
      return 5;
    }

    return null;
  };

  const h = convert(home);
  const a = convert(away);

  if (h === null || a === null) {
    return "Non disponible";
  }

  return h + "-" + a;
}


/* ==================================================
   SCORE REEL
================================================== */

function scoreReel(fixture) {

  const halftime =
    fixture?.score?.halftime || {};

  const fulltime =
    fixture?.score?.fulltime || {};

  let miTemps = null;
  let final = null;

  if (
    halftime.home !== null &&
    halftime.home !== undefined &&
    halftime.away !== null &&
    halftime.away !== undefined
  ) {
    miTemps =
      halftime.home +
      "-" +
      halftime.away;
  }

  if (
    fulltime.home !== null &&
    fulltime.home !== undefined &&
    fulltime.away !== null &&
    fulltime.away !== undefined
  ) {
    final =
      fulltime.home +
      "-" +
      fulltime.away;
  }

  return {
    halftime: miTemps,
    fulltime: final
  };
}


/* ==================================================
   RESULTAT PREDICTION
================================================== */

function resultatPrediction(
  selection,
  fixture
) {

  const status =
    fixture?.fixture?.status?.short;

  const termines = [
    "FT",
    "AET",
    "PEN"
  ];

  if (!termines.includes(status)) {
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

  if (selection?.type === "1") {
    return home > away
      ? "GAGNE"
      : "PERDU";
  }

  if (selection?.type === "2") {
    return away > home
      ? "GAGNE"
      : "PERDU";
  }

  if (selection?.type === "N") {
    return home === away
      ? "GAGNE"
      : "PERDU";
  }

  return "EN_ATTENTE";
}


/* ==================================================
   FORM DES 5 DERNIERS MATCHS
================================================== */

async function derniersMatchs(teamId) {

  try {

    const data =
      await footballApi(
        "/fixtures?team=" +
        encodeURIComponent(teamId) +
        "&last=5"
      );

    return data.response || [];

  } catch (error) {

    console.log(
      "Form indisponible équipe",
      teamId,
      error.message
    );

    return [];
  }
}


/* ==================================================
   H2H
================================================== */

async function h2h(
  homeId,
  awayId
) {

  try {

    const data =
      await footballApi(
        "/fixtures/headtohead?h2h=" +
        encodeURIComponent(
          homeId + "-" + awayId
        ) +
        "&last=5"
      );

    return data.response || [];

  } catch (error) {

    console.log(
      "H2H indisponible:",
      error.message
    );

    return [];
  }
}


/* ==================================================
   STATISTIQUES FIXTURE
================================================== */

async function statistiquesFixture(
  fixtureId
) {

  try {

    const data =
      await footballApi(
        "/fixtures/statistics?fixture=" +
        encodeURIComponent(fixtureId)
      );

    return data.response || [];

  } catch (error) {

    console.log(
      "Statistiques indisponibles:",
      error.message
    );

    return [];
  }
}


/* ==================================================
   EXTRACTION STATISTIQUES
================================================== */

function extraireStats(
  stats,
  teamId
) {

  const bloc =
    stats.find(
      x =>
        Number(x.team?.id) ===
        Number(teamId)
    );

  if (!bloc) {
    return {};
  }

  const result = {};

  for (
    const item of bloc.statistics || []
  ) {

    if (!item?.type) {
      continue;
    }

    result[item.type] =
      item.value;
  }

  return result;
}


/* ==================================================
   ANALYSE MULTI-DONNEES
================================================== */

function construireAnalyse({
  match,
  prediction,
  homeForm,
  awayForm,
  faceToFace
}) {

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const homePct =
    pct(percent.home);

  const drawPct =
    pct(percent.draw);

  const awayPct =
    pct(percent.away);

  const selection =
    meilleurePrediction(
      prediction
    );

  const h2hCount =
    faceToFace.length;

  const homeFinished =
    homeForm.filter(
      x =>
        [
          "FT",
          "AET",
          "PEN"
        ].includes(
          x.fixture?.status?.short
        )
    );

  const awayFinished =
    awayForm.filter(
      x =>
        [
          "FT",
          "AET",
          "PEN"
        ].includes(
          x.fixture?.status?.short
        )
    );

  function bilan(
    matches,
    teamId
  ) {

    let win = 0;
    let draw = 0;
    let loss = 0;

    matches.forEach(m => {

      const h =
        m.goals?.home;

      const a =
        m.goals?.away;

      if (
        h === null ||
        h === undefined ||
        a === null ||
        a === undefined
      ) {
        return;
      }

      const isHome =
        Number(m.teams?.home?.id) ===
        Number(teamId);

      const teamGoals =
        isHome ? h : a;

      const opponentGoals =
        isHome ? a : h;

      if (
        teamGoals >
        opponentGoals
      ) {
        win++;
      } else if (
        teamGoals ===
        opponentGoals
      ) {
        draw++;
      } else {
        loss++;
      }
    });

    return {
      win,
      draw,
      loss,
      total:
        win + draw + loss
    };
  }

  const homeBilan =
    bilan(
      homeFinished,
      match.teams.home.id
    );

  const awayBilan =
    bilan(
      awayFinished,
      match.teams.away.id
    );

  const score =
    scoreIndicatif(
      prediction
    );

  let texte =
    "Analyse multi-données basée sur les informations réellement disponibles. ";

  texte +=
    "Probabilités API-Football : " +
    "1 = " +
    homePct +
    "%, N = " +
    drawPct +
    "%, 2 = " +
    awayPct +
    "%. ";

  texte +=
    "Forme " +
    match.teams.home.name +
    " : " +
    homeBilan.win +
    " victoire(s), " +
    homeBilan.draw +
    " nul(s), " +
    homeBilan.loss +
    " défaite(s) sur " +
    homeBilan.total +
    " match(s). ";

  texte +=
    "Forme " +
    match.teams.away.name +
    " : " +
    awayBilan.win +
    " victoire(s), " +
    awayBilan.draw +
    " nul(s), " +
    awayBilan.loss +
    " défaite(s) sur " +
    awayBilan.total +
    " match(s). ";

  texte +=
    "Face-à-face disponibles : " +
    h2hCount +
    ". ";

  texte +=
    "Pronostic principal : " +
    selection.text +
    " avec " +
    selection.confidence +
    "% de probabilité. ";

  if (p.advice) {
    texte +=
      "Conseil API-Football : " +
      p.advice +
      ". ";
  }

  if (
    p.under_over
  ) {
    texte +=
      "Tendance buts : " +
      p.under_over +
      ". ";
  }

  if (
    score !== "Non disponible"
  ) {
    texte +=
      "Score indicatif : " +
      score +
      ". ";
  }

  texte +=
    "Les seuils Over/Under de l'API ne sont jamais présentés comme des scores exacts.";

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
   TEST API
================================================== */

app.get(
  "/test-api",
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
          data.results,

        response:
          data.response

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
   PREDICTIONS
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();

      const fixturesData =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );

      let fixtures =
        fixturesData.response || [];

      fixtures =
        fixtures.filter(
          matchAVenir
        );

      fixtures.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ) -
          new Date(
            b.fixture.date
          )
      );

      /*
       * On examine jusqu'à 12 matchs
       * au lieu de seulement 6.
       */

      const candidats =
        fixtures.slice(0, 12);

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

          /*
           * Données réelles des 5 derniers
           * matchs.
           */

          const homeForm =
            await derniersMatchs(
              match.teams.home.id
            );

          const awayForm =
            await derniersMatchs(
              match.teams.away.id
            );

          /*
           * Face-à-face.
           */

          const faceToFace =
            await h2h(
              match.teams.home.id,
              match.teams.away.id
            );

          /*
           * On garde les données
           * réellement disponibles.
           */

          analyses.push({

            match,

            prediction,

            homeForm,

            awayForm,

            faceToFace,

            selection

          });

        } catch (error) {

          console.log(
            "Analyse impossible fixture",
            match.fixture.id,
            error.message
          );

        }

      }

      /*
       * Meilleure confiance d'abord.
       */

      analyses.sort(
        (a, b) =>
          b.selection.confidence -
          a.selection.confidence
      );

      /*
       * Deux meilleurs matchs.
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

        const pred =
          p.predictions || {};

        const s =
          item.selection;

        const score =
          scoreIndicatif(
            p
          );

        const analysis =
          construireAnalyse({
            match: m,
            prediction: p,
            homeForm:
              item.homeForm,
            awayForm:
              item.awayForm,
            faceToFace:
              item.faceToFace
          });

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
            "Non disponible",

          status:
            "EN_ATTENTE",

          halftime_score:
            null,

          final_score:
            null,

          result:
            "EN_ATTENTE"

        };

        /*
         * Ne pas créer de doublon.
         */

        const existing =
          history.find(
            h =>
              Number(h.fixture_id) ===
              Number(
                historyItem.fixture_id
              )
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

            /*
             * Ne pas afficher le seuil
             * comme score exact.
             */

            goals:
              score,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            btts:
              "Non disponible",

            over_under:
              pred.under_over ||
              "Non disponible",

            corners:
              "Non disponible",

            yellow_cards:
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

            api_football:
              true,

            recent_form:
              (
                item.homeForm.length > 0 ||
                item.awayForm.length > 0
              ),

            h2h:
              item.faceToFace.length > 0

          },

          analysis

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
            : "Aucun match avec suffisamment de données n'est disponible."

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
        await statistiquesFixture(
          fixture
        );

      res.json({

        success: true,

        fixture,

        statistics:
          data

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
   STATISTIQUES DETAILLEES D'UN MATCH
================================================== */

app.get(
  "/match-details/:fixture",
  async (req, res) => {

    try {

      const fixtureId =
        Number(
          req.params.fixture
        );

      if (!fixtureId) {

        return res.status(400).json({

          success: false,

          error:
            "fixture invalide"

        });

      }

      /*
       * Fixture + score réel.
       */

      const fixtureData =
        await footballApi(
          "/fixtures?id=" +
          fixtureId +
          "&timezone=Africa/Abidjan"
        );

      const fixture =
        fixtureData.response?.[0];

      if (!fixture) {

        return res.status(404).json({

          success: false,

          error:
            "Match introuvable"

        });

      }

      /*
       * Statistiques du match.
       */

      const statistics =
        await statistiquesFixture(
          fixtureId
        );

      const homeId =
        fixture.teams?.home?.id;

      const awayId =
        fixture.teams?.away?.id;

      const homeStats =
        extraireStats(
          statistics,
          homeId
        );

      const awayStats =
        extraireStats(
          statistics,
          awayId
        );

      /*
       * Forme.
       */

      const homeForm =
        await derniersMatchs(
          homeId
        );

      const awayForm =
        await derniersMatchs(
          awayId
        );

      /*
       * H2H.
       */

      const faceToFace =
        await h2h(
          homeId,
          awayId
        );

      const scores =
        scoreReel(
          fixture
        );

      res.json({

        success: true,

        fixture: {

          id:
            fixture.fixture.id,

          status:
            fixture.fixture.status?.short,

          elapsed:
            fixture.fixture.status?.elapsed,

          date:
            fixture.fixture.date,

          halftime_score:
            scores.halftime,

          final_score:
            scores.fulltime,

          home:
            fixture.teams?.home,

          away:
            fixture.teams?.away,

          goals:
            fixture.goals

        },

        statistics: {

          home:
            homeStats,

          away:
            awayStats

        },

        recent_form: {

          home:
            homeForm,

          away:
            awayForm

        },

        h2h:
          faceToFace

      });

    } catch (error) {

      console.error(
        "Erreur match-details:",
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
   DERNIERS MATCHS EQUIPE
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
        await derniersMatchs(
          team
        );

      res.json({

        success: true,

        team,

        matches:
          data

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
       * Maximum 20 fixtures.
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

      const updated =
        history.map(item => {

          const fixture =
            fixtureMap.get(
              Number(
                item.fixture_id
              )
            );

          if (!fixture) {

            return {

              ...item,

              status:
                "EN_ATTENTE",

              halftime_score:
                null,

              final_score:
                null,

              result:
                "EN_ATTENTE"

            };

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

          return {

            ...item,

            status:
              fixture.fixture.status?.short ||
              "NS",

            halftime_score:
              scores.halftime,

            final_score:
              scores.fulltime,

            result

          };

        });

      history =
        updated;

      sauvegarderHistorique();

      const gagne =
        updated.filter(
          x =>
            x.result ===
            "GAGNE"
        ).length;

      const perdu =
        updated.filter(
          x =>
            x.result ===
            "PERDU"
        ).length;

      const attente =
        updated.filter(
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

      updated.sort(
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
          updated.length,

        stats: {

          gagne,

          perdu,

          attente,

          taux_reussite:
            taux

        },

        matches:
          updated

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
   SUPPRIMER L'HISTORIQUE
   Utile pour effacer les anciennes
   prédictions incorrectes.
================================================== */

app.delete(
  "/history",
  (req, res) => {

    history = [];

    sauvegarderHistorique();

    res.json({

      success: true,

      message:
        "Historique supprimé.",

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
      "BOT PREDICTOR actif sur le port " +
      PORT
    );

  }
);
