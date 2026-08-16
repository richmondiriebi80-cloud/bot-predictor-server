const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY || process.env.API_KEY || "";

const API_HOST = "v3.football.api-sports.io";

const CANDIDATES = 7;
const DISPLAYED = 2;

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });

  res.end(body);
}

function apiRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      path,
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (response) => {
      let data = "";

      response.on("data", chunk => {
        data += chunk;
      });

      response.on("end", () => {
        try {
          const json = JSON.parse(data);

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                json?.errors
                  ? JSON.stringify(json.errors)
                  : `API HTTP ${response.statusCode}`
              )
            );
            return;
          }

          resolve(json);
        } catch (error) {
          reject(new Error("Réponse API invalide"));
        }
      });
    });

    req.on("error", reject);

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout API"));
    });

    req.end();
  });
}

function poissonProbability(lambda, goals) {
  let factorial = 1;

  for (let i = 2; i <= goals; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial
  );
}

function calculatePoisson(homeLambda, awayLambda) {
  const results = [];

  for (let homeGoals = 0; homeGoals <= 6; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals++) {
      const probability =
        poissonProbability(homeLambda, homeGoals) *
        poissonProbability(awayLambda, awayGoals);

      results.push({
        homeGoals,
        awayGoals,
        probability
      });
    }
  }

  results.sort((a, b) => b.probability - a.probability);

  const best = results[0];

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (const result of results) {
    if (result.homeGoals > result.awayGoals) {
      homeWin += result.probability;
    } else if (result.homeGoals === result.awayGoals) {
      draw += result.probability;
    } else {
      awayWin += result.probability;
    }
  }

  return {
    homeWin,
    draw,
    awayWin,
    exactScore: `${best.homeGoals}-${best.awayGoals}`,
    exactProbability: best.probability
  };
}

