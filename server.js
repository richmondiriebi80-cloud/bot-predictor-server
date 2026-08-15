const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

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

/* =========================================================
   CONFIGURATION
========================================================= */

const API_KEY =
  process.env.API_FOOTBALL_KEY || "";

const API_URL =
  "https://v3.football.api-sports.io";

/* =========================================================
   OUTILS
========================================================= */

function apiHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json"
  };
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(
      String(value)
        .replace("%", "")
        .replace(",", ".")
    );

  return Number.isFinite(n) ? n : null;
}

function percent(value) {
  const n = numberOrNull(value);

  if (n === null) {
    return null;
  }

  return Math.round(n);
}

function displayPercent(value) {
  const n = percent(value);

  return n === null
    ? "Non disponible"
    : `${n}%`;
}

function safeText(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Non disponible";
  }

  return String(value);
}

/* =========================================================
   APPEL API-FOOTBALL
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

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API-Football a renvoyé une réponse non JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      `API-Football HTTP ${response.status}`
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
   MATCHS DU JOUR
========================================================= */

app.get("/matches", async (req, res) => {
  try {
    const date =
      req.query.date ||
      new Date()
        .toISOString()
        .slice(0, 10);

    const data = await football(
      `/fixtures?date=${encodeURIComponent(
        date
      )}&timezone=Africa/Abidjan`
    );

    const matches =
      Array.isArray(data.response)
        ? data.response
        : [];

    res.json({
      success: true,
      date,
      total: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   CONSTRUCTION DE LA PRÉDICTION
========================================================= */

function buildPrediction(
  fixture,
  predictionData
) {
  const prediction =
    predictionData?.predictions || {};

  const percentData =
    prediction.percent || {};

  const homeProbability =
    percent(percentData.home);

  const drawProbability =
    percent(percentData.draw);

  const awayProbability =
    percent(percentData.away);

  /*
   * 1X = victoire équipe 1 OU nul
   */
  const doubleChance1X =
    homeProbability !== null &&
    drawProbability !== null
      ? homeProbability +
        drawProbability
      : null;

  /*
   * X2 = nul OU victoire équipe 2
   */
  const doubleChanceX2 =
    drawProbability !== null &&
    awayProbability !== null
      ? drawProbability +
        awayProbability
      : null;

  /*
   * Détermination du pronostic principal.
   */
  let mainPick =
    "Non disponible";

  let confidence = null;

  if (
    homeProbability !== null &&
    drawProbability !== null &&
    awayProbability !== null
  ) {
    if (
      homeProbability >=
        drawProbability &&
      homeProbability >=
        awayProbability
    ) {
      mainPick =
        `Victoire ${fixture.teams.home.name}`;

      confidence =
        homeProbability;
    } else if (
      awayProbability >=
        homeProbability &&
      awayProbability >=
        drawProbability
    ) {
      mainPick =
        `Victoire ${fixture.teams.away.name}`;

      confidence =
        awayProbability;
    } else {
      mainPick = "Match nul";
      confidence =
        drawProbability;
    }
  }

  /*
   * Score prévisionnel.
   *
   * IMPORTANT :
   * on ne fabrique jamais un score.
   */
  let predictedScore =
    "Non disponible";

  const goals =
    prediction.goals || {};

  if (
    goals.home !== null &&
    goals.home !== undefined &&
    goals.away !== null &&
    goals.away !== undefined
  ) {
    predictedScore =
      `${goals.home}-${goals.away}`;
  }

  /*
   * Winner fourni directement par API-Football.
   */
  let apiWinner =
    "Non disponible";

  if (prediction.winner) {
    apiWinner =
      prediction.winner.name ||
      "Non disponible";
  }

  /*
   * Win or draw.
   */
  const winOrDraw =
    prediction.win_or_draw === true
      ? "Oui"
      : prediction.win_or_draw === false
        ? "Non"
        : "Non disponible";

  /*
   * Under / Over.
   */
  const underOver =
    prediction.under_over ||
    null;

  /*
   * BTTS si réellement fourni.
   */
  let btts =
    "Non disponible";

  if (
    prediction.btts !== null &&
    prediction.btts !== undefined &&
    prediction.btts !== ""
  ) {
    btts =
      safeText(prediction.btts);
  }

  /*
   * Conseil officiel API-Football.
   */
  const advice =
    safeText(prediction.advice);

  return {
    main_pick: mainPick,

    confidence:
      confidence === null
        ? "Non disponible"
        : `${confidence}%`,

    probabilities: {
      v1:
        displayPercent(
          homeProbability
        ),

      draw:
        displayPercent(
          drawProbability
        ),

      v2:
        displayPercent(
          awayProbability
        ),

      "1x":
        doubleChance1X === null
          ? "Non disponible"
          : `${doubleChance1X}%`,

      "x2":
        doubleChanceX2 === null
          ? "Non disponible"
          : `${doubleChanceX2}%`
    },

    predicted_score:
      predictedScore,

    api_winner:
      apiWinner,

    win_or_draw:
      winOrDraw,

    under_over:
      underOver
        ? safeText(underOver)
        : "Non disponible",

    btts,

    advice,

    /*
     * Ces éléments ne sont PAS inventés.
     * Ils restent indisponibles lorsque
     * l'API ne les fournit pas.
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

      if (!fixtureId) {
        return res.status(400).json({
          success: false,
          error: "Fixture ID manquant."
        });
      }

      /*
       * UNE SEULE requête prediction
       * pour ce match.
       */
      const data =
        await football(
          `/predictions?fixture=${encodeURIComponent(
            fixtureId
          )}`
        );

      if (
        !Array.isArray(data.response) ||
        !data.response[0]
      ) {
        return res.json({
          success: true,
          available: false,
          fixture_id:
            fixtureId,
          message:
            "Aucune prédiction API-Football disponible pour ce match."
        });
      }

      const item =
        data.response[0];

      /*
       * On récupère les informations
       * du match.
       */
      const fixture =
        item.fixture;

      /*
       * Selon les réponses API,
       * teams peut être présent dans
       * la prédiction.
       */
      const predictionFixture =
        item.fixture || {};

      const teams =
        item.teams || {};

      const normalizedFixture = {
        fixture: {
          id:
            fixture?.id ||
            Number(fixtureId),

          date:
            fixture?.date ||
            null
        },

        teams: {
          home: {
            id:
              teams.home?.id ||
              null,

            name:
              teams.home?.name ||
              "Équipe 1",

            logo:
              teams.home?.logo ||
              null
          },

          away: {
            id:
              teams.away?.id ||
              null,

            name:
              teams.away?.name ||
              "Équipe 2",

            logo:
              teams.away?.logo ||
              null
          }
        }
      };

      /*
       * Dans certaines réponses,
       * teams peut ne pas être présent
       * dans predictions.
       *
       * On fait alors une petite
       * requête fixture pour obtenir
       * les vrais noms.
       */
      if (
        !normalizedFixture.teams.home.name ||
        normalizedFixture.teams.home.name ===
          "Équipe 1"
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
            normalizedFixture.fixture =
              f.fixture;

            normalizedFixture.teams =
              f.teams;
          }
        } catch {
          /*
           * La prédiction reste utilisable
           * même si cette requête échoue.
           */
        }
      }

      const result =
        buildPrediction(
          normalizedFixture,
          item
        );

      res.json({
        success: true,
        available: true,

        match: {
          id:
            normalizedFixture.fixture.id,

          date:
            normalizedFixture.fixture.date,

          home:
            normalizedFixture.teams.home,

          away:
            normalizedFixture.teams.away
        },

        prediction:
          result,

        raw_available_fields: {
          predictions:
            Object.keys(
              item.predictions || {}
            )
        }
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
   PRÉDICTIONS DES MATCHS À VENIR
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

      /*
       * Limite volontaire pour éviter
       * de consommer inutilement les
       * appels API.
       */
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
       * 1 appel pour les matchs.
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
       * Seulement les matchs
       * non commencés.
       */
      fixtures =
        fixtures.filter(
          item => {
            const status =
              item.fixture?.status?.short;

            return [
              "NS",
              "TBD"
            ].includes(status);
          }
        );

      /*
       * Ordre chronologique.
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

      /*
       * On limite avant les appels
       * /predictions.
       */
      fixtures =
        fixtures.slice(
          0,
          limit
        );

      const matches = [];

      /*
       * Une requête prediction
       * par match sélectionné.
       */
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

              prediction: null,

              available: false,

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

            prediction,

            available: true
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

            prediction: null,

            available: false,

            error:
              error.message
          });
        }
      }

      res.json({
        success: true,
        date,
        analyzed:
          fixtures.length,
        predictions:
          matches.filter(
            x => x.available
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
   H2H - 5 DERNIERS MATCHS
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
        success: true,
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
   STATISTIQUES D'UN MATCH
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
