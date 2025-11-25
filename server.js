const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;
const app = express();

// MEMÓRIA: Guarda os tokens de cada avatar separadamente
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
  if (!userID) return res.send('Erro: ID do avatar necessario.');
  
  // Passa o ID no 'state' para saber quem é quem na volta
  const options = { state: userID, showDialog: true };
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  
  res.redirect(getSpotifyClient().createAuthorizeURL(scopes, options));
});

// --- CALLBACK (VISUAL APROVADO + FOTO) ---
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const userID = state; // O ID volta aqui

  try {
    const spotifyApi = getSpotifyClient();
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    // Salva o token na gaveta deste usuário específico
    userTokens[userID] = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + (data.body.expires_in * 1000)
    };

    // HTML ESCURO COM FOTO DO GYAZO
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Spotify Connected</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
    body { margin: 0; background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%); color: white; font-family: 'Montserrat', sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; padding-top: 5vh; min-height: 100vh; }
    h1 { font-size: 42px; margin-bottom: 10px; }
    h2 { font-size: 24px; color: #e0e0e0; margin-bottom: 30px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    p { font-size: 18px; color: #cccccc; line-height: 1.4; margin: 5px 0; }
    .menu-preview { margin-top: 25px; margin-bottom: 15px; max-width: 85%; width: 420px; border-radius: 12px; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.7); }
    .instruction { font-size: 14px; color: #cccccc; margin-top: 0px; }
    footer { margin-top: 40px; width: 100%; font-size: 11px; color: rgba(255, 255, 255, 0.5); letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <h2>MMC - Spotify Player</h2>
  <h1>You are now ready to press play <span style="color: #ff6b6b;">&lt;3</span></h1>
  <p>Your Spotify Player is ready to use!</p>
  <p style="font-size: 16px;">You can now close this tab. Thank you!</p>
  <img src="https://i.gyazo.com/fad06bc27b3dd7752587726c4a83b4cf.png" class="menu-preview">
  <p class="instruction">Click on your player to change tracks, pause, customize colors and more.</p>
  <footer>MMC - Spotify Player Plug-in Created by Saori Suki</footer>
</body>
</html>`);
  } catch (err) {
    res.send(`<h1>Erro: ${err.message}</h1>`);
  }
});

// --- TOKEN HELPER ---
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

// --- STATUS ---
app.get('/tocando', async (req, res) => {
  const userID = req.query.user;
  // Se não tem usuário, retorna disconnected
  const spotifyApi = await getUserClient(userID);
  if (!spotifyApi) return res.json({ status: "disconnected" });

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
