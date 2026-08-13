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
   API-FOOTBALL
================================================== */

const API_KEY = process.env.API_FOOTBALL_KEY;
const API = "https://v3.football.api-sports.io";

async function footballApi(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY manquante dans Render.");
  }

  const response = await fetch(API + endpoint, {
    method: "GET",
    headers: {
      "x-apisports-key": API_KEY,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("API-Football HTTP " + response.status);
  }

  const data = await response.json();

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
   HISTORIQUE
================================================== */

const HISTORY_FILE = path.join(__dirname, "history.json");

let history = [];

function chargerHistorique() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      );

      const parsed = JSON.parse(content);

      history = Array.isArray(parsed)
        ? parsed
        : [];
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
      JSON.stringify(history, null, 2)
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
  } catch {
    return "";
  }
}

/* ==================================================
   OUTILS
================================================== */

function nombre(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function moyenne(tab) {
  if (!tab.length) return 0;

  return (
    tab.reduce(
      (a, b) => a + b,
      0
    ) / tab.length
  );
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function arrondi(value, decimals = 0) {
  const p = Math.pow(
    10,
    decimals
  );

  return (
    Math.round(value * p) / p
  );
}

function pct(value) {
  return clamp(
    nombre(value),
    0,
    100
  );
}

/* ==================================================
   MATCH TERMINE
================================================== */

function matchTermine(match) {
  const status =
    match?.fixture?.status?.short;

  return [
    "FT",
    "AET",
    "PEN"
  ].includes(status);
}

/* ==================================================
   MATCH A VENIR
================================================== */

function matchAVenir(match) {
  const status =
    match?.fixture?.status?.short;

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
    match?.fixture?.date &&
    new Date(match.fixture.date) >
      new Date()
  );
}

/* ==================================================
   EXTRAIRE FORMATION EQUIPE
================================================== */

function analyserEquipe(
  fixtures,
  teamId
) {
  const matches =
    fixtures.filter(
      match =>
        matchTermine(match) &&
        (
          match.teams?.home?.id ===
            Number(teamId) ||
          match.teams?.away?.id ===
            Number(teamId)
        )
    );

  const recent =
    matches.slice(0, 5);

  const result = {
    matches: recent.length,

    wins: 0,
    draws: 0,
    losses: 0,

    goalsFor: [],
    goalsAgainst: [],

    firstHalfFor: [],
    firstHalfAgainst: [],

    cleanSheets: 0,

    btts: 0,

    over15: 0,
    over25: 0,

    homeMatches: 0,
    awayMatches: 0,

    homeGoalsFor: [],
    homeGoalsAgainst: [],

    awayGoalsFor: [],
    awayGoalsAgainst: []
  };

  recent.forEach(match => {
    const home =
      match.teams?.home?.id ===
      Number(teamId);

    const gf = home
      ? match.goals?.home
      : match.goals?.away;

    const ga = home
      ? match.goals?.away
      : match.goals?.home;

    if (
      gf === null ||
      gf === undefined ||
      ga === null ||
      ga === undefined
    ) {
      return;
    }

    result.goalsFor.push(
      Number(gf)
    );

    result.goalsAgainst.push(
      Number(ga)
    );

    if (gf > ga) {
      result.wins++;
    } else if (gf === ga) {
      result.draws++;
    } else {
      result.losses++;
    }

    if (ga === 0) {
      result.cleanSheets++;
    }

    if (
      Number(gf) > 0 &&
      Number(ga) > 0
    ) {
      result.btts++;
    }

    if (
      Number(gf) +
      Number(ga) >= 2
    ) {
      result.over15++;
    }

    if (
      Number(gf) +
      Number(ga) >= 3
    ) {
      result.over25++;
    }

    if (home) {
      result.homeMatches++;

      result.homeGoalsFor.push(
        Number(gf)
      );

      result.homeGoalsAgainst.push(
        Number(ga)
      );
    } else {
      result.awayMatches++;

      result.awayGoalsFor.push(
        Number(gf)
      );

      result.awayGoalsAgainst.push(
        Number(ga)
      );
    }

    const ht =
      match.score?.halftime;

    if (
      ht &&
      ht.home !== null &&
      ht.home !== undefined &&
      ht.away !== null &&
      ht.away !== undefined
    ) {
      const hgf = home
        ? ht.home
        : ht.away;

      const hga = home
        ? ht.away
        : ht.home;

      result.firstHalfFor.push(
        Number(hgf)
      );

      result.firstHalfAgainst.push(
        Number(hga)
      );
    }
  });

  return result;
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
      .filter(match =>
        matchTermine(match) &&
        (
          (
            match.teams?.home?.id ===
              Number(homeId) &&
            match.teams?.away?.id ===
              Number(awayId)
          ) ||
          (
            match.teams?.home?.id ===
              Number(awayId) &&
            match.teams?.away?.id ===
              Number(homeId)
          )
        )
      )
      .slice(0, 5);

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  let homeGoals = [];
  let awayGoals = [];

  matches.forEach(match => {
    const hg =
      nombre(match.goals?.home);

    const ag =
      nombre(match.goals?.away);

    const homeIsOurHome =
      match.teams?.home?.id ===
      Number(homeId);

    const ourHomeGoals =
      homeIsOurHome
        ? hg
        : ag;

    const ourAwayGoals =
      homeIsOurHome
        ? ag
        : hg;

    homeGoals.push(
      ourHomeGoals
    );

    awayGoals.push(
      ourAwayGoals
    );

    if (
      ourHomeGoals >
      ourAwayGoals
    ) {
      homeWins++;
    } else if (
      ourHomeGoals ===
      ourAwayGoals
    ) {
      draws++;
    } else {
      awayWins++;
    }
  });

  return {
    matches: matches.length,
    homeWins,
    draws,
    awayWins,
    avgHomeGoals:
      moyenne(homeGoals),
    avgAwayGoals:
      moyenne(awayGoals)
  };
}

/* ==================================================
   POISSON
================================================== */

function poisson(lambda, k) {
  if (lambda <= 0) {
    return k === 0 ? 1 : 0;
  }

  let factorial = 1;

  for (
    let i = 2;
    i <= k;
    i++
  ) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial
  );
}

