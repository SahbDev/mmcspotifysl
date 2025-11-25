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
  progress: 0,
  duration: 0,
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

async function refreshAccessToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    spotifyTokens.accessToken = access_token;
    spotifyTokens.expiresAt = Date.now() + (expires_in * 1000);
    spotifyApi.setAccessToken(access_token);
    
    console.log('✅ Token atualizado');
  } catch (error) {
    console.error('❌ Erro ao atualizar token:', error);
  }
}

// Função para buscar música atual
async function updateCurrentTrack() {
  if (!spotifyTokens.accessToken) return;

  if (Date.now() >= spotifyTokens.expiresAt - 60000) {
    await refreshAccessToken();
  }

  try {
    const playback = await spotifyApi.getMyCurrentPlaybackState();
    
    if (playback.body && playback.body.item) {
      const track = playback.body.item;
      const isPlaying = playback.body.is_playing;
      const progress = playback.body.progress_ms || 0;
      const duration = track.duration_ms || 0;
      
      currentTrack = {
        is_playing: isPlaying,
        track: track.name,
        artist: track.artists.map(artist => artist.name).join(', '),
        album: track.album.name,
        progress: progress,
        duration: duration,
        error: false
      };
      
      console.log(`🎵 ${currentTrack.track} - ${currentTrack.artist} (${Math.round(progress/1000)}s/${Math.round(duration/1000)}s)`);
    } else {
      currentTrack = {
        is_playing: false,
        track: 'Nada tocando',
        artist: '',
        album: '',
        progress: 0,
        duration: 0,
        error: false
      };
    }
  } catch (error) {
    console.error('❌ Erro ao buscar música:', error);
    currentTrack.error = true;
  }
}

function startTrackUpdater() {
  updateCurrentTrack();
  setInterval(updateCurrentTrack, 3000);
}

// ================= ROTAS =================

// Página inicial - COM SEU LAYOUT
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MMC - Spotify Player</title>
</head>
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
</html>
  `);
});

// Login com Spotify
app.get('/login', (req, res) => {
  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const authUrl = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authUrl);
});

// Callback do Spotify - COM SEU LAYOUT
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('Erro no callback:', error);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>MMC - Spotify Player - Erro</title>
      </head>
      <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
          
          <h2 style="font-size: 32px; color: white; margin-bottom: 10px;">
            MMC - Spotify Player
          </h2>
          
          <h1 style="color: #ff4444; font-size: 48px; margin-bottom: 20px;">
            Erro na Autenticação
          </h1>
          
          <p style="font-size: 24px;">
            ${error}
          </p>
          
          <p style="font-size: 18px; color: white;"> 
            <a href="/" style="color: #1DB954;">Tentar novamente</a>
          </p>
          
          <footer style="position: absolute; bottom: 10px; left: 0; width: 100%; font-size: 10px; color: white;"> 
            MMC - Spotify Player Plug-in Created by Saori Suki, a Second Life User
          </footer>

      </body>
      </html>
    `);
  }

  try {
    console.log('Trocando código por token...');
    const data = await spotifyApi.authorizationCodeGrant(code);
    
    const { access_token, refresh_token, expires_in } = data.body;
    
    spotifyTokens = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };
    
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    console.log('✅ Autenticação realizada com sucesso!');
    startTrackUpdater();
    
    // SEU HTML PERSONALIZADO
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>MMC - Spotify Player</title>
      </head>
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
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>MMC - Spotify Player - Erro</title>
      </head>
      <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
          
          <h2 style="font-size: 32px; color: white; margin-bottom: 10px;">
            MMC - Spotify Player
          </h2>
          
          <h1 style="color: #ff4444; font-size: 48px; margin-bottom: 20px;">
            Erro na Autenticação
          </h1>
          
          <p style="font-size: 24px;">
            ${error.message}
          </p>
          
          <p style="font-size: 18px; color: white;"> 
            <a href="/" style="color: #1DB954;">Tentar novamente</a>
          </p>
          
          <footer style="position: absolute; bottom: 10px; left: 0; width: 100%; font-size: 10px; color: white;"> 
            MMC - Spotify Player Plug-in Created by Saori Suki, a Second Life User
          </footer>

      </body>
      </html>
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
