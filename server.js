const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const API_URL = "https://v3.football.api-sports.io";

/* =========================================================
   OUTILS
========================================================= */

function apiHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value)
      .replace("%", "")
      .replace(",", ".")
      .trim()
  );

  return Number.isFinite(n) ? n : null;
}

function percentage(value) {
  const n = toNumber(value);

  if (n === null) return null;

  return Math.round(n);
}

function showPercentage(value) {
  const n = percentage(value);

  return n === null
    ? "Non disponible"
    : `${n}%`;
}

function text(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Non disponible";
  }

  return String(value);
}

/*
 * Vérifie qu'une valeur peut réellement représenter
 * un nombre de buts.
 *
 * Exemples acceptés :
 * 0
 * 1
 * 2
 * 3
 * "2"
 *
 * Exemples refusés :
 * -3.5
 * +1.5
 * "Over 2.5"
 * "Under 3.5"
 */
function validGoalValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return false;
  }

  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n >= 0 &&
    Number.isInteger(n)
  );
}

/*
 * Construit le score uniquement lorsque
 * les deux valeurs sont réellement des buts.
 */
function getPredictedScore(goals) {
  if (!goals) {
    return "Non disponible";
  }

  const home = goals.home;
  const away = goals.away;

  if (
    !validGoalValue(home) ||
    !validGoalValue(away)
  ) {
    return "Non disponible";
  }

  return `${Number(home)}-${Number(away)}`;
}

/* =========================================================
   API-FOOTBALL
========================================================= */

async function football(endpoint) {
  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY n'est pas configurée dans Render."
    );
  }

  const response = await fetch(
    `${API_URL}${endpoint}`,
    {
      method: "GET",
      headers: apiHeaders()
    }
  );

  const body = await response.text();

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Réponse API-Football non JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      `API-Football HTTP ${response.status}`
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

/* =========================================================
   RACINE
========================================================= */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif",
    timezone: "Africa/Abidjan"
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "BOT PREDICTOR",
    api_configured: Boolean(API_KEY),
    timezone: "Africa/Abidjan"
  });
});

/* =========================================================
   TEST API
========================================================= */

