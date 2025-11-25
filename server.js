const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const port = process.env.PORT || 3000;

// Configuração da API (Pega as senhas do Render)
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// Rota 1: Iniciar Login (Você clica aqui uma vez para autorizar)
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-read-currently-playing'];
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

// Rota 2: Callback (Onde o Spotify te devolve e te mostra o Refresh Token)
app.get('/callback', async (req, res) => {
  const error = req.query.error;
  const code = req.query.code;

  if (error) {
    console.error('Erro:', error);
    res.send(`Erro: ${error}`);
    return;
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const refreshToken = data.body['refresh_token'];
    
    // Mostra o token na tela para você copiar
    res.send(`
      <h1>Sucesso!</h1>
      <p>Copie este Refresh Token e coloque nas variáveis do Render:</p>
      <code style="background:#eee;padding:10px;display:block;">${refreshToken}</code>
    `);
  } catch (err) {
    res.send('Erro ao pegar token: ' + err);
  }
});

// Rota 3: O que o Second Life vai chamar
app.get('/tocando', async (req, res) => {
  try {
    // Configura o refresh token salvo no Render
    spotifyApi.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
    
    // Renova o token de acesso (pois ele expira rápido)
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body['access_token']);

    // Pega a música tocando agora
    const currentTrack = await spotifyApi.getMyCurrentPlayingTrack();

    if (currentTrack.body && currentTrack.body.is_playing) {
      const artista = currentTrack.body.item.artists[0].name;
      const musica = currentTrack.body.item.name;
      res.send(`${artista} - ${musica}`);
    } else {
      res.send("Pausado ou Parado");
    }
  } catch (err) {
    console.error(err);
    res.send("Erro ao conectar Spotify");
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
