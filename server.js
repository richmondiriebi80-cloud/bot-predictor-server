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
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

/* ==================================================
   API FOOTBALL
================================================== */

const API_KEY =
  String(process.env.API_FOOTBALL_KEY || "").trim();

const API_URL =
  "https://v3.football.api-sports.io";

async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(
    API_URL + endpoint,
    {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse invalide de API-Football."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      ": " +
      JSON.stringify(data.errors || data)
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
   DATE / HEURE ABIDJAN
================================================== */

function dateAbidjan() {

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

  const x = {};

  parts.forEach(p => {
    x[p.type] = p.value;
  });

  return (
    x.year +
    "-" +
    x.month +
    "-" +
    x.day
  );
}

function heureAbidjan(date) {

  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      timeZone: "Africa/Abidjan",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(new Date(date));
}

/* ==================================================
   OUTILS
================================================== */

function number(value) {

  const n =
    parseFloat(
      String(value ?? "")
        .replace("%", "")
    );

  return Number.isFinite(n) ? n : 0;
}

function moyenne(values) {

  const valid =
    values.filter(
      x => Number.isFinite(x)
    );

  if (!valid.length) {
    return 0;
  }

  return (
    valid.reduce(
      (a, b) => a + b,
      0
    ) / valid.length
  );
}

function scoreString(home, away) {

  if (
    home === null ||
    home === undefined ||
    away === null ||
    away === undefined
  ) {
    return null;
  }

  return home + "-" + away;
}

/* ==================================================
   HISTORIQUE LOCAL
================================================== */

const HISTORY_FILE =
  path.join(
    __dirname,
    "history.json"
  );

let history = [];

function chargerHistorique() {

  try {

    if (
      fs.existsSync(
        HISTORY_FILE
      )
    ) {

      const data =
        JSON.parse(
          fs.readFileSync(
            HISTORY_FILE,
            "utf8"
          )
        );

      history =
        Array.isArray(data)
          ? data
          : [];
    }

  } catch {

    history = [];
  }
}

function sauvegarderHistorique() {

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

chargerHistorique();

/* ==================================================
   FORMES
================================================== */

function analyserForme(
  fixtures,
  teamId
) {

  const matches =
    fixtures
      .filter(
        f =>
          f.fixture &&
          f.teams &&
          f.goals
      )
      .slice(0, 5);

  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  const form = [];

  for (const f of matches) {

    const isHome =
      f.teams.home.id === teamId;

    const gf =
      isHome
        ? f.goals.home
        : f.goals.away;

    const ga =
      isHome
        ? f.goals.away
        : f.goals.home;

    if (
      gf === null ||
      gf === undefined ||
      ga === null ||
      ga === undefined
    ) {
      continue;
    }

    goalsFor += gf;
    goalsAgainst += ga;

    if (gf > ga) {

      wins++;
      form.push("V");

    } else if (gf === ga) {

      draws++;
      form.push("N");

    } else {

      losses++;
      form.push("D");
    }
  }

  const total =
    wins + draws + losses;

  const points =
    wins * 3 + draws;

  return {

    matches: total,

    wins,
    draws,
    losses,

    points,

    pointsPerMatch:
      total
        ? points / total
        : 0,

    goalsFor,

    goalsAgainst,

    goalsForAverage:
      total
        ? goalsFor / total
        : 0,

    goalsAgainstAverage:
      total
        ? goalsAgainst / total
        : 0,

    form
  };
}

/* ==================================================
   ANALYSE H2H
================================================== */

function analyserH2H(
  fixtures,
  homeId,
  awayId
) {

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  for (const f of fixtures) {

    const homeGoals =
      f.goals?.home;

    const awayGoals =
      f.goals?.away;

    if (
      homeGoals === null ||
      homeGoals === undefined ||
      awayGoals === null ||
      awayGoals === undefined
    ) {
      continue;
    }

    const homeTeam =
      f.teams?.home?.id;

    const homeIsOurHome =
      homeTeam === homeId;

    const ourGoals =
      homeIsOurHome
        ? homeGoals
        : awayGoals;

    const theirGoals =
      homeIsOurHome
        ? awayGoals
        : homeGoals;

    totalHomeGoals += ourGoals;
    totalAwayGoals += theirGoals;

    if (ourGoals > theirGoals) {
      homeWins++;
    } else if (ourGoals === theirGoals) {
      draws++;
    } else {
      awayWins++;
    }
  }

  const total =
    homeWins +
    draws +
    awayWins;

  return {

    matches: total,

    homeWins,
    draws,
    awayWins,

    averageOurGoals:
      total
        ? totalHomeGoals / total
        : 0,

    averageOpponentGoals:
      total
        ? totalAwayGoals / total
        : 0
  };
}

/* ==================================================
   CALCUL SCORE D'ANALYSE
================================================== */

function calculerAnalyse(
  homeForm,
  awayForm,
  h2h,
  apiPrediction
) {

  /*
   * Score initial neutre.
   * Ce n'est PAS une garantie de résultat.
   */

  let homeScore = 50;
  let awayScore = 50;

  /*
   * Forme récente
   */

  homeScore +=
    (
      homeForm.pointsPerMatch -
      awayForm.pointsPerMatch
    ) * 8;

  awayScore +=
    (
      awayForm.pointsPerMatch -
      homeForm.pointsPerMatch
    ) * 8;

  /*
   * Attaque
   */

  homeScore +=
    (
      homeForm.goalsForAverage -
      awayForm.goalsAgainstAverage
    ) * 5;

  awayScore +=
    (
      awayForm.goalsForAverage -
      homeForm.goalsAgainstAverage
    ) * 5;

  /*
   * Défense
   */

  homeScore +=
    (
      awayForm.goalsAgainstAverage -
      homeForm.goalsAgainstAverage
    ) * 4;

  awayScore +=
    (
      homeForm.goalsAgainstAverage -
      awayForm.goalsAgainstAverage
    ) * 4;

  /*
   * H2H
   */

  if (h2h.matches > 0) {

    homeScore +=
      (
        h2h.homeWins -
        h2h.awayWins
      ) * 2;

    awayScore +=
      (
        h2h.awayWins -
        h2h.homeWins
      ) * 2;
  }

  /*
   * Prédiction API-Football comme
   * donnée complémentaire.
   */

  const percent =
    apiPrediction
      ?.predictions
      ?.percent || {};

  const apiHome =
    number(percent.home);

  const apiDraw =
    number(percent.draw);

  const apiAway =
    number(percent.away);

  homeScore +=
    apiHome * 0.15;

  awayScore +=
    apiAway * 0.15;

  /*
   * Normalisation
   */

  homeScore =
    Math.max(
      0,
      Math.min(100, homeScore)
    );

  awayScore =
    Math.max(
      0,
      Math.min(100, awayScore)
    );

  const drawScore =
    Math.max(
      0,
      100 -
      Math.abs(
        homeScore -
        awayScore
      )
    );

  const total =
    homeScore +
    awayScore +
    drawScore;

  const homePct =
    total
      ? homeScore / total * 100
      : 0;

  const awayPct =
    total
      ? awayScore / total * 100
      : 0;

  const drawPct =
    total
      ? drawScore / total * 100
      : 0;

  let type = "N";
  let confidence = drawPct;
  let text = "Match nul";

  if (
    homePct >=
    awayPct &&
    homePct >=
    drawPct
  ) {

    type = "1";
    confidence = homePct;

    text =
      "Victoire de l'équipe à domicile";

  } else if (
    awayPct >=
    homePct &&
    awayPct >=
    drawPct
  ) {

    type = "2";
    confidence = awayPct;

    text =
      "Victoire de l'équipe à l'extérieur";
  }

  return {

    type,
    text,

    confidence:
      Math.round(confidence),

    percentages: {

      home:
        Math.round(homePct),

      draw:
        Math.round(drawPct),

      away:
        Math.round(awayPct)
    }
  };
}

/* ==================================================
   DESCRIPTION ANALYSE
================================================== */

function construireTexteAnalyse(
  home,
  away,
  homeForm,
  awayForm,
  h2h,
  analyse
) {

  const lignes = [];

  lignes.push(
    "Forme récente " +
    home +
    ": " +
    homeForm.form.join(" ") +
    "."
  );

  lignes.push(
    "Forme récente " +
    away +
    ": " +
    awayForm.form.join(" ") +
    "."
  );

  lignes.push(
    home +
    " : " +
    homeForm.goalsForAverage.toFixed(2) +
    " but(s) marqué(s) par match, " +
    homeForm.goalsAgainstAverage.toFixed(2) +
    " encaissé(s)."
  );

  lignes.push(
    away +
    " : " +
    awayForm.goalsForAverage.toFixed(2) +
    " but(s) marqué(s) par match, " +
    awayForm.goalsAgainstAverage.toFixed(2) +
    " encaissé(s)."
  );

  if (h2h.matches > 0) {

    lignes.push(
      "Confrontations directes analysées : " +
      h2h.matches +
      "."
    );

  } else {

    lignes.push(
      "Aucune confrontation directe récente disponible."
    );
  }

  lignes.push(
    "Pronostic calculé : " +
    analyse.text +
    " (" +
    analyse.confidence +
    "%)."
  );

  return lignes.join(" ");
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
   TEST API
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
          data.results,

        response:
          data.response || {}
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
  }
);

/* ==================================================
   PREDICTION DETAILLEE
================================================== */

app.get(
  "/prediction/:fixture",
  async (req, res) => {

    try {

      const fixtureId =
        req.params.fixture;

      const fixtureData =
        await footballApi(
          "/fixtures?id=" +
          encodeURIComponent(
            fixtureId
          )
        );

      const fixture =
        fixtureData.response?.[0];

      if (!fixture) {

        return res.status(404).json({

          success: false,

          error:
            "Match introuvable."
        });
      }

      const homeId =
        fixture.teams.home.id;

      const awayId =
        fixture.teams.away.id;

      const [
        homeLast,
        awayLast,
        h2hData,
        predictionData
      ] =
        await Promise.all([

          footballApi(
            "/fixtures?team=" +
            homeId +
            "&last=5"
          ),

          footballApi(
            "/fixtures?team=" +
            awayId +
            "&last=5"
          ),

          footballApi(
            "/fixtures/headtohead?h2h=" +
            homeId +
            "-" +
            awayId +
            "&last=5"
          ),

          footballApi(
            "/predictions?fixture=" +
            fixtureId
          )
        ]);

      const homeForm =
        analyserForme(
          homeLast.response || [],
          homeId
        );

      const awayForm =
        analyserForme(
          awayLast.response || [],
          awayId
        );

      const h2h =
        analyserH2H(
          h2hData.response || [],
          homeId,
          awayId
        );

      const apiPrediction =
        predictionData.response?.[0] ||
        null;

      const analyse =
        calculerAnalyse(
          homeForm,
          awayForm,
          h2h,
          apiPrediction
        );

      res.json({

        success: true,

        fixture,

        analysis: {

          home_form:
            homeForm,

          away_form:
            awayForm,

          h2h,

          api_prediction:
            apiPrediction,

          final:
            analyse,

          explanation:
            construireTexteAnalyse(
              fixture.teams.home.name,
              fixture.teams.away.name,
              homeForm,
              awayForm,
              h2h,
              analyse
            )
        }
      });

    } catch (error) {

      console.error(
        "Erreur analyse:",
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
   PREDICTIONS DU JOUR
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();

      const fixturesData =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );

      let fixtures =
        fixturesData.response || [];

      /*
       * Uniquement les matchs réellement
       * à venir.
       */

      fixtures =
        fixtures.filter(
          match => {

            const status =
              match.fixture?.status?.short;

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

            return (
              !finished.includes(status) &&
              !live.includes(status) &&
              new Date(
                match.fixture.date
              ) > new Date()
            );
          }
        );

      fixtures.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );

      /*
       * On limite à deux analyses
       * afin de ne pas consommer
       * inutilement les 100 requêtes
       * quotidiennes.
       */

      const candidats =
        fixtures.slice(0, 2);

      const result = [];

      for (
        const match of candidats
      ) {

        try {

          const homeId =
            match.teams.home.id;

          const awayId =
            match.teams.away.id;

          const [
            homeLast,
            awayLast,
            h2hData,
            predictionData
          ] =
            await Promise.all([

              footballApi(
                "/fixtures?team=" +
                homeId +
                "&last=5"
              ),

              footballApi(
                "/fixtures?team=" +
                awayId +
                "&last=5"
              ),

              footballApi(
                "/fixtures/headtohead?h2h=" +
                homeId +
                "-" +
                awayId +
                "&last=5"
              ),

              footballApi(
                "/predictions?fixture=" +
                match.fixture.id
              )
            ]);

          const homeForm =
            analyserForme(
              homeLast.response || [],
              homeId
            );

          const awayForm =
            analyserForme(
              awayLast.response || [],
              awayId
            );

          const h2h =
            analyserH2H(
              h2hData.response || [],
              homeId,
              awayId
            );

          const apiPrediction =
            predictionData.response?.[0] ||
            null;

          const analyse =
            calculerAnalyse(
              homeForm,
              awayForm,
              h2h,
              apiPrediction
            );

          /*
           * NE PAS réutiliser les anciens scores
           * verts.
           *
           * Aucun ancien score n'est injecté
           * dans cette réponse.
           */

          const item = {

            match: {

              id:
                match.fixture.id,

              date:
                match.fixture.date,

              time:
                heureAbidjan(
                  match.fixture.date
                ),

              league:
                match.league?.name ||
                "Compétition",

              country:
                match.league?.country ||
                "",

              home: {

                id:
                  homeId,

                name:
                  match.teams.home.name,

                logo:
                  match.teams.home.logo
              },

              away: {

                id:
                  awayId,

                name:
                  match.teams.away.name,

                logo:
                  match.teams.away.logo
              }
            },

            prediction: {

              main_pick:
                analyse.text,

              type:
                analyse.type,

              confidence:
                analyse.confidence + "%",

              probabilities:
                analyse.percentages,

              /*
               * L'ancien score prédit
               * n'est volontairement plus
               * affiché ici.
               */

              goals:
                null,

              under_over:
                apiPrediction
                  ?.predictions
                  ?.under_over ||
                null,

              advice:
                apiPrediction
                  ?.predictions
                  ?.advice ||
                null
            },

            analysis: {

              home_form:
                homeForm,

              away_form:
                awayForm,

              h2h:
                h2h,

              explanation:
                construireTexteAnalyse(
                  match.teams.home.name,
                  match.teams.away.name,
                  homeForm,
                  awayForm,
                  h2h,
                  analyse
                )
            },

            sources: {

              api_football:
                true,

              recent_matches:
                true,

              head_to_head:
                h2h.matches > 0
            }
          };

          result.push(item);

          /*
           * Enregistrer seulement la nouvelle
           * analyse. Aucun ancien score vert
           * n'est repris.
           */

          const existing =
            history.find(
              h =>
                h.fixture_id ===
                match.fixture.id
            );

          if (!existing) {

            history.push({

              fixture_id:
                match.fixture.id,

              created_at:
                new Date().toISOString(),

              date:
                match.fixture.date,

              league:
                match.league?.name ||
                "Compétition",

              home:
                match.teams.home.name,

              away:
                match.teams.away.name,

              prediction: {

                type:
                  analyse.type,

                text:
                  analyse.text,

                confidence:
                  analyse.confidence
              },

              /*
               * Les scores sont vides avant
               * le match.
               */

              halftime_score:
                null,

              final_score:
                null,

              result:
                "EN_ATTENTE"
            });

            sauvegarderHistorique();
          }

        } catch (error) {

          console.log(
            "Analyse impossible:",
            match.fixture.id,
            error.message
          );
        }
      }

      res.json({

        success: true,

        date,

        analyzed_candidates:
          candidats.length,

        selected:
          result.length,

        matches:
          result
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
          encodeURIComponent(fixture) +
          "&half=true"
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
       * Vérification réelle des résultats
       * depuis API-Football.
       */

      const ids =
        history
          .map(
            h =>
              h.fixture_id
          )
          .filter(Boolean)
          .slice(-20);

      let fixtures = [];

      if (ids.length) {

        const data =
          await footballApi(
            "/fixtures?ids=" +
            ids.join("-") +
            "&timezone=Africa/Abidjan"
          );

        fixtures =
          data.response || [];
      }

      const map =
        new Map();

      fixtures.forEach(
        fixture => {

          map.set(
            fixture.fixture.id,
            fixture
          );
        }
      );

      history =
        history.map(item => {

          const fixture =
            map.get(
              item.fixture_id
            );

          if (!fixture) {

            return {

              ...item,

              result:
                "EN_ATTENTE"
            };
          }

          const status =
            fixture.fixture
              ?.status
              ?.short;

          const scores =
            fixture.score || {};

          const halftime =
            scoreString(
              scores.halftime?.home,
              scores.halftime?.away
            );

          const final =
            scoreString(
              scores.fulltime?.home,
              scores.fulltime?.away
            );

          let result =
            "EN_ATTENTE";

          if (
            [
              "FT",
              "AET",
              "PEN"
            ].includes(status)
          ) {

            const homeGoals =
              fixture.goals?.home;

            const awayGoals =
              fixture.goals?.away;

            if (
              homeGoals !== null &&
              homeGoals !== undefined &&
              awayGoals !== null &&
              awayGoals !== undefined
            ) {

              const type =
                item.prediction?.type;

              if (type === "1") {

                result =
                  homeGoals >
                  awayGoals
                    ? "GAGNE"
                    : "PERDU";

              } else if (
                type === "2"
              ) {

                result =
                  awayGoals >
                  homeGoals
                    ? "GAGNE"
                    : "PERDU";

              } else if (
                type === "N"
              ) {

                result =
                  homeGoals ===
                  awayGoals
                    ? "GAGNE"
                    : "PERDU";
              }
            }
          }

          return {

            ...item,

            status,

            /*
             * Ces données deviennent
             * réelles uniquement quand
             * API-Football les fournit.
             */

            halftime_score:
              halftime,

            final_score:
              final,

            result
          };
        });

      sauvegarderHistorique();

      const gagne =
        history.filter(
          x =>
            x.result ===
            "GAGNE"
        ).length;

      const perdu =
        history.filter(
          x =>
            x.result ===
            "PERDU"
        ).length;

      const attente =
        history.filter(
          x =>
            x.result ===
            "EN_ATTENTE"
        ).length;

      const termines =
        gagne + perdu;

      const taux =
        termines
          ? Math.round(
              gagne /
              termines *
              100
            )
          : 0;

      history.sort(
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

      const id =
        Number(
          req.params.fixture
        );

      const item =
        history.find(
          h =>
            h.fixture_id === id
        );

      if (!item) {

        return res.status(404).json({

          success: false,

          error:
            "Aucune analyse enregistrée."
        });
      }

      const data =
        await footballApi(
          "/fixtures?id=" +
          id
        );

      const fixture =
        data.response?.[0];

      if (fixture) {

        const scores =
          fixture.score || {};

        item.status =
          fixture.fixture
            ?.status
            ?.short;

        item.halftime_score =
          scoreString(
            scores.halftime?.home,
            scores.halftime?.away
          );

        item.final_score =
          scoreString(
            scores.fulltime?.home,
            scores.fulltime?.away
          );

        const homeGoals =
          fixture.goals?.home;

        const awayGoals =
          fixture.goals?.away;

        if (
          [
            "FT",
            "AET",
            "PEN"
          ].includes(
            item.status
          )
        ) {

          if (
            item.prediction?.type === "1"
          ) {

            item.result =
              homeGoals >
              awayGoals
                ? "GAGNE"
                : "PERDU";

          } else if (
            item.prediction?.type === "2"
          ) {

            item.result =
              awayGoals >
              homeGoals
                ? "GAGNE"
                : "PERDU";

          } else if (
            item.prediction?.type === "N"
          ) {

            item.result =
              homeGoals ===
              awayGoals
                ? "GAGNE"
                : "PERDU";
          }
        }

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
   DEMARRAGE
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
