const express = require("express");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

/* =====================================================
   CORS
===================================================== */

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

const FIFA_URL =
  "https://1xbet.com/fr/live/fifa";

const HISTORY_FILE =
  path.join(__dirname, "history.json");

let history = [];


/* =====================================================
   HISTORIQUE
===================================================== */

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

    data =
      JSON.parse(text);

  } catch {

    throw new Error(
      "Réponse API-Football non JSON."
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
      Object.values(
        data.errors
      ).join(" ")
    );

  }


  return data;

}


/* =====================================================
   DATE ABIDJAN
===================================================== */

function getAbidjanDate() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Africa/Abidjan",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    ).formatToParts(
      new Date()
    );


  const result = {};

  for (const part of parts) {
    result[part.type] =
      part.value;
  }


  return (
    result.year +
    "-" +
    result.month +
    "-" +
    result.day
  );

}


function getAbidjanTime(date) {

  try {

    return new Intl.DateTimeFormat(
      "fr-FR",
      {
        timeZone:
          "Africa/Abidjan",

        hour:
          "2-digit",

        minute:
          "2-digit"
      }
    ).format(
      new Date(date)
    );

  } catch {

    return "";

  }

}


/* =====================================================
   RACINE
===================================================== */

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


/* =====================================================
   HEALTH
===================================================== */

app.get("/health", (req, res) => {

  res.json({

    status:
      "online",

    service:
      "BOT PREDICTOR",

    api_configured:
      Boolean(
        API_FOOTBALL_KEY
      ),

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
        await footballApi(
          "/status"
        );


      res.json({

        success:
          true,

        message:
          "Connexion API-Football OK",

        results:
          data.results || 0,

        response:
          data.response || null

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );


      res.json({

        success:
          true,

        date,

        matches:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


/* =====================================================
   PRÉDICTION D'UN MATCH
===================================================== */

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

        success:
          true,

        prediction:
          data.response?.[0] ||
          null

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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
              fixture.fixture
                ?.status
                ?.short;


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
              excluded.includes(
                status
              )
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
        fixtures.slice(
          0,
          6
        );


      const analyses = [];


      for (
        const fixture
        of candidates
      ) {

        try {

          const data =
            await footballApi(
              "/predictions?fixture=" +
              fixture.fixture.id
            );


          const prediction =
            data.response?.[0];


          if (!prediction) {
            continue;
          }


          const percent =
            prediction
              .predictions
              ?.percent ||
            {};


          const home =
            parseFloat(
              String(
                percent.home || "0"
              ).replace(
                "%",
                ""
              )
            ) || 0;


          const draw =
            parseFloat(
              String(
                percent.draw || "0"
              ).replace(
                "%",
                ""
              )
            ) || 0;


          const away =
            parseFloat(
              String(
                percent.away || "0"
              ).replace(
                "%",
                ""
              )
            ) || 0;


          let type = "N";

          let confidence =
            draw;

          let pick =
            "Match nul";


          if (
            home >= draw &&
            home >= away
          ) {

            type = "1";

            confidence =
              home;

            pick =
              "Victoire " +
              fixture
                .teams
                .home
                .name;

          }


          else if (
            away >= home &&
            away >= draw
          ) {

            type = "2";

            confidence =
              away;

            pick =
              "Victoire " +
              fixture
                .teams
                .away
                .name;

          }


          const goals =
            prediction
              .predictions
              ?.goals;


          let exactScore =
            "Non disponible";


          if (
            goals &&
            Number.isFinite(
              Number(
                goals.home
              )
            ) &&
            Number.isFinite(
              Number(
                goals.away
              )
            )
          ) {

            exactScore =
              Number(
                goals.home
              ) +
              "-" +
              Number(
                goals.away
              );

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
          .slice(
            0,
            2
          );


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
              item.home +
              "%",

            draw:
              item.draw +
              "%",

            away:
              item.away +
              "%",

            goals:
              item.exactScore,

            advice:
              p.predictions
                ?.advice ||
              "Non disponible",

            btts:
              p.predictions
                ?.btts ||
              "Non disponible",

            under_over:
              p.predictions
                ?.under_over ||
              "Non disponible",

            full_time_score:
              item.exactScore

          },


          consensus: {

            confidence:
              item.confidence +
              "%",

            score:
              item.exactScore

          },


          sources: {

            api_football:
              true,

            recent_form:
              false,

            h2h:
              false

          }

        });


        history.push({

          fixture_id:
            f.fixture.id,

          created_at:
            new Date()
              .toISOString(),

          date:
            f.fixture.date,

          league:
            f.league?.name ||
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

      }


      saveHistory();


      res.json({

        success:
          true,

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

      console.error(
        "Erreur prédictions:",
        error
      );


      res.status(500).json({

        success:
          false,

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

          success:
            false,

          error:
            "fixture manquant"

        });

      }


      const data =
        await footballApi(
          "/fixtures/statistics?fixture=" +
          encodeURIComponent(
            fixture
          )
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

        success:
          false,

        error:
          error.message

      });

    }

  }
);


/* =====================================================
   FORME ÉQUIPE
===================================================== */

app.get(
  "/team-statistics",
  async (req, res) => {

    try {

      const team =
        req.query.team;


      if (!team) {

        return res.status(400).json({

          success:
            false,

          error:
            "team manquant"

        });

      }


      const data =
        await footballApi(
          "/fixtures?team=" +
          encodeURIComponent(
            team
          ) +
          "&last=5"
        );


      res.json({

        success:
          true,

        team,

        matches:
          data.response || []

      });


    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            false,

          error:
            "teams manquant"

        });

      }


      const data =
        await footballApi(
          "/fixtures/headtohead?h2h=" +
          encodeURIComponent(
            teams
          ) +
          "&last=5"
        );


      res.json({

        success:
          true,

        teams,

        h2h:
          data.response || []

      });


    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            false,

          error:
            "league et season requis"

        });

      }


      const data =
        await footballApi(
          "/standings?league=" +
          encodeURIComponent(
            league
          ) +
          "&season=" +
          encodeURIComponent(
            season
          )
        );


      res.json({

        success:
          true,

        league,

        season,

        standings:
          data.response || []

      });


    } catch (error) {

      res.status(500).json({

        success:
          false,

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
            fixture.fixture
              ?.status
              ?.short;


          if (
            ![
              "FT",
              "AET",
              "PEN"
            ].includes(
              status
            )
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

            result =
              "GAGNE";

          }


          else if (
            item.selection?.type === "2" &&
            away > home
          ) {

            result =
              "GAGNE";

          }


          else if (
            item.selection?.type === "N" &&
            home === away
          ) {

            result =
              "GAGNE";

          }


          item.result =
            result;


          item.final_score =
            home +
            "-" +
            away;


          if (
            result ===
            "GAGNE"
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

        success:
          true,

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

        success:
          false,

        error:
          error.message

      });

    }

  }
);


