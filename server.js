```javascript
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
   API FOOTBALL
================================================== */

const API_KEY = process.env.API_FOOTBALL_KEY;
const API = "https://v3.football.api-sports.io";

async function footballApi(endpoint) {
  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(API + endpoint, {
    method: "GET",
    headers: {
      "x-apisports-key": API_KEY,
      "Accept": "application/json"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.errors
        ? Object.values(data.errors).join(" ")
        : "API-Football HTTP " + response.status
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

  const x = {};

  parts.forEach(p => {
    x[p.type] = p.value;
  });

  return `${x.year}-${x.month}-${x.day}`;
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
    value === undefined ||
    value === ""
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
      const content = fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      );

      history = JSON.parse(content);

      if (!Array.isArray(history)) {
        history = [];
      }
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
      JSON.stringify(history, null, 2)
    );
  } catch (error) {
    console.log(
      "Impossible de sauvegarder l'historique:",
      error.message
    );
  }
}

chargerHistorique();

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
   SCORE REEL
================================================== */

function scoreReel(fixture) {
  const score = fixture?.score || {};

  const ht = score.halftime || {};
  const ft = score.fulltime || {};

  let halftime = null;
  let fulltime = null;

  if (
    ht.home !== null &&
    ht.home !== undefined &&
    ht.away !== null &&
    ht.away !== undefined
  ) {
    halftime =
      `${ht.home}-${ht.away}`;
  }

  if (
    ft.home !== null &&
    ft.home !== undefined &&
    ft.away !== null &&
    ft.away !== undefined
  ) {
    fulltime =
      `${ft.home}-${ft.away}`;
  }

  return {
    halftime,
    fulltime
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

  if (selection === "1") {
    return home > away
      ? "GAGNE"
      : "PERDU";
  }

  if (selection === "2") {
    return away > home
      ? "GAGNE"
      : "PERDU";
  }

  if (selection === "N") {
    return home === away
      ? "GAGNE"
      : "PERDU";
  }

  return "EN_ATTENTE";
}

/* ==================================================
   PREDICTION API-FOOTBALL
================================================== */

function extrairePrediction(prediction) {
  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  return {
    home: pct(percent.home),
    draw: pct(percent.draw),
    away: pct(percent.away),

    under_over:
      p.under_over ||
      "Non disponible",

    advice:
      p.advice ||
      "Non disponible",

    goals:
      p.goals || null,

    btts:
      p.btts || "Non disponible"
  };
}

/* ==================================================
   SELECTION PRINCIPALE
================================================== */

function meilleurePrediction(prediction) {
  const x =
    extrairePrediction(prediction);

  const home = x.home;
  const draw = x.draw;
  const away = x.away;

  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {
    return null;
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
          "équipe à domicile"
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
   SCORE API
================================================== */

function scoreAPI(prediction) {
  const goals =
    prediction?.predictions?.goals;

  if (!goals) {
    return "Non disponible";
  }

  const home = goals.home;
  const away = goals.away;

  /*
   * IMPORTANT :
   * -1.5 / -2.5 / etc. sont des seuils
   * et NE SONT PAS des scores.
   */

  if (
    typeof home !== "string" &&
    typeof away !== "string"
  ) {
    return "Non disponible";
  }

  if (
    !home ||
    !away ||
    String(home).includes(".") ||
    String(away).includes(".")
  ) {
    return "Non disponible";
  }

  return `${home}-${away}`;
}

/* ==================================================
   FORMATION / DERNIERS MATCHS
================================================== */

async function derniersMatchs(teamId) {
  if (!teamId) {
    return [];
  }

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
      "Derniers matchs indisponibles:",
      teamId,
      error.message
    );

    return [];
  }
}

/* ==================================================
   H2H
================================================== */

async function historiqueH2H(
  homeId,
  awayId
) {
  if (!homeId || !awayId) {
    return [];
  }

  try {
    const data =
      await footballApi(
        "/fixtures/headtohead?h2h=" +
        encodeURIComponent(
          `${homeId}-${awayId}`
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
   CALCUL FORME
================================================== */

function calculForme(
  matches,
  teamId
) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  const completed =
    matches.filter(m =>
      matchTermine(
        m.fixture?.status?.short
      )
    );

  completed.forEach(match => {
    const homeId =
      match.teams?.home?.id;

    const homeGoals =
      match.goals?.home;

    const awayGoals =
      match.goals?.away;

    if (
      homeGoals === null ||
      awayGoals === null ||
      homeGoals === undefined ||
      awayGoals === undefined
    ) {
      return;
    }

    const isHome =
      homeId === teamId;

    const gf =
      isHome
        ? homeGoals
        : awayGoals;

    const ga =
      isHome
        ? awayGoals
        : homeGoals;

    goalsFor += gf;
    goalsAgainst += ga;

    if (gf > ga) {
      wins++;
    } else if (gf === ga) {
      draws++;
    } else {
      losses++;
    }
  });

  return {
    matches: completed.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst
  };
}

/* ==================================================
   SCORE MI-TEMPS HISTORIQUE
================================================== */

function moyenneMiTemps(
  matches,
  teamId
) {
  let totalFor = 0;
  let totalAgainst = 0;
  let count = 0;

  matches.forEach(match => {
    const ht =
      match.score?.halftime;

    if (
      ht?.home === null ||
      ht?.away === null ||
      ht?.home === undefined ||
      ht?.away === undefined
    ) {
      return;
    }

    const homeId =
      match.teams?.home?.id;

    if (homeId === teamId) {
      totalFor += ht.home;
      totalAgainst += ht.away;
    } else {
      totalFor += ht.away;
      totalAgainst += ht.home;
    }

    count++;
  });

  if (!count) {
    return null;
  }

  return {
    for:
      totalFor / count,
    against:
      totalAgainst / count
  };
}

/* ==================================================
   SCORE FINAL ESTIME
================================================== */

function estimerScore(
  homeForm,
  awayForm
) {
  if (
    !homeForm.matches ||
    !awayForm.matches
  ) {
    return null;
  }

  const homeAvgFor =
    homeForm.goalsFor /
    homeForm.matches;

  const homeAvgAgainst =
    homeForm.goalsAgainst /
    homeForm.matches;

  const awayAvgFor =
    awayForm.goalsFor /
    awayForm.matches;

  const awayAvgAgainst =
    awayForm.goalsAgainst /
    awayForm.matches;

  let homeGoals =
    (
      homeAvgFor +
      awayAvgAgainst
    ) / 2;

  let awayGoals =
    (
      awayAvgFor +
      homeAvgAgainst
    ) / 2;

  homeGoals =
    Math.max(
      0,
      Math.min(
        5,
        Math.round(homeGoals)
      )
    );

  awayGoals =
    Math.max(
      0,
      Math.min(
        5,
        Math.round(awayGoals)
      )
    );

  return `${homeGoals}-${awayGoals}`;
}

/* ==================================================
   SCORE MI-TEMPS ESTIME
================================================== */

function estimerMiTemps(
  homeMatches,
  awayMatches,
  homeId,
  awayId
) {
  const h =
    moyenneMiTemps(
      homeMatches,
      homeId
    );

  const a =
    moyenneMiTemps(
      awayMatches,
      awayId
    );

  if (!h || !a) {
    return null;
  }

  const home =
    Math.max(
      0,
      Math.round(
        (
          h.for +
          a.against
        ) / 2
      )
    );

  const away =
    Math.max(
      0,
      Math.round(
        (
          a.for +
          h.against
        ) / 2
      )
    );

  return `${home}-${away}`;
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

app.get("/test-api", async (req, res) => {
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
      message:
        "Connexion API-Football échouée",
      error:
        error.message
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
      error:
        error.message
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
   PREDICTIONS DU JOUR
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

      let matches =
        fixtures.response || [];

      matches =
        matches.filter(matchAVenir);

      matches.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );

      /*
       * On analyse au maximum 6 candidats
       * afin d'éviter de consommer inutilement
       * les requêtes API.
       */

      const candidats =
        matches.slice(0, 6);

      const analyses = [];

      for (const match of candidats) {
        try {
          const predictionData =
            await footballApi(
              "/predictions?fixture=" +
              match.fixture.id
            );

          const prediction =
            predictionData.response?.[0];

          if (!prediction) {
            continue;
          }

          const selection =
            meilleurePrediction(
              prediction
            );

          if (!selection) {
            continue;
          }

          const homeId =
            match.teams?.home?.id;

          const awayId =
            match.teams?.away?.id;

          const homeRecent =
            await derniersMatchs(
              homeId
            );

          const awayRecent =
            await derniersMatchs(
              awayId
            );

          const h2h =
            await historiqueH2H(
              homeId,
              awayId
            );

          const homeForm =
            calculForme(
              homeRecent,
              homeId
            );

          const awayForm =
            calculForme(
              awayRecent,
              awayId
            );

          /*
           * RÈGLE STRICTE :
           * il faut au minimum 3 matchs
           * récents pour chaque équipe.
           *
           * Sinon le match n'est pas sélectionné.
           */

          if (
            homeForm.matches < 3 ||
            awayForm.matches < 3
          ) {
            continue;
          }

          /*
           * L'API doit également fournir
           * une probabilité exploitable.
           */

          if (
            selection.confidence < 50
          ) {
            continue;
          }

          const apiScore =
            scoreAPI(prediction);

          const scoreEstime =
            apiScore !==
            "Non disponible"
              ? apiScore
              : estimerScore(
                  homeForm,
                  awayForm
                );

          const miTemps =
            estimerMiTemps(
              homeRecent,
              awayRecent,
              homeId,
              awayId
            );

          const p =
            extrairePrediction(
              prediction
            );

          const analysis =
            "Analyse multi-données réelle. " +
            "Forme " +
            match.teams.home.name +
            " : " +
            homeForm.wins +
            " victoire(s), " +
            homeForm.draws +
            " nul(s), " +
            homeForm.losses +
            " défaite(s) sur " +
            homeForm.matches +
            " match(s). " +
            "Forme " +
            match.teams.away.name +
            " : " +
            awayForm.wins +
            " victoire(s), " +
            awayForm.draws +
            " nul(s), " +
            awayForm.losses +
            " défaite(s) sur " +
            awayForm.matches +
            " match(s). " +
            "Face-à-face disponibles : " +
            h2h.length +
            ". " +
            "Probabilités API-Football : " +
            "1 = " +
            p.home +
            "%, N = " +
            p.draw +
            "%, 2 = " +
            p.away +
            "%. " +
            "Pronostic principal : " +
            selection.text +
            ".";

          analyses.push({
            match,
            prediction,
            selection,
            homeForm,
            awayForm,
            h2h,
            scoreEstime,
            miTemps,
            analysis
          });

        } catch (error) {
          console.log(
            "Analyse indisponible:",
            match.fixture.id,
            error.message
          );
        }
      }

      /*
       * Meilleures analyses.
       */

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

        const x =
          extrairePrediction(p);

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
            item.scoreEstime ||
            "Non disponible",

          predicted_half_time:
            item.miTemps ||
            "Non disponible",

          under_over:
            x.under_over,

          btts:
            x.btts,

          advice:
            x.advice
        };

        /*
         * Ne pas dupliquer.
         */

        const existing =
          history.find(
            h =>
              h.fixture_id ===
              historyItem.fixture_id
          );

        if (!existing) {
          history.push(historyItem);
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
              x.home.toFixed(0) +
              "%",

            draw:
              x.draw.toFixed(0) +
              "%",

            away:
              x.away.toFixed(0) +
              "%",

            goals:
              item.scoreEstime ||
              "Non disponible",

            under_over:
              x.under_over,

            advice:
              x.advice,

            btts:
              x.btts,

            over_under:
              x.under_over,

            corners:
              "Non disponible",

            yellow_cards:
              "Non disponible",

            half_time_score:
              item.miTemps ||
              "Non disponible",

            full_time_score:
              item.scoreEstime ||
              "Non disponible"
          },

          consensus: {
            confidence:
              s.confidence.toFixed(0) +
              "%"
          },

          sources: {
            api_football: true,
            recent_form: true,
            h2h:
              item.h2h.length > 0
          },

          analysis:
            item.analysis
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
          result.length === 0
            ? "Aucun match ne possède suffisamment de données réelles pour être présenté comme fiable."
            : "Analyse terminée."
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
       * IMPORTANT :
       * On n'utilise PAS /fixtures?ids=...
       *
       * Le forfait Free ne permet pas
       * le paramètre "ids".
       *
       * On récupère chaque match avec
       * /fixtures?id=...
       */

      const updated = [];

      /*
       * Maximum 10 anciennes prédictions
       * pour limiter la consommation API.
       */

      const recent =
        history.slice(-10);

      for (const item of recent) {
        try {
          const data =
            await footballApi(
              "/fixtures?id=" +
              encodeURIComponent(
                item.fixture_id
              ) +
              "&timezone=Africa/Abidjan"
            );

          const fixture =
            data.response?.[0];

          if (!fixture) {
            updated.push({
              ...item,
              status:
                "EN_ATTENTE",
              halftime_score:
                item.halftime_score ||
                null,
              final_score:
                item.final_score ||
                null,
              result:
                "EN_ATTENTE"
            });

            continue;
          }

          const scores =
            scoreReel(fixture);

          const result =
            resultatPrediction(
              item.selection?.type,
              fixture
            );

          updated.push({
            ...item,

            status:
              fixture.fixture?.status
                ?.short ||
              "NS",

            halftime_score:
              scores.halftime,

            final_score:
              scores.fulltime,

            result
          });

        } catch (error) {
          console.log(
            "Historique fixture:",
            item.fixture_id,
            error.message
          );

          updated.push({
            ...item,
            status:
              "EN_ATTENTE",
            result:
              "EN_ATTENTE"
          });
        }
      }

      /*
       * IMPORTANT :
       * On remplace uniquement les anciens
       * éléments correspondants.
       */

      history =
        history.map(old => {
          const found =
            updated.find(
              x =>
                x.fixture_id ===
                old.fixture_id
            );

          return found || old;
        });

      sauvegarderHistorique();

      const gagne =
        history.filter(
          x => x.result === "GAGNE"
        ).length;

      const perdu =
        history.filter(
          x => x.result === "PERDU"
        ).length;

      const attente =
        history.filter(
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

      const sorted =
        [...history].sort(
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
          sorted.length,

        stats: {
          gagne,
          perdu,
          attente,
          taux_reussite:
            taux
        },

        matches:
          sorted
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
        Number(
          req.params.fixture
        );

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

      /*
       * Compatible Free :
       * utilisation de id= et non ids=.
       */

      const data =
        await footballApi(
          "/fixtures?id=" +
          encodeURIComponent(
            fixtureId
          )
        );

      const fixture =
        data.response?.[0];

      if (fixture) {
        const scores =
          scoreReel(fixture);

        item.status =
          fixture.fixture?.status
            ?.short ||
          "NS";

        item.halftime_score =
          scores.halftime;

        item.final_score =
          scores.fulltime;

        item.result =
          resultatPrediction(
            item.selection?.type,
            fixture
          );

        sauvegarderHistorique();
      }

      res.json({
        success: true,
        match:
          item
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
   SUPPRIMER L'HISTORIQUE
================================================== */

app.delete(
  "/history",
  (req, res) => {
    history = [];
    sauvegarderHistorique();

    res.json({
      success: true,
      message:
        "Historique supprimé."
    });
  }
);

/* ==================================================
   DEMARRAGE
================================================== */

app.listen(
});
  PORT,
  () => {
    console.log(
      "BOT PREDICTOR SERVER actif sur le port " +
      PORT
    );
  }
);
```
/* ==================================================
   FIFA VIRTUEL 1XBET
   TEST - MATCHS EN DIRECT
================================================== */

