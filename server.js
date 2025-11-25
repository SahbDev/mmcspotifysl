// server.js (VERSÃO FINAL: VISUAL LUXO + MULTI-USUÁRIO CORRIGIDO)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;
const app = express();

// --- BANCO DE DADOS DE USUÁRIOS (MEMÓRIA) ---
const userTokens = {}; 

// Função para criar clientes novos
function getSpotifyClient() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
  });
}

// ==================================================================
// ROTA DE LOGIN (Recebe o ID do usuário do SL)
// ==================================================================
app.get('/login', (req, res) => {
  const userID = req.query.user; // Pega o ID do avatar
  
  // Se não tiver ID, avisa
  if (!userID) return res.send('<h1 style="color:white; background:#222; padding:20px;">Erro: Use o HUD no Second Life para conectar.</h1>');

  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  const spotifyApi = getSpotifyClient();
  
  // Passa o ID do usuário no 'state' para recuperar depois
  const options = { state: userID, showDialog: true };
  
  res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
});

// ==================================================================
// ROTA DE CALLBACK (Salva o token e Mostra o Visual Bonito)
// ==================================================================
app.get('/callback', async (req, res) => {
  const { code, state } = req.query; 
  const userID = state; // Recupera o ID do avatar

  if (!userID) return res.send('Erro: Identificação de usuário perdida.');

  try {
    const spotifyApi = getSpotifyClient();
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    // SALVA OS TOKENS DESTE USUÁRIO ESPECÍFICO
    userTokens[userID] = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + (data.body.expires_in * 1000)
    };

    // --- SEU HTML BONITO AQUI ---
    const successHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Spotify Connection Success</title>
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
</html>
    `;
    res.send(successHtml);
  } catch (err) {
    res.send(`<h1>Erro ao conectar: ${err.message}</h1>`);
  }
});

// --- FUNÇÃO AUXILIAR: Recupera o cliente do usuário certo ---
async function getUserClient(userID) {
  if (!userID || !userTokens[userID]) return null;

  const spotifyApi = getSpotifyClient();
  spotifyApi.setAccessToken(userTokens[userID].accessToken);
  spotifyApi.setRefreshToken(userTokens[userID].refreshToken);

  // Renova o token se precisar
  if (Date.now() > userTokens[userID].expiresAt - 60000) {
    try {
      const data = await spotifyApi.refreshAccessToken();
      userTokens[userID].accessToken = data.body.access_token;
      userTokens[userID].expiresAt = Date.now() + (data.body.expires_in * 1000);
      spotifyApi.setAccessToken(data.body.access_token);
    } catch (err) {
      return null;
    }
  }
  return spotifyApi;
}

// ==================================================================
// ROTA DE STATUS (TOCANDO) - COM PROTEÇÃO DE ERRO 401
// ==================================================================
app.get('/tocando', async (req, res) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);

  // SE NÃO ACHAR O USUÁRIO, MANDA ERRO 401 (Para o script resetar)
  // Isso corrige o "Paused Eterno" se o servidor reiniciou
  if (!spotifyApi) return res.sendStatus(401); 

  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();
    if (data.body && data.body.is_playing) {
      res.json({
        tocando: true,
        musica: data.body.item.name,
        artista: data.body.item.artists.map(a => a.name).join(', '),
        progresso_ms: data.body.progress_ms,
        duracao_ms: data.body.item.duration_ms
      });
    } else {
      res.json({ tocando: false });
    }
  } catch (err) {
    res.json({ tocando: false });
  }
});

// ==================================================================
// ROTAS DE CONTROLE - AGORA INDIVIDUAIS
// ==================================================================
const handleControl = async (req, res, action) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);
  if (!spotifyApi) return res.sendStatus(401); // Pede login se perder o token

  try {
    if (action === 'play') await spotifyApi.play();
    if (action === 'pause') await spotifyApi.pause();
    if (action === 'next') await spotifyApi.skipToNext();
    if (action === 'previous') await spotifyApi.skipToPrevious();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
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
