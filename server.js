const express = require("express");
const fs = require("fs");
const path = require("path");

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

/* =====================================================
   CONFIGURATION
===================================================== */

const API_FOOTBALL_KEY =
  process.env.API_FOOTBALL_KEY || "";

const FOOTBALL_API =
  "https://v3.football.api-sports.io";

const XBET =
  "https://1xbet.com";

const LIVEFEED =
  `${XBET}/LiveFeed/`;

const FIFA_PAGE =
  `${XBET}/fr/live/fifa`;

const HISTORY_FILE =
  path.join(__dirname, "history.json");

let history = [];

try {
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(
      fs.readFileSync(HISTORY_FILE, "utf8")
    );

    if (!Array.isArray(history)) {
      history = [];
    }
  }
} catch {
  history = [];
}

function saveHistory() {
  try {
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(history, null, 2)
    );
  } catch (error) {
    console.log(
      "Erreur historique:",
      error.message
    );
  }
}

/* =====================================================
   OUTILS
===================================================== */

function getAbidjanDate() {
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

  const result = {};

  for (const part of parts) {
    result[part.type] = part.value;
  }

  return `${result.year}-${result.month}-${result.day}`;
}

function getAbidjanTime(date) {
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

function safeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* =====================================================
   API-FOOTBALL
===================================================== */

async function footballApi(endpoint) {
  if (!API_FOOTBALL_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY non configurée."
    );
  }

  const response =
    await fetch(
      FOOTBALL_API + endpoint,
      {
        headers: {
          "x-apisports-key":
            API_FOOTBALL_KEY,
          "Accept":
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse API-Football non JSON."
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

/* =====================================================
   RACINE
===================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif",
    timezone: "Africa/Abidjan"
  });
});

/* =====================================================
   HEALTH
===================================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "BOT PREDICTOR",
    api_configured:
      Boolean(API_FOOTBALL_KEY),
    history_records:
      history.length,
    timezone:
      "Africa/Abidjan"
  });
});

/* =====================================================
   TEST API-FOOTBALL
===================================================== */

app.get(
  "/api-test",
  async (req, res) => {
    try {
      const data =
        await footballApi("/status");

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
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   MATCHS
===================================================== */

app.get(
  "/matches",
  async (req, res) => {
    try {
      const date =
        req.query.date ||
        getAbidjanDate();

      const data =
        await footballApi(
          `/fixtures?date=${encodeURIComponent(
            date
          )}&timezone=Africa/Abidjan`
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

/* =====================================================
   PRÉDICTION
===================================================== */

app.get(
  "/prediction/:fixture",
  async (req, res) => {
    try {
      const data =
        await footballApi(
          `/predictions?fixture=${encodeURIComponent(
            req.params.fixture
          )}`
        );

      res.json({
        success: true,
        prediction:
          data.response?.[0] || null
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

/* =====================================================
   PRÉDICTIONS
===================================================== */

app.get(
  "/predictions",
  async (req, res) => {
    try {
      const date =
        req.query.date ||
        getAbidjanDate();

      const fixtureData =
        await footballApi(
          `/fixtures?date=${encodeURIComponent(
            date
          )}&timezone=Africa/Abidjan`
        );

      let fixtures =
        fixtureData.response || [];

      fixtures =
        fixtures.filter(
          fixture => {
            const status =
              fixture.fixture?.status?.short;

            const excluded = [
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
            ];

            if (
              excluded.includes(status)
            ) {
              return false;
            }

            return (
              new Date(
                fixture.fixture.date
              ) > new Date()
            );
          }
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

      const candidates =
        fixtures.slice(0, 6);

      const analyses = [];

      for (
        const fixture
        of candidates
      ) {
        try {
          const data =
            await footballApi(
              `/predictions?fixture=${fixture.fixture.id}`
            );

          const prediction =
            data.response?.[0];

          if (!prediction) {
            continue;
          }

          const percent =
            prediction.predictions?.percent ||
            {};

          const home =
            parseFloat(
              String(
                percent.home || "0"
              ).replace("%", "")
            ) || 0;

          const draw =
            parseFloat(
              String(
                percent.draw || "0"
              ).replace("%", "")
            ) || 0;

          const away =
            parseFloat(
              String(
                percent.away || "0"
              ).replace("%", "")
            ) || 0;

          let type = "N";
          let confidence = draw;
          let pick = "Match nul";

          if (
            home >= draw &&
            home >= away
          ) {
            type = "1";
            confidence = home;
            pick =
              "Victoire " +
              fixture.teams.home.name;
          } else if (
            away >= home &&
            away >= draw
          ) {
            type = "2";
            confidence = away;
            pick =
              "Victoire " +
              fixture.teams.away.name;
          }

          const goals =
            prediction.predictions?.goals;

          let exactScore =
            "Non disponible";

          if (
            goals &&
            Number.isFinite(
              Number(goals.home)
            ) &&
            Number.isFinite(
              Number(goals.away)
            )
          ) {
            exactScore =
              `${Number(goals.home)}-${Number(
                goals.away
              )}`;
          }

          analyses.push({
            fixture,
            prediction,
            type,
            pick,
            confidence,
            home,
            draw,
            away,
            exactScore
          });

        } catch (error) {
          console.log(
            "Prediction indisponible:",
            error.message
          );
        }
      }

      analyses.sort(
        (a, b) =>
          b.confidence -
          a.confidence
      );

      const selected =
        analyses
          .filter(
            x =>
              x.confidence >= 45
          )
          .slice(0, 2);

      const matches = [];

      for (
        const item
        of selected
      ) {
        const f =
          item.fixture;

        const p =
          item.prediction;

        matches.push({
          match: {
            id:
              f.fixture.id,
            date:
              f.fixture.date,
            time:
              getAbidjanTime(
                f.fixture.date
              ),
            league:
              f.league?.name || "",
            country:
              f.league?.country || "",
            home: {
              id:
                f.teams.home.id,
              name:
                f.teams.home.name,
              logo:
                f.teams.home.logo
            },
            away: {
              id:
                f.teams.away.id,
              name:
                f.teams.away.name,
              logo:
                f.teams.away.logo
            }
          },

          prediction: {
            main_pick:
              item.pick,
            type:
              item.type,
            home:
              item.home + "%",
            draw:
              item.draw + "%",
            away:
              item.away + "%",
            goals:
              item.exactScore,
            advice:
              p.predictions?.advice ||
              "Non disponible",
            btts:
              p.predictions?.btts ||
              "Non disponible",
            under_over:
              p.predictions?.under_over ||
              "Non disponible",
            full_time_score:
              item.exactScore
          },

          consensus: {
            confidence:
              item.confidence + "%",
            score:
              item.exactScore
          },

          sources: {
            api_football: true,
            recent_form: false,
            h2h: false
          }
        });

        history.push({
          fixture_id:
            f.fixture.id,
          created_at:
            new Date().toISOString(),
          date:
            f.fixture.date,
          league:
            f.league?.name || "",
          home:
            f.teams.home.name,
          away:
            f.teams.away.name,
          selection: {
            type:
              item.type,
            text:
              item.pick,
            confidence:
              item.confidence
          },
          predicted_score:
            item.exactScore,
          result:
            "EN_ATTENTE"
        });
      }

      saveHistory();

      res.json({
        success: true,
        date,
        analyzed_candidates:
          candidates.length,
        analyzed_with_data:
          analyses.length,
        selected:
          matches.length,
        matches,
        message:
          "Analyse terminée."
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

/* =====================================================
   STATISTIQUES
===================================================== */

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
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   HISTORIQUE
===================================================== */

app.get(
  "/history",
  async (req, res) => {
    try {
      res.json({
        success: true,
        total:
          history.length,
        matches:
          history
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

/* =====================================================
   LIVEFEED DIAGNOSTIQUE
===================================================== */

async function requestLiveFeed(
  endpoint,
  params = {}
) {
  const query =
    new URLSearchParams(params);

  const url =
    `${LIVEFEED}${endpoint}?${query.toString()}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      30000
    );

  try {

    const response =
      await fetch(
        url,
        {
          method: "GET",

          redirect: "follow",

          signal:
            controller.signal,

          headers: {

            "Accept":
              "application/json, text/plain, */*",

            "Accept-Language":
              "fr-FR,fr;q=0.9,en;q=0.8",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36",

            "Referer":
              FIFA_PAGE,

            "Origin":
              XBET,

            "Cache-Control":
              "no-cache",

            "Pragma":
              "no-cache"

          }
        }
      );

    const finalUrl =
      response.url;

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    const location =
      response.headers.get(
        "location"
      );

    const text =
      await response.text();

    const preview =
      text
        .slice(0, 1500)
        .replace(
          /\s+/g,
          " "
        );

    let json = null;
    let jsonError = null;

    try {

      json =
        JSON.parse(text);

    } catch (error) {

      jsonError =
        error.message;

    }

    return {

      endpoint,

      requested_url:
        url,

      final_url:
        finalUrl,

      http_status:
        response.status,

      http_ok:
        response.ok,

      content_type:
        contentType,

      location:
        location || null,

      response_length:
        text.length,

      is_json:
        json !== null,

      json_error:
        jsonError,

      response_preview:
        preview,

      json

    };

  } catch (error) {

    return {

      endpoint,

      requested_url:
        url,

      error:
        error.name ===
        "AbortError"
          ? "Timeout après 30 secondes"
          : error.message

    };

  } finally {

    clearTimeout(timeout);

  }
}

/* =====================================================
   TEST LIVEFEED
===================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    const diagnostics = [];

    /*
     * Première requête :
     * sports disponibles.
     */

    diagnostics.push(
      await requestLiveFeed(
        "GetSportsShortZip",
        {
          sports: "0",
          lng: "fr",
          tf: "1000000",
          country: "1"
        }
      )
    );

    /*
     * Deuxième requête :
     * football classique.
     */

    diagnostics.push(
      await requestLiveFeed(
        "Get1x2_Zip",
        {
          getEmpty: "true",
          count: "500",
          lng: "fr",
          sports: "1",
          mode: "4",
          country: "1"
        }
      )
    );

    /*
     * Troisième requête :
     * football virtuel.
     */

    diagnostics.push(
      await requestLiveFeed(
        "Get1x2_Zip",
        {
          getEmpty: "true",
          count: "500",
          lng: "fr",
          sports: "1",
          mode: "4",
          country: "1",
          virtualSports: "true"
        }
      )
    );

    /*
     * Quatrième variante.
     */

    diagnostics.push(
      await requestLiveFeed(
        "Get1x2_VZip",
        {
          getEmpty: "true",
          count: "500",
          lng: "fr",
          sports: "1",
          mode: "4",
          country: "1",
          virtualSports: "true"
        }
      )
    );

    const successfulJson =
      diagnostics.filter(
        x =>
          x.is_json === true
      );

    let events = [];

    for (
      const diagnostic
      of successfulJson
    ) {

      const data =
        diagnostic.json;

      let value =
        data?.Value;

      if (
        Array.isArray(value)
      ) {

        events =
          events.concat(value);

      } else if (
        value &&
        Array.isArray(value.G)
      ) {

        events =
          events.concat(value.G);

      } else if (
        value &&
        typeof value === "object"
      ) {

        events =
          events.concat(
            Object.values(value)
          );

      }

    }

    /*
     * Supprime les doublons.
     */

    const unique =
      events.filter(
        (event, index, array) => {

          const id =
            event?.I ??
            event?.Id ??
            event?.ID ??
            JSON.stringify(event);

          return (
            index ===
            array.findIndex(
              other => {

                const otherId =
                  other?.I ??
                  other?.Id ??
                  other?.ID ??
                  JSON.stringify(other);

                return (
                  String(otherId) ===
                  String(id)
                );

              }
            )
          );

        }
      );

    res.json({

      success:
        successfulJson.length > 0,

      source:
        LIVEFEED,

      fifa_found:
        unique.length > 0,

      events:
        unique.slice(0, 200),

      total:
        unique.length,

      diagnostic_count:
        diagnostics.length,

      json_responses:
        successfulJson.length,

      diagnostics,

      message:
        unique.length > 0
          ? "Données LiveFeed récupérées."
          : "Aucune donnée LiveFeed exploitable. Les diagnostics montrent maintenant exactement la réponse reçue."

    });

  }
);

/* =====================================================
   DÉMARRAGE
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      `BOT PREDICTOR actif sur le port ${PORT}`
    );

    console.log(
      "Timezone: Africa/Abidjan"
    );

    console.log(
      "Route FIFA: /virtual-fifa"
    );

  }
);
