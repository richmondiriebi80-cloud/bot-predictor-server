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
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(
      "Réponse API-Football invalide."
    );
  }

  if (!response.ok) {
    throw new Error(
      "API-Football HTTP " +
      response.status +
      " : " +
      JSON.stringify(data.errors || {})
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
    ).format(new Date(date));

  } catch (e) {
    return "";
  }
}


/* ==================================================
   OUTILS
================================================== */

function pct(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const n = parseFloat(
    String(value).replace("%", "")
  );

  return Number.isFinite(n)
    ? n
    : 0;
}


function num(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    parseFloat(
      String(value).replace("%", "")
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function safeName(team) {

  return (
    team?.name ||
    "Équipe inconnue"
  );
}


/* ==================================================
   STATUT MATCH
================================================== */

const STATUTS_TERMINE = [
  "FT",
  "AET",
  "PEN",
  "CANC",
  "ABD",
  "AWD",
  "WO"
];

const STATUTS_LIVE = [
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "LIVE"
];


function matchAVenir(match) {

  if (!match?.fixture) {
    return false;
  }

  const status =
    match.fixture.status?.short;

  if (
    STATUTS_TERMINE.includes(status) ||
    STATUTS_LIVE.includes(status)
  ) {
    return false;
  }

  return (
    new Date(match.fixture.date) >
    new Date()
  );
}


function matchTermine(match) {

  return STATUTS_TERMINE.includes(
    match?.fixture?.status?.short
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
   SCORE ESTIME
   IMPORTANT :
   LES -1.5 / -2.5 / -3.5 NE SONT PAS DES SCORES.
================================================== */

function scoreEstime(prediction) {

  const p =
    prediction?.predictions || {};

  const winner =
    p.winner || {};

  const goals =
    p.goals || {};

  const homeGoal =
    String(goals.home || "");

  const awayGoal =
    String(goals.away || "");

  /*
   * On ne transforme jamais directement
   * "-1.5" ou "-2.5" en "0-0".
   */

  let home = null;
  let away = null;

  /*
   * Si l'API fournit déjà un entier,
   * on peut l'utiliser.
   */

  if (/^\d+$/.test(homeGoal)) {
    home = parseInt(homeGoal, 10);
  }

  if (/^\d+$/.test(awayGoal)) {
    away = parseInt(awayGoal, 10);
  }

  /*
   * Si l'API ne fournit pas de score exact,
   * on produit une estimation prudente
   * uniquement à partir du vainqueur
   * et des probabilités.
   */

  const homePct =
    pct(p.percent?.home);

  const drawPct =
    pct(p.percent?.draw);

  const awayPct =
    pct(p.percent?.away);

  if (
    home === null &&
    away === null
  ) {

    if (
      winner.id &&
      winner.id ===
      prediction.teams?.home?.id
    ) {

      if (homePct >= 60) {
        home = 2;
        away = 0;
      } else {
        home = 1;
        away = 0;
      }

    } else if (
      winner.id &&
      winner.id ===
      prediction.teams?.away?.id
    ) {

      if (awayPct >= 60) {
        home = 0;
        away = 2;
      } else {
        home = 0;
        away = 1;
      }

    } else if (
      drawPct >= homePct &&
      drawPct >= awayPct
    ) {

      home = 1;
      away = 1;

    } else {

      home = 1;
      away = 0;
    }
  }

  if (home === null) {
    home = 1;
  }

  if (away === null) {
    away = 0;
  }

  return home + "-" + away;
}


/* ==================================================
   MEILLEUR PRONOSTIC
================================================== */

function meilleurePrediction(prediction) {

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
      text: "Données insuffisantes",
      confidence: 0
    };
  }

  /*
   * On respecte le winner de l'API
   * lorsqu'il existe.
   */

  const winner =
    p.winner || {};

  const homeId =
    prediction.teams?.home?.id;

  const awayId =
    prediction.teams?.away?.id;

  if (
    winner.id &&
    winner.id === homeId
  ) {
    return {
      type: "1",
      text:
        "Victoire " +
        safeName(
          prediction.teams?.home
        ),
      confidence: home
    };
  }

  if (
    winner.id &&
    winner.id === awayId
  ) {
    return {
      type: "2",
      text:
        "Victoire " +
        safeName(
          prediction.teams?.away
        ),
      confidence: away
    };
  }

  if (
    draw >= home &&
    draw >= away
  ) {
    return {
      type: "N",
      text: "Match nul",
      confidence: draw
    };
  }

  if (
    home >= away
  ) {
    return {
      type: "1",
      text:
        "Victoire " +
        safeName(
          prediction.teams?.home
        ),
      confidence: home
    };
  }

  return {
    type: "2",
    text:
      "Victoire " +
      safeName(
        prediction.teams?.away
      ),
    confidence: away
  };
}


/* ==================================================
   FORME RECENTE
================================================== */

function analyserForm(
  fixtures,
  teamId
) {

  const matches =
    (fixtures || [])
      .filter(
        f =>
          f?.fixture?.status?.short &&
          STATUTS_TERMINE.includes(
            f.fixture.status.short
          )
      )
      .slice(0, 5);

  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  const results = [];

  for (const match of matches) {

    const homeId =
      match.teams?.home?.id;

    const isHome =
      homeId === teamId;

    const gf =
      isHome
        ? num(match.goals?.home)
        : num(match.goals?.away);

    const ga =
      isHome
        ? num(match.goals?.away)
        : num(match.goals?.home);

    if (
      gf === null ||
      ga === null
    ) {
      continue;
    }

    goalsFor += gf;
    goalsAgainst += ga;

    let result;

    if (gf > ga) {
      wins++;
      result = "V";
    } else if (gf === ga) {
      draws++;
      result = "N";
    } else {
      losses++;
      result = "D";
    }

    results.push({
      result,
      goals_for: gf,
      goals_against: ga,
      opponent:
        isHome
          ? safeName(
              match.teams?.away
            )
          : safeName(
              match.teams?.home
            ),
      date:
        match.fixture.date
    });
  }

  const total =
    wins + draws + losses;

  return {
    total,
    wins,
    draws,
    losses,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    average_goals_for:
      total
        ? Number(
            (goalsFor / total)
              .toFixed(2)
          )
        : 0,
    average_goals_against:
      total
        ? Number(
            (goalsAgainst / total)
              .toFixed(2)
          )
        : 0,
    results
  };
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

      const content =
        fs.readFileSync(
          HISTORY_FILE,
          "utf8"
        );

      const parsed =
        JSON.parse(content);

      history =
        Array.isArray(parsed)
          ? parsed
          : [];

    }

  } catch (error) {

    console.log(
      "Historique non chargé :",
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
      "Erreur sauvegarde historique :",
      error.message
    );
  }
}