function percent(value) {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

function getApiPrediction(prediction) {
  if (!prediction) {
    return null;
  }

  const p = prediction.predictions || prediction;

  return {
    winner:
      p.winner?.name ||
      p.winner?.comment ||
      null,

    winOrDraw:
      p.win_or_draw ??
      null,

    underOver:
      p.under_over ??
      null,

    btts:
      p.btts ??
      null,

    advice:
      p.advice ??
      null,

    probabilities:
      p.percent ??
      p.probabilities ??
      null
  };
}

function calculateSelectionScore(poisson, apiPrediction) {
  let score = 0;

  const highest =
    Math.max(
      poisson.homeWin,
      poisson.draw,
      poisson.awayWin
    );

  score += highest * 60;

  if (apiPrediction?.winner) {
    score += 20;
  }

  if (
    apiPrediction?.winOrDraw === "Yes" ||
    apiPrediction?.winOrDraw === "Oui"
  ) {
    score += 10;
  }

  score += poisson.exactProbability * 100;

  return Math.min(100, score);
}

async function analyseMatch(fixture) {
  const home = fixture.teams?.home;
  const away = fixture.teams?.away;

  if (!home || !away) {
    return null;
  }

  let apiPrediction = null;

  try {
    const predictionData =
      await apiRequest(
        `/predictions?fixture=${fixture.fixture.id}`
      );

    if (
      predictionData?.response &&
      predictionData.response.length > 0
    ) {
      apiPrediction =
        getApiPrediction(
          predictionData.response[0]
        );
    }
  } catch (error) {
    apiPrediction = null;
  }

  /*
   * Poisson de base.
   *
   * H2H et forme récente volontairement
   * désactivés afin de rester compatible
   * avec le forfait API Free.
   */
  let homeLambda = 1.2;
  let awayLambda = 1.0;

  /*
   * Si l'API fournit un score prédit,
   * on peut légèrement l'utiliser.
   */
  const poisson =
    calculatePoisson(
      homeLambda,
      awayLambda
    );

  let mainPick;

  if (
    poisson.homeWin >= poisson.draw &&
    poisson.homeWin >= poisson.awayWin
  ) {
    mainPick = home.name;
  } else if (
    poisson.awayWin >= poisson.homeWin &&
    poisson.awayWin >= poisson.draw
  ) {
    mainPick = away.name;
  } else {
    mainPick = "Match nul";
  }

  if (apiPrediction?.winner) {
    mainPick = apiPrediction.winner;
  }

  const selectionScore =
    calculateSelectionScore(
      poisson,
      apiPrediction
    );

  const exactScore =
    poisson.exactScore;

  const underOver =
    apiPrediction?.underOver ||
    (
      homeLambda + awayLambda < 2.5
        ? "Moins de 2.5"
        : "Plus de 2.5"
    );

  const btts =
    apiPrediction?.btts ||
    (
      poisson.homeWin > 0 &&
      poisson.awayWin > 0
        ? "Calcul Poisson"
        : "Non disponible"
    );

  let advice =
    apiPrediction?.advice;

  if (!advice) {
    if (mainPick === "Match nul") {
      advice = "Match équilibré";
    } else {
      advice = `Privilégier ${mainPick}`;
    }
  }

  return {
    match: {
      id: fixture.fixture.id,
      date: fixture.fixture.date,
      league:
        fixture.league?.name ||
        "Football",
      country:
        fixture.league?.country ||
        "",
      home: {
        id: home.id,
        name: home.name,
        logo: home.logo
      },
      away: {
        id: away.id,
        name: away.name,
        logo: away.logo
      }
    },

    prediction: {
      main_pick: mainPick,

      confidence:
        `${selectionScore.toFixed(1)}%`,

      probabilities: {
        v1: percent(poisson.homeWin),
        draw: percent(poisson.draw),
        v2: percent(poisson.awayWin),
        "1x":
          percent(
            poisson.homeWin +
            poisson.draw
          ),
        x2:
          percent(
            poisson.draw +
            poisson.awayWin
          )
      },

      predicted_score: exactScore,

      exact_score: exactScore,

      exact_score_probability:
        percent(
          poisson.exactProbability
        ),

      api_winner:
        apiPrediction?.winner ||
        "Non disponible",

      win_or_draw:
        apiPrediction?.winOrDraw ||
        percent(
          poisson.homeWin +
          poisson.draw
        ),

      under_over: underOver,

      btts: btts,

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice: advice
    },

    analysis: {
      selection_score:
        Number(
          selectionScore.toFixed(2)
        ),

      data_quality:
        apiPrediction ? 100 : 70,

      recent_matches:
        "Non disponible avec le plan API Free",

      h2h_count: 0,

      poisson: {
        home_lambda: homeLambda,
        away_lambda: awayLambda,
        predicted_score: exactScore
      },

      api_prediction_available:
        Boolean(apiPrediction),

      api_probabilities_available:
        Boolean(
          apiPrediction?.probabilities
        ),

      data_sources: {
        prediction:
          apiPrediction
            ? "ok"
            : "unavailable",

        recent_form:
          "unavailable",

        h2h:
          "disabled"
      },

      errors: {
        recent_form:
          "Désactivé pour respecter le forfait API Free",

        h2h:
          "Désactivé volontairement",

        prediction:
          apiPrediction
            ? null
            : "Prédiction API indisponible"
      },

      seasons_used: false,

      engine:
        "Prédiction API + Poisson + score exact probable"
    },

    available: true
  };
}

async function getPredictions() {
  if (!API_KEY) {
    throw new Error(
      "Clé API manquante. Ajoute API_FOOTBALL_KEY dans les variables d'environnement Render."
    );
  }

  const today =
    new Date().toISOString().slice(0, 10);

  /*
   * UNE seule requête pour récupérer
   * les matchs du jour.
   */
  const fixturesData =
    await apiRequest(
      `/fixtures?date=${today}&status=NS`
    );

  const fixtures =
    Array.isArray(fixturesData?.response)
      ? fixturesData.response
      : [];

  /*
   * On garde 7 candidats maximum.
   */
  const candidates =
    fixtures
      .filter(item =>
        item?.fixture?.id &&
        item?.teams?.home &&
        item?.teams?.away
      )
      .slice(0, CANDIDATES);

  const analysed = [];

  /*
   * Maximum 7 appels /predictions.
   * Cela évite volontairement les H2H
   * et les requêtes "last".
   */
  for (const fixture of candidates) {
    try {
      const result =
        await analyseMatch(fixture);

      if (result) {
        analysed.push(result);
      }
    } catch (error) {
      console.error(
        "Erreur analyse match:",
        error.message
      );
    }
  }

  analysed.sort(
    (a, b) =>
      b.analysis.selection_score -
      a.analysis.selection_score
  );

  const topTwo =
    analysed
      .slice(0, DISPLAYED)
      .map((item, index) => {
        item.analysis.rank =
          index + 1;

        return item;
      });

  return {
    success: true,

    status: "ok",

    prediction_engine:
      "Prédiction API + Poisson + score exact probable",

    candidates_requested:
      CANDIDATES,

    candidates_analyzed:
      candidates.length,

    predictions:
      topTwo.length,

    displayed:
      topTwo.length,

    selection:
      "Top 2 après analyse complète",

    rate_limit_protection:
      true,

    h2h:
      false,

    matches:
      topTwo,

    recent_matches:
      "Non disponible avec le plan API Free",

    seasons_used:
      false,

    date:
      today
  };
}

const server =
  http.createServer(
    async (req, res) => {

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Requested-With"
        });

        res.end();
        return;
      }

      const parsed =
        new URL(
          req.url,
          `http://${req.headers.host}`
        );

      /*
       * Test simple du serveur.
       */
      if (
        parsed.pathname === "/" ||
        parsed.pathname === "/health"
      ) {
        sendJSON(res, 200, {
          success: true,
          status: "ok",
          service: "BOT PREDICTOR",
          prediction_engine:
            "Prédiction API + Poisson + score exact probable",
          candidates_requested:
            CANDIDATES,
          displayed:
            DISPLAYED,
          api_key_configured:
            Boolean(API_KEY),
          rate_limit_protection:
            true,
          h2h:
            false,
          message:
            "Serveur opérationnel"
        });

        return;
      }

      /*
       * Endpoint utilisé par l'application.
       */
      if (
        parsed.pathname === "/api/predictions"
      ) {
        try {
          const result =
            await getPredictions();

          sendJSON(
            res,
            200,
            result
          );

        } catch (error) {

          console.error(
            "BOT PREDICTOR ERROR:",
            error
          );

          sendJSON(
            res,
            500,
            {
              success: false,
              status: "error",
              error: error.message,
              h2h: false,
              rate_limit_protection: true
            }
          );
        }

        return;
      }

      sendJSON(
        res,
        404,
        {
          success: false,
          error: "Endpoint introuvable"
        }
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `BOT PREDICTOR server running on port ${PORT}`
    );
  }
);
