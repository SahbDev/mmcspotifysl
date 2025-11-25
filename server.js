const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const Redis = require('redis');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Redis (escalável)
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Configuração Spotify
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

// Conectar Redis
redisClient.on('error', (err) => console.log('Redis Error:', err));
redisClient.connect();

// ================= FUNÇÕES MULTI-USUÁRIO =================

// Salvar sessão do usuário
async function saveUserSession(userId, sessionData) {
  const key = `user:${userId}`;
  await redisClient.set(key, JSON.stringify(sessionData));
  await redisClient.expire(key, 60 * 60 * 24 * 7); // Expira em 7 dias
}

// Buscar sessão do usuário
async function getUserSession(userId) {
  const key = `user:${userId}`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

// Atualizar token do usuário
async function refreshUserToken(userId) {
  const session = await getUserSession(userId);
  if (!session) return null;

  try {
    spotifyApi.setRefreshToken(session.refreshToken);
    const data = await spotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    // Atualizar sessão
    session.accessToken = access_token;
    session.expiresAt = Date.now() + (expires_in * 1000);
    await saveUserSession(userId, session);
    
    console.log(`✅ Token atualizado para usuário: ${userId}`);
    return access_token;
  } catch (error) {
    console.error(`❌ Erro ao atualizar token para ${userId}:`, error);
    return null;
  }
}

// Buscar música atual do usuário
async function updateUserTrack(userId) {
  const session = await getUserSession(userId);
  if (!session || !session.accessToken) return null;

  // Verificar se token expirou
  if (Date.now() >= session.expiresAt - 60000) {
    const newToken = await refreshUserToken(userId);
    if (!newToken) return null;
    session.accessToken = newToken;
  }

  try {
    spotifyApi.setAccessToken(session.accessToken);
    const playback = await spotifyApi.getMyCurrentPlaybackState();
    
    let currentTrack;
    if (playback.body && playback.body.item) {
      const track = playback.body.item;
      currentTrack = {
        is_playing: playback.body.is_playing,
        track: track.name,
        artist: track.artists.map(artist => artist.name).join(', '),
        album: track.album.name,
        progress: playback.body.progress_ms || 0,
        duration: track.duration_ms || 0,
        error: false
      };
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
    
    // Salvar track atual no Redis
    await redisClient.set(`track:${userId}`, JSON.stringify(currentTrack));
    return currentTrack;
    
  } catch (error) {
    console.error(`❌ Erro ao buscar música para ${userId}:`, error);
    return { error: true, track: 'Erro de conexão', artist: '' };
  }
}

// ================= ROTAS MULTI-USUÁRIO =================

// Página inicial
app.get('/', (req, res) => {
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
        
        <h1 style="color: white; font-size: 36px; margin-bottom: 30px;">
          Connect your Spotify Account
        </h1>
        
        <a href="/login" style="
          background: #1DB954; 
          color: white; 
          padding: 15px 30px; 
          text-decoration: none; 
          border-radius: 25px; 
          font-size: 18px;
          display: inline-block;
          margin: 20px;">
          Connect Spotify
        </a>
        
        <footer style="position: absolute; bottom: 10px; left: 0; width: 100%; font-size: 10px; color: white;"> 
          MMC - Spotify Player Plug-in Created by Saori Suki, a Second Life User
        </footer>

    </body>
    </html>
  `);
});

// Login - Gera estado único para cada usuário
app.get('/login', (req, res) => {
  const { user } = req.query;
  if (!user) {
    return res.status(400).send('User ID required');
  }
  
  const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
  const state = `user_${user}_${Date.now()}`; // Estado único por usuário
  
  // Salvar estado temporariamente
  redisClient.set(`state:${state}`, user, { EX: 300 }); // Expira em 5 min
  
  const authUrl = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authUrl);
});

// Callback - Associa token ao usuário correto
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send('Authentication error');
  }

  try {
    // Verificar estado
    const userId = await redisClient.get(`state:${state}`);
    if (!userId) {
      return res.status(400).send('Invalid state');
    }

    // Trocar código por token
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;
    
    // Salvar sessão do usuário
    const userSession = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000),
      connectedAt: Date.now()
    };
    
    await saveUserSession(userId, userSession);
    
    // Limpar estado
    await redisClient.del(`state:${state}`);
    
    console.log(`✅ Novo usuário conectado: ${userId}`);
    
    // Iniciar updater para este usuário
    setInterval(() => updateUserTrack(userId), 3000);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>MMC - Spotify Player</title>
      </head>
      <body style="margin: 0; background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
          
          <h2 style="font-size: 32px; color: white; margin-bottom: 10px;">
            MMC - Spotify Player
          </h2>
          
          <h1 style="color: white; font-size: 48px; margin-bottom: 20px;">
            You are now ready to press play <3
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
    res.status(500).send('Authentication failed');
  }
});

// Rota para Second Life - Dados específicos por usuário
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
    // Buscar track atual do Redis
    const trackData = await redisClient.get(`track:${user}`);
    const currentTrack = trackData ? JSON.parse(trackData) : null;
    
    if (currentTrack && !currentTrack.error) {
      res.json({
        success: true,
        ...currentTrack,
        timestamp: Date.now()
      });
    } else {
      // Se não tem dados atualizados, buscar agora
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
    console.error(`❌ Erro na rota /current-track para ${user}:`, error);
    res.json({
      success: false,
      track: 'Server error',
      artist: '',
      progress: 0,
      duration: 0
    });
  }
});

// Status do serviço
app.get('/status', async (req, res) => {
  const keys = await redisClient.keys('user:*');
  const userCount = keys.length;
  
  res.json({
    online: true,
    userCount: userCount,
    memory: await redisClient.info('memory')
  });
});

// ================= INICIAR SERVIDOR =================
app.listen(PORT, () => {
  console.log(`🎵 Servidor Multi-Usuário Spotify rodando na porta ${PORT}`);
  console.log(`👥 Pronto para ${process.env.REDIS_URL ? 'centenas' : 'dezenas'} de usuários`);
});
