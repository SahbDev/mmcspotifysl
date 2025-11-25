// server.js (VERSÃO FINAL CORRIGIDA - SEM LOOPING)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;
const app = express();

const userTokens = {}; 

function getSpotifyClient() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
  });
}

// --- LOGIN ---
app.get('/login', (req, res) => {
  const userID = req.query.user;
  // Passa o ID do usuário para recuperar depois
  const options = { state: userID || 'unknown', showDialog: true };
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  res.redirect(getSpotifyClient().createAuthorizeURL(scopes, options));
});

// --- CALLBACK (VISUAL CORRETO) ---
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const userID = state; 

  try {
    const spotifyApi = getSpotifyClient();
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    if (userID && userID !== 'unknown') {
        userTokens[userID] = {
          accessToken: data.body.access_token,
          refreshToken: data.body.refresh_token,
          expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
    }

    // HTML VISUAL (Sua versão aprovada)
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Raleway:wght@300;400;600&display=swap');
    @keyframes breathe { 0% { opacity: 0.9; } 50% { opacity: 1; } 100% { opacity: 0.9; } }
    body { margin: 0; background: radial-gradient(circle at center, #2b2b2b 0%, #000000 100%); color: white; font-family: 'Raleway', sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; padding-top: 5vh; min-height: 100vh; box-sizing: border-box; }
    h1 { font-family: 'Playfair Display', serif; font-size: 48px; margin-bottom: 10px; margin-top: 0; letter-spacing: 1px; animation: breathe 4s infinite; }
    h2 { font-family: 'Raleway', sans-serif; font-size: 14px; color: #cccccc; margin-bottom: 40px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; border-bottom: 1px solid #555; padding-bottom: 15px; width: 60%; }
    p { font-size: 18px; color: #cccccc; font-weight: 300; margin: 5px 0; }
    .highlight { color: #fff; font-weight: 600; }
    .menu-preview { margin-top: 35px; margin-bottom: 20px; max-width: 85%; width: 420px; border-radius: 8px; border: 1px solid #333; box-shadow: 0 20px 50px rgba(0,0,0,0.8); transition: transform 0.5s ease; }
    .menu-preview:hover { transform: translateY(-5px); }
    .instruction { font-size: 14px; color: #cccccc; margin-top: 10px; font-style: normal; font-weight: 400; }
    footer { margin-top: auto; width: 100%; text-align: center; font-size: 11px; color: #cccccc; letter-spacing: 1px; text-transform: uppercase; padding-top: 40px; opacity: 0.8; }
  </style>
</head>
<body>
  <h2>MMC - Spotify Player</h2>
  <h1>You are ready to press play <span style="font-size: 0.8em; color: #fff;">&lt;3</span></h1>
  <p>Your Spotify Player is now <span class="highlight">connected</span>.</p>
  <p style="font-size: 15px; color: #aaa;">You may close this tab safely.</p>
  <img src="https://i.gyazo.com/fad06bc27b3dd7752587726c4a83b4cf.png" class="menu-preview">
  <p class="instruction">Click on your player to change tracks, pause, customize colors and more.</p>
  <footer>MMC - Spotify Player Plug-in Created by Saori Suki</footer>
</body>
</html>`);
  } catch (err) {
    res.send(`<h1>Erro: ${err.message}</h1>`);
  }
});

// --- FUNÇÃO DE TOKEN ---
async function getUserClient(userID) {
  if (!userID || !userTokens[userID]) return null;
  const spotifyApi = getSpotifyClient();
  spotifyApi.setAccessToken(userTokens[userID].accessToken);
  spotifyApi.setRefreshToken(userTokens[userID].refreshToken);

  if (Date.now() > userTokens[userID].expiresAt - 60000) {
    try {
      const data = await spotifyApi.refreshAccessToken();
      userTokens[userID].accessToken = data.body.access_token;
      userTokens[userID].expiresAt = Date.now() + (data.body.expires_in * 1000);
      spotifyApi.setAccessToken(data.body.access_token);
    } catch (err) { return null; }
  }
  return spotifyApi;
}

// --- STATUS (CORREÇÃO AQUI) ---
app.get('/tocando', async (req, res) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);

  // Se não tem login, retorna status DISCONNECTED (importante para o LSL saber)
  if (!spotifyApi) return res.json({ status: "disconnected" });

  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    
    // Se estiver tocando algo
    if (data.body && data.body.is_playing) {
      res.json({
        status: "playing",
        musica: data.body.item.name,
        artista: data.body.item.artists.map(a => a.name).join(', '),
        progresso_ms: data.body.progress_ms,
        duracao_ms: data.body.item.duration_ms
      });
    } else if (data.body && data.body.item) {
      // Tem dados mas está pausado
      res.json({ 
        status: "paused",
        musica: data.body.item.name,
        artista: data.body.item.artists.map(a => a.name).join(', '),
        progresso_ms: data.body.progress_ms,
        duracao_ms: data.body.item.duration_ms
      });
    } else {
      // Não está tocando nada
      res.json({ status: "paused" });
    }
  } catch (err) {
    // Se der erro na API, assume desconectado
    res.json({ status: "disconnected" });
  }
});

// --- CONTROLES ---
const handleControl = async (req, res, action) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);
  if (!spotifyApi) return res.sendStatus(401);

  try {
    if (action === 'play') await spotifyApi.play();
    if (action === 'pause') await spotifyApi.pause();
    if (action === 'next') await spotifyApi.skipToNext();
    if (action === 'previous') await spotifyApi.skipToPrevious();
    res.status(200).send('OK');
  } catch (err) { res.status(500).send('Error'); }
};

app.post('/play', (req, res) => handleControl(req, res, 'play'));
app.post('/pause', (req, res) => handleControl(req, res, 'pause'));
app.post('/next', (req, res) => handleControl(req, res, 'next'));
app.post('/previous', (req, res) => handleControl(req, res, 'previous'));

app.post('/revoke', (req, res) => {
  const userID = req.query.user;
  if (userTokens[userID]) delete userTokens[userID];
  res.status(200).send('Revoked');
});

app.listen(port, () => { console.log(`Server running`); });
