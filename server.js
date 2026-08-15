const express = require("express");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

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
   UTILITAIRES
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

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function textContainsFifa(value) {
  const text =
    String(value || "").toLowerCase();

  return (
    text.includes("fifa") ||
    text.includes("fc 24") ||
    text.includes("fc 25") ||
    text.includes("fc 26") ||
    text.includes("esports football") ||
    text.includes("virtual football") ||
    text.includes("e-football") ||
    text.includes("rush")
  );
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
   ROUTE RACINE
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
   MATCHS API-FOOTBALL
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
   TEAM STATISTICS
===================================================== */

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
          `/fixtures?team=${encodeURIComponent(
            team
          )}&last=5`
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

/* =====================================================
   H2H
===================================================== */

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
          `/fixtures/headtohead?h2h=${encodeURIComponent(
            teams
          )}&last=5`
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

/* =====================================================
   CLASSEMENT
===================================================== */

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
            "league et season requis"
        });
      }

      const data =
        await footballApi(
          `/standings?league=${encodeURIComponent(
            league
          )}&season=${encodeURIComponent(
            season
          )}`
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

/* =====================================================
   HISTORIQUE
===================================================== */

app.get(
  "/history",
  async (req, res) => {
    try {
      let gagne = 0;
      let perdu = 0;
      let attente = 0;

      for (
        const item
        of history.slice(-10)
      ) {
        try {
          const data =
            await footballApi(
              `/fixtures?id=${encodeURIComponent(
                item.fixture_id
              )}`
            );

          const fixture =
            data.response?.[0];

          if (!fixture) {
            attente++;
            continue;
          }

          const status =
            fixture.fixture?.status?.short;

          if (
            ![
              "FT",
              "AET",
              "PEN"
            ].includes(status)
          ) {
            attente++;
            continue;
          }

          const home =
            fixture.goals?.home;

          const away =
            fixture.goals?.away;

          if (
            home === null ||
            away === null ||
            home === undefined ||
            away === undefined
          ) {
            attente++;
            continue;
          }

          let result = "PERDU";

          if (
            item.selection?.type === "1" &&
            home > away
          ) {
            result = "GAGNE";
          } else if (
            item.selection?.type === "2" &&
            away > home
          ) {
            result = "GAGNE";
          } else if (
            item.selection?.type === "N" &&
            home === away
          ) {
            result = "GAGNE";
          }

          item.result = result;

          item.final_score =
            `${home}-${away}`;

          if (result === "GAGNE") {
            gagne++;
          } else {
            perdu++;
          }

        } catch {
          attente++;
        }
      }

      saveHistory();

      const finished =
        gagne + perdu;

      const taux =
        finished
          ? Math.round(
              (gagne / finished) * 100
            )
          : 0;

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
      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   1XBET LIVEFEED
   RÉCUPÉRATION DIRECTE DES DONNÉES
===================================================== */

async function get1xBetJson(
  endpoint,
  params = {}
) {
  const query =
    new URLSearchParams(params);

  const url =
    `${LIVEFEED}${endpoint}?${query.toString()}`;

  const response =
    await fetch(
      url,
      {
        headers: {
          "Accept":
            "application/json,text/plain,*/*",

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",

          "Referer":
            FIFA_PAGE
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Réponse non JSON depuis ${endpoint}`
    );
  }

  return {
    url,
    status:
      response.status,
    data
  };
}

/* =====================================================
   FIFA DIRECT LIVEFEED
===================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    const diagnostics = [];

    try {

      /*
       * 1) Récupérer les sports disponibles.
       * Le dépôt fourni utilise GetSportsShortZip
       * pour cette étape.
       */

      let sportsResult;

      try {

        sportsResult =
          await get1xBetJson(
            "GetSportsShortZip",
            {
              sports: "0",
              lng: "fr",
              tf: "1000000",
              country: "1"
            }
          );

        diagnostics.push({
          endpoint:
            "GetSportsShortZip",
          success:
            true,
          http:
            sportsResult.status
        });

      } catch (error) {

        diagnostics.push({
          endpoint:
            "GetSportsShortZip",
          success:
            false,
          error:
            error.message
        });

      }


      /*
       * 2) Récupérer le flux football live.
       *
       * On teste plusieurs variantes car
       * l'infrastructure 1xBet peut varier
       * selon le domaine/région.
       */

      const requests = [

        {
          endpoint:
            "Get1x2_Zip",

          params: {
            getEmpty:
              "true",
            count:
              "500",
            lng:
              "fr",
            sports:
              "1",
            mode:
              "4",
            country:
              "1"
          }

        },

        {
          endpoint:
            "Get1x2_Zip",

          params: {
            getEmpty:
              "true",
            count:
              "500",
            lng:
              "fr",
            sports:
              "1",
            mode:
              "4",
            country:
              "1",
            virtualSports:
              "true"
          }

        },

        {
          endpoint:
            "Get1x2_VZip",

          params: {
            getEmpty:
              "true",
            count:
              "500",
            lng:
              "fr",
            sports:
              "1",
            mode:
              "4",
            country:
              "1",
            virtualSports:
              "true"
          }

        }

      ];


      let liveData = null;
      let liveSource = null;


      for (
        const request
        of requests
      ) {

        try {

          const result =
            await get1xBetJson(
              request.endpoint,
              request.params
            );


          const value =
            result.data?.Value;


          diagnostics.push({

            endpoint:
              request.endpoint,

            params:
              request.params,

            http:
              result.status,

            hasValue:
              Boolean(value),

            valueType:
              Array.isArray(value)
                ? "array"
                : typeof value

          });


          if (
            value &&
            (
              Array.isArray(value) ||
              typeof value ===
                "object"
            )
          ) {

            liveData =
              result.data;

            liveSource =
              result.url;

            break;

          }

        } catch (error) {

          diagnostics.push({

            endpoint:
              request.endpoint,

            success:
              false,

            error:
              error.message

          });

        }

      }


      if (!liveData) {

        return res.json({

          success:
            false,

          source:
            LIVEFEED,

          fifa_found:
            false,

          events: [],

          total:
            0,

          diagnostics,

          message:
            "Le LiveFeed 1xBet n'a pas retourné de données exploitables."

        });

      }


      /*
       * 3) Transformer Value en tableau.
       */

      const value =
        liveData.Value;


      let rawEvents = [];


      if (
        Array.isArray(value)
      ) {

        rawEvents =
          value;

      } else if (
        value &&
        Array.isArray(
          value.G
        )
      ) {

        rawEvents =
          value.G;

      } else if (
        value &&
        typeof value ===
          "object"
      ) {

        rawEvents =
          Object.values(
            value
          );

      }


      /*
       * 4) Garder les événements qui semblent
       * correspondre au football virtuel/FIFA.
       */

      const events = [];


      for (
        const item
        of rawEvents
      ) {

        const serialized =
          safeJson(item);


        const league =
          item.L ||
          item.LE ||
          item.LN ||
          item.N ||
          "";

        const sport =
          item.SN ||
          item.SportName ||
          "";

        const team1 =
          item.O1 ||
          item.O1N ||
          item.Team1 ||
          item.HomeTeam ||
          "";

        const team2 =
          item.O2 ||
          item.O2N ||
          item.Team2 ||
          item.AwayTeam ||
          "";

        const gameId =
          item.I ||
          item.Id ||
          item.ID ||
          null;

        const start =
          item.S ||
          item.ST ||
          item.StartTime ||
          null;

        const score1 =
          item.SC?.FS?.S1 ??
          item.SC?.S1 ??
          item.S1 ??
          null;

        const score2 =
          item.SC?.FS?.S2 ??
          item.SC?.S2 ??
          item.S2 ??
          null;


        /*
         * FIFA/virtual peut être identifié
         * dans plusieurs champs.
         */

        const isFifa =
          textContainsFifa(
            `${serialized} ${league} ${sport} ${team1} ${team2}`
          );


        /*
         * Certains flux utilisent des noms
         * de ligues codés. On conserve aussi
         * les événements où O1/O2 sont présents
         * lorsque virtualSports=true a répondu.
         */

        if (
          !isFifa &&
          (!team1 || !team2)
        ) {
          continue;
        }


        events.push({

          id:
            gameId,

          competition:
            league,

          sport:
            sport,

          home:
            team1,

          away:
            team2,

          start:
            start,

          score:
            score1 !== null ||
            score2 !== null
              ? {
                  home:
                    score1,
                  away:
                    score2
                }
              : null,

          raw:
            item

        });

      }


      /*
       * Supprimer les doublons.
       */

      const uniqueEvents =
        events.filter(
          (event, index, array) =>
            index ===
            array.findIndex(
              other =>
                String(
                  other.id
                ) ===
                String(
                  event.id
                )
            )
        );


      res.json({

        success:
          true,

        source:
          liveSource,

        method:
          "1xBet LiveFeed",

        fifa_found:
          uniqueEvents.length >
          0,

        events:
          uniqueEvents,

        total:
          uniqueEvents.length,

        diagnostics,

        message:
          uniqueEvents.length
            ? "Événements récupérés depuis le LiveFeed 1xBet."
            : "Le LiveFeed répond mais aucun événement FIFA/football virtuel identifiable n'a été trouvé."

      });


    } catch (error) {

      console.error(
        "1xBet FIFA:",
        error
      );

      res.status(500).json({

        success:
          false,

        source:
          LIVEFEED,

        method:
          "1xBet LiveFeed",

        fifa_found:
          false,

        events: [],

        total:
          0,

        diagnostics,

        error:
          error.message

      });

    }

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
      "FIFA endpoint: /virtual-fifa"
    );

  }
);
