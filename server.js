// server.js (VERSÃO FINAL: MULTI-USUÁRIO / MULTI-CONTAS)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;
const app = express();

// BANCO DE DADOS TEMPORÁRIO (Memória)
// Guarda os tokens de cada avatar: { 'uuid_do_avatar': { access: '...', refresh: '...' } }
const userTokens = {}; 

// Função auxiliar para criar a API configurada
function getSpotifyClient() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
  });
}

// ==================================================================
// ROTA DE LOGIN (Agora recebe o ID do usuário do SL)
// ==================================================================
app.get('/login', (req, res) => {
  const userID = req.query.user; // O script LSL vai mandar ?user=UUID
  
  if (!userID) return res.send('Erro: ID de usuário não fornecido.');

  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  const spotifyApi = getSpotifyClient();
  
  // Passamos o ID do usuário no 'state' para recuperar depois no callback
  const options = { state: userID, showDialog: true };
  
  res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
});

// ==================================================================
// ROTA DE CALLBACK (Salva o token no ID certo)
// ==================================================================
app.get('/callback', async (req, res) => {
  const { code, state } = req.query; // 'state' aqui é o UUID do avatar
  const userID = state;

  if (!userID) return res.send('Erro: Identificação de usuário perdida.');

  try {
    const spotifyApi = getSpotifyClient();
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    // SALVA OS TOKENS ESPECÍFICOS PARA ESSE USUÁRIO
    userTokens[userID] = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + (data.body.expires_in * 1000)
    };

    const successHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Spotify Connection Success</title>
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
</html>
    `;
    res.send(successHtml);
  } catch (err) {
    res.send(`<h1>Erro ao conectar: ${err.message}</h1>`);
  }
});

// ==================================================================
// FUNÇÃO PARA PEGAR O CLIENTE AUTENTICADO DE UM USUÁRIO
// ==================================================================
async function getUserClient(userID) {
  if (!userID || !userTokens[userID]) return null;

  const spotifyApi = getSpotifyClient();
  spotifyApi.setAccessToken(userTokens[userID].accessToken);
  spotifyApi.setRefreshToken(userTokens[userID].refreshToken);

  // Verifica se precisa renovar o token
  if (Date.now() > userTokens[userID].expiresAt - 60000) {
    try {
      const data = await spotifyApi.refreshAccessToken();
      userTokens[userID].accessToken = data.body.access_token;
      userTokens[userID].expiresAt = Date.now() + (data.body.expires_in * 1000);
      spotifyApi.setAccessToken(data.body.access_token);
    } catch (err) {
      console.error("Erro ao renovar token", err);
      return null;
    }
  }
  return spotifyApi;
}

// ==================================================================
// ROTA DE STATUS (TOCANDO) - Multi-usuário
// ==================================================================
app.get('/tocando', async (req, res) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);

  if (!spotifyApi) return res.json({ tocando: false }); // Não logado

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
// ROTAS DE CONTROLE - Multi-usuário
// ==================================================================
const handleControl = async (req, res, action) => {
  const userID = req.query.user;
  const spotifyApi = await getUserClient(userID);
  if (!spotifyApi) return res.status(401).send('No User');

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
  if (userTokens[userID]) {
    delete userTokens[userID]; // Remove apenas o token deste usuário
  }
  res.status(200).send('Revoked');
});

app.listen(port, () => { console.log(`Server running`); });