chargerHistorique();


/* ==================================================
   CACHE
================================================== */

const cache = {
  predictions: new Map(),
  forms: new Map(),
  h2h: new Map()
};

const CACHE_TIME =
  30 * 60 * 1000;


function cacheValide(item) {

  return (
    item &&
    Date.now() - item.time <
    CACHE_TIME
  );
}


/* ==================================================
   PREDICTION API
================================================== */

async function obtenirPrediction(
  fixtureId
) {

  const cached =
    cache.predictions.get(
      String(fixtureId)
    );

  if (cacheValide(cached)) {
    return cached.data;
  }

  const data =
    await footballApi(
      "/predictions?fixture=" +
      encodeURIComponent(fixtureId)
    );

  const prediction =
    data.response?.[0] ||
    null;

  cache.predictions.set(
    String(fixtureId),
    {
      time: Date.now(),
      data: prediction
    }
  );

  return prediction;
}


/* ==================================================
   DERNIERS MATCHS EQUIPE
================================================== */

async function derniersMatchs(
  teamId
) {

  const key =
    String(teamId);

  const cached =
    cache.forms.get(key);

  if (cacheValide(cached)) {
    return cached.data;
  }

  const data =
    await footballApi(
      "/fixtures?team=" +
      encodeURIComponent(teamId) +
      "&last=5"
    );

  const matches =
    data.response || [];

  cache.forms.set(
    key,
    {
      time: Date.now(),
      data: matches
    }
  );

  return matches;
}


