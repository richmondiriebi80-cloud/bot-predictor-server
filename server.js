const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY || process.env.API_KEY || "";

const API_HOST = "v3.football.api-sports.io";

const CANDIDATES = 7;
const DISPLAY = 2;

let lastRequest = 0;
let cachedPredictions = null;
let cachedAt = 0;

const CACHE_TIME = 60 * 1000;

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

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const json = JSON.parse(data);

          if (res.statusCode >= 400) {
            reject(
              new Error(
                json?.message ||
                json?.errors?.message ||
                `API HTTP ${res.statusCode}`
              )
            );
            return;
          }

          resolve(json);
        } catch (e) {
          reject(new Error("Réponse API invalide"));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function poisson(lambda, k) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poissonMatch(lambdaHome, lambdaAway) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestScore = "1-0";
  let bestProbability = 0;

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const probability =
        poisson(lambdaHome, h) *
        poisson(lambdaAway, a);

      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;

      if (probability > bestProbability) {
        bestProbability = probability;
        bestScore = `${h}-${a}`;
      }
    }
  }

  return {
    homeWin,
    draw,
    awayWin,
    bestScore,
    bestProbability
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function calculatePoisson(apiPrediction) {
  let homeLambda = 1.2;
  let awayLambda = 1.0;

  const advice =
    apiPrediction?.predictions?.advice || "";

  const score =
    apiPrediction?.predictions?.goals;

  if (
    score &&
    typeof score.home === "number" &&
    typeof score.away === "number"
  ) {
    homeLambda = Math.max(0.3, score.home);
    awayLambda = Math.max(0.3, score.away);
  }

  const result =
    poissonMatch(homeLambda, awayLambda);

  return {
    homeLambda,
    awayLambda,
    ...result,
    apiAdvice: advice
  };
}

function buildPrediction(fixture, apiPrediction) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;

  const poissonData =
    calculatePoisson(apiPrediction);

  let v1 = poissonData.homeWin;
  let draw = poissonData.draw;
  let v2 = poissonData.awayWin;

  /*
   * Si l'API fournit ses propres probabilités,
   * on les utilise.
   */
  const apiPred =
    apiPrediction?.predictions;

  if (
    apiPred?.percent &&
    apiPred.percent.home &&
    apiPred.percent.draw &&
    apiPred.percent.away
  ) {
    v1 =
      parseFloat(apiPred.percent.home) / 100;

    draw =
      parseFloat(apiPred.percent.draw) / 100;

    v2 =
      parseFloat(apiPred.percent.away) / 100;
  }

  const max =
    Math.max(v1, draw, v2);

  let mainPick;

  if (max === v1) {
    mainPick = home.name;
  } else if (max === v2) {
    mainPick = away.name;
  } else {
    mainPick = "Match nul";
  }

  const oneX = v1 + draw;
  const x2 = draw + v2;

  const totalLambda =
    poissonData.homeLambda +
    poissonData.awayLambda;

  const under25 =
    Math.exp(-totalLambda) *
    (
      1 +
      totalLambda +
      (Math.pow(totalLambda, 2) / 2)
    );

  const over25 =
    1 - under25;

  /*
   * Score exact probable calculé
   * pour la fin du match.
   */
  const exactScore =
    poissonData.bestScore;

  const confidence =
    max * 100;

  const selectionScore =
    confidence;

  return {
    match: {
      id: fixture.fixture.id,
      date: fixture.fixture.date,
      league:
        fixture.league?.name || "Football",
      country:
        fixture.league?.country || "Monde",
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
        `${confidence.toFixed(1)}%`,

      probabilities: {
        v1: percent(v1),
        draw: percent(draw),
        v2: percent(v2),
        "1x": percent(oneX),
        x2: percent(x2)
      },

      predicted_score:
        exactScore,

      exact_score:
        exactScore,

      exact_score_probability:
        percent(poissonData.bestProbability),

      api_winner:
        apiPred?.winner?.name ||
        mainPick,

      win_or_draw:
        percent(oneX),

      under_over:
        under25 >= 0.5
          ? "Moins de 2.5"
          : "Plus de 2.5",

      btts:
        "Calcul Poisson",

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        apiPred?.advice ||
        "Analyse API + Poisson"
    },

    analysis: {
      selection_score:
        Number(selectionScore.toFixed(2)),

      data_quality: 100,

      recent_matches:
        "Non disponible avec le plan API actuel",

      h2h_count: 0,

      poisson: {
        home_lambda:
          Number(poissonData.homeLambda.toFixed(2)),

        away_lambda:
          Number(poissonData.awayLambda.toFixed(2)),

        predicted_score:
          exactScore
      },

      api_prediction_available:
        !!apiPrediction,

      data_sources: {
        prediction:
          apiPrediction ? "ok" : "unavailable",

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
          apiPrediction ? null : "Indisponible"
      },

      seasons_used: false,

      engine:
        "Prédiction API + Poisson + score exact probable"
    },

    available: true
  };
}