/* =====================================================
   FIFA VIRTUEL 1XBET
   PLAYWRIGHT / CHROMIUM
===================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    let browser = null;


    try {

      browser =
        await chromium.launch({

          headless:
            true,

          args: [

            "--no-sandbox",

            "--disable-setuid-sandbox",

            "--disable-dev-shm-usage",

            "--disable-gpu",

            "--no-zygote"

          ]

        });


      const context =
        await browser.newContext({

          locale:
            "fr-FR",

          timezoneId:
            "Africa/Abidjan",

          viewport: {

            width:
              1366,

            height:
              900

          },

          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"

        });


      const page =
        await context.newPage();


      /*
       * Bloque uniquement certaines ressources
       * lourdes. On laisse JavaScript fonctionner.
       */

      await page.route(
        "**/*",
        async route => {

          const type =
            route.request()
              .resourceType();


          if (
            [
              "image",
              "font"
            ].includes(
              type
            )
          ) {

            await route.abort();

          } else {

            await route.continue();

          }

        }
      );


      /*
       * Capture les réponses JSON.
       * C'est important car certains sites
       * chargent les événements via API après
       * l'ouverture de la page.
       */

      const apiResponses = [];


      page.on(
        "response",
        async response => {

          try {

            const contentType =
              response
                .headers()
                ["content-type"] ||
              "";


            const responseUrl =
              response.url();


            if (
              contentType
                .toLowerCase()
                .includes(
                  "json"
                ) ||
              responseUrl
                .toLowerCase()
                .includes(
                  "livefeed"
                ) ||
              responseUrl
                .toLowerCase()
                .includes(
                  "api"
                )
            ) {

              apiResponses.push({

                url:
                  responseUrl,

                status:
                  response.status(),

                contentType

              });

            }

          } catch {}

        }
      );


      console.log(
        "Ouverture FIFA:",
        FIFA_URL
      );


      await page.goto(
        FIFA_URL,
        {

          waitUntil:
            "domcontentloaded",

          timeout:
            60000

        }
      );


      /*
       * Laisse le JavaScript de la page
       * construire les événements.
       */

      await page.waitForTimeout(
        10000
      );


      /*
       * Quelques scrolls permettent de déclencher
       * le chargement lazy de certains événements.
       */

      await page.evaluate(
        async () => {

          for (
            let i = 0;
            i < 5;
            i++
          ) {

            window.scrollTo(
              0,
              document.body.scrollHeight
            );

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  1000
                )
            );

          }

          window.scrollTo(
            0,
            0
          );

        }
      );


      await page.waitForTimeout(
        3000
      );


      /*
       * Récupération du texte réellement
       * rendu par le navigateur.
       */

      const bodyText =
        await page
          .locator("body")
          .innerText();


      /*
       * Récupération des liens visibles.
       */

      const links =
        await page
          .locator("a")
          .evaluateAll(
            anchors =>
              anchors.map(
                a => ({

                  text:
                    (
                      a.innerText ||
                      ""
                    ).trim(),

                  href:
                    a.href || ""

                })
              )
          );


      /*
       * Récupération de quelques éléments
       * visibles contenant du contenu FIFA.
       */

      const elements =
        await page
          .locator(
            "body *"
          )
          .evaluateAll(
            nodes => {

              const result = [];

              for (
                const node
                of nodes
              ) {

                const text =
                  (
                    node.innerText ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();


                if (
                  !text ||
                  text.length > 250
                ) {

                  continue;

                }


                const lower =
                  text.toLowerCase();


                if (
                  lower.includes(
                    "fc 24"
                  ) ||
                  lower.includes(
                    "fc 25"
                  ) ||
                  lower.includes(
                    "fc 26"
                  ) ||
                  lower.includes(
                    "fifa"
                  )
                ) {

                  result.push(
                    text
                  );

                }

              }


              return [
                ...new Set(
                  result
                )
              ];

            }
          );


      /*
       * Recherche des éléments FIFA.
       */

      const fifaElements = [];


      function addEvent(
        value,
        href = null
      ) {

        if (
          !value ||
          value.length > 300
        ) {

          return;

        }


        const clean =
          value
            .replace(
              /\s+/g,
              " "
            )
            .trim();


        if (!clean) {
          return;
        }


        const lower =
          clean.toLowerCase();


        if (
          !(
            lower.includes(
              "fifa"
            ) ||
            lower.includes(
              "fc 24"
            ) ||
            lower.includes(
              "fc 25"
            ) ||
            lower.includes(
              "fc 26"
            ) ||
            lower.includes(
              "rush"
            ) ||
            lower.includes(
              "3x3"
            ) ||
            lower.includes(
              "4x4"
            ) ||
            lower.includes(
              "5x5"
            )
          )
        ) {

          return;

        }


        if (
          !fifaElements.some(
            x =>
              x.text ===
              clean
          )
        ) {

          fifaElements.push({

            text:
              clean,

            href:
              href

          });

        }

      }


      for (
        const element
        of elements
      ) {

        addEvent(
          element
        );

      }


      for (
        const link
        of links
      ) {

        addEvent(
          link.text,
          link.href
        );

      }


      /*
       * Recherche également dans le texte
       * brut pour les compétitions.
       */

      const textLines =
        bodyText
          .split("\n")
          .map(
            x =>
              x
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
          )
          .filter(Boolean);


      for (
        const line
        of textLines
      ) {

        addEvent(
          line
        );

      }


      /*
       * Détection des compétitions.
       */

      const competitions =
        [
          ...new Set(
            fifaElements
              .map(
                x =>
                  x.text
              )
              .filter(
                text => {

                  const lower =
                    text
                      .toLowerCase();

                  return (
                    lower.includes(
                      "fc 24"
                    ) ||
                    lower.includes(
                      "fc 25"
                    ) ||
                    lower.includes(
                      "fc 26"
                    ) ||
                    lower.includes(
                      "fifa"
                    )
                  );

                }
              )
          )
        ];


      /*
       * On limite le JSON pour éviter une
       * réponse énorme.
       */

      const events =
        fifaElements.slice(
          0,
          200
        );


      res.json({

        success:
          true,

        source:
          FIFA_URL,

        method:
          "Playwright Chromium",

        page_loaded:
          true,

        fifa_found:
          events.length > 0,

        competitions,

        events,

        total:
          events.length,

        browser_api_responses:
          apiResponses
            .slice(
              0,
              100
            ),

        message:
          events.length > 0

            ? "Éléments FIFA récupérés après exécution JavaScript."

            : "La page est accessible mais aucun événement FIFA exploitable n'a été exposé au navigateur."

      });


    } catch (error) {

      console.error(
        "Erreur FIFA Playwright:",
        error
      );


      res.status(500).json({

        success:
          false,

        source:
          FIFA_URL,

        method:
          "Playwright Chromium",

        error:
          error.message,

        hint:
          "Vérifie que Chromium est installé avec npx playwright install chromium."

      });


    } finally {

      if (browser) {

        try {

          await browser.close();

        } catch {}

      }

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
      "BOT PREDICTOR actif sur le port " +
      PORT
    );

    console.log(
      "Timezone: Africa/Abidjan"
    );

    console.log(
      "FIFA URL: " +
      FIFA_URL
    );

  }
);
