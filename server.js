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
   CONFIGURATION API-FOOTBALL
================================================== */

const API_KEY =
  process.env.API_FOOTBALL_KEY;

const API =
  "https://v3.football.api-sports.io";


/* ==================================================
   APPEL API-FOOTBALL
================================================== */

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
      "Réponse invalide API-Football."
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
    typeof data.errors === "object" &&
    Object.keys(data.errors).length > 0
  ) {

    throw new Error(
      Object.entries(data.errors)
        .map(([key, value]) => {
          return key + ": " + value;
        })
        .join(" | ")
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
    ).format(new Date(date));

  } catch (e) {

    return "";

  }
}


/* ==================================================
   NOMBRE
================================================== */

function nombre(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    parseFloat(
      String(value)
        .replace("%", "")
        .replace(",", ".")
    );

  return Number.isFinite(n)
    ? n
    : null;
}


/* ==================================================
   POURCENTAGE
================================================== */

function pct(value) {

  const n = nombre(value);

  return n === null ? 0 : n;
}


/* ==================================================
   TEXTE PROPRE
================================================== */

function texte(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}


/* ==================================================
   NOM COMPETITION
================================================== */

function nomLeague(match) {

  if (
    match &&
    match.league &&
    typeof match.league.name === "string"
  ) {
    return match.league.name;
  }

  if (
    match &&
    match.league &&
    typeof match.league === "string"
  ) {
    return match.league;
  }

  return "Compétition";
}


/* ==================================================
   PAYS
================================================== */

function nomPays(match) {

  if (
    match &&
    match.league &&
    typeof match.league.country === "string"
  ) {
    return match.league.country;
  }

  return "";
}


/* ==================================================
   EQUIPE
================================================== */

function equipe(match, cote) {

  const team =
    match?.teams?.[cote] ||
    {};

  return {

    id:
      team.id || null,

    name:
      typeof team.name === "string"
        ? team.name
        : "Équipe inconnue",

    logo:
      typeof team.logo === "string"
        ? team.logo
        : ""

  };
}


/* ==================================================
   MATCH A VENIR
================================================== */

