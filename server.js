// server.js
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

// A porta onde o servidor vai rodar
const port = process.env.PORT || 3000;

// Configuração do Spotify API (use as variáveis de ambiente)
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

const app = express();

// Rota de Login (a mesma que você já usa)
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
  res.redirect(spotifyApi.createAuthorizeURL(scopes, 'state'));
});

// Rota de Callback (recebe o token de acesso)
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;

    // Salva os tokens na instância da API para uso futuro
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Mensagem de sucesso para o navegador do SL
    res.send('<h1>Conectado! Pode fechar.</h1>');
  } catch (err) {
    res.send(`<h1>Erro ao conectar: ${err.message}</h1>`);
  }
});

// Rota para Obter a Música Atual (o que o SL usa a cada 3s)
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
    // Se o token expirar, tenta renovar
    if (err.statusCode === 401) {
      try {
        const data = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(data.body.access_token);
        // Tenta buscar a música novamente após a renovação
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
// NOVAS ROTAS DE CONTROLE PARA O MENU LSL
// ==========================================================

// Rota para Tocar/Retomar
app.post('/play', async (req, res) => {
  try {
    await spotifyApi.play();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao tocar: ${err.message}`);
  }
});

// Rota para Pausar
app.post('/pause', async (req, res) => {
  try {
    await spotifyApi.pause();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao pausar: ${err.message}`);
  }
});

// Rota para Próxima Faixa
app.post('/next', async (req, res) => {
  try {
    await spotifyApi.skipToNext();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao pular: ${err.message}`);
  }
});

// Rota para Faixa Anterior (o Spotify usa "skipToPrevious" para voltar)
app.post('/previous', async (req, res) => {
  try {
    await spotifyApi.skipToPrevious();
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(`Erro ao voltar: ${err.message}`);
  }
});

// Inicializa o servidor
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