/* ==================================================
   PROBABILITES SCORE
================================================== */

function calculerProbabilites(
  homeGoals,
  awayGoals
) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestScore = "1-1";
  let bestProbability = 0;

  for (
    let h = 0;
    h <= 6;
    h++
  ) {
    for (
      let a = 0;
      a <= 6;
      a++
    ) {
      const probability =
        poisson(
          homeGoals,
          h
        ) *
        poisson(
          awayGoals,
          a
        );

      if (h > a) {
        homeWin += probability;
      } else if (h === a) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        bestScore =
          h + "-" + a;
      }
    }
  }

  const total =
    homeWin +
    draw +
    awayWin;

  if (total <= 0) {
    return {
      home: 0,
      draw: 0,
      away: 0,
      score: "Non disponible"
    };
  }

  return {
    home:
      homeWin / total * 100,

    draw:
      draw / total * 100,

    away:
      awayWin / total * 100,

    score:
      bestScore
  };
}

/* ==================================================
   ANALYSE COMPLETE
================================================== */

function analyserMatch(
  match,
  homeStats,
  awayStats,
  h2h,
  apiPrediction
) {
  const homeAvailable =
    homeStats.matches;

  const awayAvailable =
    awayStats.matches;

  /*
   * Minimum de données.
   */

  if (
    homeAvailable < 3 ||
    awayAvailable < 3
  ) {
    return null;
  }

  /*
   * Attaque domicile :
   * forme générale + performances
   * à domicile.
   */

  const homeAttackGeneral =
    moyenne(
      homeStats.goalsFor
    );

  const homeDefenseGeneral =
    moyenne(
      homeStats.goalsAgainst
    );

  const homeAttackSpecific =
    homeStats.homeGoalsFor.length
      ? moyenne(
          homeStats.homeGoalsFor
        )
      : homeAttackGeneral;

  const homeDefenseSpecific =
    homeStats.homeGoalsAgainst.length
      ? moyenne(
          homeStats.homeGoalsAgainst
        )
      : homeDefenseGeneral;

  /*
   * Attaque extérieur.
   */

  const awayAttackGeneral =
    moyenne(
      awayStats.goalsFor
    );

  const awayDefenseGeneral =
    moyenne(
      awayStats.goalsAgainst
    );

  const awayAttackSpecific =
    awayStats.awayGoalsFor.length
      ? moyenne(
          awayStats.awayGoalsFor
        )
      : awayAttackGeneral;

  const awayDefenseSpecific =
    awayStats.awayGoalsAgainst.length
      ? moyenne(
          awayStats.awayGoalsAgainst
        )
      : awayDefenseGeneral;

  /*
   * Buts attendus.
   */

  let expectedHome =
    (
      homeAttackSpecific +
      awayDefenseSpecific
    ) / 2;

  let expectedAway =
    (
      awayAttackSpecific +
      homeDefenseSpecific
    ) / 2;

  /*
   * H2H léger.
   */

  if (h2h.matches >= 2) {
    expectedHome =
      expectedHome * 0.8 +
      h2h.avgHomeGoals * 0.2;

    expectedAway =
      expectedAway * 0.8 +
      h2h.avgAwayGoals * 0.2;
  }

  expectedHome =
    clamp(
      expectedHome,
      0.15,
      4
    );

  expectedAway =
    clamp(
      expectedAway,
      0.15,
      4
    );

  /*
   * Probabilités calculées.
   */

  const model =
    calculerProbabilites(
      expectedHome,
      expectedAway
    );

  /*
   * Probabilités API-Football.
   */

  const api =
    apiPrediction?.predictions
      ?.percent || {};

  const apiHome =
    pct(
      String(api.home || "")
        .replace("%", "")
    );

  const apiDraw =
    pct(
      String(api.draw || "")
        .replace("%", "")
    );

  const apiAway =
    pct(
      String(api.away || "")
        .replace("%", "")
    );

  const apiDisponible =
    (
      apiHome +
      apiDraw +
      apiAway
    ) > 0;

  /*
   * Consensus :
   * 65% modèle + 35% API.
   */

  let finalHome =
    model.home;

  let finalDraw =
    model.draw;

  let finalAway =
    model.away;

  if (apiDisponible) {
    finalHome =
      model.home * 0.65 +
      apiHome * 0.35;

    finalDraw =
      model.draw * 0.65 +
      apiDraw * 0.35;

    finalAway =
      model.away * 0.65 +
      apiAway * 0.35;
  }

  /*
   * Normalisation.
   */

  const total =
    finalHome +
    finalDraw +
    finalAway;

  finalHome =
    finalHome / total * 100;

  finalDraw =
    finalDraw / total * 100;

  finalAway =
    finalAway / total * 100;

  /*
   * Sélection.
   */

  let type = "N";
  let confidence = finalDraw;
  let pick = "Match nul";

  if (
    finalHome >= finalDraw &&
    finalHome >= finalAway
  ) {
    type = "1";
    confidence = finalHome;

    pick =
      "Victoire " +
      (
        match.teams?.home?.name ||
        "équipe à domicile"
      );
  } else if (
    finalAway >= finalHome &&
    finalAway >= finalDraw
  ) {
    type = "2";
    confidence = finalAway;

    pick =
      "Victoire " +
      (
        match.teams?.away?.name ||
        "équipe extérieure"
      );
  }

  /*
   * Score probable.
   */

  const score =
    model.score;

  const scoreParts =
    score.split("-");

  const predictedHome =
    Number(scoreParts[0]);

  const predictedAway =
    Number(scoreParts[1]);

  /*
   * Mi-temps calculée à partir
   * des données disponibles.
   */

  let halfHome =
    moyenne(
      homeStats.firstHalfFor
    );

  let halfAway =
    moyenne(
      awayStats.firstHalfFor
    );

  let halfHomeAgainst =
    moyenne(
      homeStats.firstHalfAgainst
    );

  let halfAwayAgainst =
    moyenne(
      awayStats.firstHalfAgainst
    );

  if (
    !homeStats.firstHalfFor.length ||
    !awayStats.firstHalfFor.length
  ) {
    halfHome =
      expectedHome * 0.45;

    halfAway =
      expectedAway * 0.45;

    halfHomeAgainst =
      expectedHome * 0.45;

    halfAwayAgainst =
      expectedAway * 0.45;
  }

  const expectedHalfHome =
    clamp(
      (
        halfHome +
        halfAwayAgainst
      ) / 2,
      0,
      3
    );

  const expectedHalfAway =
    clamp(
      (
        halfAway +
        halfHomeAgainst
      ) / 2,
      0,
      3
    );

  const halfScore =
    Math.round(
      expectedHalfHome
    ) +
    "-" +
    Math.round(
      expectedHalfAway
    );

  /*
   * BTTS.
   */

  const bttsRate =
    (
      (
        homeStats.btts /
        Math.max(
          1,
          homeStats.matches
        )
      ) +
      (
        awayStats.btts /
        Math.max(
          1,
          awayStats.matches
        )
      )
    ) / 2 * 100;

  /*
   * Over 2.5.
   */

  const over25Rate =
    (
      (
        homeStats.over25 /
        Math.max(
          1,
          homeStats.matches
        )
      ) +
      (
        awayStats.over25 /
        Math.max(
          1,
          awayStats.matches
        )
      )
    ) / 2 * 100;

  /*
   * Qualité des données.
   */

  let dataQuality = 0;

  dataQuality +=
    Math.min(
      homeStats.matches,
      5
    ) * 7;

  dataQuality +=
    Math.min(
      awayStats.matches,
      5
    ) * 7;

  if (h2h.matches >= 2) {
    dataQuality += 10;
  }

  if (apiDisponible) {
    dataQuality += 10;
  }

  dataQuality =
    clamp(
      dataQuality,
      0,
      100
    );

  /*
   * Confiance corrigée par la qualité
   * des données.
   */

  const confidence =
    confidence *
    (
      0.70 +
      dataQuality / 100 * 0.30
    );

  /*
   * Analyse textuelle.
   */

  let analyse =
    "Analyse basée sur la forme récente des deux équipes";

  if (h2h.matches >= 2) {
    analyse +=
      ", les confrontations directes disponibles";
  }

  if (apiDisponible) {
    analyse +=
      " et les probabilités API-Football";
  }

  analyse += ".";

  analyse +=
    " Forme domicile : " +
    homeStats.wins +
    " victoire(s), " +
    homeStats.draws +
    " nul(s), " +
    homeStats.losses +
    " défaite(s).";

  analyse +=
    " Forme extérieur : " +
    awayStats.wins +
    " victoire(s), " +
    awayStats.draws +
    " nul(s), " +
    awayStats.losses +
    " défaite(s).";

  analyse +=
    " Buts attendus : " +
    expectedHome.toFixed(2) +
    " - " +
    expectedAway.toFixed(2) +
    ".";

  analyse +=
    " Le modèle retient " +
    pick +
    " avec " +
    confidence.toFixed(0) +
    "% de confiance.";

  return {
    selection: {
      type,
      text: pick,
      confidence
    },

    probabilities: {
      home: finalHome,
      draw: finalDraw,
      away: finalAway
    },

    scores: {
      halftime: halfScore,
      final: score
    },

    markets: {
      btts:
        bttsRate >= 50
          ? "Oui"
          : "Non",

      btts_probability:
        bttsRate,

      over_under:
        over25Rate >= 50
          ? "Over 2.5"
          : "Under 2.5",

      over25_probability:
        over25Rate
    },

    expected_goals: {
      home: expectedHome,
      away: expectedAway
    },

    data_quality:
      dataQuality,

    analysis: analyse
  };
}

