// server.js (VERSÃO MULTI-USUÁRIO FINAL - SEM LOGS EXTRAS)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;

// Mapa para armazenar sessões por owner UUID
let userSessions = new Map();

const app = express();

app.get('/login', (req, res) => {
  const { owner } = req.query;
  if (!owner) {
    return res.status(400).send('Erro: Owner UUID necessário. Tente novamente do Second Life.');
  }
  
  try {
    // Inicializa sessão temporária para o owner
    userSessions.set(owner, { state: owner });
    
    const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
    const options = { state: owner, showDialog: true };
    res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
  } catch (err) {
    res.status(500).send('Erro interno no login');
  }
});

app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const owner = state;
  
  if (!userSessions.has(owner)) {
    return res.status(400).send('Sessão inválida. Faça login novamente do Second Life.');
  }
  
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    
    // Armazena tokens para este owner
    userSessions.set(owner, { access_token, refresh_token });
    
    const successHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Spotify Connection Success</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Raleway:wght@300;400;600&display=swap');
    @keyframes breathe {
      0% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.02); opacity: 1; }
      100% { transform: scale(1); opacity: 0.9; }
    }
    body {
      margin: 0;
      background: radial-gradient(circle at center, #2b2b2b 0%, #000000 100%);
      color: white;
      font-family: 'Raleway', sans-serif;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 5vh;
      padding-bottom: 5vh;
      min-height: 100vh;
      box-sizing: border-box;
    }
    h1 { font-family: 'Playfair Display', serif; color: white; font-size: 48px; margin-bottom: 10px; margin-top: 0; letter-spacing: 1px; animation: breathe 4s infinite ease-in-out; }
    h2 { font-family: 'Raleway', sans-serif; font-size: 14px; color: #cccccc; margin-bottom: 40px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; border-bottom: 1px solid #555; padding-bottom: 15px; width: 60%; }
    p { font-size: 18px; color: #cccccc; font-weight: 300; line-height: 1.6; margin: 5px 0; }
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
  <img src="https://i.gyazo.com/fad06bc27b3dd7752587726c4a83b4cf.png" alt="Player Controls" class="menu-preview">
  <p class="instruction">Click on your player to change tracks, pause, customize colors and more.</p>
  <footer>MMC - Spotify Player Plug-in Created by Saori Suki</footer>
</body>
</html>
    `;
    res.send(successHtml);
  } catch (err) {
    userSessions.delete(owner);
    res.status(500).send(`Erro ao conectar: ${err.message}`);
  }
});

app.get('/tocando', async (req, res) => {
  const { owner } = req.query;
  if (!owner || !userSessions.has(owner)) {
    return res.json({ tocando: false });
  }
  
  const userData = userSessions.get(owner);
  const userApi = new SpotifyWebApi({
    accessToken: userData.access_token,
    refreshToken: userData.refresh_token
  });
  
  try {
    const data = await userApi.getMyCurrentPlaybackState();
    if (data.body && data.body.is_playing) {
      const { item, progress_ms } = data.body;
      const response = {
        tocando: true,
        musica: item.name,
        artista: item.artists.map(artist => artist.name).join(', '),
        progresso_ms: progress_ms,
        duracao_ms: item.duration_ms
      };
      res.json(response);
    } else {
      res.json({ tocando: false });
    }
  } catch (err) {
    if (err.statusCode === 401) {
      try {
        const data = await userApi.refreshAccessToken();
        userData.access_token = data.body.access_token;
        userSessions.set(owner, userData);
        return res.redirect(`/tocando?owner=${owner}`);
      } catch (refreshErr) {
        userSessions.delete(owner);
        res.json({ tocando: false });
      }
    } else {
      res.json({ tocando: false });
    }
  }
});

// ROTAS DE CONTROLE
const handleCommand = async (req, res, command) => {
  const { owner } = req.query;
  if (!owner || !userSessions.has(owner)) {
    return res.status(200).send('OK');
  }
  
  const userData = userSessions.get(owner);
  const userApi = new SpotifyWebApi({
    accessToken: userData.access_token,
    refreshToken: userData.refresh_token
  });
  
  try {
    if (command === 'play') await userApi.play();
    else if (command === 'pause') await userApi.pause();
    else if (command === 'next') await userApi.skipToNext();
    else if (command === 'previous') await userApi.skipToPrevious();
    res.status(200).send('OK');
  } catch (err) {
    res.status(200).send('OK');
  }
};

app.post('/play', (req, res) => handleCommand(req, res, 'play'));
app.post('/pause', (req, res) => handleCommand(req, res, 'pause'));
app.post('/next', (req, res) => handleCommand(req, res, 'next'));
app.post('/previous', (req, res) => handleCommand(req, res, 'previous'));

app.post('/revoke', (req, res) => {
  const { owner } = req.query;
  if (owner) userSessions.delete(owner);
  res.status(200).send('Revoked');
});

app.listen(port, () => { console.log(`Server running on port ${port}`); });
