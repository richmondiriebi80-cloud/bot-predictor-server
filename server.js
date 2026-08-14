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
   API-FOOTBALL
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
    ).formatToParts(
      new Date()
    );


  const x = {};


  parts.forEach(
    p => {
      x[p.type] = p.value;
    }
  );


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
   NOMBRE
================================================== */

function nombre(value) {

  if (
    value === null ||
    value === undefined
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

  const n =
    nombre(value);

  return n === null
    ? 0
    : n;

}


/* ==================================================
   NOMBRE ENTIER
================================================== */

function entier(value) {

  const n =
    nombre(value);

  if (n === null) {
    return null;
  }

  return Math.round(n);

}


/* ==================================================
   ARRONDI
================================================== */

function round(value, decimals = 2) {

  const p =
    Math.pow(10, decimals);

  return Math.round(
    value * p
  ) / p;

}


/* ==================================================
   MOYENNE
================================================== */

function moyenne(values) {

  const valid =
    values.filter(
      x =>
        Number.isFinite(x)
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


/* ==================================================
   CLAMP
================================================== */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(max, value)
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


      if (
        !Array.isArray(history)
      ) {

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
   MATCH TERMINE
================================================== */

function matchTermine(
  fixture
) {

  const status =
    fixture?.fixture?.status?.short;


  return [
    "FT",
    "AET",
    "PEN"
  ].includes(status);

}


/* ==================================================
   MATCH A VENIR
================================================== */

function matchAVenir(
  match
) {

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
   SAISON PROBABLE
================================================== */

function saisonProbable(date) {

  const d =
    new Date(date);


  const year =
    d.getUTCFullYear();


  const month =
    d.getUTCMonth() + 1;


  /*
   * Pour la majorité des championnats
   * européens :
   *
   * juillet -> saison année courante
   * janvier/juin -> saison année précédente
   */

  return month >= 7
    ? year
    : year - 1;

}


/* ==================================================
   EXTRACTION SCORE
================================================== */

function scoreExact(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  const text =
    String(value)
      .trim();


  /*
   * Accepte uniquement un vrai
   * score du type 2-1.
   *
   * Refuse :
   * -2.5
   * +2.5
   * -1.5
   * 2.5
   */

  const match =
    text.match(
      /^(\d+)\s*-\s*(\d+)$/
    );


  if (!match) {
    return null;
  }


  return {
    home:
      Number(match[1]),

    away:
      Number(match[2])
  };

}


/* ==================================================
   SCORE REEL
================================================== */

function scoreReel(
  fixture
) {

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
   NORMALISATION MATCH
================================================== */

function normaliserMatch(
  fixture,
  teamId
) {

  const homeId =
    fixture.teams?.home?.id;


  const awayId =
    fixture.teams?.away?.id;


  const isHome =
    Number(homeId) === Number(teamId);


  const homeGoals =
    fixture.goals?.home;


  const awayGoals =
    fixture.goals?.away;


  const htHome =
    fixture.score?.halftime?.home;


  const htAway =
    fixture.score?.halftime?.away;


  let gf = null;
  let ga = null;


  if (
    homeGoals !== null &&
    homeGoals !== undefined &&
    awayGoals !== null &&
    awayGoals !== undefined
  ) {

    if (isHome) {

      gf =
        Number(homeGoals);

      ga =
        Number(awayGoals);

    } else {

      gf =
        Number(awayGoals);

      ga =
        Number(homeGoals);

    }

  }


  let htFor = null;
  let htAgainst = null;


  if (
    htHome !== null &&
    htHome !== undefined &&
    htAway !== null &&
    htAway !== undefined
  ) {

    if (isHome) {

      htFor =
        Number(htHome);

      htAgainst =
        Number(htAway);

    } else {

      htFor =
        Number(htAway);

      htAgainst =
        Number(htHome);

    }

  }


  let result =
    "N";


  if (
    gf !== null &&
    ga !== null
  ) {

    if (gf > ga) {
      result = "G";
    }

    else if (gf < ga) {
      result = "P";
    }

  }


  return {

    id:
      fixture.fixture?.id,

    date:
      fixture.fixture?.date,

    opponent:
      isHome
        ? fixture.teams?.away?.name
        : fixture.teams?.home?.name,

    home:
      isHome,

    gf,
    ga,

    htFor,
    htAgainst,

    result,

    league:
      fixture.league?.name ||
      "",

    status:
      fixture.fixture?.status?.short ||
      ""

  };

}


/* ==================================================
   FORME EQUIPE
================================================== */

function analyserForme(
  fixtures,
  teamId
) {

  const matches =
    fixtures
      .filter(
        fixture =>
          fixture.fixture?.status?.short === "FT" ||
          fixture.fixture?.status?.short === "AET" ||
          fixture.fixture?.status?.short === "PEN"
      )
      .map(
        fixture =>
          normaliserMatch(
            fixture,
            teamId
          )
      );


  const goalsFor =
    moyenne(
      matches
        .map(x => x.gf)
        .filter(x => x !== null)
    );


  const goalsAgainst =
    moyenne(
      matches
        .map(x => x.ga)
        .filter(x => x !== null)
    );


  const htFor =
    moyenne(
      matches
        .map(x => x.htFor)
        .filter(x => x !== null)
    );


  const htAgainst =
    moyenne(
      matches
        .map(x => x.htAgainst)
        .filter(x => x !== null)
    );


  const wins =
    matches.filter(
      x => x.result === "G"
    ).length;


  const draws =
    matches.filter(
      x => x.result === "N"
    ).length;


  const losses =
    matches.filter(
      x => x.result === "P"
    ).length;


  const points =
    wins * 3 +
    draws;


  const maxPoints =
    matches.length * 3;


  const formPercent =
    maxPoints > 0
      ? (points / maxPoints) * 100
      : 0;


  const btts =
    matches.filter(
      x =>
        x.gf !== null &&
        x.ga !== null &&
        x.gf > 0 &&
        x.ga > 0
    ).length;


  const over25 =
    matches.filter(
      x =>
        x.gf !== null &&
        x.ga !== null &&
        x.gf + x.ga >= 3
    ).length;


  return {

    matches,

    count:
      matches.length,

    wins,

    draws,

    losses,

    points,

    formPercent:
      round(formPercent),

    goalsFor:
      round(goalsFor),

    goalsAgainst:
      round(goalsAgainst),

    htFor:
      round(htFor),

    htAgainst:
      round(htAgainst),

    bttsPercent:
      matches.length
        ? round(
            (btts /
              matches.length) *
              100
          )
        : 0,

    over25Percent:
      matches.length
        ? round(
            (over25 /
              matches.length) *
              100
          )
        : 0

  };

}


/* ==================================================
   H2H
================================================== */

function analyserH2H(
  fixtures,
  homeId,
  awayId
) {

  const matches =
    fixtures
      .filter(
        fixture =>
          fixture.fixture?.status?.short === "FT" ||
          fixture.fixture?.status?.short === "AET" ||
          fixture.fixture?.status?.short === "PEN"
      );


  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let homeGoals = [];
  let awayGoals = [];


  matches.forEach(
    fixture => {

      const h =
        fixture.teams?.home?.id;

      const a =
        fixture.teams?.away?.id;

      const hg =
        fixture.goals?.home;

      const ag =
        fixture.goals?.away;


      if (
        hg === null ||
        hg === undefined ||
        ag === null ||
        ag === undefined
      ) {
        return;
      }


      const homeGoalsNumber =
        Number(hg);

      const awayGoalsNumber =
        Number(ag);


      if (
        Number(h) === Number(homeId)
      ) {

        homeGoals.push(
          homeGoalsNumber
        );

        awayGoals.push(
          awayGoalsNumber
        );


        if (
          homeGoalsNumber >
          awayGoalsNumber
        ) {
          homeWins++;
        }

        else if (
          homeGoalsNumber <
          awayGoalsNumber
        ) {
          awayWins++;
        }

        else {
          draws++;
        }

      }

      else if (
        Number(a) === Number(homeId)
      ) {

        homeGoals.push(
          awayGoalsNumber
        );

        awayGoals.push(
          homeGoalsNumber
        );


        if (
          awayGoalsNumber >
          homeGoalsNumber
        ) {
          homeWins++;
        }

        else if (
          awayGoalsNumber <
          homeGoalsNumber
        ) {
          awayWins++;
        }

        else {
          draws++;
        }

      }

    }
  );


  return {

    count:
      matches.length,

    homeWins,

    draws,

    awayWins,

    homeGoals:
      round(
        moyenne(homeGoals)
      ),

    awayGoals:
      round(
        moyenne(awayGoals)
      )

  };

}


/* ==================================================
   CLASSEMENT
================================================== */

async function recupererClassement(
  leagueId,
  date
) {

  try {

    if (!leagueId) {
      return null;
    }


    const season =
      saisonProbable(date);


    const data =
      await footballApi(
        "/standings?league=" +
        encodeURIComponent(
          leagueId
        ) +
        "&season=" +
        encodeURIComponent(
          season
        )
      );


    return (
      data.response?.[0] ||
      null
    );

  } catch (error) {

    console.log(
      "Classement indisponible:",
      error.message
    );


    return null;

  }

}


/* ==================================================
   TROUVER POSITION
================================================== */

function positionEquipe(
  standings,
  teamId
) {

  if (
    !standings?.league?.standings
  ) {
    return null;
  }


  const groups =
    standings.league.standings;


  for (
    const group of groups
  ) {

    for (
      const item of group
    ) {

      if (
        Number(item.team?.id) ===
        Number(teamId)
      ) {

        return {

          rank:
            item.rank ?? null,

          points:
            item.points ?? null,

          goalsDiff:
            item.goalsDiff ?? null,

          form:
            item.form ?? null

        };

      }

    }

  }


  return null;

}


/* ==================================================
   PREDICTION API-FOOTBALL
================================================== */

async function predictionAPI(
  fixtureId
) {

  const data =
    await footballApi(
      "/predictions?fixture=" +
      encodeURIComponent(
        fixtureId
      )
    );


  return (
    data.response?.[0] ||
    null
  );

}


/* ==================================================
   POURCENTAGES API
================================================== */

function pourcentagesPrediction(
  prediction
) {

  const p =
    prediction?.predictions || {};


  const percent =
    p.percent || {};


  return {

    home:
      pct(percent.home),

    draw:
      pct(percent.draw),

    away:
      pct(percent.away)

  };

}


/* ==================================================
   MEILLEUR CHOIX
================================================== */

function meilleurChoix(
  percentages
) {

  const home =
    percentages.home;

  const draw =
    percentages.draw;

  const away =
    percentages.away;


  if (
    home === 0 &&
    draw === 0 &&
    away === 0
  ) {

    return {

      type: "-",

      confidence: 0,

      label:
        "Données insuffisantes"

    };

  }


  if (
    home >= draw &&
    home >= away
  ) {

    return {

      type: "1",

      confidence: home,

      label:
        "Victoire à domicile"

    };

  }


  if (
    away >= home &&
    away >= draw
  ) {

    return {

      type: "2",

      confidence: away,

      label:
        "Victoire à l'extérieur"

    };

  }


  return {

    type: "N",

    confidence: draw,

    label:
      "Match nul"

  };

}


/* ==================================================
   SCORE EXACT API
================================================== */

function scorePredictionAPI(
  prediction
) {

  const goals =
    prediction?.predictions?.goals;


  if (!goals) {
    return null;
  }


  const home =
    scoreExact(
      goals.home
    );


  const away =
    scoreExact(
      goals.away
    );


  if (
    !home ||
    !away
  ) {

    return null;

  }


  return {

    home:
      home.home,

    away:
      away.home

  };

}


/* ==================================================
   SCORE PROBABLE CALCULÉ
================================================== */

function scoreCalcule(
  homeForm,
  awayForm,
  h2h
) {

  /*
   * Attaque domicile :
   * moyenne buts marqués domicile
   * + faiblesse défensive adverse.
   *
   * On reste volontairement simple
   * et transparent.
   */

  const homeAttack =
    homeForm.goalsFor;


  const awayDefense =
    awayForm.goalsAgainst;


  const awayAttack =
    awayForm.goalsFor;


  const homeDefense =
    homeForm.goalsAgainst;


  let expectedHome =
    (
      homeAttack +
      awayDefense
    ) / 2;


  let expectedAway =
    (
      awayAttack +
      homeDefense
    ) / 2;


  /*
   * Petit poids H2H uniquement
   * lorsqu'il existe suffisamment
   * de confrontations.
   */

  if (
    h2h &&
    h2h.count >= 2
  ) {

    expectedHome =
      expectedHome * 0.75 +
      h2h.homeGoals * 0.25;


    expectedAway =
      expectedAway * 0.75 +
      h2h.awayGoals * 0.25;

  }


  expectedHome =
    clamp(
      expectedHome,
      0,
      5
    );


  expectedAway =
    clamp(
      expectedAway,
      0,
      5
    );


  return {

    home:
      Math.round(
        expectedHome
      ),

    away:
      Math.round(
        expectedAway
      )

  };

}


/* ==================================================
   SCORE MI-TEMPS
================================================== */

function scoreMiTemps(
  homeForm,
  awayForm
) {

  let home =
    (
      homeForm.htFor +
      awayForm.htAgainst
    ) / 2;


  let away =
    (
      awayForm.htFor +
      homeForm.htAgainst
    ) / 2;


  /*
   * Les petites valeurs doivent
   * rester réalistes.
   */

  home =
    clamp(
      home,
      0,
      3
    );


  away =
    clamp(
      away,
      0,
      3
    );


  return {

    home:
      Math.round(home),

    away:
      Math.round(away)

  };

}


/* ==================================================
   FORMAT SCORE
================================================== */

function formatScore(
  score
) {

  if (!score) {
    return "Non disponible";
  }


  return (
    score.home +
    "-" +
    score.away
  );

}


/* ==================================================
   BTTS
================================================== */

function calculBTTS(
  homeForm,
  awayForm
) {

  const values = [
    homeForm.bttsPercent,
    awayForm.bttsPercent
  ];


  const result =
    moyenne(values);


  return (
    round(result) +
    "%"
  );

}


/* ==================================================
   OVER / UNDER
================================================== */

function calculOverUnder(
  homeForm,
  awayForm
) {

  const over =
    moyenne([
      homeForm.over25Percent,
      awayForm.over25Percent
    ]);


  if (over >= 60) {
    return "Over 2.5";
  }


  if (over <= 40) {
    return "Under 2.5";
  }


  return "Équilibré";

}


/* ==================================================
   NIVEAU DE DONNÉES
================================================== */

function qualiteDonnees(
  homeForm,
  awayForm,
  h2h,
  prediction
) {

  let score = 0;


  if (
    homeForm.count >= 5
  ) {
    score += 25;
  }

  else if (
    homeForm.count >= 3
  ) {
    score += 15;
  }


  if (
    awayForm.count >= 5
  ) {
    score += 25;
  }

  else if (
    awayForm.count >= 3
  ) {
    score += 15;
  }


  if (
    h2h.count >= 3
  ) {
    score += 15;
  }

  else if (
    h2h.count >= 1
  ) {
    score += 7;
  }


  if (prediction) {
    score += 20;
  }


  if (
    homeForm.htFor !== 0 ||
    homeForm.htAgainst !== 0 ||
    awayForm.htFor !== 0 ||
    awayForm.htAgainst !== 0
  ) {
    score += 15;
  }


  return clamp(
    score,
    0,
    100
  );

}


/* ==================================================
   CONFIANCE COMBINÉE
================================================== */

function confianceFinale(
  apiPick,
  homeForm,
  awayForm,
  h2h,
  quality
) {

  if (
    !apiPick ||
    apiPick.confidence <= 0
  ) {
    return 0;
  }


  /*
   * La confiance n'est pas simplement
   * le pourcentage API.
   *
   * On combine :
   * - confiance API
   * - forme domicile
   * - forme extérieur
   * - H2H
   * - qualité des données.
   */

  let confidence =
    apiPick.confidence * 0.60;


  const formDifference =
    Math.abs(
      homeForm.formPercent -
      awayForm.formPercent
    );


  confidence +=
    clamp(
      formDifference,
      0,
      100
    ) * 0.15;


  if (
    h2h.count >= 3
  ) {

    confidence += 10;

  }


  confidence +=
    quality * 0.15;


  return clamp(
    Math.round(confidence),
    0,
    99
  );

}


/* ==================================================
   ANALYSE D'UN MATCH
================================================== */

async function analyserMatch(
  match
) {

  const fixtureId =
    match.fixture.id;


  const homeId =
    match.teams?.home?.id;


  const awayId =
    match.teams?.away?.id;


  if (
    !homeId ||
    !awayId
  ) {

    return null;

  }


  /*
   * Récupérer les historiques
   * des deux équipes.
   */

  const [
    homeLast,
    awayLast,
    h2hData,
    apiPrediction
  ] =
  await Promise.all([

    footballApi(
      "/fixtures?team=" +
      encodeURIComponent(homeId) +
      "&last=5"
    ),

    footballApi(
      "/fixtures?team=" +
      encodeURIComponent(awayId) +
      "&last=5"
    ),

    footballApi(
      "/fixtures/headtohead?h2h=" +
      encodeURIComponent(
        homeId + "-" + awayId
      ) +
      "&last=5"
    ),

    predictionAPI(
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


  const standings =
    await recupererClassement(
      match.league?.id,
      match.fixture.date
    );


  const homeRank =
    positionEquipe(
      standings,
      homeId
    );


  const awayRank =
    positionEquipe(
      standings,
      awayId
    );


  const percentages =
    pourcentagesPrediction(
      apiPrediction
    );


  const apiPick =
    meilleurChoix(
      percentages
    );


  const quality =
    qualiteDonnees(
      homeForm,
      awayForm,
      h2h,
      apiPrediction
    );


  const confidence =
    confianceFinale(
      apiPick,
      homeForm,
      awayForm,
      h2h,
      quality
    );


  /*
   * Si l'API donne un vrai score
   * exact, on peut l'utiliser.
   *
   * Sinon on calcule notre propre
   * score à partir des données.
   */

  const apiExact =
    scorePredictionAPI(
      apiPrediction
    );


  const calculatedScore =
    scoreCalcule(
      homeForm,
      awayForm,
      h2h
    );


  const finalScore =
    apiExact ||
    calculatedScore;


  const halftime =
    scoreMiTemps(
      homeForm,
      awayForm
    );


  const btts =
    calculBTTS(
      homeForm,
      awayForm
    );


  const overUnder =
    calculOverUnder(
      homeForm,
      awayForm
    );


  /*
   * Conseil API.
   */

  const advice =
    apiPrediction?.predictions?.advice ||
    "Aucun conseil API disponible";


  /*
   * Analyse lisible.
   */

  const homeFormText =
    homeForm.count > 0
      ? `${homeForm.wins} victoire(s), ${homeForm.draws} nul(s), ${homeForm.losses} défaite(s), ${homeForm.goalsFor} but(s) marqué(s) en moyenne et ${homeForm.goalsAgainst} encaissé(s).`
      : "Données récentes indisponibles.";


  const awayFormText =
    awayForm.count > 0
      ? `${awayForm.wins} victoire(s), ${awayForm.draws} nul(s), ${awayForm.losses} défaite(s), ${awayForm.goalsFor} but(s) marqué(s) en moyenne et ${awayForm.goalsAgainst} encaissé(s).`
      : "Données récentes indisponibles.";


  let h2hText =
    "Aucune confrontation directe exploitable.";


  if (
    h2h.count > 0
  ) {

    h2hText =
      `${h2h.count} confrontation(s) directe(s) : ${h2h.homeWins} avantage(s) ${match.teams.home.name}, ${h2h.draws} nul(s), ${h2h.awayWins} avantage(s) ${match.teams.away.name}.`;

  }


  const classementText =
    homeRank && awayRank
      ? `${match.teams.home.name} est ${homeRank.rank}e et ${match.teams.away.name} est ${awayRank.rank}e.`
      : "Classement non disponible pour cette compétition.";


  const analysis =
    `Analyse réelle des données disponibles. ` +
    `${match.teams.home.name} : ${homeFormText} ` +
    `${match.teams.away.name} : ${awayFormText} ` +
    `${h2hText} ` +
    `${classementText} ` +
    `API-Football donne 1=${percentages.home}%, N=${percentages.draw}%, 2=${percentages.away}%. ` +
    `Score probable calculé : ${formatScore(finalScore)}. ` +
    `Mi-temps probable : ${formatScore(halftime)}. ` +
    `BTTS estimé : ${btts}. ` +
    `Tendance : ${overUnder}. ` +
    `Qualité des données : ${quality}%.`;


  return {

    fixture:
      match,

    apiPrediction,

    homeForm,

    awayForm,

    h2h,

    homeRank,

    awayRank,

    quality,

    percentages,

    apiPick,

    confidence,

    finalScore,

    halftime,

    btts,

    overUnder,

    advice,

    analysis

  };

}


/* ==================================================
   RACINE
================================================== */

app.get(
  "/",
  (req, res) => {

    res.json({

      status:
        "ok",

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

      status:
        "online",

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

        success:
          true,

        date,

        matches:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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

        success:
          true,

        prediction:
          data.response?.[0] ||
          null

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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


      let matches =
        fixturesData.response || [];


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
       * On analyse jusqu'à 8 candidats
       * pour avoir une vraie comparaison.
       */

      const candidats =
        matches.slice(0, 8);


      const analyses = [];


      for (
        const match of candidats
      ) {

        try {

          const analysis =
            await analyserMatch(
              match
            );


          if (!analysis) {
            continue;
          }


          /*
           * Ne pas présenter comme
           * "fiable" une analyse trop faible.
           */

          if (
            analysis.quality < 55
          ) {

            console.log(
              "Données insuffisantes:",
              match.fixture.id,
              analysis.quality
            );

            continue;

          }


          if (
            analysis.confidence < 52
          ) {

            console.log(
              "Confiance insuffisante:",
              match.fixture.id,
              analysis.confidence
            );

            continue;

          }


          analyses.push(
            analysis
          );

        } catch (error) {

          console.log(
            "Analyse impossible:",
            match.fixture.id,
            error.message
          );

        }

      }


      /*
       * Plus forte confiance d'abord.
       */

      analyses.sort(
        (a, b) =>
          b.confidence -
          a.confidence
      );


      /*
       * Maximum 2 matchs.
       */

      const selected =
        analyses.slice(0, 2);


      const result = [];


      for (
        const item of selected
      ) {

        const m =
          item.fixture;


        const p =
          item.apiPrediction;


        const finalScore =
          item.finalScore;


        const halftime =
          item.halftime;


        const selectionText =
          item.apiPick.type === "1"
            ? "Victoire " +
              m.teams.home.name
            : item.apiPick.type === "2"
              ? "Victoire " +
                m.teams.away.name
              : "Match nul";


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
              item.apiPick.type,

            text:
              selectionText,

            confidence:
              item.confidence

          },

          predicted_half_time:
            formatScore(
              halftime
            ),

          predicted_full_time:
            formatScore(
              finalScore
            ),

          predicted_score:
            formatScore(
              finalScore
            ),

          data_quality:
            item.quality,

          btts:
            item.btts,

          over_under:
            item.overUnder,

          advice:
            item.advice,

          form_home:
            item.homeForm,

          form_away:
            item.awayForm,

          h2h:
            item.h2h

        };


        /*
         * Ne pas créer plusieurs
         * historiques pour le même match.
         */

        const existingIndex =
          history.findIndex(
            h =>
              Number(
                h.fixture_id
              ) ===
              Number(
                historyItem.fixture_id
              )
          );


        if (
          existingIndex === -1
        ) {

          history.push(
            historyItem
          );

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
              selectionText,

            type:
              item.apiPick.type,

            home:
              item.percentages.home
                .toFixed(0) +
              "%",

            draw:
              item.percentages.draw
                .toFixed(0) +
              "%",

            away:
              item.percentages.away
                .toFixed(0) +
              "%",

            goals:
              formatScore(
                finalScore
              ),

            under_over:
              item.overUnder,

            over_under:
              item.overUnder,

            btts:
              item.btts,

            corners:
              p?.predictions?.under_over ||
              "Non disponible",

            yellow_cards:
              "Non disponible",

            half_time_score:
              formatScore(
                halftime
              ),

            full_time_score:
              formatScore(
                finalScore
              ),

            advice:
              item.advice

          },

          consensus: {

            confidence:
              item.confidence +
              "%",

            score:
              formatScore(
                finalScore
              ),

            data_quality:
              item.quality +
              "%"

          },

          sources: {

            api_football:
              true,

            recent_matches:
              true,

            h2h:
              item.h2h.count > 0,

            standings:
              Boolean(
                item.homeRank ||
                item.awayRank
              ),

            sportmonks:
              false,

            football_data:
              false

          },

          analysis:
            item.analysis

        });

      }


      /*
       * Si aucun match suffisamment
       * fiable n'est trouvé.
       */

      if (
        result.length === 0
      ) {

        return res.json({

          success:
            true,

          date,

          analyzed_candidates:
            candidats.length,

          selected:
            0,

          matches: [],

          message:
            "Aucun match ne possède actuellement suffisamment de données et de confiance pour être présenté comme pronostic fiable."

        });

      }


      res.json({

        success:
          true,

        date,

        analyzed_candidates:
          candidats.length,

        selected:
          result.length,

        matches:
          result,

        message:
          "Analyse terminée avec comparaison de la forme, des derniers matchs, du H2H, du classement lorsque disponible et de la prédiction API-Football."

      });

    } catch (error) {

      console.error(
        "Erreur predictions:",
        error
      );


      res.status(500).json({

        success:
          false,

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

          success:
            false,

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

        success:
          true,

        fixture,

        statistics:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            false,

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

        success:
          true,

        team,

        matches:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            false,

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

        success:
          true,

        teams,

        h2h:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            false,

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

        success:
          true,

        league,

        season,

        standings:
          data.response || []

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

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

          success:
            true,

          total:
            0,

          stats: {

            gagne:
              0,

            perdu:
              0,

            attente:
              0,

            taux_reussite:
              0

          },

          matches: []

        });

      }


      /*
       * Maximum 20 derniers matchs
       * pour limiter les requêtes.
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
            Number(
              fixture.fixture.id
            ),
            fixture
          );

        }
      );


      const updated =
        history.map(
          item => {

            const fixture =
              fixtureMap.get(
                Number(
                  item.fixture_id
                )
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


            let result =
              "EN_ATTENTE";


            if (
              matchTermine(
                fixture
              )
            ) {

              const hg =
                fixture.goals?.home;

              const ag =
                fixture.goals?.away;


              if (
                hg !== null &&
                hg !== undefined &&
                ag !== null &&
                ag !== undefined
              ) {

                if (
                  item.selection?.type === "1"
                ) {

                  result =
                    Number(hg) >
                    Number(ag)
                      ? "GAGNE"
                      : "PERDU";

                }

                else if (
                  item.selection?.type === "2"
                ) {

                  result =
                    Number(ag) >
                    Number(hg)
                      ? "GAGNE"
                      : "PERDU";

                }

                else if (
                  item.selection?.type === "N"
                ) {

                  result =
                    Number(hg) ===
                    Number(ag)
                      ? "GAGNE"
                      : "PERDU";

                }

              }

            }


            return {

              ...item,

              status:
                fixture.fixture?.status?.short ||
                "NS",

              halftime_score:
                scores.halftime,

              final_score:
                scores.fulltime,

              /*
               * Alias pour les anciennes
               * versions de l'application.
               */

              predicted_half_time:
                item.predicted_half_time ||
                null,

              predicted_full_time:
                item.predicted_full_time ||
                item.predicted_score ||
                null,

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
          ) -
          new Date(
            a.created_at
          )
      );


      res.json({

        success:
          true,

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

        success:
          false,

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
            Number(
              h.fixture_id
            ) ===
            fixtureId
        );


      if (!item) {

        return res.status(404).json({

          success:
            false,

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
          fixture.fixture?.status?.short ||
          "NS";


        item.halftime_score =
          scores.halftime;


        item.final_score =
          scores.fulltime;


        if (
          matchTermine(
            fixture
          )
        ) {

          const hg =
            fixture.goals?.home;

          const ag =
            fixture.goals?.away;


          if (
            hg !== null &&
            hg !== undefined &&
            ag !== null &&
            ag !== undefined
          ) {

            if (
              item.selection?.type === "1"
            ) {

              item.result =
                Number(hg) >
                Number(ag)
                  ? "GAGNE"
                  : "PERDU";

            }

            else if (
              item.selection?.type === "2"
            ) {

              item.result =
                Number(ag) >
                Number(hg)
                  ? "GAGNE"
                  : "PERDU";

            }

            else if (
              item.selection?.type === "N"
            ) {

              item.result =
                Number(hg) ===
                Number(ag)
                  ? "GAGNE"
                  : "PERDU";

            }

          }

        }


        sauvegarderHistorique();

      }


      res.json({

        success:
          true,

        match:
          item

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


/* ==================================================
   SUPPRIMER HISTORIQUE
================================================== */

app.delete(
  "/history",
  (req, res) => {

    history = [];

    sauvegarderHistorique();


    res.json({

      success:
        true,

      message:
        "Historique supprimé.",

      total:
        0

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

        success:
          true,

        message:
          "Connexion API-Football OK",

        results:
          data.results || 0,

        response:
          data.response || null

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

        message:
          "Connexion API-Football échouée",

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