/* ==================================================
   H2H
================================================== */

async function h2h(
  homeId,
  awayId
) {

  const key =
    homeId +
    "-" +
    awayId;

  const cached =
    cache.h2h.get(key);

  if (cacheValide(cached)) {
    return cached.data;
  }

  const data =
    await footballApi(
      "/fixtures/headtohead?h2h=" +
      encodeURIComponent(
        homeId + "-" + awayId
      ) +
      "&last=5"
    );

  const matches =
    data.response || [];

  cache.h2h.set(
    key,
    {
      time: Date.now(),
      data: matches
    }
  );

  return matches;
}


/* ==================================================
   ANALYSE H2H
================================================== */

function analyserH2H(
  fixtures,
  homeId
) {

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  const matches =
    (fixtures || [])
      .filter(
        f =>
          STATUTS_TERMINE.includes(
            f?.fixture?.status?.short
          )
      )
      .slice(0, 5);

  for (const match of matches) {

    const hg =
      num(match.goals?.home);

    const ag =
      num(match.goals?.away);

    if (
      hg === null ||
      ag === null
    ) {
      continue;
    }

    const homeTeamId =
      match.teams?.home?.id;

    const homeTeamIsOurHome =
      homeTeamId === homeId;

    if (hg === ag) {

      draws++;

    } else if (
      homeTeamIsOurHome
        ? hg > ag
        : ag > hg
    ) {

      homeWins++;

    } else {

      awayWins++;
    }
  }

  return {
    total:
      homeWins +
      draws +
      awayWins,

    home_team_wins:
      homeWins,

    draws,

    away_team_wins:
      awayWins
  };
}


/* ==================================================
   ANALYSE TEXTE
================================================== */

function construireAnalyse(
  prediction,
  homeForm,
  awayForm,
  h2hData,
  selection
) {

  const p =
    prediction?.predictions || {};

  const homePct =
    pct(p.percent?.home);

  const drawPct =
    pct(p.percent?.draw);

  const awayPct =
    pct(p.percent?.away);

  const advice =
    p.advice ||
    "Aucun conseil API disponible";

  const score =
    scoreEstime(prediction);

  const homeTeam =
    safeName(
      prediction?.teams?.home
    );

  const awayTeam =
    safeName(
      prediction?.teams?.away
    );

  let texte =
    "Analyse multi-données. ";

  texte +=
    "Probabilités API-Football : " +
    "1 = " +
    homePct.toFixed(0) +
    "%, " +
    "N = " +
    drawPct.toFixed(0) +
    "%, " +
    "2 = " +
    awayPct.toFixed(0) +
    "%. ";

  if (homeForm.total > 0) {

    texte +=
      homeTeam +
      " sur ses " +
      homeForm.total +
      " derniers matchs : " +
      homeForm.wins +
      " victoire(s), " +
      homeForm.draws +
      " nul(s), " +
      homeForm.losses +
      " défaite(s), " +
      homeForm.goals_for +
      " but(s) marqué(s), " +
      homeForm.goals_against +
      " encaissé(s). ";

  } else {

    texte +=
      "Forme récente de " +
      homeTeam +
      " indisponible. ";
  }

  if (awayForm.total > 0) {

    texte +=
      awayTeam +
      " sur ses " +
      awayForm.total +
      " derniers matchs : " +
      awayForm.wins +
      " victoire(s), " +
      awayForm.draws +
      " nul(s), " +
      awayForm.losses +
      " défaite(s), " +
      awayForm.goals_for +
      " but(s) marqué(s), " +
      awayForm.goals_against +
      " encaissé(s). ";

  } else {

    texte +=
      "Forme récente de " +
      awayTeam +
      " indisponible. ";
  }

  texte +=
    "Face-à-face disponibles : " +
    h2hData.total +
    ". ";

  if (h2hData.total > 0) {

    texte +=
      "Bilan H2H : " +
      h2hData.home_team_wins +
      " victoire(s) côté " +
      homeTeam +
      ", " +
      h2hData.draws +
      " nul(s), " +
      h2hData.away_team_wins +
      " victoire(s) côté " +
      awayTeam +
      ". ";
  }

  texte +=
    "Pronostic principal : " +
    selection.text +
    " avec " +
    selection.confidence.toFixed(0) +
    "% de probabilité. ";

  texte +=
    "Conseil API-Football : " +
    advice +
    ". ";

  texte +=
    "Score indicatif interne : " +
    score +
    ". ";

  texte +=
    "Attention : les seuils API tels que -1.5, -2.5 ou -3.5 sont des prédictions Over/Under et ne constituent pas des scores exacts.";

  return texte;
}


