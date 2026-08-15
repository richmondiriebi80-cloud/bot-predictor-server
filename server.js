const express = require("express");
const fs = require("fs");
const path = require("path");

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
   CONFIGURATION API-FOOTBALL
===================================================== */

const API_FOOTBALL_KEY =
  process.env.API_FOOTBALL_KEY || "";

const FOOTBALL_API =
  "https://v3.football.api-sports.io";


/* =====================================================
   HISTORIQUE
===================================================== */

const HISTORY_FILE =
  path.join(__dirname, "history.json");

let history = [];

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
      "API_FOOTBALL_KEY non configurée dans Render."
    );
  }

  const response = await fetch(
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

  for (const p of parts) {
    result[p.type] =
      p.value;
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
    status: "online",
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
          "/fixtures?date=" +
          encodeURIComponent(
            date
          ) +
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


/* =====================================================
   PRÉDICTION
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


/* =====================================================
   PRÉDICTIONS DU JOUR
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
          encodeURIComponent(
            date
          ) +
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
        fixtures.slice(0, 6);

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

          const p =
            data.response?.[0];

          if (!p) {
            continue;
          }


          const percent =
            p.predictions
              ?.percent || {};


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
          let confidence = draw;
          let pick = "Match nul";


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

          } else if (
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
            p.predictions
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
            "Prediction:",
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
          "/fixtures/statistics?fixture=" +
          encodeURIComponent(
            fixture
          )
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

          success: false,

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
          "/fixtures/headtohead?h2h=" +
          encodeURIComponent(
            teams
          ) +
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
   HISTORIQUE / STATISTIQUES
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
            away === null
          ) {

            attente++;

            continue;

          }


          let result =
            "PERDU";


          if (
            item.selection?.type ===
              "1" &&
            home > away
          ) {

            result = "GAGNE";

          } else if (
            item.selection?.type ===
              "2" &&
            away > home
          ) {

            result = "GAGNE";

          } else if (
            item.selection?.type ===
              "N" &&
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


/* =====================================================
   FIFA 1XBET
===================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    const url =
      "https://1xbet.com/fr/live/fifa";


    try {

      const response =
        await fetch(
          url,
          {
            headers: {

              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",

              "Accept":
                "text/html,application/xhtml+xml",

              "Accept-Language":
                "fr-FR,fr;q=0.9,en;q=0.8"

            }
          }
        );


      const html =
        await response.text();


      if (!response.ok) {

        return res.status(502).json({

          success: false,

          source: url,

          error:
            "1xBet HTTP " +
            response.status

        });

      }


      /*
       * Transformer le HTML en texte.
       */

      let text =
        html
          .replace(
            /<script[\s\S]*?<\/script>/gi,
            " "
          )
          .replace(
            /<style[\s\S]*?<\/style>/gi,
            " "
          )
          .replace(
            /<[^>]+>/g,
            "\n"
          )
          .replace(
            /&nbsp;/gi,
            " "
          )
          .replace(
            /&amp;/gi,
            "&"
          )
          .replace(
            /\s+/g,
            " "
          );


      /*
       * Compétitions FIFA détectées.
       */

      const competitionRegex =
        /FC\s*(?:24|25|26)[^0-9]{0,80}(?:Rush|5x5|4x4|3x3|Championnat|Ligue|Superligue)?/gi;


      const competitions =
        [
          ...new Set(
            (
              text.match(
                competitionRegex
              ) || []
            ).map(
              x =>
                x.trim()
            )
          )
        ];


      /*
       * Équipes présentes dans la page.
       *
       * On récupère les noms à partir
       * des liens FIFA quand ils existent.
       */

      const events = [];


      const hrefRegex =
        /href=["']([^"']*\/(?:fifa|football)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;


      let match;


      while (
        (match =
          hrefRegex.exec(html)) !== null
      ) {

        const href =
          match[1];

        const raw =
          match[2]
            .replace(
              /<[^>]+>/g,
              " "
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();


        if (!raw) {
          continue;
        }


        const low =
          (
            href +
            " " +
            raw
          ).toLowerCase();


        if (
          !low.includes("fifa") &&
          !low.includes("fc-24") &&
          !low.includes("fc-25") &&
          !low.includes("fc-26")
        ) {
          continue;
        }


        let fullUrl =
          href;


        if (
          href.startsWith("/")
        ) {

          fullUrl =
            "https://1xbet.com" +
            href;

        }


        events.push({

          title:
            raw,

          url:
            fullUrl

        });

      }


      /*
       * Détection complémentaire
       * de lignes FIFA.
       */

      const lines =
        text
          .split(
            /[.!?]\s+/
          )
          .map(
            x =>
              x.trim()
          )
          .filter(Boolean);


      for (
        const line
        of lines
      ) {

        const low =
          line.toLowerCase();


        if (
          (
            low.includes("fc 24") ||
            low.includes("fc 25") ||
            low.includes("fc 26") ||
            low.includes("fifa")
          ) &&
          line.length < 300
        ) {

          if (
            !events.some(
              e =>
                e.title ===
                line
            )
          ) {

            events.push({

              title:
                line,

              url:
                url

            });

          }

        }

      }


      const uniqueEvents =
        events.filter(
          (event, index, arr) =>
            index ===
            arr.findIndex(
              x =>
                x.title ===
                event.title
            )
        );


      res.json({

        success: true,

        source: url,

        fifa_found:
          competitions.length > 0 ||
          uniqueEvents.length > 0,

        competitions,

        events:
          uniqueEvents.slice(
            0,
            100
          ),

        total:
          uniqueEvents.length,

        method:
          "HTML + extraction",

        message:
          competitions.length ||
          uniqueEvents.length
            ? "Données FIFA détectées."
            : "La page 1xBet est accessible mais ses événements FIFA ne sont pas exposés dans le HTML récupéré par Render."

      });


    } catch (error) {

      console.error(
        "FIFA:",
        error.message
      );

      res.status(500).json({

        success: false,

        source: url,

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
      "BOT PREDICTOR actif sur le port " +
      PORT
    );

  }
);
