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
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


/* ==================================================
   CONFIGURATION API-FOOTBALL
================================================== */

const API_KEY = process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


async function footballApi(endpoint) {

  if (!API_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );
  }

  const response = await fetch(
    API + endpoint,
    {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "Accept": "application/json"
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(
      "Réponse invalide de API-Football."
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
    ).format(
      new Date(date)
    );

  } catch (e) {

    return "";

  }
}


/* ==================================================
   POURCENTAGE
================================================== */

function pct(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  return (
    parseFloat(
      String(value)
        .replace("%", "")
    ) || 0
  );
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


function chargerHistorique() {

  try {

    if (
      fs.existsSync(
        HISTORY_FILE
      )
    ) {

      const content =
        fs.readFileSync(
          HISTORY_FILE,
          "utf8"
        );

      history =
        JSON.parse(content);

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
    new Date(
      match.fixture.date
    ) > new Date()
  );
}


/* ==================================================
   SCORE REEL
================================================== */

function scoreReel(fixture) {

  const score =
    fixture?.score || {};

  const ht =
    score.halftime || {};

  const ft =
    score.fulltime || {};

  let halftime = null;
  let fulltime = null;

  if (
    ht.home !== null &&
    ht.home !== undefined &&
    ht.away !== null &&
    ht.away !== undefined
  ) {

    halftime =
      ht.home +
      "-" +
      ht.away;

  }

  if (
    ft.home !== null &&
    ft.home !== undefined &&
    ft.away !== null &&
    ft.away !== undefined
  ) {

    fulltime =
      ft.home +
      "-" +
      ft.away;

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
   RESULTAT PRONOSTIC
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

  const homeGoals =
    fixture.goals?.home;

  const awayGoals =
    fixture.goals?.away;

  if (
    homeGoals === null ||
    homeGoals === undefined ||
    awayGoals === null ||
    awayGoals === undefined
  ) {
    return "EN_ATTENTE";
  }

  if (selection === "1") {

    return homeGoals > awayGoals
      ? "GAGNE"
      : "PERDU";

  }

  if (selection === "2") {

    return awayGoals > homeGoals
      ? "GAGNE"
      : "PERDU";

  }

  if (selection === "N") {

    return homeGoals === awayGoals
      ? "GAGNE"
      : "PERDU";

  }

  return "EN_ATTENTE";
}


/* ==================================================
   FORMATION DE LA FORME
================================================== */

function analyserForme(
  matches,
  teamId
) {

  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  const results = [];

  for (const match of matches || []) {

    const homeId =
      match.teams?.home?.id;

    const awayId =
      match.teams?.away?.id;

    const homeGoals =
      match.goals?.home;

    const awayGoals =
      match.goals?.away;

    if (
      homeGoals === null ||
      homeGoals === undefined ||
      awayGoals === null ||
      awayGoals === undefined
    ) {
      continue;
    }

    let gf = 0;
    let ga = 0;

    let result = "";

    if (homeId === teamId) {

      gf = homeGoals;
      ga = awayGoals;

      if (homeGoals > awayGoals) {
        wins++;
        result = "V";
      } else if (homeGoals === awayGoals) {
        draws++;
        result = "N";
      } else {
        losses++;
        result = "D";
      }

    } else if (awayId === teamId) {

      gf = awayGoals;
      ga = homeGoals;

      if (awayGoals > homeGoals) {
        wins++;
        result = "V";
      } else if (awayGoals === homeGoals) {
        draws++;
        result = "N";
      } else {
        losses++;
        result = "D";
      }

    } else {
      continue;
    }

    goalsFor += gf;
    goalsAgainst += ga;

    results.push(result);
  }

  const total =
    wins + draws + losses;

  const points =
    wins * 3 + draws;

  const formScore =
    total > 0
      ? (points / (total * 3)) * 100
      : 0;

  const avgGoalsFor =
    total > 0
      ? goalsFor / total
      : 0;

  const avgGoalsAgainst =
    total > 0
      ? goalsAgainst / total
      : 0;

  return {

    total,
    wins,
    draws,
    losses,

    goalsFor,
    goalsAgainst,

    avgGoalsFor,
    avgGoalsAgainst,

    formScore,

    results

  };
}


/* ==================================================
   H2H
================================================== */

function analyserH2H(
  matches,
  homeId,
  awayId
) {

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let total = 0;

  for (const match of matches || []) {

    const home =
      match.teams?.home?.id;

    const away =
      match.teams?.away?.id;

    const hg =
      match.goals?.home;

    const ag =
      match.goals?.away;

    if (
      hg === null ||
      hg === undefined ||
      ag === null ||
      ag === undefined
    ) {
      continue;
    }

    if (
      home === homeId &&
      away === awayId
    ) {

      total++;

      if (hg > ag) {
        homeWins++;
      } else if (hg === ag) {
        draws++;
      } else {
        awayWins++;
      }

    } else if (
      home === awayId &&
      away === homeId
    ) {

      total++;

      if (ag > hg) {
        homeWins++;
      } else if (ag === hg) {
        draws++;
      } else {
        awayWins++;
      }

    }

  }

  return {

    total,

    homeWins,

    draws,

    awayWins

  };

}


/* ==================================================
   CHOIX DU PRONOSTIC
================================================== */

function calculerPronostic(
  homeForm,
  awayForm,
  h2h,
  apiPrediction
) {

  let homeScore = 0;
  let drawScore = 0;
  let awayScore = 0;

  /*
   * FORME RÉCENTE
   */

  homeScore +=
    homeForm.formScore * 0.35;

  awayScore +=
    awayForm.formScore * 0.35;


  /*
   * ATTAQUE / DÉFENSE
   */

  homeScore +=
    Math.max(
      0,
      Math.min(
        20,
        (
          homeForm.avgGoalsFor -
          homeForm.avgGoalsAgainst +
          1
        ) * 10
      )
    );

  awayScore +=
    Math.max(
      0,
      Math.min(
        20,
        (
          awayForm.avgGoalsFor -
          awayForm.avgGoalsAgainst +
          1
        ) * 10
      )
    );


  /*
   * H2H
   */

  if (h2h.total > 0) {

    const h2hTotal =
      h2h.total;

    homeScore +=
      (
        h2h.homeWins /
        h2hTotal
      ) * 20;

    awayScore +=
      (
        h2h.awayWins /
        h2hTotal
      ) * 20;

    drawScore +=
      (
        h2h.draws /
        h2hTotal
      ) * 20;

  }


  /*
   * PREDICTION API-FOOTBALL
   *
   * Utilisée comme donnée
   * complémentaire.
   */

  const apiPercent =
    apiPrediction?.predictions?.percent ||
    {};

  const apiHome =
    pct(apiPercent.home);

  const apiDraw =
    pct(apiPercent.draw);

  const apiAway =
    pct(apiPercent.away);

  homeScore +=
    apiHome * 0.25;

  drawScore +=
    apiDraw * 0.25;

  awayScore +=
    apiAway * 0.25;


  /*
   * NORMALISATION
   */

  const total =
    homeScore +
    drawScore +
    awayScore;


  if (total <= 0) {

    return {

      type: "N",

      text: "Données insuffisantes",

      confidence: 0,

      scores: {
        home: 0,
        draw: 0,
        away: 0
      }

    };

  }


  const home =
    (homeScore / total) * 100;

  const draw =
    (drawScore / total) * 100;

  const away =
    (awayScore / total) * 100;


  let type = "N";
  let confidence = draw;
  let text = "Match nul";


  if (
    home >= draw &&
    home >= away
  ) {

    type = "1";
    confidence = home;
    text = "Victoire à domicile";

  } else if (
    away >= home &&
    away >= draw
  ) {

    type = "2";
    confidence = away;
    text = "Victoire à l'extérieur";

  }


  return {

    type,

    text,

    confidence:
      Math.round(confidence),

    scores: {

      home:
        Math.round(home),

      draw:
        Math.round(draw),

      away:
        Math.round(away)

    }

  };

}


/* ==================================================
   ANALYSE TEXTUELLE
================================================== */

function construireAnalyse(
  home,
  away,
  homeForm,
  awayForm,
  h2h,
  selection,
  apiPrediction
) {

  const phrases = [];

  /*
   * FORME
   */

  if (
    homeForm.formScore >
    awayForm.formScore + 5
  ) {

    phrases.push(
      `${home.name} présente une meilleure forme récente.`
    );

  } else if (
    awayForm.formScore >
    homeForm.formScore + 5
  ) {

    phrases.push(
      `${away.name} présente une meilleure forme récente.`
    );

  } else {

    phrases.push(
      "La forme récente des deux équipes est relativement équilibrée."
    );

  }


  /*
   * BUTS
   */

  if (
    homeForm.avgGoalsFor >
    awayForm.avgGoalsFor + 0.3
  ) {

    phrases.push(
      `${home.name} affiche une meilleure moyenne de buts marqués sur ses derniers matchs.`
    );

  } else if (
    awayForm.avgGoalsFor >
    homeForm.avgGoalsFor + 0.3
  ) {

    phrases.push(
      `${away.name} affiche une meilleure moyenne de buts marqués sur ses derniers matchs.`
    );

  }


  /*
   * DÉFENSE
   */

  if (
    homeForm.avgGoalsAgainst <
    awayForm.avgGoalsAgainst - 0.3
  ) {

    phrases.push(
      `${home.name} présente une défense statistiquement plus solide récemment.`
    );

  } else if (
    awayForm.avgGoalsAgainst <
    homeForm.avgGoalsAgainst - 0.3
  ) {

    phrases.push(
      `${away.name} présente une défense statistiquement plus solide récemment.`
    );

  }


  /*
   * H2H
   */

  if (h2h.total > 0) {

    phrases.push(
      `Les ${h2h.total} dernières confrontations disponibles donnent ${h2h.homeWins} avantage(s) à ${home.name}, ${h2h.awayWins} à ${away.name} et ${h2h.draws} nul(s).`
    );

  } else {

    phrases.push(
      "Aucune confrontation directe récente exploitable n'a été trouvée."
    );

  }


  /*
   * API
   */

  if (
    apiPrediction?.predictions?.advice
  ) {

    phrases.push(
      "La prédiction API-Football est utilisée comme donnée complémentaire."
    );

  }


  /*
   * CONCLUSION
   */

  let conclusion = "";

  if (selection.type === "1") {

    conclusion =
      `Le croisement des données donne un avantage à ${home.name}.`;

  } else if (
    selection.type === "2"
  ) {

    conclusion =
      `Le croisement des données donne un avantage à ${away.name}.`;

  } else {

    conclusion =
      "Le croisement des données ne montre pas un avantage suffisamment net pour une équipe.";
  }


  phrases.push(conclusion);


  return phrases.join(" ");

}


/* ==================================================
   PRÉDICTION API SÉCURISÉE
================================================== */

async function obtenirPredictionAPI(
  fixtureId
) {

  try {

    const data =
      await footballApi(
        "/predictions?fixture=" +
        encodeURIComponent(fixtureId)
      );

    return (
      data.response?.[0] ||
      null
    );

  } catch (error) {

    console.log(
      "Prediction API indisponible:",
      fixtureId,
      error.message
    );

    return null;

  }

}


/* ==================================================
   ANALYSE D'UN MATCH
================================================== */

async function analyserMatch(
  match
) {

  const home =
    match.teams?.home;

  const away =
    match.teams?.away;


  if (
    !home?.id ||
    !away?.id
  ) {

    return null;

  }


  /*
   * 5 DERNIERS MATCHS DOMICILE
   */

  const homeLastData =
    await footballApi(
      "/fixtures?team=" +
      home.id +
      "&last=5"
    );


  /*
   * 5 DERNIERS MATCHS EXTÉRIEUR
   */

  const awayLastData =
    await footballApi(
      "/fixtures?team=" +
      away.id +
      "&last=5"
    );


  const homeForm =
    analyserForme(
      homeLastData.response || [],
      home.id
    );


  const awayForm =
    analyserForme(
      awayLastData.response || [],
      away.id
    );


  /*
   * H2H
   */

  let h2hData = {
    response: []
  };


  try {

    h2hData =
      await footballApi(
        "/fixtures/headtohead?h2h=" +
        home.id +
        "-" +
        away.id +
        "&last=5"
      );

  } catch (error) {

    console.log(
      "H2H indisponible:",
      error.message
    );

  }


  const h2h =
    analyserH2H(
      h2hData.response || [],
      home.id,
      away.id
    );


  /*
   * PRÉDICTION API
   */

  const apiPrediction =
    await obtenirPredictionAPI(
      match.fixture.id
    );


  /*
   * CALCUL INDÉPENDANT
   */

  const selection =
    calculerPronostic(
      homeForm,
      awayForm,
      h2h,
      apiPrediction
    );


  /*
   * ANALYSE
   */

  const analysis =
    construireAnalyse(
      home,
      away,
      homeForm,
      awayForm,
      h2h,
      selection,
      apiPrediction
    );


  /*
   * DONNÉES PRÉVISIONNELLES
   *
   * Aucun faux score mi-temps
   * ou score final n'est créé.
   */

  const apiPred =
    apiPrediction?.predictions || {};


  return {

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
          home.id,

        name:
          home.name,

        logo:
          home.logo ||
          ""

      },

      away: {

        id:
          away.id,

        name:
          away.name,

        logo:
          away.logo ||
          ""

      }

    },

    prediction: {

      main_pick:
        selection.type === "1"
          ? "Victoire " + home.name
          : selection.type === "2"
          ? "Victoire " + away.name
          : "Match nul",

      type:
        selection.type,

      home:
        selection.scores.home +
        "%",

      draw:
        selection.scores.draw +
        "%",

      away:
        selection.scores.away +
        "%",

      /*
       * Le score exact n'est plus
       * affiché comme un faux score.
       */

      goals:
        "Non calculé",

      under_over:
        apiPred.under_over ||
        "Non disponible",

      advice:
        apiPred.advice ||
        "Pronostic calculé à partir de l'analyse statistique.",

      /*
       * Pas de score mi-temps
       * ou final pré-match.
       */

      half_time_score:
        null,

      full_time_score:
        null

    },

    consensus: {

      confidence:
        selection.confidence +
        "%"

    },

    analysis,

    form: {

      home: {

        matches:
          homeForm.total,

        wins:
          homeForm.wins,

        draws:
          homeForm.draws,

        losses:
          homeForm.losses,

        goals_for:
          homeForm.goalsFor,

        goals_against:
          homeForm.goalsAgainst,

        average_goals_for:
          Number(
            homeForm.avgGoalsFor.toFixed(2)
          ),

        average_goals_against:
          Number(
            homeForm.avgGoalsAgainst.toFixed(2)
          ),

        form_score:
          Math.round(
            homeForm.formScore
          ),

        results:
          homeForm.results

      },

      away: {

        matches:
          awayForm.total,

        wins:
          awayForm.wins,

        draws:
          awayForm.draws,

        losses:
          awayForm.losses,

        goals_for:
          awayForm.goalsFor,

        goals_against:
          awayForm.goalsAgainst,

        average_goals_for:
          Number(
            awayForm.avgGoalsFor.toFixed(2)
          ),

        average_goals_against:
          Number(
            awayForm.avgGoalsAgainst.toFixed(2)
          ),

        form_score:
          Math.round(
            awayForm.formScore
          ),

        results:
          awayForm.results

      }

    },

    h2h: {

      matches:
        h2h.total,

      home_wins:
        h2h.homeWins,

      draws:
        h2h.draws,

      away_wins:
        h2h.awayWins

    },

    api_prediction: {

      available:
        Boolean(apiPrediction),

      advice:
        apiPred.advice ||
        null,

      under_over:
        apiPred.under_over ||
        null

    },

    sources: {

      api_football:
        true

    }

  };

}


/* ==================================================
   RACINE
================================================== */

app.get(
  "/",
  (req, res) => {

    res.json({

      status: "ok",

      service:
        "BOT PREDICTOR",

      message:
        "Serveur actif",

      timezone:
        "Africa/Abidjan"

    });

  }
);


/* ==================================================
   HEALTH
================================================== */

app.get(
  "/health",
  (req, res) => {

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

  }
);


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
          data.response

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
   PRÉDICTION D'UN MATCH
================================================== */

app.get(
  "/prediction/:fixture",
  async (req, res) => {

    try {

      const fixture =
        req.params.fixture;


      const result =
        await analyserMatch({

          fixture: {
            id: Number(fixture),
            date: new Date().toISOString()
          },

          teams: {
            home: {},
            away: {}
          }

        });


      /*
       * Cette route nécessite les équipes.
       * On utilise donc directement
       * la prédiction API si nécessaire.
       */

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
   PRÉDICTIONS
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


      let matches =
        fixturesData.response || [];


      /*
       * Seulement les matchs à venir.
       */

      matches =
        matches.filter(
          matchAVenir
        );


      matches.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ) -
          new Date(
            b.fixture.date
          )
      );


      /*
       * Limite volontaire :
       *
       * 2 matchs maximum.
       *
       * Cela évite de consommer
       * inutilement les 100 requêtes
       * quotidiennes du compte Free.
       */

      const candidats =
        matches.slice(0, 2);


      const result = [];


      for (
        const match of candidats
      ) {

        try {

          const analyse =
            await analyserMatch(
              match
            );


          if (!analyse) {
            continue;
          }


          /*
           * ENREGISTRER DANS HISTORIQUE
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

              country:
                match.league?.country ||
                "",

              home:
                analyse.match.home,

              away:
                analyse.match.away,

              selection: {

                type:
                  analyse.prediction.type,

                text:
                  analyse.prediction.main_pick,

                confidence:
                  analyse.consensus.confidence

              },

              /*
               * Aucun score fictif
               * avant le match.
               */

              predicted_score:
                null,

              halftime_score:
                null,

              final_score:
                null,

              result:
                "EN_ATTENTE",

              status:
                "NS"

            });

            sauvegarderHistorique();

          }


          result.push(
            analyse
          );


        } catch (error) {

          console.log(
            "Analyse indisponible pour le match",
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
   STATISTIQUES MATCH
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
   DERNIERS MATCHS ÉQUIPE
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

      /*
       * Aucun historique.
       */

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
       * Maximum 20 fixtures.
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


      const fixtureMap =
        new Map();


      fixtures.forEach(
        fixture => {

          fixtureMap.set(
            fixture.fixture.id,
            fixture
          );

        }
      );


      const updated =
        history.map(
          item => {

            const fixture =
              fixtureMap.get(
                item.fixture_id
              );


            if (!fixture) {

              return {

                ...item,

                status:
                  "EN_ATTENTE",

                halftime_score:
                  null,

                final_score:
                  null,

                result:
                  "EN_ATTENTE"

              };

            }


            const scores =
              scoreReel(
                fixture
              );


            const result =
              resultatPrediction(
                item.selection?.type,
                fixture
              );


            return {

              ...item,

              status:
                fixture.fixture.status?.short ||
                "NS",

              /*
               * Les vrais scores du match
               * uniquement après récupération
               * auprès de l'API.
               */

              halftime_score:
                scores.halftime,

              final_score:
                scores.fulltime,

              result

            };

          }
        );


      history =
        updated;


      sauvegarderHistorique();


      const gagne =
        updated.filter(
          x =>
            x.result === "GAGNE"
        ).length;


      const perdu =
        updated.filter(
          x =>
            x.result === "PERDU"
        ).length;


      const attente =
        updated.filter(
          x =>
            x.result === "EN_ATTENTE"
        ).length;


      const termines =
        gagne + perdu;


      const taux =
        termines > 0
          ? Math.round(
              (
                gagne /
                termines
              ) * 100
            )
          : 0;


      updated.sort(
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
          updated.length,

        stats: {

          gagne,

          perdu,

          attente,

          taux_reussite:
            taux

        },

        matches:
          updated

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


      const data =
        await footballApi(
          "/fixtures?id=" +
          fixtureId
        );


      const fixture =
        data.response?.[0];


      if (fixture) {

        const scores =
          scoreReel(
            fixture
          );


        item.status =
          fixture.fixture.status?.short ||
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
   VIDER L'ANCIEN HISTORIQUE
================================================== */

app.post(
  "/history/clear",
  (req, res) => {

    history = [];

    sauvegarderHistorique();

    res.json({

      success: true,

      message:
        "Historique supprimé.",

      total: 0

    });

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
