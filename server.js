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
   CONFIGURATION
================================================== */

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const FOOTBALL_API =
  "https://v3.football.api-sports.io";

const HISTORY_FILE =
  path.join(__dirname, "history.json");

let history = [];


/* ==================================================
   HISTORIQUE
================================================== */

try {
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(
      fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      )
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
      JSON.stringify(
        history,
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      "Erreur historique:",
      error.message
    );
  }
}


/* ==================================================
   API-FOOTBALL
================================================== */

async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(
    FOOTBALL_API + endpoint,
    {
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
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
      "API-Football a renvoyé une réponse non JSON."
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
    Object.keys(data.errors).length
  ) {
    throw new Error(
      Object.values(data.errors).join(" ")
    );
  }

  return data;
}


/* ==================================================
   DATE / HEURE ABIDJAN
================================================== */

function todayAbidjan() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Africa/Abidjan",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(
      new Date()
    );

  const p = {};

  parts.forEach(
    x => {
      p[x.type] = x.value;
    }
  );

  return (
    p.year +
    "-" +
    p.month +
    "-" +
    p.day
  );
}


function timeAbidjan(date) {

  try {
    return new Intl.DateTimeFormat(
      "fr-FR",
      {
        timeZone: "Africa/Abidjan",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(
      new Date(date)
    );
  } catch {
    return "";
  }
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
        error:
          error.message
      });

    }

  }
);


/* ==================================================
   MATCHS
================================================== */

