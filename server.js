const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Spotify - USE SUAS CREDENCIAIS AQUI
const spotifyApi = new SpotifyWebApi({
  clientId: 'bb4c46d3e3e549bb9ebf5007e89a5c9e',
  clientSecret: 'f1090563300d4a598dbb711d39255499',
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback'
});

// Vamos armazenar a música atual aqui
let currentTrack = {
  is_playing: false,
  track: 'Nenhuma música',
  artist: 'Nenhum artista',
  album: '',
  error: false
};

// Configurar o Express
app.use(express.static('public'));
app.use(express.json());

// ================= ROTAS BÁSICAS =================

// Rota 1: Página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota 2: Login com Spotify
app.get('/login', (req, res) => {
  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const authUrl = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authUrl);
});

// Rota 3: Dados para o Second Life
app.get('/current-track', (req, res) => {
  res.json({
    success: true,
    ...currentTrack,
    timestamp: Date.now()
  });
});

// Rota 4: Status do serviço
app.get('/status', (req, res) => {
  res.json({
    online: true,
    message: 'Servidor Spotify funcionando!',
    ...currentTrack
  });
});

// ================= INICIAR SERVIDOR =================
app.listen(PORT, () => {
  console.log(`🎵 Servidor Spotify rodando na porta ${PORT}`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`📡 URL para SL: http://localhost:${PORT}/current-track`);
});
