// server.js (VERSÃO FINAL ESTÁVEL - PROTOCOLO DE STATUS)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;
const app = express();

// Banco de dados em memória
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
  if (!userID) return res.send('<h1 style="color:white;background:#222">Erro: Acesse pelo Second Life.</h1>');
  
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  const options = { state: userID, showDialog: true };
  
  res.redirect(getSpotifyClient().createAuthorizeURL(scopes, options));
});

// --- CALLBACK (COM VISUAL APROVADO) ---
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const userID = state; // O state devolve o ID do avatar

  if (!userID) return res.send('Erro: ID perdido.');

  try {
    const spotifyApi = getSpotifyClient();
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    userTokens[userID] = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + (data.body.expires_in * 1000)
    };

    // HTML VISUAL FINAL
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Raleway:wght@300;400;600&display=swap');
    @keyframes breathe { 0% { opacity: 0.9; } 50% { opacity: 1; } 100% { opacity: 0.9; } }
    body { margin: 0; background: radial-gradient(circle at center, #2b2b2b 0%, #000000 100%); color: white; font-family: 'Raleway', sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; padding-top: 5vh; min-height: 100vh; }
    h1 { font-family: 'Playfair Display', serif; font-size: 48px; animation: breathe 4s infinite; }
    h2 { font-family: 'Raleway', sans-serif; font-size: 14px; color: #cccccc; border-bottom: 1px solid #555; padding-bottom: 15px; width: 60%; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 40px; }
    p { font-size: 18px; color: #cccccc; margin: 5px 0; }
    .highlight { color: #fff; font-weight: 600; }
    .menu-preview { margin-top: 35px; margin-bottom: 20px; max-width: 85%; width: 420px; border-radius: 8px; border: 1px solid #333; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .instruction { font-size: 14px; color: #cccccc; margin-top: 10px; }
    footer { margin-top: auto; width: 100%; padding-top: 40px; padding-bottom: 20px; font-size: 11px; color: #cccccc; letter-spacing: 1px; text-transform: uppercase; opacity: 0.8; }
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

// --- STATUS (TOCANDO) ---
// Agora sempre retorna JSON, nunca erro 401/500
app.get('/tocando', async (req, res) => {
  const userID = req.query.user;
  
  // Se não tem usuário ou token, retorna status desconectado
  if (!userID || !userTokens[userID]) {
    return res.json({ status: "disconnected" }); 
  }

  const spotifyApi = getSpotifyClient();
  spotifyApi.setAccessToken(userTokens[userID].accessToken);
  spotifyApi.setRefreshToken(userTokens[userID].refreshToken);

  // Renovação de token
  if (Date.now() > userTokens[userID].expiresAt - 60000) {
    try {
      const data = await spotifyApi.refreshAccessToken();
      userTokens[userID].accessToken = data.body.access_token;
      userTokens[userID].expiresAt = Date.now() + (data.body.expires_in * 1000);
      spotifyApi.setAccessToken(data.body.access_token);
    } catch (err) {
      return res.json({ status: "disconnected" }); // Falha na renovação = desconectado
    }
  }

  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    if (data.body && data.body.is_playing) {
      res.json({
        status: "playing",
        musica: data.body.item.name,
        artista: data.body.item.artists.map(a => a.name).join(', '),
        progresso_ms: data.body.progress_ms,
        duracao_ms: data.body.item.duration_ms
      });
    } else {
      res.json({ status: "paused" });
    }
  } catch (err) {
    res.json({ status: "paused" });
  }
});

// --- CONTROLES ---
const handleControl = async (req, res, action) => {
  const userID = req.query.user;
  if (!userID || !userTokens[userID]) return res.sendStatus(401); // Aqui pode dar erro para o botão falhar se não tiver user

  const spotifyApi = getSpotifyClient();
  spotifyApi.setAccessToken(userTokens[userID].accessToken);
  
  try {
    if (action === 'play') await spotifyApi.play();
    if (action === 'pause') await spotifyApi.pause();
    if (action === 'next') await spotifyApi.skipToNext();
    if (action === 'previous') await spotifyApi.skipToPrevious();
    res.send('OK');
  } catch (err) { res.send('Error'); }
};

app.post('/play', (req, res) => handleControl(req, res, 'play'));
app.post('/pause', (req, res) => handleControl(req, res, 'pause'));
app.post('/next', (req, res) => handleControl(req, res, 'next'));
app.post('/previous', (req, res) => handleControl(req, res, 'previous'));

app.post('/revoke', (req, res) => {
  const userID = req.query.user;
  if (userTokens[userID]) delete userTokens[userID];
  res.send('Revoked');
});

app.listen(port, () => { console.log('Server Running'); });
