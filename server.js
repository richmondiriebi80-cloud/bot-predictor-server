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

  res.header(
    "Access-Control-Allow-Origin",
    "*"
  );

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

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


async function footballApi(endpoint) {

  if (!API_KEY) {

    throw new Error(
      "API_FOOTBALL_KEY manquante dans Render."
    );

  }

  const response =
    await fetch(
      API + endpoint,
      {
        method: "GET",
        headers: {
          "x-apisports-key": API_KEY,
          "Accept": "application/json"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      "API-Football HTTP " +
      response.status
    );

  }


  const data =
    await response.json();


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

function dateAbidjan(date = new Date()) {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Africa/Abidjan",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(date);


  const result = {};


  parts.forEach(
    p => {
      result[p.type] = p.value;
    }
  );


  return (
    result.year +
    "-" +
    result.month +
    "-" +
    result.day
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
   NOMBRE
================================================== */

function nombre(value) {

  const n =
    parseFloat(value);

  return Number.isFinite(n)
    ? n
    : 0;

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

      const data =
        fs.readFileSync(
          HISTORY_FILE,
          "utf8"
        );


      history =
        JSON.parse(data);


      if (!Array.isArray(history)) {
        history = [];
      }

    }

  } catch (error) {

    console.log(
      "Erreur historique:",
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
      "Erreur sauvegarde:",
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
    ).getTime() >
    Date.now()
  );

}


/* ==================================================
   DERNIERS MATCHS D'UNE EQUIPE
================================================== */

async function derniersMatchs(teamId) {

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

async function h2h(homeId, awayId) {

  try {

    const data =
      await footballApi(
        "/fixtures/headtohead?h2h=" +
        encodeURIComponent(
          homeId + "-" + awayId
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
   STATISTIQUES FORME
================================================== */

function calculerForme(matches, teamId) {

  let victoires = 0;
  let nuls = 0;
  let defaites = 0;

  let butsPour = 0;
  let butsContre = 0;

  let matchsComptes = 0;


  for (const match of matches) {

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


    if (
      homeId !== teamId &&
      awayId !== teamId
    ) {
      continue;
    }


    matchsComptes++;


    if (homeId === teamId) {

      butsPour += homeGoals;
      butsContre += awayGoals;


      if (homeGoals > awayGoals) {
        victoires++;
      }
      else if (homeGoals === awayGoals) {
        nuls++;
      }
      else {
        defaites++;
      }

    }
    else {

      butsPour += awayGoals;
      butsContre += homeGoals;


      if (awayGoals > homeGoals) {
        victoires++;
      }
      else if (awayGoals === homeGoals) {
        nuls++;
      }
      else {
        defaites++;
      }

    }

  }


  const points =
    (victoires * 3) +
    nuls;


  const tauxForme =
    matchsComptes > 0
      ? (
          points /
          (matchsComptes * 3)
        ) * 100
      : 0;


  return {

    matchs: matchsComptes,

    victoires,

    nuls,

    defaites,

    butsPour,

    butsContre,

    moyenneButsPour:
      matchsComptes
        ? butsPour / matchsComptes
        : 0,

    moyenneButsContre:
      matchsComptes
        ? butsContre / matchsComptes
        : 0,

    tauxForme

  };

}


/* ==================================================
   FORME H2H
================================================== */

function analyserH2H(
  matches,
  homeId,
  awayId
) {

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  let total = 0;


  for (const match of matches) {

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


    total++;


    const homeTeam =
      match.teams?.home?.id;


    const awayTeam =
      match.teams?.away?.id;


    let homeScore = hg;
    let awayScore = ag;


    if (
      homeTeam === awayId &&
      awayTeam === homeId
    ) {

      homeScore = ag;
      awayScore = hg;

    }


    if (homeScore > awayScore) {
      homeWins++;
    }
    else if (homeScore < awayScore) {
      awayWins++;
    }
    else {
      draws++;
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
   ESTIMATION SCORE
================================================== */

function estimerScore(
  homeForm,
  awayForm,
  apiPrediction
) {

  /*
   * Moyenne récente.
   */

  let homeAttack =
    homeForm.moyenneButsPour;

  let homeDefense =
    homeForm.moyenneButsContre;

  let awayAttack =
    awayForm.moyenneButsPour;

  let awayDefense =
    awayForm.moyenneButsContre;


  /*
   * Estimation simple mais basée
   * sur les données réelles récupérées.
   */

  let homeGoals =
    (
      homeAttack +
      awayDefense
    ) / 2;


  let awayGoals =
    (
      awayAttack +
      homeDefense
    ) / 2;


  /*
   * Si API-Football fournit une
   * indication de vainqueur,
   * on ajuste légèrement.
   */

  const winnerId =
    apiPrediction
      ?.predictions
      ?.winner
      ?.id;


  const homeId =
    apiPrediction
      ?.teams
      ?.home
      ?.id;


  const awayId =
    apiPrediction
      ?.teams
      ?.away
      ?.id;


  if (winnerId === homeId) {

    homeGoals += 0.25;

  }


  if (winnerId === awayId) {

    awayGoals += 0.25;

  }


  /*
   * Empêcher les scores absurdes.
   */

  homeGoals =
    Math.max(
      0,
      Math.min(
        5,
        homeGoals
      )
    );


  awayGoals =
    Math.max(
      0,
      Math.min(
        5,
        awayGoals
      )
    );


  /*
   * Arrondi au score entier
   * le plus plausible.
   */

  homeGoals =
    Math.round(homeGoals);


  awayGoals =
    Math.round(awayGoals);


  return {

    home: homeGoals,

    away: awayGoals,

    text:
      homeGoals +
      "-" +
      awayGoals

  };

}


/* ==================================================
   SCORE MI-TEMPS
================================================== */

function estimerMiTemps(
  fullTime
) {

  const home =
    Math.round(
      fullTime.home * 0.45
    );


  const away =
    Math.round(
      fullTime.away * 0.45
    );


  return {

    home,

    away,

    text:
      home +
      "-" +
      away

  };

}


/* ==================================================
   MEILLEURE SELECTION
================================================== */

function meilleurePrediction(
  prediction
) {

  const p =
    prediction?.predictions || {};


  const percent =
    p.percent || {};


  const home =
    pct(percent.home);

  const draw =
    pct(percent.draw);

  const away =
    pct(percent.away);


  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {

    return {

      type: "-",

      text:
        "Données insuffisantes",

      confidence: 0

    };

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
          "équipe domicile"
        ),

      confidence: home

    };

  }


  if (away >= home && away >= draw) {

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

    text:
      "Match nul",

    confidence: draw

  };

}


/* ==================================================
   ANALYSE COMPLETE
================================================== */

async function analyserMatch(match) {

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
   * Récupération parallèle.
   */

  const [
    predictionData,
    homeLast,
    awayLast,
    h2hData
  ] =
    await Promise.all([

      footballApi(
        "/predictions?fixture=" +
        match.fixture.id
      ),

      derniersMatchs(
        home.id
      ),

      derniersMatchs(
        away.id
      ),

      h2h(
        home.id,
        away.id
      )

    ]);


  const prediction =
    predictionData.response?.[0];


  if (!prediction) {

    return null;

  }


  const homeForm =
    calculerForme(
      homeLast,
      home.id
    );


  const awayForm =
    calculerForme(
      awayLast,
      away.id
    );


  const h2hForm =
    analyserH2H(
      h2hData,
      home.id,
      away.id
    );


  const selection =
    meilleurePrediction(
      prediction
    );


  /*
   * Score calculé par notre
   * propre analyse.
   */

  const score =
    estimerScore(
      homeForm,
      awayForm,
      prediction
    );


  const halftime =
    estimerMiTemps(
      score
    );


  const pred =
    prediction.predictions || {};


  /*
   * Niveau de fiabilité.
   *
   * On part de la probabilité
   * API-Football et on ajoute
   * un petit bonus lorsque les
   * données historiques existent.
   */

  let reliability =
    selection.confidence;


  if (
    homeForm.matchs >= 3 &&
    awayForm.matchs >= 3
  ) {

    reliability += 5;

  }


  if (h2hForm.total >= 2) {

    reliability += 3;

  }


  reliability =
    Math.min(
      95,
      reliability
    );


  /*
   * Analyse lisible.
   */

  const analyse = [

    "Analyse multi-données.",

    "Forme récente : " +
      home.name +
      " " +
      homeForm.victoires +
      " victoire(s), " +
      homeForm.nuls +
      " nul(s), " +
      homeForm.defaites +
      " défaite(s) sur " +
      homeForm.matchs +
      " match(s).",

    "Forme récente : " +
      away.name +
      " " +
      awayForm.victoires +
      " victoire(s), " +
      awayForm.nuls +
      " nul(s), " +
      awayForm.defaites +
      " défaite(s) sur " +
      awayForm.matchs +
      " match(s).",

    "Moyenne buts : " +
      home.name +
      " " +
      homeForm.moyenneButsPour.toFixed(2) +
      " marqué(s) / " +
      homeForm.moyenneButsContre.toFixed(2) +
      " encaissé(s).",

    away.name +
      " " +
      awayForm.moyenneButsPour.toFixed(2) +
      " marqué(s) / " +
      awayForm.moyenneButsContre.toFixed(2) +
      " encaissé(s).",

    "Confrontations directes disponibles : " +
      h2hForm.total +
      ".",

    "Probabilités API-Football : " +
      "1=" +
      pct(pred.percent?.home).toFixed(0) +
      "%, N=" +
      pct(pred.percent?.draw).toFixed(0) +
      "%, 2=" +
      pct(pred.percent?.away).toFixed(0) +
      "%.",

    "Pronostic principal : " +
      selection.text +
      ".",

    "Score final estimé par l'analyse : " +
      score.text +
      ".",

    "Score mi-temps estimé : " +
      halftime.text +
      "."

  ].join(" ");


  return {

    match,

    prediction: {

      main_pick:
        selection.text,

      type:
        selection.type,

      home:
        pct(pred.percent?.home)
          .toFixed(0) +
        "%",

      draw:
        pct(pred.percent?.draw)
          .toFixed(0) +
        "%",

      away:
        pct(pred.percent?.away)
          .toFixed(0) +
        "%",

      goals:
        score.text,

      half_time_score:
        halftime.text,

      full_time_score:
        score.text,

      under_over:
        pred.under_over ||
        "Non disponible",

      over_under:
        pred.under_over ||
        "Non disponible",

      advice:
        pred.advice ||
        "Non disponible",

      btts:
        "Non disponible",

      corners:
        "Non disponible",

      yellow_cards:
        "Non disponible"

    },

    consensus: {

      confidence:
        reliability.toFixed(0) +
        "%",

      score:
        score.text

    },

    sources: {

      api_football: true,

      sportmonks:
        Boolean(
          process.env.SPORTMONKS_API_KEY
        ),

      football_data:
        Boolean(
          process.env.FOOTBALL_DATA_API_KEY
        )

    },

    analysis:
      analyse,

    raw: {

      home_form:
        homeForm,

      away_form:
        awayForm,

      h2h:
        h2hForm

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
   PREDICTION D'UN MATCH
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
   PREDICTIONS
================================================== */

app.get(
  "/predictions",
  async (req, res) => {

    try {

      const date =
        req.query.date ||
        dateAbidjan();


      /*
       * On récupère les matchs du jour.
       */

      const fixtures =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );


      let matches =
        fixtures.response || [];


      /*
       * Seulement les matchs futurs.
       */

      matches =
        matches.filter(
          matchAVenir
        );


      /*
       * Les matchs les plus proches
       * en premier.
       */

      matches.sort(
        (a, b) =>
          new Date(a.fixture.date) -
          new Date(b.fixture.date)
      );


      /*
       * On analyse jusqu'à 8 matchs
       * pour pouvoir en sélectionner 2.
       */

      const candidats =
        matches.slice(0, 8);


      const analyses = [];


      for (const match of candidats) {

        try {

          const analyse =
            await analyserMatch(
              match
            );


          if (analyse) {

            analyses.push(
              analyse
            );

          }

        } catch (error) {

          console.log(
            "Analyse échouée fixture",
            match.fixture.id,
            error.message
          );

        }

      }


      /*
       * Meilleurs matchs selon
       * la fiabilité calculée.
       */

      analyses.sort(
        (a, b) =>
          nombre(
            b.consensus.confidence
          ) -
          nombre(
            a.consensus.confidence
          )
      );


      const selected =
        analyses.slice(0, 2);


      /*
       * Sauvegarde historique.
       */

      for (const item of selected) {

        const fixtureId =
          item.match.fixture.id;


        const exists =
          history.some(
            h =>
              h.fixture_id ===
              fixtureId
          );


        if (!exists) {

          history.push({

            fixture_id:
              fixtureId,

            created_at:
              new Date().toISOString(),

            date:
              item.match.fixture.date,

            league:
              item.match.league?.name ||
              "Compétition",

            country:
              item.match.league?.country ||
              "",

            home:
              item.match.teams.home,

            away:
              item.match.teams.away,

            selection:
              {

                type:
                  item.prediction.type,

                text:
                  item.prediction.main_pick,

                confidence:
                  item.consensus.confidence

              },

            predicted_score:
              item.prediction.full_time_score,

            predicted_half_time:
              item.prediction.half_time_score,

            status:
              "NS",

            halftime_score:
              null,

            final_score:
              null,

            result:
              "EN_ATTENTE"

          });

        }

      }


      sauvegarderHistorique();


      res.json({

        success: true,

        date,

        analyzed_candidates:
          candidats.length,

        selected:
          selected.length,

        matches:
          selected,

        message:
          selected.length
            ? "Analyse terminée."
            : "Aucun match avec données suffisantes."

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
   TEAM STATISTICS
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
       * Derniers IDs seulement.
       */

      const ids =
        history
          .map(
            h =>
              h.fixture_id
          )
          .filter(Boolean)
          .slice(-30);


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
        history.map(
          item => {

            const fixture =
              map.get(
                item.fixture_id
              );


            if (!fixture) {

              return item;

            }


            const status =
              fixture.fixture.status?.short;


            const halftime =
              fixture.score?.halftime;


            const fulltime =
              fixture.score?.fulltime;


            let halftimeScore =
              null;


            let finalScore =
              null;


            if (
              halftime?.home !== null &&
              halftime?.home !== undefined &&
              halftime?.away !== null &&
              halftime?.away !== undefined
            ) {

              halftimeScore =
                halftime.home +
                "-" +
                halftime.away;

            }


            if (
              fulltime?.home !== null &&
              fulltime?.home !== undefined &&
              fulltime?.away !== null &&
              fulltime?.away !== undefined
            ) {

              finalScore =
                fulltime.home +
                "-" +
                fulltime.away;

            }


            let result =
              "EN_ATTENTE";


            if (
              [
                "FT",
                "AET",
                "PEN"
              ].includes(status)
            ) {

              const hg =
                fixture.goals?.home;

              const ag =
                fixture.goals?.away;


              const type =
                item.selection?.type;


              if (
                type === "1"
              ) {

                result =
                  hg > ag
                    ? "GAGNE"
                    : "PERDU";

              }
              else if (
                type === "2"
              ) {

                result =
                  ag > hg
                    ? "GAGNE"
                    : "PERDU";

              }
              else if (
                type === "N"
              ) {

                result =
                  hg === ag
                    ? "GAGNE"
                    : "PERDU";

              }

            }


            return {

              ...item,

              status,

              halftime_score:
                halftimeScore,

              final_score:
                finalScore,

              result

            };

          }
        );


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
        gagne +
        perdu;


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
   SUPPRESSION HISTORIQUE
================================================== */

app.delete(
  "/history",
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
   DEMARRAGE
================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      "BOT PREDICTOR actif sur le port " +
      PORT
    );

  }
);