async function getFixtures() {
  /*
   * On demande les matchs du jour.
   */
  const today =
    new Date().toISOString().slice(0, 10);

  const response =
    await apiRequest(
      `/fixtures?date=${today}&status=NS`
    );

  return response?.response || [];
}

async function getApiPrediction(fixtureId) {
  try {
    const response =
      await apiRequest(
        `/predictions?fixture=${fixtureId}`
      );

    return response?.response?.[0] || null;
  } catch (error) {
    return null;
  }
}

async function generatePredictions() {
  /*
   * Protection contre trop de requêtes.
   */
  const now = Date.now();

  if (
    cachedPredictions &&
    now - cachedAt < CACHE_TIME
  ) {
    return cachedPredictions;
  }

  if (
    now - lastRequest < 6000
  ) {
    if (cachedPredictions) {
      return cachedPredictions;
    }
  }

  lastRequest = now;

  const fixtures =
    await getFixtures();

  /*
   * On limite à 7 candidats.
   */
  const candidates =
    fixtures.slice(0, CANDIDATES);

  const analyzed = [];

  /*
   * Une requête API de prédiction par candidat.
   * Aucun H2H et aucune requête "last".
   */
  for (const fixture of candidates) {
    const apiPrediction =
      await getApiPrediction(
        fixture.fixture.id
      );

    const prediction =
      buildPrediction(
        fixture,
        apiPrediction
      );

    analyzed.push(prediction);
  }

  /*
   * Classement par qualité/précision.
   */
  analyzed.sort(
    (a, b) =>
      b.analysis.selection_score -
      a.analysis.selection_score
  );

  /*
   * Seulement les 2 meilleurs sont affichés.
   */
  const topTwo =
    analyzed
      .slice(0, DISPLAY)
      .map((item, index) => ({
        ...item,
        analysis: {
          ...item.analysis,
          rank: index + 1
        }
      }));

  const result = {
    success: true,

    status: "ok",

    prediction_engine:
      "Prédiction API + Poisson + score exact probable",

    candidates_requested:
      CANDIDATES,

    candidates_analyzed:
      analyzed.length,

    predictions:
      topTwo.length,

    displayed:
      DISPLAY,

    selection:
      "Top 2 après analyse complète",

    rate_limit_protection:
      true,

    h2h:
      false,

    matches:
      topTwo,

    recent_matches:
      "Non disponible avec le plan API actuel",

    seasons_used:
      false,

    date:
      new Date().toISOString().slice(0, 10)
  };

  cachedPredictions = result;
  cachedAt = Date.now();

  return result;
}

function sendJson(res, status, data) {
  const body =
    JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  });

  res.end(body);
}

const server =
  http.createServer(
    async (req, res) => {

      /*
       * CORS sans package cors.
       */
      if (req.method === "OPTIONS") {
        sendJson(res, 200, {
          success: true
        });

        return;
      }

      const url =
        new URL(
          req.url,
          `http://${req.headers.host}`
        );

      /*
       * Health check Render.
       */
      if (
        req.method === "GET" &&
        url.pathname === "/"
      ) {
        sendJson(res, 200, {
          success: true,
          status: "ok",
          service: "BOT PREDICTOR",

          prediction_engine:
            "Prédiction API + Poisson + score exact probable",

          candidates_requested:
            CANDIDATES,

          displayed:
            DISPLAY,

          api_key_configured:
            !!API_KEY,

          h2h:
            false,

          rate_limit_protection:
            true,

          message:
            "Serveur opérationnel"
        });

        return;
      }

      /*
       * Endpoint prédictions.
       */
      if (
        req.method === "GET" &&
        url.pathname === "/api/predictions"
      ) {
        try {
          const result =
            await generatePredictions();

          sendJson(
            res,
            200,
            result
          );

        } catch (error) {

          console.error(
            "Prediction error:",
            error
          );

          sendJson(res, 500, {
            success: false,

            error:
              error.message ||
              "Erreur serveur",

            message:
              "Impossible de générer les prédictions"
          });
        }

        return;
      }

      sendJson(res, 404, {
        success: false,
        error: "Route introuvable"
      });
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `BOT PREDICTOR démarré sur le port ${PORT}`
    );

    console.log(
      `API key configurée : ${!!API_KEY}`
    );

    console.log(
      `Candidats : ${CANDIDATES}`
    );

    console.log(
      `Matchs affichés : ${DISPLAY}`
    );

    console.log(
      "H2H : désactivé"
    );
  }
);
