const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY;

const API_URL = "https://v3.football.api-sports.io";

const TIMEZONE = "Africa/Abidjan";

const CANDIDATES = 7;
const DISPLAY = 2;

// Cache pour éviter de refaire 8 requêtes à chaque actualisation
const CACHE_TIME = 10 * 60 * 1000;

let predictionCache = {
  time: 0,
  data: null
};

let busy = false;


/* =========================================================
   OUTILS
========================================================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function number(value, fallback = 0) {

  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}


function percent(value) {

  const n = number(value, 0);

  return Math.max(0, Math.min(100, n));
}


function formatPercent(value) {

  return percent(value).toFixed(1) + "%";
}


/* =========================================================
   POISSON
========================================================= */

function poissonProbability(lambda, goals) {

  lambda = Math.max(0.01, number(lambda, 1));

  let factorial = 1;

  for (let i = 1; i <= goals; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial
  );
}


function calculateExactScore(homeLambda, awayLambda) {

  let best = {
    home: 0,
    away: 0,
    probability: 0
  };

  for (let home = 0; home <= 6; home++) {

    for (let away = 0; away <= 6; away++) {

      const probability =
        poissonProbability(homeLambda, home) *
        poissonProbability(awayLambda, away);

      if (probability > best.probability) {

        best = {
          home,
          away,
          probability
        };

      }

    }

  }

  return {

    score: `${best.home}-${best.away}`,

    probability:
      (best.probability * 100).toFixed(1) + "%"

  };

}


/* =========================================================
   RÉCUPÉRATION API
========================================================= */

async function apiRequest(endpoint) {

  if (!API_KEY) {

    throw new Error(
      "API_FOOTBALL_KEY est absente dans Render."
    );

  }

  const response = await fetch(
    API_URL + endpoint,
    {
      method: "GET",

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
      "Réponse API invalide."
    );

  }


  if (!response.ok) {

    throw new Error(
      JSON.stringify(
        data.errors || data
      )
    );

  }


  if (
    data.errors &&
    Object.keys(data.errors).length > 0
  ) {

    throw new Error(
      JSON.stringify(data.errors)
    );

  }


  return data;

}


/* =========================================================
   MATCHS DU JOUR
========================================================= */

async function getTodayFixtures() {

  const today =
    new Date()
      .toLocaleDateString(
        "en-CA",
        {
          timeZone: TIMEZONE
        }
      );


  const endpoint =
    `/fixtures?date=${today}` +
    `&timezone=${encodeURIComponent(TIMEZONE)}`;


  const data =
    await apiRequest(endpoint);


  if (
    !data.response ||
    !Array.isArray(data.response)
  ) {

    return [];

  }


  return data.response

    .filter(item => {

      const status =
        item.fixture?.status?.short;

      // uniquement les matchs pas encore commencés
      return status === "NS" ||
             status === "TBD";

    })

    .filter(item => {

      return (
        item.fixture?.id &&
        item.teams?.home?.id &&
        item.teams?.away?.id
      );

    })

    .sort(
      (a, b) =>
        number(a.fixture.timestamp) -
        number(b.fixture.timestamp)
    );

}


/* =========================================================
   EXTRACTION PRÉDICTION API
========================================================= */

