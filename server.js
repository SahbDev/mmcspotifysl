const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Spotify - VARIÁVEIS DE AMBIENTE
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499',
  redirectUri: process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback'
});

// Estado da aplicação
let currentTrack = {
  is_playing: false,
  track: 'Nenhuma música',
  artist: 'Nenhum artista',
  album: '',
  error: false
};

let spotifyTokens = {
  accessToken: '',
  refreshToken: '',
  expiresAt: 0
};

// Middleware
app.use(express.static('public'));
app.use(express.json());

// ================= FUNÇÕES =================

// Função para atualizar token do Spotify
async function refreshAccessToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    spotifyTokens.accessToken = access_token;
    spotifyTokens.expiresAt = Date.now() + (expires_in * 1000);
    spotifyApi.setAccessToken(access_token);
    
    console.log('✅ Token do Spotify atualizado');
  } catch (error) {
    console.error('❌ Erro ao atualizar token:', error);
  }
}

// Função para buscar música atual
async function updateCurrentTrack() {
  if (!spotifyTokens.accessToken) return;

  // Verificar se precisa atualizar o token
  if (Date.now() >= spotifyTokens.expiresAt - 60000) {
    await refreshAccessToken();
  }

  try {
    const playback = await spotifyApi.getMyCurrentPlaybackState();
    
    if (playback.body && playback.body.item) {
      const track = playback.body.item;
      const isPlaying = playback.body.is_playing;
      
      currentTrack = {
        is_playing: isPlaying,
        track: track.name,
        artist: track.artists.map(artist => artist.name).join(', '),
        album: track.album.name,
        error: false
      };
      
      console.log(`🎵 Tocando: ${currentTrack.track} - ${currentTrack.artist}`);
    } else {
      currentTrack = {
        is_playing: false,
        track: 'Nada tocando',
        artist: '',
        album: '',
        error: false
      };
    }
  } catch (error) {
    console.error('❌ Erro ao buscar música:', error);
    currentTrack.error = true;
  }
}

// Iniciar atualização automática a cada 5 segundos
function startTrackUpdater() {
  // Atualizar imediatamente
  updateCurrentTrack();
  
  // Atualizar a cada 5 segundos
  setInterval(updateCurrentTrack, 5000);
}

// ================= ROTAS =================

// Página inicial
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Spotify para Second Life</title>
        <style>
          body { 
            font-family: Arial; 
            text-align: center; 
            padding: 50px;
            background: linear-gradient(135deg, #1DB954, #191414);
            color: white;
          }
          .container {
            background: rgba(255,255,255,0.1);
            padding: 30px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
          }
          .button {
            background: #1DB954;
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 25px;
            display: inline-block;
            margin: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎵 Spotify para Second Life</h1>
          <p>Conecte sua conta do Spotify para mostrar a música atual no Second Life</p>
          
          <a href="/login" class="button">🔗 Conectar com Spotify</a>
          
          <div style="margin-top: 30px;">
            <p><strong>URL para o Second Life:</strong></p>
            <code>https://mmcspotifysl.onrender.com/current-track</code>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Login com Spotify
app.get('/login', (req, res) => {
  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const authUrl = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authUrl);
});

// Callback do Spotify
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('Erro no callback:', error);
    return res.status(400).send(`Erro na autenticação: ${error}`);
  }

  try {
    console.log('Trocando código por token...');
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    const { access_token, refresh_token, expires_in } = data.body;
    
    // Salvar tokens
    spotifyTokens = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };
    
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    console.log('✅ Autenticação realizada com sucesso!');
    
    // INICIAR ATUALIZAÇÃO AUTOMÁTICA DAS MÚSICAS
    startTrackUpdater();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Autenticação Concluída</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #1DB954, #191414);
            color: white;
          }
          .success { 
            background: rgba(255,255,255,0.1); 
            padding: 30px; 
            border-radius: 15px;
            backdrop-filter: blur(10px);
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>🎵 Autenticação Concluída!</h1>
          <p>Seu Spotify foi conectado com sucesso ao Second Life.</p>
          <p>Você pode fechar esta janela e voltar para o Second Life.</p>
          <p><small>O sistema começará a atualizar automaticamente.</small></p>
        </div>
        <script>
          setTimeout(() => window.close(), 3000);
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    res.status(500).send(`
      <h1>Erro na Autenticação</h1>
      <p>${error.message}</p>
      <a href="/">Tentar novamente</a>
    `);
  }
});

// Rota para o Second Life buscar dados
app.get('/current-track', (req, res) => {
  res.json({
    success: true,
    ...currentTrack,
    timestamp: Date.now()
  });
});

// Status do serviço
app.get('/status', (req, res) => {
  res.json({
    authenticated: !!spotifyTokens.accessToken,
    online: true,
    ...currentTrack
  });
});

// ================= INICIAR SERVIDOR =================
app.listen(PORT, () => {
  console.log(`🎵 Servidor Spotify rodando na porta ${PORT}`);
  console.log(`📡 URL para SL: https://mmcspotifysl.onrender.com/current-track`);
});