/* ==================================================
   API PREDICTION
================================================== */

async function getApiPrediction(
  fixtureId
) {
  try {
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
  } catch {
    return null;
  }
}

/* ==================================================
   DERNIERS MATCHS EQUIPE
================================================== */

async function getTeamHistory(
  teamId
) {
  try {
    const data =
      await footballApi(
        "/fixtures?team=" +
        encodeURIComponent(
          teamId
        ) +
        "&last=5"
      );

    return data.response || [];
  } catch {
    return [];
  }
}

/* ==================================================
   H2H
================================================== */

async function getH2H(
  homeId,
  awayId
) {
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
  } catch {
    return [];
  }
}

/* ==================================================
   RACINE
================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif",
    timezone: "Africa/Abidjan"
  });
});

/* ==================================================
   HEALTH
================================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "BOT PREDICTOR",
    api_configured:
      Boolean(API_KEY),
    history_records:
      history.length,
    timezone:
      "Africa/Abidjan"
  });
});

/* ==================================================
   MATCHS
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
        error: error.message
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

      const fixtureData =
        await footballApi(
          "/fixtures?date=" +
          encodeURIComponent(date) +
          "&timezone=Africa/Abidjan"
        );

      let fixtures =
        fixtureData.response || [];

      fixtures =
        fixtures.filter(
          matchAVenir
        );

      fixtures.sort(
        (a, b) =>
          new Date(
            a.fixture.date
          ) -
          new Date(
            b.fixture.date
          )
      );

      /*
       * On limite à 6 candidats
       * pour éviter de consommer
       * inutilement les requêtes API.
       */

      const candidats =
        fixtures.slice(0, 6);

      const analyses = [];

      for (
        const match of candidats
      ) {
        const homeId =
          match.teams?.home?.id;

        const awayId =
          match.teams?.away?.id;

        if (
          !homeId ||
          !awayId
        ) {
          continue;
        }

        /*
         * Récupération des données
         * historiques.
         */

        const [
          homeFixtures,
          awayFixtures,
          h2h,
          apiPrediction
        ] = await Promise.all([
          getTeamHistory(
            homeId
          ),
          getTeamHistory(
            awayId
          ),
          getH2H(
            homeId,
            awayId
          ),
          getApiPrediction(
            match.fixture.id
          )
        ]);

        const homeStats =
          analyserEquipe(
            homeFixtures,
            homeId
          );

        const awayStats =
          analyserEquipe(
            awayFixtures,
            awayId
          );

        const h2hStats =
          analyserH2H(
            h2h,
            homeId,
            awayId
          );

        const analysis =
          analyserMatch(
            match,
            homeStats,
            awayStats,
            h2hStats,
            apiPrediction
          );

        if (!analysis) {
          continue;
        }

        /*
         * On refuse les analyses
         * trop faibles.
         */

        if (
          analysis.data_quality < 60 ||
          analysis.selection.confidence < 45
        ) {
          continue;
        }

        analyses.push({
          match,
          analysis,
          apiPrediction
        });
      }

      /*
       * Meilleure qualité d'abord.
       */

      analyses.sort(
        (a, b) =>
          (
            b.analysis.selection.confidence +
            b.analysis.data_quality * 0.25
          ) -
          (
            a.analysis.selection.confidence +
            a.analysis.data_quality * 0.25
          )
      );

      /*
       * Deux meilleurs matchs.
       */

      const selected =
        analyses.slice(0, 2);

      const result = [];

      for (
        const item of selected
      ) {
        const m =
          item.match;

        const a =
          item.analysis;

        const home =
          m.teams?.home || {};

        const away =
          m.teams?.away || {};

        /*
         * Historique.
         */

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
            id: home.id,
            name: home.name || "",
            logo: home.logo || ""
          },

          away: {
            id: away.id,
            name: away.name || "",
            logo: away.logo || ""
          },

          selection:
            a.selection,

          predicted_score:
            a.scores.final,

          predicted_half_time:
            a.scores.halftime,

          probabilities:
            {
              home:
                arrondi(
                  a.probabilities.home
                ),

              draw:
                arrondi(
                  a.probabilities.draw
                ),

              away:
                arrondi(
                  a.probabilities.away
                )
            },

          markets:
            a.markets,

          data_quality:
            a.data_quality,

          status:
            "EN_ATTENTE",

          halftime_score:
            null,

          final_score:
            null,

          result:
            "EN_ATTENTE"
        };

        /*
         * Ne pas créer plusieurs fois
         * la même prédiction.
         */

        const existing =
          history.find(
            h =>
              h.fixture_id ===
              historyItem.fixture_id
          );

        if (!existing) {
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

            home: {
              id: home.id,
              name:
                home.name || "",
              logo:
                home.logo || ""
            },

            away: {
              id: away.id,
              name:
                away.name || "",
              logo:
                away.logo || ""
            }
          },

          prediction: {
            main_pick:
              a.selection.text,

            type:
              a.selection.type,

            home:
              arrondi(
                a.probabilities.home
              ) + "%",

            draw:
              arrondi(
                a.probabilities.draw
              ) + "%",

            away:
              arrondi(
                a.probabilities.away
              ) + "%",

            goals:
              a.scores.final,

            half_time_score:
              a.scores.halftime,

            full_time_score:
              a.scores.final,

            btts:
              a.markets.btts,

            btts_probability:
              arrondi(
                a.markets
                  .btts_probability
              ) + "%",

            over_under:
              a.markets.over_under,

            over25_probability:
              arrondi(
                a.markets
                  .over25_probability
              ) + "%"
          },

          consensus: {
            confidence:
              arrondi(
                a.selection.confidence
              ) + "%",

            score:
              a.scores.final
          },

          sources: {
            api_football:
              Boolean(
                item.apiPrediction
              ),

            recent_team_matches:
              true,

            h2h:
              true
          },

          analysis:
            a.analysis
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
            : "Aucun match ne possède actuellement suffisamment de données fiables."
      });

    } catch (error) {
      console.error(
        "Erreur predictions:",
        error
      );

      res.status(500).json({
        success: false,
        error: error.message
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
          encodeURIComponent(
            fixture
          )
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
        error: error.message
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
       * Aucun ancien résultat :
       * on renvoie simplement
       * l'historique actuel.
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
       * Récupérer les derniers
       * matchs enregistrés.
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
       * Mise à jour des résultats.
       */

      history =
        history.map(item => {
          const fixture =
            fixtureMap.get(
              item.fixture_id
            );

          if (!fixture) {
            return item;
          }

          const status =
            fixture.fixture.status?.short;

          if (
            status === "HT" ||
            status === "1H" ||
            status === "2H" ||
            status === "LIVE"
          ) {
            return {
              ...item,
              status
            };
          }

          if (
            matchTermine(fixture)
          ) {
            const halftime =
              fixture.score?.halftime;

            const fulltime =
              fixture.score?.fulltime;

            const homeGoals =
              fixture.goals?.home;

            const awayGoals =
              fixture.goals?.away;

            let result =
              "EN_ATTENTE";

            if (
              item.selection?.type ===
              "1"
            ) {
              result =
                homeGoals >
                awayGoals
                  ? "GAGNE"
                  : "PERDU";
            } else if (
              item.selection?.type ===
              "2"
            ) {
              result =
                awayGoals >
                homeGoals
                  ? "GAGNE"
                  : "PERDU";
            } else if (
              item.selection?.type ===
              "N"
            ) {
              result =
                homeGoals ===
                awayGoals
                  ? "GAGNE"
                  : "PERDU";
            }

            return {
              ...item,

              status,

              halftime_score:
                halftime &&
                halftime.home !==
                  null &&
                halftime.away !==
                  null
                  ? halftime.home +
                    "-" +
                    halftime.away
                  : null,

              final_score:
                fulltime &&
                fulltime.home !==
                  null &&
                fulltime.away !==
                  null
                  ? fulltime.home +
                    "-" +
                    fulltime.away
                  : null,

              result
            };
          }

          return {
            ...item,
            status
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
        error: error.message
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
        const status =
          fixture.fixture.status?.short;

        item.status =
          status || "NS";

        if (
          matchTermine(
            fixture
          )
        ) {
          const ht =
            fixture.score?.halftime;

          const ft =
            fixture.score?.fulltime;

          item.halftime_score =
            ht &&
            ht.home !== null &&
            ht.away !== null
              ? ht.home +
                "-" +
                ht.away
              : null;

          item.final_score =
            ft &&
            ft.home !== null &&
            ft.away !== null
              ? ft.home +
                "-" +
                ft.away
              : null;

          const hg =
            fixture.goals?.home;

          const ag =
            fixture.goals?.away;

          if (
            item.selection?.type ===
            "1"
          ) {
            item.result =
              hg > ag
                ? "GAGNE"
                : "PERDU";
          } else if (
            item.selection?.type ===
            "2"
          ) {
            item.result =
              ag > hg
                ? "GAGNE"
                : "PERDU";
          } else if (
            item.selection?.type ===
            "N"
          ) {
            item.result =
              hg === ag
                ? "GAGNE"
                : "PERDU";
          }
        }

        sauvegarderHistorique();
      }

      res.json({
        success: true,
        match: item
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
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
      success: true,
      message:
        "Historique supprimé."
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
