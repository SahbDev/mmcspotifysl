// server.js
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

const app = express();

// Rota de Login (Forçando o showDialog para segurança)
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  
  const options = {
    state: 'state',
    showDialog: true 
  };
  
  res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
});

// ==========================================================
// ROTA DE CALLBACK COM VISUAL FINAL (TODOS OS TEXTOS BRANCOS)
// ==========================================================
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // HTML personalizado com as mensagens e o rodapé
    const successHtml = `
      <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
        
        <h2 style="font-size: 32px; color: white; margin-bottom: 10px;">
          MMC - Spotify Player
        </h2>
        
        <h1 style="color: white; font-size: 48px; margin-bottom: 20px;">
          You are now ready to press play <span style="font-size: 0.8em;">&lt;3</span>
        </h1>
        
        <p style="font-size: 24px;">
          Your Spotify Player is ready to use !
        </p>
        <p style="font-size: 18px; color: white;"> 
          You can now close this tab. Thank you!
        </p>
        
        <footer style="position: absolute; bottom: 10px; left: 0; width: 100%; font-size: 10px; color: white;"> 
          MMC - Spotify Player Plug-in Created by Saori Suki, a Second Life User
        </footer>
      </body>
    `;

    res.send(successHtml);
  } catch (err) {
    res.send(`<h1>Erro ao conectar: ${err.message}</h1>`);
  }
});

// Rota para Obter a Música Atual
app.get('/tocando', async (req, res) => {
  try {
    const data = await spotifyApi.getMyCurrentPlaybackState();

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
        const data = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(data.body.access_token);
        return res.redirect('/tocando');
      } catch (refreshErr) {
        res.status(401).json({ error: 'Token expirado. Reconecte-se.' });
      }
    } else {
      res.status(500).json({ error: 'Erro ao buscar estado de reprodução.' });
    }
  }
});

// ==========================================================
// ROTAS DE CONTROLE (PLAY, PAUSE, NEXT, PREVIOUS, REVOKE)
// ==========================================================

app.post('/play', async (req, res) => {
  try {
    await spotifyApi.play();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao tocar: ${err.message}`);
  }
});

app.post('/pause', async (req, res) => {
  try {
    await spotifyApi.pause();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao pausar: ${err.message}`);
  }
});

app.post('/next', async (req, res) => {
  try {
    await spotifyApi.skipToNext();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao pular: ${err.message}`);
  }
});

app.post('/previous', async (req, res) => {
  try {
    await spotifyApi.skipToPrevious();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao voltar: ${err.message}`);
  }
});

app.post('/revoke', (req, res) => {
  spotifyApi.setAccessToken(null);
  spotifyApi.setRefreshToken(null);
  res.status(200).send('Tokens Revoked');
});


// Inicializa o servidor
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
