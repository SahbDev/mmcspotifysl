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

// ================= FUNÇÕES AUXILIARES =================

// Nova função para criar instância da API com token do Redis
async function getSpotifyApiForUser(userId) {
  const sessionData = await redisClient.get(`user:${userId}`);
  if (!sessionData) return null;
  
  const session = JSON.parse(sessionData);
  
  // Refresh Token (usando a função existente)
  if (Date.now() >= session.expiresAt - 60000) {
    const newToken = await refreshUserToken(userId, session);
    if (!newToken) return null;
  }
  
  return new SpotifyWebApi({
    clientId: spotifyConfig.clientId,
    clientSecret: spotifyConfig.clientSecret,
    accessToken: session.accessToken // Usar o token atualizado/existente
  });
}

// Buscar música do usuário
async function updateUserTrack(userId) {
  try {
    const sessionData = await redisClient.get(`user:${userId}`);
    if (!sessionData) {
      console.log(`❌ Sessão não encontrada para: ${userId.slice(0,8)}`);
      return null;
    }

    const session = JSON.parse(sessionData);
    
    // Verificar token
    if (Date.now() >= session.expiresAt - 60000) {
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
        // CORREÇÃO: Usar 'Paused / Idle' para o LSL identificar o estado correto
        track: (playback.body && playback.body.item) ? 'Paused / Idle' : 'Nada tocando',
        artist: (playback.body && playback.body.item && playback.body.item.artists) ? playback.body.item.artists.map(artist => artist.name).join(', ') : '',
        progress: (playback.body && playback.body.progress_ms) ? playback.body.progress_ms : 0,
        duration: (playback.body && playback.body.item) ? playback.body.item.duration_ms : 0,
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

// ================= ROTAS DE ACESSO =================

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

  // Adicionando user-modify-playback-state para controle
  const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state'];
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
    
    // Se o updater já estiver rodando, apenas o deixa, senão inicia.
    if (!userIntervals.has(userId)) {
        startUserUpdater(userId);
    }
    
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


// ================= ROTA DE DADOS =================

app.get('/current-track', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.json({ success: false, track: 'User not specified', artist: '', progress: 0, duration: 0 });

  try {
    const trackData = await redisClient.get(`track:${user}`);
    
    if (trackData) {
      const currentTrack = JSON.parse(trackData);
      // CORREÇÃO: Mapear o formato para o esperado pelo LSL
      res.json({ 
        track: currentTrack.track,
        artist: currentTrack.artist,
        is_playing: currentTrack.is_playing,
        progress: currentTrack.progress,
        duration: currentTrack.duration
      });
    } else {
      const freshTrack = await updateUserTrack(user);
      if (freshTrack) {
        // CORREÇÃO: Mapear o formato para o esperado pelo LSL
        res.json({ 
            track: freshTrack.track,
            artist: freshTrack.artist,
            is_playing: freshTrack.is_playing,
            progress: freshTrack.progress,
            duration: freshTrack.duration
        });
      } else {
        // CORREÇÃO: Mensagem de erro para o LSL
        res.json({ track: 'Not Connected', artist: 'Touch to Log In', progress: 0, duration: 0 });
      }
    }
  } catch (error) {
    console.error(`❌ Erro em /current-track para ${user}:`, error);
    res.json({ track: 'Server Error', artist: 'Try again later', progress: 0, duration: 0 });
  }
});

// ================= ROTAS DE CONTROLE (NOVO!) =================

app.post('/control/:action', async (req, res) => {
    const userId = req.query.user;
    const action = req.params.action;

    if (!userId) return res.status(400).send('User ID required');

    try {
        const userSpotifyApi = await getSpotifyApiForUser(userId);
        if (!userSpotifyApi) {
            return res.json({ track: 'Not Connected', artist: 'Please Log In', progress: 0, duration: 0 });
        }

        switch (action) {
            case 'next':
                await userSpotifyApi.skipToNext();
                break;
            case 'previous':
                await userSpotifyApi.skipToPrevious();
                break;
            case 'pause':
                const playback = await userSpotifyApi.getMyCurrentPlaybackState();
                if (playback.body && playback.body.is_playing) {
                    await userSpotifyApi.pause(); // Pausa
                } else {
                    await userSpotifyApi.play(); // Toca (Resume)
                }
                break;
            default:
                return res.status(400).send('Invalid control action.');
        }

        // Aguarda a sincronização do Spotify e força a atualização do cache (3 segundos)
        // Não precisamos de um retorno de JSON do estado aqui, pois o updater fará isso em segundos.
        // O LSL fará o GET /current-track normalmente.
        setTimeout(() => updateUserTrack(userId), 500);
        
        // Retorna sucesso para o LSL
        res.json({ status: 'ok', message: `${action} command sent.` });

    } catch (error) {
        console.error(`❌ Erro no controle para ${userId.slice(0,8)} (${action}):`, error.message);
        // Retorna um erro que o LSL possa interpretar
        res.status(500).json({ track: 'Control Error', artist: 'Device Not Found', progress: 0, duration: 0 });
    }
});


// ================= ROTAS DE STATUS/HEALTH =================

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
    version: '2.0-multi-user-controls'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 SPOTIFY MULTI-USER SERVER rodando na porta ${PORT}`);
  console.log(`🔍 Status: https://mmcspotifysl.onrender.com/status`);
  console.log(`❤️  Health: https://mmcspotifysl.onrender.com/health`);
});