app.get("/api-test", async (req, res) => {
  try {
    const data = await football("/status");

    res.json({
      success: true,
      message: "Connexion API-Football OK",
      results: data.results || 0,
      response: data.response || null
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   MATCHS
========================================================= */

app.get("/matches", async (req, res) => {
  try {
    const date =
      req.query.date ||
      new Date().toISOString().slice(0, 10);

    const data = await football(
      `/fixtures?date=${encodeURIComponent(
        date
      )}&timezone=Africa/Abidjan`
    );

    res.json({
      success: true,
      date,
      total: Array.isArray(data.response)
        ? data.response.length
        : 0,
      matches: data.response || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   CONSTRUCTION PRÉDICTION
========================================================= */

function buildPrediction(
  fixture,
  item
) {
  const predictions =
    item?.predictions || {};

  const percent =
    predictions.percent || {};

  const v1 =
    percentage(percent.home);

  const draw =
    percentage(percent.draw);

  const v2 =
    percentage(percent.away);

  const oneX =
    v1 !== null &&
    draw !== null
      ? v1 + draw
      : null;

  const xTwo =
    draw !== null &&
    v2 !== null
      ? draw + v2
      : null;

  let mainPick =
    "Non disponible";

  let confidence = null;

  if (
    v1 !== null &&
    draw !== null &&
    v2 !== null
  ) {
    if (
      v1 >= draw &&
      v1 >= v2
    ) {
      mainPick =
        `Victoire ${fixture.teams.home.name}`;

      confidence = v1;

    } else if (
      v2 >= v1 &&
      v2 >= draw
    ) {
      mainPick =
        `Victoire ${fixture.teams.away.name}`;

      confidence = v2;

    } else {
      mainPick = "Match nul";
      confidence = draw;
    }
  }

  /*
   * CORRECTION PRINCIPALE :
   * on n'utilise plus directement
   * goals.home + goals.away.
   */
  const predictedScore =
    getPredictedScore(
      predictions.goals
    );

  /*
   * Under/Over est affiché comme
   * marché séparé.
   */
  let underOver =
    "Non disponible";

  if (
    predictions.under_over !== null &&
    predictions.under_over !== undefined &&
    predictions.under_over !== ""
  ) {
    underOver =
      String(
        predictions.under_over
      );
  }

  /*
   * Winner officiel.
   */
  const apiWinner =
    predictions.winner?.name ||
    "Non disponible";

  /*
   * Win or draw.
   */
  let winOrDraw =
    "Non disponible";

  if (
    predictions.win_or_draw === true
  ) {
    winOrDraw = "Oui";
  }

  if (
    predictions.win_or_draw === false
  ) {
    winOrDraw = "Non";
  }

  /*
   * BTTS.
   */
  const btts =
    predictions.btts !== null &&
    predictions.btts !== undefined &&
    predictions.btts !== ""
      ? String(predictions.btts)
      : "Non disponible";

  /*
   * Conseil API.
   */
  const advice =
    predictions.advice ||
    "Non disponible";

  return {

    main_pick:
      mainPick,

    confidence:
      confidence === null
        ? "Non disponible"
        : `${confidence}%`,

    probabilities: {

      v1:
        showPercentage(v1),

      draw:
        showPercentage(draw),

      v2:
        showPercentage(v2),

      "1x":
        oneX === null
          ? "Non disponible"
          : `${oneX}%`,

      "x2":
        xTwo === null
          ? "Non disponible"
          : `${xTwo}%`
    },

    /*
     * Vrai score uniquement.
     */
    predicted_score:
      predictedScore,

    /*
     * Marché Under/Over séparé.
     */
    under_over:
      underOver,

    api_winner:
      apiWinner,

    win_or_draw:
      winOrDraw,

    btts:
      btts,

    advice:
      advice,

    /*
     * Ces données ne sont pas inventées.
     */
    halftime_score:
      "Non disponible",

    exact_score_probability:
      "Non disponible",

    corners:
      "Non disponible",

    yellow_cards:
      "Non disponible"
  };
}

/* =========================================================
   PRÉDICTION D'UN MATCH
========================================================= */

app.get(
  "/prediction/:fixture",
  async (req, res) => {

    try {

      const fixtureId =
        req.params.fixture;

      const data =
        await football(
          `/predictions?fixture=${encodeURIComponent(
            fixtureId
          )}`
        );

      const item =
        data.response?.[0];

      if (!item) {

        return res.json({
          success: true,
          available: false,
          fixture_id:
            fixtureId,
          message:
            "Aucune prédiction disponible."
        });
      }

      /*
       * On récupère le vrai match.
       */
      let fixture =
        item.fixture || null;

      let teams =
        item.teams || null;

      /*
       * Si nécessaire, récupération
       * des équipes via /fixtures.
       */
      if (
        !teams?.home?.name ||
        !teams?.away?.name
      ) {

        try {

          const fixtureData =
            await football(
              `/fixtures?id=${encodeURIComponent(
                fixtureId
              )}`
            );

          const f =
            fixtureData.response?.[0];

          if (f) {
            fixture =
              f.fixture;

            teams =
              f.teams;
          }

        } catch {
          // On conserve les données disponibles.
        }
      }

      if (!teams) {

        return res.json({
          success: false,
          error:
            "Impossible de déterminer les équipes du match."
        });
      }

      const normalizedFixture = {
        fixture,
        teams
      };

      const prediction =
        buildPrediction(
          normalizedFixture,
          item
        );

      res.json({

        success: true,

        available: true,

        match: {

          id:
            fixture?.id ||
            Number(fixtureId),

          date:
            fixture?.date ||
            null,

          home:
            teams.home,

          away:
            teams.away
        },

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

/* =========================================================
   PRÉDICTIONS
========================================================= */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        new Date()
          .toISOString()
          .slice(0, 10);

      const requestedLimit =
        Number(req.query.limit) || 5;

      const limit =
        Math.min(
          Math.max(
            requestedLimit,
            1
          ),
          10
        );

      /*
       * Récupération des matchs.
       */
      const fixtureData =
        await football(
          `/fixtures?date=${encodeURIComponent(
            date
          )}&timezone=Africa/Abidjan`
        );

      let fixtures =
        Array.isArray(
          fixtureData.response
        )
          ? fixtureData.response
          : [];

      /*
       * Matchs pas encore commencés.
       */
      fixtures =
        fixtures.filter(
          fixture => {

            const status =
              fixture.fixture?.status?.short;

            return (
              status === "NS" ||
              status === "TBD"
            );
          }
        );

      /*
       * Tri par heure.
       */
      fixtures.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ) -
          new Date(
            b.fixture.date
          )
      );

      fixtures =
        fixtures.slice(
          0,
          limit
        );

      const matches = [];

      for (
        const fixture
        of fixtures
      ) {

        try {

          const data =
            await football(
              `/predictions?fixture=${fixture.fixture.id}`
            );

          const item =
            data.response?.[0];

          if (!item) {

            matches.push({

              match: {

                id:
                  fixture.fixture.id,

                date:
                  fixture.fixture.date,

                league:
                  fixture.league?.name ||
                  "Non disponible",

                country:
                  fixture.league?.country ||
                  "Non disponible",

                home:
                  fixture.teams.home,

                away:
                  fixture.teams.away
              },

              available:
                false,

              prediction:
                null,

              message:
                "Prédiction non disponible."
            });

            continue;
          }

          const prediction =
            buildPrediction(
              fixture,
              item
            );

          matches.push({

            match: {

              id:
                fixture.fixture.id,

              date:
                fixture.fixture.date,

              league:
                fixture.league?.name ||
                "Non disponible",

              country:
                fixture.league?.country ||
                "Non disponible",

              home:
                fixture.teams.home,

              away:
                fixture.teams.away
            },

            available:
              true,

            prediction
          });

        } catch (error) {

          matches.push({

            match: {

              id:
                fixture.fixture.id,

              date:
                fixture.fixture.date,

              league:
                fixture.league?.name ||
                "Non disponible",

              country:
                fixture.league?.country ||
                "Non disponible",

              home:
                fixture.teams.home,

              away:
                fixture.teams.away
            },

            available:
              false,

            prediction:
              null,

            error:
              error.message
          });
        }
      }

      res.json({

        success:
          true,

        date,

        analyzed:
          fixtures.length,

        predictions:
          matches.filter(
            m => m.available
          ).length,

        matches

      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   H2H
========================================================= */

app.get(
  "/h2h",
  async (req, res) => {

    try {

      const home =
        req.query.home;

      const away =
        req.query.away;

      if (!home || !away) {

        return res.status(400).json({
          success: false,
          error:
            "home et away sont obligatoires."
        });
      }

      const data =
        await football(
          `/fixtures/headtohead?h2h=${encodeURIComponent(
            `${home}-${away}`
          )}&last=5`
        );

      res.json({

        success:
          true,

        total:
          data.results || 0,

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

/* =========================================================
   STATISTIQUES
========================================================= */

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
            "fixture obligatoire."
        });
      }

      const data =
        await football(
          `/fixtures/statistics?fixture=${encodeURIComponent(
            fixture
          )}`
        );

      res.json({

        success:
          true,

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

/* =========================================================
   DÉMARRAGE
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `BOT PREDICTOR actif sur le port ${PORT}`
    );

    console.log(
      "API-Football:",
      API_KEY
        ? "CONFIGURÉE"
        : "NON CONFIGURÉE"
    );

    console.log(
      "Timezone: Africa/Abidjan"
    );
  }
);
