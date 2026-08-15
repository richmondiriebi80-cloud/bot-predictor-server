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
   CONFIGURATION API-FOOTBALL
================================================== */

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const FOOTBALL_API =
  "https://v3.football.api-sports.io";


async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY n'est pas configurée dans Render."
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

  const text = await response.text();

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
   DATE AFRICA/ABIDJAN
================================================== */

function getDateAbidjan() {

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

  return (
    result.year +
    "-" +
    result.month +
    "-" +
    result.day
  );
}


/* ==================================================
   HEURE AFRICA/ABIDJAN
================================================== */

function getTimeAbidjan(date) {

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
   HISTORIQUE
================================================== */

const HISTORY_FILE =
  path.join(
    __dirname,
    "history.json"
  );

let history = [];

try {

  if (
    fs.existsSync(
      HISTORY_FILE
    )
  ) {

    history =
      JSON.parse(
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
      "Erreur sauvegarde historique:",
      error.message
    );

  }

}


/* ==================================================
   RACINE
================================================== */

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
        getDateAbidjan();

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
   PRÉDICTIONS
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        getDateAbidjan();


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
       * On limite le nombre de requêtes
       * afin de respecter le quota API.
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
            p.predictions?.percent || {};


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
           * IMPORTANT :
           * Les valeurs Over/Under comme
           * "-2.5" ou "-1.5" ne sont PAS
           * des scores exacts.
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


      /*
       * On sélectionne uniquement
       * les meilleures prédictions.
       */

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

        const fixture =
          item.fixture;

        const p =
          item.prediction;


        const prediction = {

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

        };


        matches.push({

          match: {

            id:
              fixture.fixture.id,

            date:
              fixture.fixture.date,

            time:
              getTimeAbidjan(
                fixture.fixture.date
              ),

            league:
              fixture.league?.name ||
              "",

            country:
              fixture.league?.country ||
              "",

            home: {

              id:
                fixture.teams.home.id,

              name:
                fixture.teams.home.name,

              logo:
                fixture.teams.home.logo

            },

            away: {

              id:
                fixture.teams.away.id,

              name:
                fixture.teams.away.name,

              logo:
                fixture.teams.away.logo

            }

          },


          prediction,


          consensus: {

            confidence:
              item.confidence.toFixed(0) +
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

          },


          analysis:
            "Analyse basée sur les données disponibles dans API-Football. " +
            "Probabilités : 1 = " +
            item.home.toFixed(0) +
            "%, N = " +
            item.draw.toFixed(0) +
            "%, 2 = " +
            item.away.toFixed(0) +
            "%. " +
            "Pronostic principal : " +
            item.pick +
            ". " +
            "Conseil API-Football : " +
            (
              p.predictions?.advice ||
              "Non disponible"
            ) +
            ". " +
            "Les seuils Over/Under ne sont pas présentés comme des scores exacts."

        });


        /*
         * Enregistrer dans l'historique.
         */

        const exists =
          history.some(
            h =>
              h.fixture_id ===
              fixture.fixture.id
          );


        if (!exists) {

          history.push({

            fixture_id:
              fixture.fixture.id,

            created_at:
              new Date().toISOString(),

            date:
              fixture.fixture.date,

            league:
              fixture.league?.name ||
              "",

            country:
              fixture.league?.country ||
              "",

            home:
              fixture.teams.home.name,

            away:
              fixture.teams.away.name,

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
          matches.length > 0
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
            "Paramètre fixture manquant."

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
   FORME RÉCENTE D'UNE ÉQUIPE
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
            "Paramètre team manquant."

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
            "Paramètre teams manquant."

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
            "league et season sont requis."

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
   HISTORIQUE + STATISTIQUES
================================================== */

app.get(
  "/history",
  async (req, res) => {

    try {

      let gagne = 0;
      let perdu = 0;
      let attente = 0;


      /*
       * Vérification des derniers matchs.
       * On n'utilise PAS le paramètre ids,
       * car ton abonnement API-Football Free
       * ne l'autorise pas.
       */

      const recent =
        history.slice(-10);


      for (
        const item of recent
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


          const hg =
            fixture.goals?.home;

          const ag =
            fixture.goals?.away;


          if (
            hg === null ||
            ag === null ||
            hg === undefined ||
            ag === undefined
          ) {

            attente++;

            continue;

          }


          let result =
            "PERDU";


          if (
            item.selection?.type === "1" &&
            hg > ag
          ) {

            result = "GAGNE";

          } else if (
            item.selection?.type === "2" &&
            ag > hg
          ) {

            result = "GAGNE";

          } else if (
            item.selection?.type === "N" &&
            hg === ag
          ) {

            result = "GAGNE";

          }


          item.result =
            result;

          item.final_score =
            hg +
            "-" +
            ag;


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


      const finished =
        gagne + perdu;


      const successRate =
        finished > 0
          ? Math.round(
              (
                gagne /
                finished
              ) * 100
            )
          : 0;


      saveHistory();


      res.json({

        success: true,

        total:
          history.length,

        stats: {

          gagne,

          perdu,

          attente,

          taux_reussite:
            successRate

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
   TEST DE LA PAGE PUBLIQUE
================================================== */

app.get(
  "/virtual-fifa",
  async (req, res) => {

    const urls = [

      "https://1xbet.com/fr/live/fifa",

      "https://1xbet.com/en/live/fifa"

    ];


    let html = "";
    let source = "";


    try {

      for (
        const url of urls
      ) {

        try {

          const response =
            await fetch(
              url,
              {
                method: "GET",

                redirect:
                  "follow",

                headers: {

                  "User-Agent":
                    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Safari/537.36",

                  "Accept":
                    "text/html,application/xhtml+xml"

                }

              }
            );


          const text =
            await response.text();


          if (
            response.ok &&
            text &&
            text.toLowerCase()
              .includes("<html")
          ) {

            html = text;

            source = url;

            break;

          }

        } catch (error) {

          console.log(
            "FIFA source:",
            error.message
          );

        }

      }


      if (!html) {

        return res.status(502).json({

          success: false,

          source:
            "1xBet FIFA",

          error:
            "La page FIFA 1xBet n'est pas accessible depuis Render."

        });

      }


      /*
       * Détection simple des éléments
       * FIFA présents dans la page.
       */

      const fifaTerms = [];

      const regex =
        /(?:FC\s*24|FC\s*25|FC\s*26|FIFA|Virtual Football|Esports Football)/gi;


      const found =
        html.match(regex) || [];


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
          !fifaTerms.includes(
            clean.toUpperCase()
          )
        ) {

          fifaTerms.push(
            clean.toUpperCase()
          );

        }

      }


      /*
       * Liens FIFA visibles.
       */

      const events = [];

      const linkRegex =
        /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;


      let match;


      while (
        (match =
          linkRegex.exec(html)) !== null
      ) {

        const href =
          match[1];

        const text =
          match[2]
            .replace(
              /<[^>]*>/g,
              " "
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();


        const combined =
          (
            href +
            " " +
            text
          ).toLowerCase();


        if (
          combined.includes("fifa") ||
          combined.includes("fc-25") ||
          combined.includes("fc-26") ||
          combined.includes("virtual")
        ) {

          let fullUrl =
            href;


          if (
            href.startsWith("/")
          ) {

            fullUrl =
              "https://1xbet.com" +
              href;

          }


          if (
            !events.some(
              e =>
                e.url ===
                fullUrl
            )
          ) {

            events.push({

              title:
                text ||
                "FIFA virtuel",

              url:
                fullUrl

            });

          }

        }

      }


      res.json({

        success: true,

        source,

        fifa_found:
          fifaTerms.length > 0 ||
          events.length > 0,

        competitions:
          fifaTerms,

        events:
          events.slice(0, 100),

        total:
          events.length,

        message:
          (
            fifaTerms.length > 0 ||
            events.length > 0
          )
            ? "Éléments FIFA détectés sur la page publique 1xBet."
            : "Page accessible mais aucun élément FIFA exploitable détecté."

      });


    } catch (error) {

      console.error(
        "Erreur virtual-fifa:",
        error.message
      );


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
