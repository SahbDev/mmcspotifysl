// server.js (VERSÃO MULTI-USUÁRIO CORRIGIDA)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;

// Mapa para armazenar sessões por owner UUID (chave: owner_uuid, valor: { access_token, refresh_token })
let userSessions = new Map();

const app = express();

// Middleware para logs
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get('/login', (req, res) => {
  const { owner } = req.query;
  if (!owner) {
    return res.status(400).send('Erro: Owner UUID necessário. Tente novamente do Second Life.');
  }
  
  try {
    // Inicializa sessão temporária para o owner
    userSessions.set(owner, { state: owner }); // Usamos owner como state para simplicidade
    
    const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
    const options = { state: owner, showDialog: true };
    res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
  } catch (err) {
    console.error('Erro no /login:', err);
    res.status(500).send('Erro interno no login');
  }
});

app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const owner = state; // State é o owner UUID
  
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
    /* ... (mesmo estilo do original) ... */
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
    console.error('Erro no /callback:', err);
    // Remove sessão inválida
    userSessions.delete(owner);
    res.status(500).send(`Erro ao conectar: ${err.message}. Verifique se sua conta está autorizada no app do Spotify Developer.`);
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
    console.error('Erro no /tocando para owner', owner, ':', err);
    if (err.statusCode === 401) {
      try {
        const data = await userApi.refreshAccessToken();
        userData.access_token = data.body.access_token;
        userSessions.set(owner, userData);
        return res.redirect(`/tocando?owner=${owner}`);
      } catch (refreshErr) {
        console.error('Erro ao refresh token para owner', owner, ':', refreshErr);
        userSessions.delete(owner); // Remove sessão inválida
        res.json({ tocando: false });
      }
    } else {
      res.json({ tocando: false });
    }
  }
});

// ROTAS DE CONTROLE (ISOLADAS POR OWNER)
const handleCommand = async (req, res, command) => {
  const { owner } = req.query;
  if (!owner || !userSessions.has(owner)) {
    return res.status(200).send('OK'); // Sempre OK para não travar SL
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
    console.error(`Erro no /${command} para owner`, owner, ':', err);
    res.status(200).send('OK'); // Sempre OK
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
