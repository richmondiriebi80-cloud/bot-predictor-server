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
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

/* ==================================================
   API-FOOTBALL
================================================== */

const API_KEY = String(
  process.env.API_FOOTBALL_KEY || ""
).trim();

const API_URL = "https://v3.football.api-sports.io";

/* Appel API sécurisé */
async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(
    API_URL + endpoint,
    {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY
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
      JSON.stringify(data.errors || data)
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

  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Africa/Abidjan",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date());

  const result = {};

  parts.forEach(p => {
    result[p.type] = p.value;
  });

  return (
    result.year +
    "-" +
    result.month +
    "-" +
    result.day
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
      String(value).replace("%", "")
    ) || 0
  );
}

/* ==================================================
   HISTORIQUE
================================================== */

const HISTORY_FILE = path.join(
  __dirname,
  "history.json"
);

let history = [];

function chargerHistorique() {

  try {

    if (fs.existsSync(HISTORY_FILE)) {

      const content =
        fs.readFileSync(
          HISTORY_FILE,
          "utf8"
        );

      const data =
        JSON.parse(content);

      history =
        Array.isArray(data)
          ? data
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
   SELECTION PREDICTION
================================================== */

function meilleurePrediction(prediction) {

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const home = pct(percent.home);
  const draw = pct(percent.draw);
  const away = pct(percent.away);

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
   SCORE REEL
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
      ht.home !== null &&
      ht.home !== undefined &&
      ht.away !== null &&
      ht.away !== undefined
        ? ht.home + "-" + ht.away
        : null,

    fulltime:
      ft.home !== null &&
      ft.home !== undefined &&
      ft.away !== null &&
      ft.away !== undefined
        ? ft.home + "-" + ft.away
        : null
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

  if (selection.type === "1") {
    return home > away
      ? "GAGNE"
      : "PERDU";
  }

  if (selection.type === "2") {
    return away > home
      ? "GAGNE"
      : "PERDU";
  }

  if (selection.type === "N") {
    return home === away
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
    service: "BOT PREDICTOR",
    api_configured: Boolean(API_KEY),
    history_records: history.length,
    timezone: "Africa/Abidjan"
  });

});

/* ==================================================
   TEST API
================================================== */

app.get("/api-test", async (req, res) => {

  try {

    const data =
      await footballApi("/status");

    res.json({
      success: true,
      message: "Connexion API-Football OK",
      results: data.results,
      response: data.response || {}
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: "Connexion API-Football échouée",
      error: error.message
    });
  }

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
      error: error.message
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

      const prediction =
        data.response?.[0] || null;

      res.json({
        success: true,
        prediction
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
   PREDICTIONS
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

      const allMatches =
        fixtures.response || [];

      const matches =
        allMatches.filter(match => {

          const status =
            match.fixture?.status?.short;

          return (
            ![
              "FT",
              "AET",
              "PEN",
              "CANC",
              "ABD",
              "AWD",
              "WO",
              "1H",
              "HT",
              "2H",
              "ET",
              "BT",
              "P",
              "LIVE"
            ].includes(status) &&
            new Date(
              match.fixture.date
            ) > new Date()
          );
        });

      matches.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );

      const candidats =
        matches.slice(0, 6);

      const analyses = [];

      for (const match of candidats) {

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
            match.fixture.id,
            error.message
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

      const result = [];

      for (const item of selected) {

        const m = item.match;
        const p = item.prediction;
        const s = item.selection;

        const pred =
          p.predictions || {};

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
              m.teams?.home?.name || "",
            logo:
              m.teams?.home?.logo || ""
          },

          away: {
            id:
              m.teams?.away?.id,
            name:
              m.teams?.away?.name || "",
            logo:
              m.teams?.away?.logo || ""
          },

          selection: {
            type: s.type,
            text: s.text,
            confidence:
              s.confidence
          },

          predicted_score:
            scorePrevu(p),

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
              scorePrevu(p),

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible"
          },

          consensus: {
            confidence:
              s.confidence.toFixed(0) +
              "%"
          },

          sources: {
            api_football: true
          },

          analysis:
            "Analyse API-Football : " +
            s.text +
            " avec une probabilité de " +
            s.confidence.toFixed(0) +
            "%."
        });
      }

      res.json({

        success: true,

        date,

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

        error:
          error.message
      });
    }
  }
);

/* ==================================================
   STATISTIQUES
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
        fixture,
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
        team,
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
          error: "teams manquant"
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
        league,
        season,
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
            fixture.fixture.id,
            fixture
          );
        }
      );

      const updated =
        history.map(item => {

          const fixture =
            fixtureMap.get(
              item.fixture_id
            );

          if (!fixture) {

            return {
              ...item,
              status: "EN_ATTENTE",
              halftime_score: null,
              final_score: null,
              result: "EN_ATTENTE"
            };
          }

          const scores =
            scoreReel(fixture);

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

      history = updated;

      sauvegarderHistorique();

      const gagne =
        updated.filter(
          x => x.result === "GAGNE"
        ).length;

      const perdu =
        updated.filter(
          x => x.result === "PERDU"
        ).length;

      const attente =
        updated.filter(
          x => x.result === "EN_ATTENTE"
        ).length;

      const termines =
        gagne + perdu;

      const taux =
        termines > 0
          ? Math.round(
              (gagne / termines) * 100
            )
          : 0;

      updated.sort(
        (a, b) =>
          new Date(b.created_at) -
          new Date(a.created_at)
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
   HISTORIQUE D'UN MATCH
================================================== */

app.get(
  "/history/:fixture",
  async (req, res) => {

    try {

      const fixtureId =
        Number(req.params.fixture);

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
          fixtureId
        );

      const fixture =
        data.response?.[0];

      if (fixture) {

        const scores =
          scoreReel(fixture);

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
        match: item
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