/* ==================================================
   RACINE
================================================== */

app.get(
  "/",
  (req, res) => {

    res.json({
      status: "ok",
      service: "BOT PREDICTOR",
      message:
        "Serveur actif - version analyse multi-données",
      timezone: "Africa/Abidjan"
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

      const fixture =
        req.params.fixture;

      const prediction =
        await obtenirPrediction(
          fixture
        );

      if (!prediction) {

        return res.json({

          success: true,

          prediction: null,

          message:
            "Aucune prédiction disponible pour ce match."

        });
      }

      res.json({

        success: true,

        prediction

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
        (fixtures.response || [])
          .filter(matchAVenir);

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
       * On analyse plusieurs candidats.
       */

      const candidats =
        matches.slice(0, 8);

      const analyses = [];

      /*
       * Première étape :
       * récupérer les prédictions API.
       */

      for (
        const match of candidats
      ) {

        try {

          const prediction =
            await obtenirPrediction(
              match.fixture.id
            );

          if (!prediction) {
            continue;
          }

          const selection =
            meilleurePrediction(
              prediction
            );

          if (
            selection.confidence <= 0
          ) {
            continue;
          }

          analyses.push({

            match,

            prediction,

            selection

          });

        } catch (error) {

          console.log(
            "Prediction indisponible :",
            match.fixture.id,
            error.message
          );

        }

      }

      /*
       * Trier selon la confiance.
       */

      analyses.sort(
        (a, b) =>
          b.selection.confidence -
          a.selection.confidence
      );

      /*
       * Les 2 meilleurs.
       */

      const selected =
        analyses.slice(0, 2);

      const result = [];

      for (
        const item of selected
      ) {

        const m =
          item.match;

        const p =
          item.prediction;

        const s =
          item.selection;

        const homeId =
          m.teams?.home?.id;

        const awayId =
          m.teams?.away?.id;

        /*
         * Récupération des formes.
         */

        let homeLast5 = [];
        let awayLast5 = [];
        let h2hMatches = [];

        try {
          homeLast5 =
            await derniersMatchs(
              homeId
            );
        } catch (e) {
          console.log(
            "Forme domicile indisponible",
            e.message
          );
        }

        try {
          awayLast5 =
            await derniersMatchs(
              awayId
            );
        } catch (e) {
          console.log(
            "Forme extérieur indisponible",
            e.message
          );
        }

        try {
          h2hMatches =
            await h2h(
              homeId,
              awayId
            );
        } catch (e) {
          console.log(
            "H2H indisponible",
            e.message
          );
        }

        const homeForm =
          analyserForm(
            homeLast5,
            homeId
          );

        const awayForm =
          analyserForm(
            awayLast5,
            awayId
          );

        const h2hData =
          analyserH2H(
            h2hMatches,
            homeId
          );

        const pred =
          p.predictions || {};

        const estimatedScore =
          scoreEstime(p);

        const analysis =
          construireAnalyse(
            p,
            homeForm,
            awayForm,
            h2hData,
            s
          );

        /*
         * On enregistre la prédiction.
         */

        const existing =
          history.find(
            h =>
              Number(h.fixture_id) ===
              Number(m.fixture.id)
          );

        if (!existing) {

          history.push({

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
                homeId,

              name:
                m.teams?.home?.name ||
                "",

              logo:
                m.teams?.home?.logo ||
                ""

            },

            away: {

              id:
                awayId,

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
              estimatedScore,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            result:
              "EN_ATTENTE",

            halftime_score:
              null,

            final_score:
              null

          });

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

            home: {

              id:
                homeId,

              name:
                m.teams?.home?.name ||
                "",

              logo:
                m.teams?.home?.logo ||
                ""

            },

            away: {

              id:
                awayId,

              name:
                m.teams?.away?.name ||
                "",

              logo:
                m.teams?.away?.logo ||
                ""

            }

          },

          prediction: {

            main_pick:
              s.text,

            type:
              s.type,

            home:
              pct(
                pred.percent?.home
              ).toFixed(0) +
              "%",

            draw:
              pct(
                pred.percent?.draw
              ).toFixed(0) +
              "%",

            away:
              pct(
                pred.percent?.away
              ).toFixed(0) +
              "%",

            goals:
              estimatedScore,

            under_over:
              pred.under_over ||
              "Non disponible",

            advice:
              pred.advice ||
              "Non disponible",

            btts:
              pred.btts ||
              "Non disponible",

            over_under:
              pred.under_over ||
              "Non disponible",

            corners:
              "Non disponible",

            yellow_cards:
              "Non disponible",

            half_time_score:
              "Non disponible",

            full_time_score:
              estimatedScore

          },

          consensus: {

            confidence:
              s.confidence.toFixed(0) +
              "%",

            score:
              estimatedScore

          },

          form: {

            home:
              homeForm,

            away:
              awayForm

          },

          h2h:
            h2hData,

          sources: {

            api_football:
              true,

            form_last_5:
              homeForm.total > 0 ||
              awayForm.total > 0,

            head_to_head:
              h2hData.total > 0

          },

          analysis

        });

      }

      res.json({

        success: true,

        date,

        analyzed_candidates:
          candidats.length,

        selected:
          result.length,

        matches:
          result,

        message:
          result.length
            ? "Analyse terminée."
            : "Aucun match avec suffisamment de données de prédiction."

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

      /*
       * Fixture principale.
       */

      const fixtureData =
        await footballApi(
          "/fixtures?id=" +
          encodeURIComponent(fixture) +
          "&timezone=Africa/Abidjan"
        );

      const match =
        fixtureData.response?.[0] ||
        null;

      if (!match) {

        return res.status(404).json({

          success: false,

          error:
            "Match introuvable."

        });

      }

      /*
       * Statistiques de match.
       *
       * Pour un match futur, API-Football
       * peut naturellement ne rien fournir.
       */

      let statsData = null;

      try {

        statsData =
          await footballApi(
            "/fixtures/statistics?fixture=" +
            encodeURIComponent(fixture) +
            "&half=true"
          );

      } catch (e) {

        console.log(
          "Statistiques match indisponibles :",
          e.message
        );

      }

      const statistics =
        statsData?.response ||
        [];

      /*
       * Forme des équipes.
       */

      let homeLast5 = [];
      let awayLast5 = [];
      let h2hMatches = [];

      const homeId =
        match.teams?.home?.id;

      const awayId =
        match.teams?.away?.id;

      try {
        homeLast5 =
          await derniersMatchs(
            homeId
          );
      } catch (e) {}

      try {
        awayLast5 =
          await derniersMatchs(
            awayId
          );
      } catch (e) {}

      try {
        h2hMatches =
          await h2h(
            homeId,
            awayId
          );
      } catch (e) {}

      /*
       * Transformer statistiques API
       * en objet simple.
       */

      function transformerStats(
        teamStats
      ) {

        const out = {};

        for (
          const item of
          teamStats?.statistics || []
        ) {

          const key =
            String(
              item.type || ""
            )
              .toLowerCase()
              .replace(/\s+/g, "_");

          out[key] =
            item.value;

        }

        return out;
      }

      const homeStats =
        transformerStats(
          statistics[0]
        );

      const awayStats =
        transformerStats(
          statistics[1]
        );

      const scores =
        scoreReel(match);

      const homeForm =
        analyserForm(
          homeLast5,
          homeId
        );

      const awayForm =
        analyserForm(
          awayLast5,
          awayId
        );

      const h2hResult =
        analyserH2H(
          h2hMatches,
          homeId
        );

      res.json({

        success: true,

        fixture:
          fixture,

        match: {

          id:
            match.fixture.id,

          status:
            match.fixture.status?.short,

          status_long:
            match.fixture.status?.long,

          date:
            match.fixture.date,

          halftime_score:
            scores.halftime,

          final_score:
            scores.fulltime,

          home:
            match.teams?.home,

          away:
            match.teams?.away

        },

        statistics: {

          home:
            homeStats,

          away:
            awayStats

        },

        halftime_statistics:
          statistics,

        form: {

          home:
            homeForm,

          away:
            awayForm

        },

        h2h:
          h2hResult,

        last_5: {

          home:
            homeLast5,

          away:
            awayLast5

        },

        message:
          statistics.length
            ? "Statistiques disponibles."
            : "Les statistiques détaillées ne sont pas disponibles pour ce match."

      });

    } catch (error) {

      console.error(
        "Erreur statistiques:",
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
        await derniersMatchs(
          team
        );

      const form =
        analyserForm(
          data,
          Number(team)
        );

      res.json({

        success: true,

        team,

        form,

        matches:
          data

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

      const parts =
        String(teams).split("-");

      if (
        parts.length !== 2
      ) {

        return res.status(400).json({

          success: false,

          error:
            "teams doit être au format ID-ID"

        });

      }

      const data =
        await h2h(
          parts[0],
          parts[1]
        );

      res.json({

        success: true,

        teams,

        total:
          data.length,

        h2h:
          data

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
   RESULTAT D'UNE PREDICTION
================================================== */

function resultatPrediction(
  selection,
  fixture
) {

  if (
    !fixture ||
    !matchTermine(fixture)
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

  if (
    selection?.type === "1"
  ) {

    return (
      homeGoals > awayGoals
        ? "GAGNE"
        : "PERDU"
    );

  }

  if (
    selection?.type === "2"
  ) {

    return (
      awayGoals > homeGoals
        ? "GAGNE"
        : "PERDU"
    );

  }

  if (
    selection?.type === "N"
  ) {

    return (
      homeGoals === awayGoals
        ? "GAGNE"
        : "PERDU"
    );

  }

  return "EN_ATTENTE";
}


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
       * Maximum 20 derniers IDs.
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
        termines
          ? Math.round(
              gagne /
              termines *
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
            Number(
              h.fixture_id
            ) === fixtureId
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
          fixtureId +
          "&timezone=Africa/Abidjan"
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
   NETTOYER L'ANCIEN HISTORIQUE
   À UTILISER UNE SEULE FOIS SI NÉCESSAIRE
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
      "BOT PREDICTOR SERVER actif sur le port " +
      PORT
    );

  }
);