function matchAVenir(match) {

  if (!match?.fixture?.date) {
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

  if (termines.includes(status)) {
    return false;
  }

  if (live.includes(status)) {
    return false;
  }

  return (
    new Date(match.fixture.date)
      .getTime() >
    Date.now()
  );
}


/* ==================================================
   SCORE REEL
================================================== */

function scoreReel(fixture) {

  const goals =
    fixture?.goals || {};

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

  if (
    !fulltime &&
    goals.home !== null &&
    goals.home !== undefined &&
    goals.away !== null &&
    goals.away !== undefined
  ) {

    fulltime =
      goals.home +
      "-" +
      goals.away;
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

  const type =
    selection?.type;

  if (type === "1") {

    return homeGoals > awayGoals
      ? "GAGNE"
      : "PERDU";
  }

  if (type === "2") {

    return awayGoals > homeGoals
      ? "GAGNE"
      : "PERDU";
  }

  if (type === "N") {

    return homeGoals === awayGoals
      ? "GAGNE"
      : "PERDU";
  }

  return "EN_ATTENTE";
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

      const data =
        JSON.parse(content);

      if (Array.isArray(data)) {
        history = data;
      } else {
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
   SELECTION PRINCIPALE
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
        "Prédiction indisponible",

      confidence: 0

    };
  }

  if (
    home >= draw &&
    home >= away
  ) {

    const winner =
      prediction?.teams?.home?.name ||
      "équipe à domicile";

    return {

      type: "1",

      text:
        "Victoire " + winner,

      confidence: home

    };
  }

  if (
    away >= home &&
    away >= draw
  ) {

    const winner =
      prediction?.teams?.away?.name ||
      "équipe extérieure";

    return {

      type: "2",

      text:
        "Victoire " + winner,

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
   UNDER / OVER
================================================== */

function underOver(prediction) {

  const p =
    prediction?.predictions || {};

  return (
    p.under_over ||
    "Non disponible"
  );
}


/* ==================================================
   BUTS ESTIMES
================================================== */

function butsEstimes(prediction) {

  const goals =
    prediction?.predictions?.goals;

  if (!goals) {
    return null;
  }

  const home =
    texte(goals.home);

  const away =
    texte(goals.away);

  if (
    !home ||
    !away
  ) {
    return null;
  }

  /*
   * IMPORTANT :
   * API-Football renvoie ici des seuils
   * comme -1.5 ou -2.5.
   *
   * Ce ne sont PAS des scores exacts.
   */

  return {

    home: home,

    away: away,

    display:
      "Buts domicile " +
      home +
      " / buts extérieur " +
      away

  };
}


/* ==================================================
   STATISTIQUES EQUIPE
================================================== */

async function statistiquesEquipe(
  teamId,
  leagueId,
  season
) {

  if (
    !teamId ||
    !leagueId ||
    !season
  ) {

    return null;
  }

  try {

    const data =
      await footballApi(
        "/teams/statistics?" +
        "league=" +
        encodeURIComponent(leagueId) +
        "&season=" +
        encodeURIComponent(season) +
        "&team=" +
        encodeURIComponent(teamId)
      );

    return (
      data.response ||
      null
    );

  } catch (error) {

    console.log(
      "Stats équipe indisponibles:",
      teamId,
      error.message
    );

    return null;
  }
}


/* ==================================================
   EXTRACTION STATISTIQUES
================================================== */

function extraireStatsEquipe(stats) {

  if (!stats) {

    return {

      matchs: 0,

      victoires: 0,

      nuls: 0,

      defaites: 0,

      butsPour: 0,

      butsContre: 0

    };
  }

  const fixtures =
    stats.fixtures || {};

  const goals =
    stats.goals || {};

  const played =
    fixtures.played?.total || 0;

  const wins =
    fixtures.wins?.total || 0;

  const draws =
    fixtures.draws?.total || 0;

  const losses =
    fixtures.loses?.total || 0;

  const scored =
    goals.for?.total?.total || 0;

  const conceded =
    goals.against?.total?.total || 0;

  return {

    matchs: played,

    victoires: wins,

    nuls: draws,

    defaites: losses,

    butsPour: scored,

    butsContre: conceded

  };
}


/* ==================================================
   H2H
================================================== */

async function recupererH2H(
  homeId,
  awayId
) {

  if (
    !homeId ||
    !awayId
  ) {

    return [];
  }

  try {

    const data =
      await footballApi(
        "/fixtures/headtohead?h2h=" +
        encodeURIComponent(
          homeId +
          "-" +
          awayId
        ) +
        "&last=5"
      );

    return (
      data.response ||
      []
    );

  } catch (error) {

    console.log(
      "H2H indisponible:",
      error.message
    );

    return [];
  }
}


/* ==================================================
   RESUME H2H
================================================== */

function resumeH2H(matches) {

  if (
    !Array.isArray(matches) ||
    matches.length === 0
  ) {

    return {
      total: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0
    };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  matches.forEach(match => {

    const home =
      match.goals?.home;

    const away =
      match.goals?.away;

    if (
      home === null ||
      home === undefined ||
      away === null ||
      away === undefined
    ) {
      return;
    }

    if (home > away) {
      homeWins++;
    } else if (away > home) {
      awayWins++;
    } else {
      draws++;
    }

  });

  return {

    total: matches.length,

    homeWins,

    draws,

    awayWins

  };
}


/* ==================================================
   ANALYSE TEXTUELLE
================================================== */

function construireAnalyse({
  home,
  away,
  prediction,
  homeStats,
  awayStats,
  h2h
}) {

  const selection =
    meilleurePrediction(
      prediction
    );

  const p =
    prediction?.predictions || {};

  const percent =
    p.percent || {};

  const hs =
    extraireStatsEquipe(
      homeStats
    );

  const as =
    extraireStatsEquipe(
      awayStats
    );

  const h2hResume =
    resumeH2H(h2h);

  const homeWin =
    pct(percent.home);

  const draw =
    pct(percent.draw);

  const awayWin =
    pct(percent.away);

  const homeAvg =
    hs.matchs > 0
      ? (
          hs.butsPour /
          hs.matchs
        ).toFixed(2)
      : null;

  const awayAvg =
    as.matchs > 0
      ? (
          as.butsPour /
          as.matchs
        ).toFixed(2)
      : null;

  const homeAgainst =
    hs.matchs > 0
      ? (
          hs.butsContre /
          hs.matchs
        ).toFixed(2)
      : null;

  const awayAgainst =
    as.matchs > 0
      ? (
          as.butsContre /
          as.matchs
        ).toFixed(2)
      : null;

  const parts = [];

  parts.push(
    "Analyse multi-données."
  );

  parts.push(
    "Probabilités API-Football : " +
    "1 = " +
    homeWin +
    "%, N = " +
    draw +
    "%, 2 = " +
    awayWin +
    "%."
  );

  if (hs.matchs > 0) {

    parts.push(
      "Forme " +
      home +
      " : " +
      hs.victoires +
      " victoire(s), " +
      hs.nuls +
      " nul(s), " +
      hs.defaites +
      " défaite(s) sur " +
      hs.matchs +
      " match(s)."
    );

    parts.push(
      "Moyenne buts " +
      home +
      " : " +
      homeAvg +
      " marqué(s), " +
      homeAgainst +
      " encaissé(s)."
    );

  } else {

    parts.push(
      "Statistiques détaillées de " +
      home +
      " indisponibles pour cette compétition."
    );

  }

  if (as.matchs > 0) {

    parts.push(
      "Forme " +
      away +
      " : " +
      as.victoires +
      " victoire(s), " +
      as.nuls +
      " nul(s), " +
      as.defaites +
      " défaite(s) sur " +
      as.matchs +
      " match(s)."
    );

    parts.push(
      "Moyenne buts " +
      away +
      " : " +
      awayAvg +
      " marqué(s), " +
      awayAgainst +
      " encaissé(s)."
    );

  } else {

    parts.push(
      "Statistiques détaillées de " +
      away +
      " indisponibles pour cette compétition."
    );

  }

  parts.push(
    "Confrontations directes disponibles : " +
    h2hResume.total +
    "."
  );

  if (selection.confidence > 0) {

    parts.push(
      "Pronostic principal : " +
      selection.text +
      " avec " +
      selection.confidence.toFixed(0) +
      "%."
    );

  }

  if (p.advice) {

    parts.push(
      "Conseil API-Football : " +
      p.advice +
      "."
    );

  }

  if (p.under_over) {

    parts.push(
      "Tendance buts : " +
      p.under_over +
      "."
    );

  }

  parts.push(
    "Les seuils de buts API-Football ne sont pas présentés comme un score exact."
  );

  return parts.join(" ");
}


/* ==================================================
   SCORE EXACT
================================================== */

function scoreExactDisponible(
  prediction
) {

  /*
   * L'API peut fournir des seuils
   * -1.5 / -2.5.
   *
   * Ils ne sont pas des scores exacts.
   *
   * Donc on ne fabrique jamais
   * un faux 0-0.
   */

  const p =
    prediction?.predictions || {};

  if (
    p.score &&
    typeof p.score === "object" &&
    p.score.home !== null &&
    p.score.home !== undefined &&
    p.score.away !== null &&
    p.score.away !== undefined
  ) {

    const home =
      nombre(p.score.home);

    const away =
      nombre(p.score.away);

    if (
      home !== null &&
      away !== null
    ) {

      return (
        home +
        "-" +
        away
      );
    }
  }

  return "Non disponible";
}


/* ==================================================
   CREATION MATCH
================================================== */

async function analyserMatch(
  match
) {

  const home =
    equipe(match, "home");

  const away =
    equipe(match, "away");

  const fixtureId =
    match.fixture?.id;

  if (!fixtureId) {
    return null;
  }

  let prediction = null;

  try {

    const data =
      await footballApi(
        "/predictions?fixture=" +
        encodeURIComponent(
          fixtureId
        )
      );

    prediction =
      data.response?.[0] ||
      null;

  } catch (error) {

    console.log(
      "Prediction indisponible:",
      fixtureId,
      error.message
    );

    return null;
  }

  if (!prediction) {
    return null;
  }

  const selection =
    meilleurePrediction(
      prediction
    );

  if (
    selection.confidence <= 0
  ) {
    return null;
  }


  /*
   * Récupération des statistiques
   * de saison lorsque la ligue et
   * la saison sont disponibles.
   */

  const leagueId =
    match.league?.id;

  const season =
    match.league?.season;


  const [
    homeStats,
    awayStats,
    h2h
  ] = await Promise.all([

    statistiquesEquipe(
      home.id,
      leagueId,
      season
    ),

    statistiquesEquipe(
      away.id,
      leagueId,
      season
    ),

    recupererH2H(
      home.id,
      away.id
    )

  ]);


  const p =
    prediction.predictions ||
    {};


  const goals =
    butsEstimes(
      prediction
    );


  const scoreExact =
    scoreExactDisponible(
      prediction
    );


  const analyse =
    construireAnalyse({
      home: home.name,
      away: away.name,
      prediction,
      homeStats,
      awayStats,
      h2h
    });


  /*
   * Niveau de qualité des données.
   */

  let quality = 0;

  if (prediction) {
    quality += 40;
  }

  if (
    homeStats &&
    awayStats
  ) {
    quality += 25;
  }

  if (
    Array.isArray(h2h) &&
    h2h.length > 0
  ) {
    quality += 15;
  }

  if (p.advice) {
    quality += 10;
  }

  if (p.under_over) {
    quality += 10;
  }


  return {

    match: {

      id:
        fixtureId,

      date:
        match.fixture.date,

      time:
        heureAbidjan(
          match.fixture.date
        ),

      league:
        nomLeague(match),

      country:
        nomPays(match),

      home: home,

      away: away

    },

    prediction: {

      main_pick:
        selection.text,

      type:
        selection.type,

      home:
        home.name,

      away:
        away.name,

      probability_home:
        homePct(
          p.percent?.home
        ),

      probability_draw:
        drawPct(
          p.percent?.draw
        ),

      probability_away:
        awayPct(
          p.percent?.away
        ),

      home_percent:
        pct(
          p.percent?.home
        ).toFixed(0) + "%",

      draw_percent:
        pct(
          p.percent?.draw
        ).toFixed(0) + "%",

      away_percent:
        pct(
          p.percent?.away
        ).toFixed(0) + "%",

      goals:
        goals
          ? goals.display
          : "Non disponible",

      under_over:
        underOver(
          prediction
        ),

      advice:
        p.advice ||
        "Non disponible",

      exact_score:
        scoreExact,

      half_time_score:
        "Non disponible",

      full_time_score:
        scoreExact

    },

    consensus: {

      confidence:
        selection.confidence
          .toFixed(0) +
        "%",

      score:
        scoreExact

    },

    sources: {

      api_football:
        true,

      api_football_predictions:
        true,

      api_football_team_statistics:
        Boolean(
          homeStats &&
          awayStats
        ),

      api_football_h2h:
        Array.isArray(h2h) &&
        h2h.length > 0,

      sportmonks:
        false,

      football_data:
        false

    },

    analysis:
      analyse,

    data_quality:
      quality

  };
}


/* ==================================================
   POURCENTAGES PROPRES
================================================== */

function homePct(value) {
  return pct(value);
}

function drawPct(value) {
  return pct(value);
}

function awayPct(value) {
  return pct(value);
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
        "Africa/Abidjan",

      api_configured:
        Boolean(API_KEY)

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

      const matches =
        data.response || [];

      res.json({

        success: true,

        date: date,

        total:
          matches.length,

        matches:
          matches

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

      const fixture =
        req.params.fixture;

      const data =
        await footballApi(
          "/predictions?fixture=" +
          encodeURIComponent(
            fixture
          )
        );

      res.json({

        success: true,

        fixture:
          fixture,

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


      /*
       * Récupération des matchs.
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
       * Seulement les matchs à venir.
       */

      matches =
        matches.filter(
          matchAVenir
        );


      /*
       * Plus proches d'abord.
       */

      matches.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ).getTime() -
          new Date(
            b.fixture.date
          ).getTime()
      );


      /*
       * On analyse jusqu'à 10
       * candidats afin de pouvoir
       * trouver les meilleurs.
       */

      const candidats =
        matches.slice(0, 10);


      const analyses = [];


      for (
        const match of candidats
      ) {

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
            "Analyse impossible:",
            match.fixture?.id,
            error.message
          );

        }

      }


      /*
       * Meilleure qualité puis
       * meilleure confiance.
       */

      analyses.sort(
        (a, b) => {

          if (
            b.data_quality !==
            a.data_quality
          ) {

            return (
              b.data_quality -
              a.data_quality
            );
          }

          const ca =
            parseFloat(
              a.consensus.confidence
            ) || 0;

          const cb =
            parseFloat(
              b.consensus.confidence
            ) || 0;

          return cb - ca;

        }
      );


      /*
       * Deux meilleurs matchs.
       */

      const selected =
        analyses.slice(0, 2);


      /*
       * Historique.
       */

      selected.forEach(item => {

        const existing =
          history.find(
            h =>
              h.fixture_id ===
              item.match.id
          );

        if (!existing) {

          history.push({

            fixture_id:
              item.match.id,

            created_at:
              new Date().toISOString(),

            date:
              item.match.date,

            league:
              item.match.league,

            country:
              item.match.country,

            home:
              item.match.home,

            away:
              item.match.away,

            selection: {

              type:
                item.prediction.type,

              text:
                item.prediction.main_pick,

              confidence:
                parseFloat(
                  item.consensus.confidence
                ) || 0

            },

            predicted_score:
              item.prediction.exact_score,

            predicted_half_time:
              item.prediction.half_time_score,

            advice:
              item.prediction.advice,

            under_over:
              item.prediction.under_over

          });

        }

      });


      sauvegarderHistorique();


      res.json({

        success: true,

        date: date,

        analyzed_candidates:
          candidats.length,

        analyzed:
          analyses.length,

        selected:
          selected.length,

        matches:
          selected,

        message:
          selected.length >= 2
            ? "Analyse terminée."
            : "Pas assez de matchs avec des données exploitables."

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
          encodeURIComponent(
            fixture
          )
        );


      res.json({

        success: true,

        fixture:
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
          encodeURIComponent(
            team
          ) +
          "&last=5"
        );


      res.json({

        success: true,

        team:
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
          encodeURIComponent(
            teams
          ) +
          "&last=5"
        );


      res.json({

        success: true,

        teams:
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

      if (
        !league ||
        !season
      ) {

        return res.status(400).json({

          success: false,

          error:
            "league et season sont requis"

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

        league:
          league,

        season:
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
       * IDs récents.
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


      /*
       * Mise à jour historique.
       */

      const updated =
        history.map(item => {

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
              item.selection,
              fixture
            );


          return {

            ...item,

            status:
              fixture.fixture.status?.short ||
              "NS",

            halftime_score:
              scores.halftime,

            final_score:
              scores.fulltime,

            result:
              result

          };

        });


      history =
        updated;


      sauvegarderHistorique();


      const gagne =
        updated.filter(
          x =>
            x.result ===
            "GAGNE"
        ).length;


      const perdu =
        updated.filter(
          x =>
            x.result ===
            "PERDU"
        ).length;


      const attente =
        updated.filter(
          x =>
            x.result ===
            "EN_ATTENTE"
        ).length;


      const termines =
        gagne +
        perdu;


      const taux =
        termines > 0
          ? Math.round(
              (
                gagne /
                termines
              ) *
              100
            )
          : 0;


      updated.sort(
        (a, b) =>
          new Date(
            b.created_at
          ).getTime() -
          new Date(
            a.created_at
          ).getTime()
      );


      res.json({

        success: true,

        total:
          updated.length,

        stats: {

          gagne:
            gagne,

          perdu:
            perdu,

          attente:
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
          encodeURIComponent(
            fixtureId
          )
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
            item.selection,
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
