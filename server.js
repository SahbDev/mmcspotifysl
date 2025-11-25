const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const port = process.env.PORT || 3000;

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

const app = express();

// Rota de Login (Força a tela de consentimento para segurança)
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  
  const options = {
    state: 'state',
    showDialog: true 
  };
  
  res.redirect(spotifyApi.createAuthorizeURL(scopes, options));
});

// ==========================================================
// ROTA DE CALLBACK COM O VISUAL FINAL APROVADO
// ==========================================================
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // HTML FINAL APROVADO
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

    h1 {
      font-family: 'Playfair Display', serif;
      color: white;
      font-size: 48px; 
      margin-bottom: 10px;
      margin-top: 0;
      letter-spacing: 1px;
      animation: breathe 4s infinite ease-in-out;
    }

    h2 {
      font-family: 'Raleway', sans-serif;
      font-size: 14px;
      color: #cccccc;
      margin-bottom: 40px;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      border-bottom: 1px solid #555;
      padding-bottom: 15px;
      width: 60%;
    }

    p {
      font-size: 18px;
      color: #cccccc;
      font-weight: 300;
      line-height: 1.6;
      margin: 5px 0;
    }

    .highlight {
      color: #fff;
      font-weight: 600;
    }

    .menu-preview {
      margin-top: 35px;
      margin-bottom: 20px;
      max-width: 85%;
      width: 420px; 
      border-radius: 8px;
      border: 1px solid #333;
      box-shadow: 0 20px 50px rgba(0,0,0,0.8);
      transition: transform 0.5s ease;
    }

    .menu-preview:hover {
      transform: translateY(-5px);
    }

    .instruction {
      font-size: 14px;
      color: #cccccc;
      margin-top: 10px;
      font-style: normal;
      font-weight: 400;
    }

    footer {
      margin-top: auto;
      width: 100%;
      text-align: center;
      font-size: 11px;
      color: #cccccc;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding-top: 40px;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  
  <h2>MMC - Spotify Player</h2>
  
  <h1>
    You are ready to press play <span style="font-size: 0.8em; color: #fff;">&lt;3</span>
  </h1>
  
  <p>
    Your Spotify Player is now <span class="highlight">connected</span>.
  </p>
  <p style="font-size: 15px; color: #aaa;"> 
    You may close this tab safely.
  </p>

  <img src="https://i.gyazo.com/fad06bc27b3dd7752587726c4a83b4cf.png" 
       alt="Player Controls" 
       class="menu-preview">
  
  <p class="instruction">
    Click on your player to change tracks, pause, customize colors and more.
  </p>

  <footer>
    MMC - Spotify Player Plug-in Created by Saori Suki
  </footer>

</body>
</html>
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

// ROTAS DE CONTROLE
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
