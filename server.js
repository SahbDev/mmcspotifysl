const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const Redis = require('redis');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Redis
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Configuração Spotify BASE
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

// ================= SISTEMA MULTI-USUÁRIO ISOLADO =================

// Buscar música atual do usuário (COMPLETAMENTE ISOLADA)
async function updateUserTrack(userId) {
  try {
    // Buscar sessão do usuário
    const sessionData = await redisClient.get(`user:${userId}`);
    if (!sessionData) {
      console.log(`❌ Usuário ${userId} não encontrado`);
      return null;
    }

    const session = JSON.parse(sessionData);
    
    // Verificar se token expirou
    if (Date.now() >= session.expiresAt - 60000) {
      console.log(`🔄 Atualizando token para ${userId}`);
      const newToken = await refreshUserToken(userId, session);
      if (!newToken) return null;
      session.accessToken = newToken;
    }

    // Criar instância Spotify COMPLETAMENTE NOVA para este usuário
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
        album: track.album?.name || '',
        progress: playback.body.progress_ms || 0,
        duration: track.duration_ms || 0,
        error: false
      };
      
      console.log(`🎵 ${userId.slice(0,8)}: ${currentTrack.track} - ${currentTrack.artist}`);
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
    
    // Salvar track atual NO CACHE DO USUÁRIO
    await redisClient.set(`track:${userId}`, JSON.stringify(currentTrack), {
      EX: 60 // Expira em 60 segundos
    });
    
    return currentTrack;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar música para ${userId}:`, error.message);
    
    // Salvar estado de erro
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

// Atualizar token do usuário
async function refreshUserToken(userId, session) {
  try {
    const userSpotifyApi = new SpotifyWebApi({
      clientId: spotifyConfig.clientId,
      clientSecret: spotifyConfig.clientSecret,
      refreshToken: session.refreshToken
    });
    
    const data = await userSpotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    // Atualizar sessão
    session.accessToken = access_token;
    session.expiresAt = Date.now() + (expires_in * 1000);
    
    // Salvar sessão atualizada
    await redisClient.set(`user:${userId}`, JSON.stringify(session));
    
    console.log(`✅ Token atualizado para ${userId.slice(0,8)}`);
    return access_token;
  } catch (error) {
    console.error(`❌ Erro ao atualizar token para ${userId}:`, error);
    return null;
  }
}

// Iniciar updater para usuário
function startUserUpdater(userId) {
  // Atualizar imediatamente
  updateUserTrack(userId);
  
  // Configurar intervalo com identificador único
  const intervalId = setInterval(async () => {
    await updateUserTrack(userId);
  }, 3000);
  
  // Guardar reference do interval
  userIntervals.set(userId, intervalId);
}

// Map para guardar intervals
const userIntervals = new Map();

// ================= ROTAS =================

// Página inicial
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MMC - Spotify Player</title>
    </head>
    <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
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

// Login
app.get('/login', (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).send('User ID required');

  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const state = `user_${user}_${Date.now()}`;

  // Salvar estado
  redisClient.set(`state:${state}`, user, { EX: 300 });

  const spotifyApi = new SpotifyWebApi(spotifyConfig);
  const authUrl = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authUrl);
});

// Callback
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send('Authentication error');

  try {
    const userId = await redisClient.get(`state:${state}`);
    if (!userId) return res.status(400).send('Invalid state');

    // Criar instância NOVA para este usuário
    const userSpotifyApi = new SpotifyWebApi(spotifyConfig);
    const data = await userSpotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;
    
    // Salvar sessão COMPLETAMENTE ISOLADA
    const userSession = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000),
      connectedAt: Date.now()
    };
    
    await redisClient.set(`user:${userId}`, JSON.stringify(userSession));
    await redisClient.del(`state:${state}`);
    
    console.log(`🎉 NOVO USUÁRIO CONECTADO: ${userId}`);
    console.log(`   Sessão salva em: user:${userId}`);
    
    // Iniciar updater
    startUserUpdater(userId);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>MMC - Spotify Player</title></head>
      <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
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

// Rota para Second Life
app.get('/current-track', async (req, res) => {
  const { user } = req.query;
  
  if (!user) {
    return res.json({
      success: false,
      track: 'User not specified',
      artist: '',
      progress: 0,
      duration: 0
    });
  }

  try {
    // Buscar track do cache do usuário
    const trackData = await redisClient.get(`track:${user}`);
    
    if (trackData) {
      const currentTrack = JSON.parse(trackData);
      res.json({
        success: true,
        ...currentTrack,
        timestamp: Date.now()
      });
    } else {
      // Se não tem cache, buscar agora
      const freshTrack = await updateUserTrack(user);
      if (freshTrack) {
        res.json({
          success: true,
          ...freshTrack,
          timestamp: Date.now()
        });
      } else {
        res.json({
          success: false,
          track: 'Not connected',
          artist: '',
          progress: 0,
          duration: 0
        });
      }
    }
  } catch (error) {
    console.error(`❌ Erro em /current-track para ${user}:`, error);
    res.json({
      success: false,
      track: 'Server error',
      artist: '',
      progress: 0,
      duration: 0
    });
  }
});

// Status com DEBUG
app.get('/status', async (req, res) => {
  try {
    const userKeys = await redisClient.keys('user:*');
    const trackKeys = await redisClient.keys('track:*');
    
    // Debug: mostrar últimos usuários
    const recentUsers = [];
    for (let i = 0; i < Math.min(userKeys.length, 5); i++) {
      const userData = await redisClient.get(userKeys[i]);
      recentUsers.push({
        key: userKeys[i],
        data: userData ? JSON.parse(userData) : null
      });
    }

    res.json({
      online: true,
      userCount: userKeys.length,
      trackCount: trackKeys.length,
      recentUsers: recentUsers,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({
      online: true,
      error: error.message
    });
  }
});

// Debug: ver usuário específico
app.get('/debug-user', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).send('User required');

  try {
    const session = await redisClient.get(`user:${user}`);
    const track = await redisClient.get(`track:${user}`);
    
    res.json({
      user: user,
      session: session ? JSON.parse(session) : null,
      track: track ? JSON.parse(track) : null
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Logout
app.get('/logout', async (req, res) => {
  const { user } = req.query;
  if (user) {
    await redisClient.del(`user:${user}`);
    await redisClient.del(`track:${user}`);
    
    // Parar interval
    if (userIntervals.has(user)) {
      clearInterval(userIntervals.get(user));
      userIntervals.delete(user);
    }
    
    console.log(`✅ Usuário ${user} desconectado`);
  }
  res.redirect('/');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: Date.now(),
    userIntervals: userIntervals.size
  });
});

// ================= INICIAR =================
app.listen(PORT, () => {
  console.log(`🚀 Spotify Multi-User Server rodando na porta ${PORT}`);
  console.log(`🔍 Debug: https://mmcspotifysl.onrender.com/status`);
  console.log(`🎯 Health: https://mmcspotifysl.onrender.com/health`);
});
