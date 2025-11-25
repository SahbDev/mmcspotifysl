const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const Redis = require('redis');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Redis
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Configuração Spotify
const spotifyConfig = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
};

// Conectar Redis
redisClient.on('error', (err) => console.log('Redis Client Error', err));
(async () => {
  await redisClient.connect();
  console.log('✅ Redis conectado');
})();

// Map para intervals por usuário
const userIntervals = new Map();

// ================= FUNÇÕES MULTI-USUÁRIO =================

// Buscar música do usuário
async function updateUserTrack(userId) {
  try {
    console.log(`🔄 Buscando música para usuário: ${userId.slice(0,8)}`);
    
    const sessionData = await redisClient.get(`user:${userId}`);
    if (!sessionData) {
      console.log(`❌ Sessão não encontrada para: ${userId.slice(0,8)}`);
      return null;
    }

    const session = JSON.parse(sessionData);
    
    // Verificar token
    if (Date.now() >= session.expiresAt - 60000) {
      console.log(`🔄 Atualizando token para: ${userId.slice(0,8)}`);
      const newToken = await refreshUserToken(userId, session);
      if (!newToken) return null;
    }

    // NOVA instância Spotify para CADA usuário
    const userSpotifyApi = new SpotifyWebApi({
      clientId: spotifyConfig.clientId,
      clientSecret: spotifyConfig.clientSecret,
      accessToken: session.accessToken
    });

    const playback = await userSpotifyApi.getMyCurrentPlaybackState();
    
    let currentTrack;
    if (playback.body && playback.body.item && playback.body.is_playing) {
      const track = playback.body.item;
      currentTrack = {
        is_playing: true,
        track: track.name || 'Música desconhecida',
        artist: track.artists ? track.artists.map(artist => artist.name).join(', ') : 'Artista desconhecido',
        progress: playback.body.progress_ms || 0,
        duration: track.duration_ms || 0,
        error: false
      };
      
      console.log(`🎵 ${userId.slice(0,8)}: "${currentTrack.track}" - ${currentTrack.artist}`);
    } else {
      currentTrack = {
        is_playing: false,
        track: 'Nada tocando',
        artist: '',
        progress: 0,
        duration: 0,
        error: false
      };
      console.log(`⏸️ ${userId.slice(0,8)}: Nada tocando`);
    }
    
    // Salvar no cache do usuário
    await redisClient.set(`track:${userId}`, JSON.stringify(currentTrack), { EX: 60 });
    
    return currentTrack;
    
  } catch (error) {
    console.error(`❌ Erro para ${userId.slice(0,8)}:`, error.message);
    
    await redisClient.set(`track:${userId}`, JSON.stringify({
      error: true,
      track: 'Erro de conexão',
      artist: '',
      progress: 0,
      duration: 0
    }), { EX: 30 });
    
    return null;
  }
}

// Atualizar token
async function refreshUserToken(userId, session) {
  try {
    const userSpotifyApi = new SpotifyWebApi({
      clientId: spotifyConfig.clientId,
      clientSecret: spotifyConfig.clientSecret,
      refreshToken: session.refreshToken
    });
    
    const data = await userSpotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    session.accessToken = access_token;
    session.expiresAt = Date.now() + (expires_in * 1000);
    
    await redisClient.set(`user:${userId}`, JSON.stringify(session));
    
    console.log(`✅ Token atualizado para: ${userId.slice(0,8)}`);
    return access_token;
  } catch (error) {
    console.error(`❌ Erro ao atualizar token para ${userId.slice(0,8)}:`, error);
    return null;
  }
}

// Iniciar updater para usuário
function startUserUpdater(userId) {
  console.log(`🚀 Iniciando updater para: ${userId.slice(0,8)}`);
  
  // Atualizar imediatamente
  updateUserTrack(userId);
  
  // Configurar intervalo
  const intervalId = setInterval(() => updateUserTrack(userId), 3000);
  userIntervals.set(userId, intervalId);
}

// ================= ROTAS =================

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>MMC - Spotify Player</title></head>
    <body style="margin: 0; background: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
      <h2>MMC - Spotify Player</h2>
      <h1>Connect your Spotify Account</h1>
      <a href="/login" style="background: #1DB954; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-size: 18px; display: inline-block; margin: 20px;">
        Connect Spotify
      </a>
      <footer style="position: absolute; bottom: 10px; width: 100%; font-size: 10px;">
        MMC - Spotify Player Plug-in Created by Saori Suki
      </footer>
    </body>
    </html>
  `);
});

app.get('/login', (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).send('User ID required');

  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const state = `user_${user}_${Date.now()}`;

  redisClient.set(`state:${state}`, user, { EX: 300 });

  const spotifyApi = new SpotifyWebApi(spotifyConfig);
  const authUrl = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send('Authentication error');

  try {
    const userId = await redisClient.get(`state:${state}`);
    if (!userId) return res.status(400).send('Invalid state');

    const userSpotifyApi = new SpotifyWebApi(spotifyConfig);
    const data = await userSpotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;
    
    const userSession = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000),
      connectedAt: Date.now()
    };
    
    await redisClient.set(`user:${userId}`, JSON.stringify(userSession));
    await redisClient.del(`state:${state}`);
    
    console.log(`🎉 NOVO USUÁRIO: ${userId}`);
    
    startUserUpdater(userId);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>MMC - Spotify Player</title></head>
      <body style="margin: 0; background: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
        <h2>MMC - Spotify Player</h2>
        <h1>You are now ready to press play <3</h1>
        <p>Your Spotify Player is ready to use!</p>
        <p>You can now close this tab. Thank you!</p>
        <footer style="position: absolute; bottom: 10px; width: 100%; font-size: 10px;">
          MMC - Spotify Player Plug-in Created by Saori Suki
        </footer>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/current-track', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.json({ success: false, track: 'User not specified', artist: '', progress: 0, duration: 0 });

  try {
    const trackData = await redisClient.get(`track:${user}`);
    
    if (trackData) {
      const currentTrack = JSON.parse(trackData);
      res.json({ success: true, ...currentTrack, timestamp: Date.now() });
    } else {
      const freshTrack = await updateUserTrack(user);
      if (freshTrack) {
        res.json({ success: true, ...freshTrack, timestamp: Date.now() });
      } else {
        res.json({ success: false, track: 'Not connected', artist: '', progress: 0, duration: 0 });
      }
    }
  } catch (error) {
    console.error(`❌ Erro em /current-track para ${user}:`, error);
    res.json({ success: false, track: 'Server error', artist: '', progress: 0, duration: 0 });
  }
});

app.get('/status', async (req, res) => {
  try {
    const userKeys = await redisClient.keys('user:*');
    const trackKeys = await redisClient.keys('track:*');

    res.json({
      online: true,
      userCount: userKeys.length,
      trackCount: trackKeys.length,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({ online: true, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: Date.now(),
    userIntervals: userIntervals.size,
    version: '2.0-multi-user'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 SPOTIFY MULTI-USER SERVER rodando na porta ${PORT}`);
  console.log(`🔍 Status: https://mmcspotifysl.onrender.com/status`);
  console.log(`❤️  Health: https://mmcspotifysl.onrender.com/health`);
});