const XBET_LIVE_API =
  "https://1xbet.com/LiveFeed/";

app.get("/virtual-fifa", async (req, res) => {
  try {

    /* ----------------------------------------------
       1. RÉCUPÉRER LES SPORTS 1XBET
    ---------------------------------------------- */

    const sportParams =
      new URLSearchParams({
        sports: "0",
        lng: "fr",
        tf: "1000000",
        country: "1"
      });

    const sportResponse =
      await fetch(
        XBET_LIVE_API +
        "GetSportsShortZip?" +
        sportParams.toString(),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0",
            "Accept":
              "application/json,text/plain,*/*"
          }
        }
      );

    if (!sportResponse.ok) {
      throw new Error(
        "1xBet Sports HTTP " +
        sportResponse.status
      );
    }

    const sportData =
      await sportResponse.json();

    const sports =
      Array.isArray(sportData.Value)
        ? sportData.Value
        : [];


    /* ----------------------------------------------
       2. CHERCHER FIFA
    ---------------------------------------------- */

    const fifaSports =
      sports.filter((sport) => {

        const name =
          String(
            sport.N || ""
          ).toLowerCase();

        return (
          name.includes("fifa") ||
          name.includes("esports football")
        );

      });


    if (fifaSports.length === 0) {

      return res.json({
        success: true,
        source: "1xBet LiveFeed",
        fifa_found: false,
        message:
          "Aucun sport FIFA détecté actuellement.",
        sports_found:
          sports.map((sport) => ({
            id: sport.I,
            name: sport.N
          }))
      });

    }


    /* ----------------------------------------------
       3. RÉCUPÉRER LES MATCHS FIFA
    ---------------------------------------------- */

    const allGames = [];


    for (const fifa of fifaSports) {

      const sportId =
        fifa.I;

      if (
        sportId === undefined ||
        sportId === null
      ) {
        continue;
      }


      const gameParams =
        new URLSearchParams({
          getEmpty: "true",
          count: "500",
          lng: "fr",
          sports: String(sportId)
        });


      const gameResponse =
        await fetch(
          XBET_LIVE_API +
          "Get1x2_Zip?" +
          gameParams.toString(),
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0",
              "Accept":
                "application/json,text/plain,*/*"
            }
          }
        );


      if (!gameResponse.ok) {
        continue;
      }


      const gameData =
        await gameResponse.json();


      const games =
        Array.isArray(gameData.Value)
          ? gameData.Value
          : [];


      for (const game of games) {

        const home =
          game.O1 ||
          game.O1N ||
          "Équipe 1";

        const away =
          game.O2 ||
          game.O2N ||
          "Équipe 2";


        allGames.push({

          id:
            game.I ??
            null,

          sport:
            fifa.N ||
            "FIFA",

          league:
            game.L ||
            game.LE ||
            "FIFA virtuel",

          home,

          away,

          start:
            game.S ??
            null,

          score: {

            home:
              game.SC?.FS?.S1 ??
              game.SC?.S1 ??
              null,

            away:
              game.SC?.FS?.S2 ??
              game.SC?.S2 ??
              null

          },

          status:
            game.SC?.CPS ??
            game.MIO?.TSt ??
            null,

          live: true

        });

      }

    }


    /* ----------------------------------------------
       4. RÉPONSE
    ---------------------------------------------- */

    res.json({

      success: true,

      source:
        "1xBet LiveFeed",

      fifa_found:
        true,

      fifa_sports:
        fifaSports.map((sport) => ({
          id: sport.I,
          name: sport.N
        })),

      total_matches:
        allGames.length,

      matches:
        allGames

    });


  } catch (error) {

    console.error(
      "Erreur FIFA 1xBet:",
      error
    );

    res.status(500).json({

      success: false,

      source:
        "1xBet LiveFeed",

      error:
        error.message

    });

  }

});
