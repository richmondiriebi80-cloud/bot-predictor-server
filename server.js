const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Autorise les requêtes cross-origin depuis votre front-end
app.use(cors());

// URL officielle de l'API 1xBet pour les matchs virtuels FIFA
const XBET_API_URL = "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=120&lng=fr&mode=4&virtualSports=true";

// Helper pour extraire les cotes principales (1, X, 2)
function parseMainOdds(events = []) {
  const odds = { v1: null, draw: null, v2: null };
  events.forEach(event => {
    if (event.T === 1) odds.v1 = event.C;   // Victoire Domicile
    if (event.T === 2) odds.draw = event.C; // Match Nul
    if (event.T === 3) odds.v2 = event.C;   // Victoire Extérieur
  });
  return odds;
}

// Route API pour votre front-end
app.get('/api/matches-fifa', async (req, res) => {
  try {
    const response = await axios.get(XBET_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://1xbet.com/'
      },
      timeout: 8000
    });

    const rawMatches = response.data?.Value || [];

    // Formatage propre pour le front-end
    const formattedMatches = rawMatches.map(match => ({
      id: match.I,
      league: match.L,
      homeTeam: match.O1,
      awayTeam: match.O2,
      score: match.SC?.FS || "0-0",
      period: match.SC?.CPS || "En cours",
      timeRemaining: match.SC?.TS || null,
      odds: parseMainOdds(match.E)
    }));

    res.status(200).json({
      success: true,
      count: formattedMatches.length,
      data: formattedMatches
    });

  } catch (error) {
    console.error("Erreur lors de la récupération des matchs FIFA :", error.message);
    res.status(500).json({
      success: false,
      error: "Impossible de récupérer les matchs en direct."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
