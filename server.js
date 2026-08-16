const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;
const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.API_KEY ||
  "";

const API_HOST = "v3.football.api-sports.io";

const CANDIDATES = 7;
const DISPLAY = 2;

// Cache pour éviter les appels répétés
let cache = null;
let cacheTime = 0;

const CACHE_DURATION = 60 * 1000;

function apiRequest(path) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: API_HOST,
        path,
        method: "GET",
        headers: {
          "x-apisports-key": API_KEY,
          "Accept": "application/json"
        }
      },
      (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          try {
            const json = JSON.parse(data);

            if (response.statusCode >= 400) {
              reject(
                new Error(
                  json?.message ||
                  json?.errors?.message ||
                  `API HTTP ${response.statusCode}`
                )
              );
              return;
            }

            resolve(json);
          } catch {
            reject(new Error("Réponse API invalide"));
          }
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function factorial(n) {
  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(lambda, goals) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

/*
 * Calcule les probabilités 1 / X / 2
 * et recherche le score exact le plus probable.
 */
function calculatePoisson(homeLambda, awayLambda) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestScore = "1-1";
  let bestProbability = 0;

  for (let homeGoals = 0; homeGoals <= 7; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals++) {
      const probability =
        poisson(homeLambda, homeGoals) *
        poisson(awayLambda, awayGoals);

      if (homeGoals > awayGoals) {
        homeWin += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (probability > bestProbability) {
        bestProbability = probability;

        bestScore =
          `${homeGoals}-${awayGoals}`;
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

function percentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/*
 * Essa fonction utilise les données de prédiction API
 * lorsqu'elles existent.
 *
 * Si l'API Free ne fournit pas certaines données,
 * on utilise une estimation Poisson neutre plutôt
 * que d'inventer une forme récente.
 */
function buildPrediction(fixture, apiPrediction) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;

  let homeLambda = 1.2;
  let awayLambda = 1.0;

  const apiGoals =
    apiPrediction?.predictions?.goals;

  if (
    apiGoals &&
    typeof apiGoals.home === "number" &&
    typeof apiGoals.away === "number"
  ) {
    homeLambda =
      Math.max(0.2, apiGoals.home);

    awayLambda =
      Math.max(0.2, apiGoals.away);
  }

  const poissonResult =
    calculatePoisson(
      homeLambda,
      awayLambda
    );

  let v1 = poissonResult.homeWin;
  let draw = poissonResult.draw;
  let v2 = poissonResult.awayWin;

  /*
   * Si l'API donne ses propres pourcentages,
   * on les utilise.
   */
  const apiPercent =
    apiPrediction?.predictions?.percent;

  if (
    apiPercent?.home &&
    apiPercent?.draw &&
    apiPercent?.away
  ) {
    const apiHome =
      parseFloat(apiPercent.home);

    const apiDraw =
      parseFloat(apiPercent.draw);

    const apiAway =
      parseFloat(apiPercent.away);

    if (
      Number.isFinite(apiHome) &&
      Number.isFinite(apiDraw) &&
      Number.isFinite(apiAway)
    ) {
      v1 = apiHome / 100;
      draw = apiDraw / 100;
      v2 = apiAway / 100;
    }
  }

  const maximum =
    Math.max(v1, draw, v2);

  let mainPick;

  if (maximum === v1) {
    mainPick = home.name;
  } else if (maximum === v2) {
    mainPick = away.name;
  } else {
    mainPick = "Match nul";
  }

  const oneX = v1 + draw;
  const x2 = draw + v2;

  /*
   * Marché +/− 2.5 buts.
   */
  const totalLambda =
    homeLambda + awayLambda;

  const probabilityUnder25 =
    Math.exp(-totalLambda) *
    (
      1 +
      totalLambda +
      Math.pow(totalLambda, 2) / 2
    );

  const underOver =
    probabilityUnder25 >= 0.5
      ? "Moins de 2.5"
      : "Plus de 2.5";

  /*
   * BTTS calculé avec Poisson.
   */
  const homeZero =
    Math.exp(-homeLambda);

  const awayZero =
    Math.exp(-awayLambda);

  const bttsYes =
    1 -
    homeZero -
    awayZero +
    Math.exp(-totalLambda);

  const btts =
    bttsYes >= 0.5
      ? "Oui"
      : "Non";

  /*
   * Score exact probable.
   */
  const exactScore =
    poissonResult.bestScore;

  const exactScoreProbability =
    poissonResult.bestProbability;

  const confidence =
    maximum * 100;

  /*
   * Score de sélection.
   *
   * On ne prétend pas avoir la forme récente
   * puisque le forfait Free ne donne pas le
   * paramètre "last".
   */
  const selectionScore =
    confidence;

  const apiWinner =
    apiPrediction?.predictions?.winner?.name ||
    null;

  const advice =
    apiPrediction?.predictions?.advice ||
    (
      mainPick === "Match nul"
        ? "Match équilibré"
        : `Avantage ${mainPick}`
    );

  return {
    match: {
      id: fixture.fixture.id,

      date: fixture.fixture.date,

      league:
        fixture.league?.name ||
        "Football",

      country:
        fixture.league?.country ||
        "Monde",

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
        v1: percentage(v1),
        draw: percentage(draw),
        v2: percentage(v2),
        "1x": percentage(oneX),
        x2: percentage(x2)
      },

      /*
       * Score probable à la fin du match.
       */
      predicted_score:
        exactScore,

      exact_score:
        exactScore,

      exact_score_probability:
        percentage(exactScoreProbability),

      api_winner:
        apiWinner || "Non disponible",

      win_or_draw:
        percentage(oneX),

      under_over:
        underOver,

      btts:
        btts,

      halftime_score:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible",

      advice:
        advice
    },

    analysis: {
      selection_score:
        Number(selectionScore.toFixed(2)),

      /*
       * 100 signifie seulement que les données
       * utilisées sont valides, pas que la prédiction
       * est garantie.
       */
      data_quality:
        apiPrediction ? 100 : 70,

      recent_matches:
        "Non disponible avec le plan API Free",

      h2h_count:
        0,

      poisson: {
        home_lambda:
          Number(homeLambda.toFixed(2)),

        away_lambda:
          Number(awayLambda.toFixed(2)),

        predicted_score:
          exactScore
      },

      api_prediction_available:
        !!apiPrediction,

      api_probabilities_available:
        !!(
          apiPrediction?.predictions?.percent
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
          "Désactivé : paramètre last indisponible sur le forfait Free",

        h2h:
          "Désactivé volontairement",

        prediction:
          apiPrediction
            ? null
            : "Prédiction API indisponible"
      },

      seasons_used:
        false,

      engine:
        "Prédiction API + Poisson + score exact probable"
    },

    available:
      true
  };
}

/*
 * Récupération des matchs du jour.
 */
async function getFixtures() {
  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const result =
    await apiRequest(
      `/fixtures?date=${today}&status=NS`
    );

  return result?.response || [];
}

/*
 * Une seule prédiction API par match.
 *
 * Aucun appel H2H.
 * Aucun appel avec "last".
 */
async function getPrediction(fixtureId) {
  try {
    const result =
      await apiRequest(
        `/predictions?fixture=${fixtureId}`
      );

    return (
      result?.response?.[0] ||
      null
    );
  } catch (error) {
    console.error(
      `Prediction ${fixtureId}:`,
      error.message
    );

    return null;
  }
}

/*
 * Analyse des 7 candidats.
 */
async function generatePredictions() {
  const now =
    Date.now();

  /*
   * Utilise le cache si disponible.
   */
  if (
    cache &&
    now - cacheTime <
      CACHE_DURATION
  ) {
    return cache;
  }

  const fixtures =
    await getFixtures();

  /*
   * Maximum 7 candidats.
   */
  const candidates =
    fixtures.slice(
      0,
      CANDIDATES
    );

  const analyzed = [];

  for (const fixture of candidates) {
    const apiPrediction =
      await getPrediction(
        fixture.fixture.id
      );

    const result =
      buildPrediction(
        fixture,
        apiPrediction
      );

    analyzed.push(result);
  }

  /*
   * Classement.
   */
  analyzed.sort(
    (a, b) =>
      b.analysis.selection_score -
      a.analysis.selection_score
  );

  /*
   * On affiche uniquement les 2 meilleurs.
   */
  const topTwo =
    analyzed
      .slice(0, DISPLAY)
      .map((item, index) => ({
        ...item,

        analysis: {
          ...item.analysis,

          rank:
            index + 1
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
      new Date()
        .toISOString()
        .slice(0, 10)
  };

  cache =
    result;

  cacheTime =
    Date.now();

  return result;
}

/*
 * Réponse JSON avec CORS intégré.
 *
 * Aucun package cors nécessaire.
 */
function sendJson(
  response,
  status,
  data
) {
  response.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "GET, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type"
    }
  );

  response.end(
    JSON.stringify(data)
  );
}

const server =
  http.createServer(
    async (request, response) => {

      /*
       * CORS preflight.
       */
      if (
        request.method ===
        "OPTIONS"
      ) {
        sendJson(
          response,
          200,
          {
            success: true
          }
        );

        return;
      }

      /*
       * Page principale / Health check.
       */
      if (
        request.method === "GET" &&
        request.url === "/"
      ) {
        sendJson(
          response,
          200,
          {
            success: true,

            status: "ok",

            service:
              "BOT PREDICTOR",

            prediction_engine:
              "Prédiction API + Poisson + score exact probable",

            candidates_requested:
              CANDIDATES,

            displayed:
              DISPLAY,

            api_key_configured:
              Boolean(API_KEY),

            rate_limit_protection:
              true,

            h2h:
              false,

            message:
              "Serveur opérationnel"
          }
        );

        return;
      }

      /*
       * Endpoint principal.
       */
      if (
        request.method === "GET" &&
        request.url.startsWith(
          "/api/predictions"
        )
      ) {
        try {
          const result =
            await generatePredictions();

          sendJson(
            response,
            200,
            result
          );

        } catch (error) {
          console.error(
            "SERVER ERROR:",
            error
          );

          sendJson(
            response,
            500,
            {
              success: false,

              error:
                error.message ||
                "Erreur serveur"
            }
          );
        }

        return;
      }

      /*
       * Route inconnue.
       */
      sendJson(
        response,
        404,
        {
          success: false,
          error:
            "Route introuvable"
        }
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================="
    );

    console.log(
      "BOT PREDICTOR - SERVEUR"
    );

    console.log(
      "================================="
    );

    console.log(
      `Port : ${PORT}`
    );

    console.log(
      `API configurée : ${Boolean(API_KEY)}`
    );

    console.log(
      `Candidats : ${CANDIDATES}`
    );

    console.log(
      `Affichage : ${DISPLAY}`
    );

    console.log(
      "H2H : désactivé"
    );

    console.log(
      "Forme récente : désactivée"
    );

    console.log(
      "Poisson : activé"
    );

    console.log(
      "Score exact probable : activé"
    );

    console.log(
      "================================="
    );
  }
);
