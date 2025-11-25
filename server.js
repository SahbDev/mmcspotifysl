const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

// Rota de Login (Igual antes)
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-read-currently-playing'];
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

// Rota de Callback (Igual antes)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    spotifyApi.setAccessToken(data.body['access_token']);
    spotifyApi.setRefreshToken(data.body['refresh_token']);

    setInterval(async () => {
      const data = await spotifyApi.refreshAccessToken();
      spotifyApi.setAccessToken(data.body['access_token']);
    }, 1800 * 1000); 

    res.send('<h1>Conectado! Pode fechar.</h1>');
  } catch (err) {
    res.send('Erro no login: ' + err);
  }
});

// --- A MUDANÇA ESTÁ AQUI ---
// Agora enviamos JSON (Dados puros) para o LSL ler
app.get('/tocando', async (req, res) => {
  try {
    const data = await spotifyApi.getMyCurrentPlayingTrack();
    
    if (data.body && data.body.is_playing) {
      const track = data.body.item;
      
      // Enviamos apenas os dados matemáticos
      res.json({
        tocando: true,
        musica: track.name,
        artista: track.artists[0].name,
        album: track.album.name,
        progresso_ms: data.body.progress_ms, // Onde a musica ta (em ms)
        duracao_ms: track.duration_ms      // Total da musica (em ms)
      });
      
    } else {
      res.json({ tocando: false });
    }
  } catch (err) {
    res.json({ tocando: false, erro: "token_invalido" });
  }
});

app.listen(process.env.PORT || 3000);