function extractPrediction(apiData, fixture) {

  const response =
    apiData?.response?.[0];


  if (!response) {

    return null;

  }


  const predictions =
    response.predictions || {};


  const teams =
    response.teams || {};


  const percentData =
    predictions.percent || {};


  const winner =
    predictions.winner || {};


  let homeProbability =
    percent(
      percentData.home
    );


  let drawProbability =
    percent(
      percentData.draw
    );


  let awayProbability =
    percent(
      percentData.away
    );


  /*
   * Certains retours API peuvent être incomplets.
   */

  const total =
    homeProbability +
    drawProbability +
    awayProbability;


  if (total > 0) {

    homeProbability =
      homeProbability / total * 100;

    drawProbability =
      drawProbability / total * 100;

    awayProbability =
      awayProbability / total * 100;

  }


  /*
   * Score prévu par l'API.
   */

  let apiHomeGoals =
    number(
      predictions.goals?.home,
      NaN
    );


  let apiAwayGoals =
    number(
      predictions.goals?.away,
      NaN
    );


  /*
   * Si l'API ne donne pas de score,
   * on utilise les probabilités pour
   * construire une estimation raisonnable.
   */

  if (!Number.isFinite(apiHomeGoals)) {

    apiHomeGoals =
      0.8 +
      (homeProbability / 100) * 1.2;

  }


  if (!Number.isFinite(apiAwayGoals)) {

    apiAwayGoals =
      0.7 +
      (awayProbability / 100) * 1.1;

  }


  apiHomeGoals =
    Math.max(
      0.2,
      Math.min(
        4,
        apiHomeGoals
      )
    );


  apiAwayGoals =
    Math.max(
      0.2,
      Math.min(
        4,
        apiAwayGoals
      )
    );


  /*
   * Calcul Poisson du score exact.
   */

  const exactScore =
    calculateExactScore(
      apiHomeGoals,
      apiAwayGoals
    );


  /*
   * Score final API s'il existe.
   */

  const apiScore =
    predictions.goals?.home !== undefined &&
    predictions.goals?.away !== undefined
      ? `${predictions.goals.home}-${predictions.goals.away}`
      : exactScore.score;


  /*
   * Pourcentage principal.
   */

  const confidence =
    Math.max(
      homeProbability,
      drawProbability,
      awayProbability
    );


  /*
   * Double chance.
   */

  const oneX =
    homeProbability +
    drawProbability;


  const xTwo =
    drawProbability +
    awayProbability;


  /*
   * Choix principal.
   */

  let mainPick = "Nul";

  if (
    homeProbability >= drawProbability &&
    homeProbability >= awayProbability
  ) {

    mainPick =
      fixture.teams.home.name;

  } else if (
    awayProbability >= homeProbability &&
    awayProbability >= drawProbability
  ) {

    mainPick =
      fixture.teams.away.name;

  }


  /*
   * Analyse du score total.
   */

  const totalGoals =
    apiHomeGoals +
    apiAwayGoals;


  const underOver =
    predictions.under_over ||
    (
      totalGoals >= 2.5
        ? "Plus de 2.5"
        : "Moins de 2.5"
    );


  /*
   * BTTS calculé à partir du modèle.
   */

  const bttsProbability =
    (
      1 -
      poissonProbability(apiHomeGoals, 0)
    ) *
    (
      1 -
      poissonProbability(apiAwayGoals, 0)
    );


  const btts =
    bttsProbability >= 0.5
      ? "Oui"
      : "Non";


  /*
   * Score à la mi-temps estimé.
   */

  const halftimeHome =
    Math.max(
      0,
      Math.round(
        apiHomeGoals * 0.45
      )
    );


  const halftimeAway =
    Math.max(
      0,
      Math.round(
        apiAwayGoals * 0.45
      )
    );


  const halftimeScore =
    `${halftimeHome}-${halftimeAway}`;


  /*
   * Score de sélection.
   *
   * On favorise :
   * - probabilité du vainqueur
   * - probabilité du score exact
   * - cohérence du modèle
   */

  const selectionScore =
    (
      confidence * 0.65
    ) +
    (
      percent(
        exactScore.probability
      ) * 0.35
    );


  return {

    main_pick: mainPick,

    confidence:
      formatPercent(confidence),

    probabilities: {

      v1:
        formatPercent(homeProbability),

      draw:
        formatPercent(drawProbability),

      v2:
        formatPercent(awayProbability),

      "1x":
        formatPercent(oneX),

      x2:
        formatPercent(xTwo)

    },

    predicted_score:
      exactScore.score,

    exact_score:
      exactScore.score,

    exact_score_probability:
      exactScore.probability,

    api_predicted_score:
      apiScore,

    api_winner:
      winner.name ||
      "Non disponible",

    win_or_draw:
      predictions.win_or_draw !== undefined
        ? (
            predictions.win_or_draw
              ? "Oui"
              : "Non"
          )
        : "Non disponible",

    under_over:
      underOver,

    btts:
      btts,

    btts_probability:
      formatPercent(
        bttsProbability * 100
      ),

    halftime_score:
      halftimeScore,

    corners:
      "Non disponible",

    yellow_cards:
      "Non disponible",

    advice:
      predictions.advice ||
      "Analyse API + Poisson",

    selection_score:
      Number(
        selectionScore.toFixed(2)
      )

  };

}


/* =========================================================
   ANALYSE D'UN MATCH
========================================================= */

