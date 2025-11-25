const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

// Rota de Login
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-read-currently-playing'];
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

// Rota de Retorno (Callback)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    spotifyApi.setAccessToken(data.body['access_token']);
    spotifyApi.setRefreshToken(data.body['refresh_token']);

    // Renovar token automaticamente
    setInterval(async () => {
      const data = await spotifyApi.refreshAccessToken();
      spotifyApi.setAccessToken(data.body['access_token']);
    }, 1800 * 1000); 

    res.send('<h1 style="font-family:sans-serif;">Tudo certo! Seu Second Life já pode ver o Spotify.</h1>');
  } catch (err) {
    res.send('Erro no login: ' + err);
  }
});

// O que o Second Life vai ver
app.get('/tocando', async (req, res) => {
  try {
    const data = await spotifyApi.getMyCurrentPlayingTrack();
    if (data.body && data.body.is_playing) {
      const track = data.body.item;
      const capa = track.album.images[0].url;
      const nome = track.name;
      const artista = track.artists[0].name;

      // Monta a página visual (HTML + CSS)
      const html = `
        <body style="margin:0;background:#000;color:#fff;font-family:Arial, sans-serif;text-align:center;overflow:hidden;">
          <div style="background:url('${capa}') no-repeat center; background-size:cover; width:100vw; height:100vh; position:absolute; top:0; left:0; opacity:0.3; filter:blur(10px);"></div>
          
          <div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh;">
            <img src="${capa}" style="width:350px; height:350px; box-shadow:0 0 30px rgba(0,0,0,0.8); border-radius:10px;">
            <h1 style="margin-top:20px; font-size:30px; text-shadow:2px 2px 4px #000;">${nome}</h1>
            <h2 style="color:#1DB954; font-size:24px; margin-top:5px; text-shadow:1px 1px 2px #000;">${artista}</h2>
          </div>
        </body>`;
      
      res.send(html);
    } else {
      res.send('<body style="background:#000;color:#555;display:flex;justify-content:center;align-items:center;height:100vh;font-family:Arial;"><h1>Pausado</h1></body>');
    }
  } catch (err) {
    res.send('Erro ou nada tocando.');
  }
});

app.listen(process.env.PORT || 3000);