app.get(
  "/matches",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        todayAbidjan();

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

      const data =
        await footballApi(
          "/predictions?fixture=" +
          encodeURIComponent(
            req.params.fixture
          )
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
        todayAbidjan();

      const fixtureData =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );

      let fixtures =
        fixtureData.response || [];


      fixtures =
        fixtures.filter(
          fixture => {

            const status =
              fixture.fixture?.status?.short;

            const finished = [
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
              finished.includes(status) ||
              live.includes(status)
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


      /*
       * Limite volontaire pour éviter
       * de consommer inutilement le quota.
       */

      const candidates =
        fixtures.slice(0, 6);

      const analyses = [];


      for (
        const fixture of candidates
      ) {

        try {

          const data =
            await footballApi(
              "/predictions?fixture=" +
              fixture.fixture.id
            );

          const p =
            data.response?.[0];

          if (!p) {
            continue;
          }


          const percent =
            p.predictions?.percent ||
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


          if (
            confidence <= 0
          ) {
            continue;
          }


          /*
           * Un score exact n'est affiché
           * QUE si l'API fournit réellement
           * deux nombres de buts.
           */

          const goals =
            p.predictions?.goals;

          let exactScore =
            "Non disponible";


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

            exactScore =
              Number(goals.home) +
              "-" +
              Number(goals.away);

          }


          analyses.push({
            fixture,
            prediction: p,
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
            fixture.fixture.id,
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
        const item of selected
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
              timeAbidjan(
                f.fixture.date
              ),

            league:
              f.league?.name ||
              "",

            country:
              f.league?.country ||
              "",

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
              item.home.toFixed(0) +
              "%",

            draw:
              item.draw.toFixed(0) +
              "%",

            away:
              item.away.toFixed(0) +
              "%",

            goals:
              item.exactScore,

            under_over:
              p.predictions?.under_over ||
              "Non disponible",

            advice:
              p.predictions?.advice ||
              "Non disponible",

            btts:
              p.predictions?.btts ||
              "Non disponible",

            over_under:
              p.predictions?.under_over ||
              "Non disponible",

            corners:
              p.predictions?.corners ||
              "Non disponible",

            yellow_cards:
              p.predictions?.yellow_cards ||
              "Non disponible",

            half_time_score:
              "Non disponible",

            full_time_score:
              item.exactScore

          },


          consensus: {

            confidence:
              item.confidence.toFixed(0) +
              "%",

            score:
              item.exactScore

          },


          sources: {

            api_football: true,
            recent_form: false,
            h2h: false

          },


          analysis:
            "Analyse basée sur les données disponibles dans API-Football. " +
            "1 = " +
            item.home.toFixed(0) +
            "%, N = " +
            item.draw.toFixed(0) +
            "%, 2 = " +
            item.away.toFixed(0) +
            "%. " +
            "Pronostic principal : " +
            item.pick +
            ". " +
            "Les valeurs Over/Under ne sont jamais utilisées comme score exact."

        });


        /*
         * Historique.
         */

        const exists =
          history.some(
            h =>
              h.fixture_id ===
              f.fixture.id
          );


        if (!exists) {

          history.push({

            fixture_id:
              f.fixture.id,

            created_at:
              new Date().toISOString(),

            date:
              f.fixture.date,

            league:
              f.league?.name ||
              "",

            country:
              f.league?.country ||
              "",

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

          saveHistory();

        }

      }


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
          matches.length
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
   FORME RÉCENTE
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
   HISTORIQUE / STATISTIQUES
================================================== */

app.get(
  "/history",
  async (req, res) => {

    try {

      let gagne = 0;
      let perdu = 0;
      let attente = 0;


      /*
       * Pas de paramètre "ids" :
       * ton plan API-Football Free
       * ne l'autorise pas.
       */

      for (
        const item of history.slice(-10)
      ) {

        try {

          const data =
            await footballApi(
              "/fixtures?id=" +
              encodeURIComponent(
                item.fixture_id
              )
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


          let result =
            "PERDU";


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


          item.result =
            result;

          item.final_score =
            home +
            "-" +
            away;


          if (
            result === "GAGNE"
          ) {

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
              (
                gagne /
                finished
              ) * 100
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


/* ==================================================
   FIFA VIRTUEL 1XBET
   AVEC TENTATIVE PLAYWRIGHT
================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    const url =
      "https://1xbet.com/fr/live/fifa";


    /*
     * Première tentative :
     * navigateur Playwright.
     */

    try {

      let chromium;

      try {

        chromium =
          require(
            "playwright"
          ).chromium;

      } catch {

        chromium = null;

      }


      if (chromium) {

        const browser =
          await chromium.launch({
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox"
            ]
          });


        const page =
          await browser.newPage({
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
            locale: "fr-FR"
          });


        await page.goto(
          url,
          {
            waitUntil:
              "domcontentloaded",
            timeout:
              30000
          }
        );


        await page.waitForTimeout(
          5000
        );


        const pageText =
          await page.locator(
            "body"
          ).innerText();


        /*
         * Recherche de lignes FIFA.
         */

        const lines =
          pageText
            .split("\n")
            .map(
              x =>
                x.trim()
            )
            .filter(Boolean);


        const fifaLines =
          lines.filter(
            line => {

              const x =
                line.toLowerCase();

              return (
                x.includes("fc 24") ||
                x.includes("fc 25") ||
                x.includes("fc 26") ||
                x.includes("fifa") ||
                x.includes("virtual")
              );

            }
          );


        await browser.close();


        return res.json({

          success: true,

          source:
            "1xBet FIFA",

          method:
            "Playwright",

          fifa_found:
            fifaLines.length > 0,

          events:
            fifaLines.slice(
              0,
              100
            ),

          total:
            fifaLines.length,

          message:
            fifaLines.length
              ? "Éléments FIFA récupérés."
              : "La page est accessible mais aucun élément FIFA n'a été exposé au navigateur."

        });

      }

    } catch (error) {

      console.log(
        "Playwright FIFA:",
        error.message
      );

    }


    /*
     * Deuxième tentative :
     * récupération HTML classique.
     */

    try {

      const response =
        await fetch(
          url,
          {
            headers: {

              "User-Agent":
                "Mozilla/5.0",

              "Accept":
                "text/html,application/xhtml+xml"

            }
          }
        );


      const html =
        await response.text();


      if (!response.ok) {

        return res.status(502).json({

          success: false,

          source:
            "1xBet FIFA",

          error:
            "1xBet HTTP " +
            response.status

        });

      }


      const detected = [];


      const regex =
        /FC\s*(?:24|25|26)|FIFA|Virtual Football/gi;


      const found =
        html.match(
          regex
        ) || [];


      for (
        const value of found
      ) {

        const clean =
          value
            .replace(
              /\s+/g,
              " "
            )
            .trim();


        if (
          !detected.includes(
            clean
          )
        ) {

          detected.push(
            clean
          );

        }

      }


      res.json({

        success: true,

        source:
          url,

        method:
          "HTML",

        fifa_found:
          detected.length > 0,

        events:
          detected,

        total:
          detected.length,

        javascript_required:
          detected.length === 0,

        message:
          detected.length
            ? "Éléments FIFA détectés."
            : "1xBet nécessite probablement l'exécution JavaScript pour afficher les événements."

      });


    } catch (error) {

      res.status(500).json({

        success: false,

        source:
          "1xBet FIFA",

        error:
          error.message

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