async function analyzeMatch(fixture) {

  try {

    const fixtureId =
      fixture.fixture.id;


    const data =
      await apiRequest(
        `/predictions?fixture=${fixtureId}`
      );


    const prediction =
      extractPrediction(
        data,
        fixture
      );


    if (!prediction) {

      return null;

    }


    return {

      match: {

        id:
          fixture.fixture.id,

        date:
          fixture.fixture.date,

        league:
          fixture.league?.name ||
          "Football",

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

      prediction: {

        ...prediction

      },

      analysis: {

        selection_score:
          prediction.selection_score,

        data_quality:
          100,

        recent_matches:
          "Non utilisé",

        h2h_count:
          0,

        poisson: {

          predicted_score:
            prediction.exact_score

        },

        api_prediction_available:
          true,

        api_probabilities_available:
          true,

        data_sources: {

          prediction:
            "ok",

          recent_form:
            "not_used",

          h2h:
            "not_used"

        },

        engine:
          "API prediction + Poisson + score exact",

        rank:
          0

      },

      available:
        true

    };

  } catch (error) {

    console.error(
      "Erreur analyse match:",
      error.message
    );

    return null;

  }

}


/* =========================================================
   ANALYSE PRINCIPALE
========================================================= */

async function buildPredictions() {

  /*
   * Récupération des matchs du jour :
   * 1 seule requête.
   */

  const fixtures =
    await getTodayFixtures();


  /*
   * On prend uniquement 7 candidats.
   */

  const candidates =
    fixtures.slice(
      0,
      CANDIDATES
    );


  const results = [];


  /*
   * Analyse séquentielle.
   *
   * Important :
   * cela évite d'envoyer 7 requêtes
   * exactement au même moment.
   */

  for (
    const fixture of candidates
  ) {

    const result =
      await analyzeMatch(
        fixture
      );


    if (result) {

      results.push(result);

    }


    /*
     * Petite pause entre les appels.
     */

    await sleep(700);

  }


  /*
   * Classement des 7 matchs.
   */

  results.sort(
    (a, b) =>
      b.prediction.selection_score -
      a.prediction.selection_score
  );


  /*
   * Seulement les 2 meilleurs.
   */

  const topTwo =
    results
      .slice(0, DISPLAY)
      .map(
        (item, index) => {

          item.analysis.rank =
            index + 1;

          return item;

        }
      );


  return {

    success:
      true,

    status:
      "ok",

    prediction_engine:
      "Prédiction API + Poisson + score exact",

    candidates_requested:
      CANDIDATES,

    candidates_analyzed:
      results.length,

    predictions:
      topTwo.length,

    displayed:
      topTwo.length,

    selection:
      "Top 2 après analyse complète des 7 candidats",

    rate_limit_protection:
      true,

    h2h_used:
      false,

    recent_form_used:
      false,

    matches:
      topTwo,

    date:
      new Date()
        .toLocaleDateString(
          "en-CA",
          {
            timeZone:
              TIMEZONE
          }
        )

  };

}


/* =========================================================
   ROUTE PRINCIPALE
========================================================= */

app.get(
  "/api/predictions",
  async (req, res) => {

    try {

      /*
       * Cache :
       * évite de consommer 8 requêtes
       * si l'utilisateur actualise plusieurs fois.
       */

      if (
        predictionCache.data &&
        Date.now() -
        predictionCache.time <
        CACHE_TIME
      ) {

        return res.json(
          predictionCache.data
        );

      }


      /*
       * Si une analyse est déjà en cours.
       */

      if (busy) {

        return res.status(429).json({

          success:
            false,

          error:
            "Analyse déjà en cours. Réessaie dans quelques secondes."

        });

      }


      busy = true;


      const data =
        await buildPredictions();


      predictionCache = {

        time:
          Date.now(),

        data

      };


      busy = false;


      return res.json(
        data
      );


    } catch (error) {

      busy = false;


      console.error(
        "BOT PREDICTOR ERROR:",
        error
      );


      return res.status(500).json({

        success:
          false,

        error:
          error.message,

        message:
          "Impossible de générer les prédictions."

      });

    }

  }
);


/* =========================================================
   ROUTE STATUS
========================================================= */

app.get(
  "/",
  (req, res) => {

    res.json({

      success:
        true,

      status:
        "ok",

      service:
        "BOT PREDICTOR",

      prediction_engine:
        "API prediction + Poisson + score exact",

      candidates_requested:
        CANDIDATES,

      displayed:
        DISPLAY,

      h2h_used:
        false,

      recent_form_used:
        false,

      api_key_configured:
        Boolean(API_KEY),

      rate_limit_protection:
        true,

      message:
        "Serveur opérationnel"

    });

  }
);


/* =========================================================
   LANCEMENT
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `BOT PREDICTOR démarré sur le port ${PORT}`
    );

  }
);
