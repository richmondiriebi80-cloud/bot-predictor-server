const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const API_FOOTBALL = "https://v3.football.api-sports.io";

async function footballApi(path) {
  const response = await fetch(API_FOOTBALL + path, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("API-Football HTTP " + response.status);
  }

  const data = await response.json();

  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(Object.values(data.errors).join(" "));
  }

  return data;
}

function today() {
  const d = new Date();

  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "BOT PREDICTOR",
    message: "Serveur actif"
  });
});

app.get("/matches", async (req, res) => {
  try {
    const date = req.query.date || today();

    const data = await footballApi(
      "/fixtures?date=" + encodeURIComponent(date)
    );

    res.json({
      success: true,
      date,
      matches: data.response || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/prediction/:fixture", async (req, res) => {
  try {
    const fixture = req.params.fixture;

    const data = await footballApi(
      "/predictions?fixture=" + encodeURIComponent(fixture)
    );

    res.json({
      success: true,
      prediction: data.response?.[0] || null
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("BOT PREDICTOR SERVER démarré sur le port " + PORT);
});
