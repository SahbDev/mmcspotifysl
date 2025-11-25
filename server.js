// server.js
// MMC - Spotify Player for Second Life (multi-avatar tokens)
// Requirements: set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, REDIRECT_URI
// Optional: REDIS_URL to persist tokens across restarts

const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Spotify app config (from env)
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://yourdomain.com/callback';

// Validate
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in env.');
  process.exit(1);
}

// Redis (optional) - to persist user tokens/tracks across restarts
let redisClient = null;
const REDIS_URL = process.env.REDIS_URL || null;
async function initRedis() {
  if (!REDIS_URL) return;
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on('error', (err) => console.error('Redis error', err));
  await redisClient.connect();
  console.log('✅ Redis connected');
}
initRedis().catch(err => {
  console.warn('⚠️ Could not connect to Redis (continuing with in-memory storage).', err.message);
  redisClient = null;
});

// ===== In-memory fallback storage (if no Redis) =====
let userTokens = {};   // userTokens[avatar] = { accessToken, refreshToken, expiresAt }
let userTracks = {};   // userTracks[avatar] = { is_playing, track, artist, album, progress, duration, error, timestamp }

// Helper storage functions (use redis if available)
async function saveTokensForAvatar(avatar, tokensObj) {
  userTokens[avatar] = tokensObj;
  if (redisClient) {
    await redisClient.hSet(`spotify:tokens:${avatar}`, tokensObjToRedis(tokensObj));
  }
}
function tokensObjToRedis(obj) {
  // convert values to strings for redis hset
  return {
    accessToken: obj.accessToken || '',
    refreshToken: obj.refreshToken || '',
    expiresAt: (obj.expiresAt || 0).toString()
  };
}
async function loadTokensForAvatar(avatar) {
  if (redisClient) {
    try {
      const exists = await redisClient.exists(`spotify:tokens:${avatar}`);
      if (exists) {
        const h = await redisClient.hGetAll(`spotify:tokens:${avatar}`);
        return {
          accessToken: h.accessToken || '',
          refreshToken: h.refreshToken || '',
          expiresAt: parseInt(h.expiresAt || '0', 10)
        };
      }
    } catch (err) {
      console.warn('Redis read tokens failed', err);
    }
  }
  // fallback to memory
  return userTokens[avatar] || null;
}
async function saveTrackForAvatar(avatar, trackObj) {
  userTracks[avatar] = trackObj;
  if (redisClient) {
    try {
      await redisClient.hSet(`spotify:track:${avatar}`, {
        is_playing: trackObj.is_playing ? '1' : '0',
        track: trackObj.track || '',
        artist: trackObj.artist || '',
        album: trackObj.album || '',
        progress: (trackObj.progress || 0).toString(),
        duration: (trackObj.duration || 0).toString(),
        error: trackObj.error ? '1' : '0',
        timestamp: (trackObj.timestamp || Date.now()).toString()
      });
    } catch (err) {
      console.warn('Redis save track failed', err.message);
    }
  }
}
async function loadTrackForAvatar(avatar) {
  if (redisClient) {
    try {
      const exists = await redisClient.exists(`spotify:track:${avatar}`);
      if (exists) {
        const h = await redisClient.hGetAll(`spotify:track:${avatar}`);
        return {
          is_playing: h.is_playing === '1',
          track: h.track || 'Nada tocando',
          artist: h.artist || '',
          album: h.album || '',
          progress: parseInt(h.progress || '0', 10),
          duration: parseInt(h.duration || '0', 10),
          error: h.error === '1',
          timestamp: parseInt(h.timestamp || Date.now().toString(), 10)
        };
      }
    } catch (err) {
      console.warn('Redis load track failed', err.message);
    }
  }
  return userTracks[avatar] || null;
}

// Utility: create new SpotifyWebApi instance for operations
function makeSpotifyApiForTokens(tokens) {
  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI
  });
  if (tokens && tokens.accessToken) api.setAccessToken(tokens.accessToken);
  if (tokens && tokens.refreshToken) api.setRefreshToken(tokens.refreshToken);
  return api;
}

// Function to refresh token for a specific avatar if needed
async function ensureValidAccessToken(avatar) {
  const tokens = await loadTokensForAvatar(avatar);
  if (!tokens) return null;
  const now = Date.now();
  // Refresh 60s before expiry
  if (!tokens.expiresAt || now >= (tokens.expiresAt - 60000)) {
    // perform refresh
    const api = makeSpotifyApiForTokens(tokens);
    api.setRefreshToken(tokens.refreshToken);
    try {
      const data = await api.refreshAccessToken();
      const newAccess = data.body.access_token;
      const expiresIn = data.body.expires_in; // seconds
      tokens.accessToken = newAccess;
      tokens.expiresAt = Date.now() + expiresIn * 1000;
      // Save updated tokens
      await saveTokensForAvatar(avatar, tokens);
      console.log(`🔁 Refreshed token for avatar ${avatar}`);
      return tokens;
    } catch (err) {
      console.error(`❌ Failed to refresh token for avatar ${avatar}:`, err.message || err);
      // mark token error
      tokens.error = true;
      await saveTokensForAvatar(avatar, tokens);
      return null;
    }
  }
  return tokens;
}

// Update current track for a single avatar (called on demand or periodically)
async function updateTrackForAvatar(avatar) {
  const tokens = await loadTokensForAvatar(avatar);
  if (!tokens || !tokens.accessToken) {
    // ensure userTracks has empty state
    const empty = {
      is_playing: false,
      track: 'Nenhuma música',
      artist: '',
      album: '',
      progress: 0,
      duration: 0,
      error: false,
      timestamp: Date.now()
    };
    await saveTrackForAvatar(avatar, empty);
    return empty;
  }

  // Ensure valid token (refresh if needed)
  const validTokens = await ensureValidAccessToken(avatar);
  if (!validTokens) {
    const errObj = {
      is_playing: false,
      track: 'Erro de autenticação',
      artist: '',
      album: '',
      progress: 0,
      duration: 0,
      error: true,
      timestamp: Date.now()
    };
    await saveTrackForAvatar(avatar, errObj);
    return errObj;
  }

  // Make a Spotify API client with the (valid) access token
  const api = makeSpotifyApiForTokens(validTokens);
  api.setAccessToken(validTokens.accessToken);

  try {
    const playback = await api.getMyCurrentPlaybackState();
    if (playback.body && playback.body.item) {
      const item = playback.body.item;
      const nowObj = {
        is_playing: !!playback.body.is_playing,
        track: item.name || 'Unknown',
        artist: (item.artists || []).map(a => a.name).join(', '),
        album: item.album ? item.album.name : '',
        progress: playback.body.progress_ms || 0,
        duration: item.duration_ms || 0,
        error: false,
        timestamp: Date.now()
      };
      await saveTrackForAvatar(avatar, nowObj);
      return nowObj;
    } else {
      const pausedObj = {
        is_playing: false,
        track: 'Nada tocando',
        artist: '',
        album: '',
        progress: 0,
        duration: 0,
        error: false,
        timestamp: Date.now()
      };
      await saveTrackForAvatar(avatar, pausedObj);
      return pausedObj;
    }
  } catch (err) {
    console.error(`❌ Error fetching playback for avatar ${avatar}:`, err.message || err);
    const errObj = {
      is_playing: false,
      track: 'Erro ao buscar música',
      artist: '',
      album: '',
      progress: 0,
      duration: 0,
      error: true,
      timestamp: Date.now()
    };
    await saveTrackForAvatar(avatar, errObj);
    return errObj;
  }
}

// ================= EXPRESS ROUTES =================

app.use(express.static('public'));
app.use(express.json());

// Home (simple)
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><meta charset="utf-8"><title>MMC - Spotify Player</title></head>
      <body style="background:#222;color:#fff;font-family:sans-serif;text-align:center;padding:80px;">
        <h1>MMC - Spotify Player (Second Life)</h1>
        <p>Use a URL /login?avatar=UUID para conectar um avatar.</p>
        <p>URL para SL: <code>/current-track?avatar=UUID</code></p>
      </body>
    </html>
  `);
});

// Login route (redirects to Spotify consent)
// Client should call /login?avatar=<UUID>
app.get('/login', (req, res) => {
  const avatar = req.query.avatar;
  if (!avatar) return res.status(400).send('Missing avatar query parameter');
  const scopes = ['user-read-currently-playing','user-read-playback-state'];
  // use state to identify avatar on callback
  const state = avatar;
  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI
  });
  const authUrl = api.createAuthorizeURL(scopes, state, true);
  res.redirect(authUrl);
});

// Callback route (Spotify sends code + state = avatar)
app.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const avatar = state; // we used avatar as state
  if (error) {
    console.error('Spotify callback error:', error);
    return res.status(400).send(`<h1>Erro na autenticação: ${error}</h1>`);
  }
  if (!code || !avatar) {
    return res.status(400).send('<h1>Missing code or avatar</h1>');
  }

  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI
  });

  try {
    const data = await api.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;
    const tokensObj = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000
    };
    // Save tokens per avatar
    await saveTokensForAvatar(avatar, tokensObj);
    // Prime a track fetch
    await updateTrackForAvatar(avatar);

    console.log(`✅ Avatar ${avatar} authenticated`);
    // Send friendly HTML page (you may customize)
    res.send(`
      <html>
        <head><meta charset="utf-8"><title>Connected</title></head>
        <body style="background:#222;color:#fff;font-family:sans-serif;text-align:center;padding:80px;">
          <h1>Conectado com sucesso!</h1>
          <p>Avatar: ${avatar}</p>
          <p>Você já pode fechar esta aba.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error exchanging code:', err.message || err);
    res.status(500).send(`<h1>Erro na autenticação: ${err.message || err}</h1>`);
  }
});

// Route for Second Life to get the current track for a given avatar
app.get('/current-track', async (req, res) => {
  const avatar = req.query.avatar;
  if (!avatar) {
    return res.json({
      success: false,
      track: 'Nenhuma música',
      artist: '',
      progress: 0,
      duration: 0,
      error: true,
      message: 'Missing avatar'
    });
  }

  // Attempt to load track from storage; update first if tokens exist
  const tokens = await loadTokensForAvatar(avatar);
  if (!tokens || !tokens.accessToken) {
    // Not authenticated
    return res.json({
      success: true,
      is_playing: false,
      track: 'Nenhuma música',
      artist: '',
      progress: 0,
      duration: 0
    });
  }

  // Update (this will refresh token if needed)
  const trackObj = await updateTrackForAvatar(avatar);

  // Return simplified JSON compatible with your LSL parser
  res.json({
    success: true,
    is_playing: trackObj.is_playing,
    track: trackObj.track,
    artist: trackObj.artist,
    album: trackObj.album,
    progress: trackObj.progress,
    duration: trackObj.duration,
    timestamp: trackObj.timestamp
  });
});

// Status route for debug
app.get('/status', async (req, res) => {
  res.json({
    authenticatedCount: Object.keys(userTokens).length,
    trackedCount: Object.keys(userTracks).length
  });
});

// Logout for avatar (optional)
app.get('/logout', async (req, res) => {
  const avatar = req.query.avatar;
  if (!avatar) return res.status(400).send('Missing avatar');
  // delete from redis & memory
  delete userTokens[avatar];
  delete userTracks[avatar];
  if (redisClient) {
    await redisClient.del(`spotify:tokens:${avatar}`);
    await redisClient.del(`spotify:track:${avatar}`);
  }
  res.send(`<h1>Desconectado: ${avatar}</h1>`);
});

// Start periodic updater: try to update all authenticated avatars every X seconds
const UPDATE_INTERVAL_MS = 3000; // 3s (same cadence as before)
setInterval(async () => {
  try {
    // compute list of avatars to update (from redis or memory)
    let avatars = Object.keys(userTokens);
    if (redisClient) {
      // attempt to read keys pattern (may be slow on large datasets)
      try {
        const keys = await redisClient.keys('spotify:tokens:*');
        const redisAvatars = keys.map(k => k.replace('spotify:tokens:', ''));
        avatars = Array.from(new Set([...avatars, ...redisAvatars]));
      } catch (err) {
        // fallback: keep in-memory avatars only
      }
    }
    for (const avatar of avatars) {
      // Update but don't await serially for long blocking; we await to handle errors gracefully but could parallelize
      await updateTrackForAvatar(avatar).catch(err => console.warn('Updater error', err && err.message));
    }
  } catch (err) {
    console.error('Updater loop error', err.message || err);
  }
}, UPDATE_INTERVAL_MS);

// start server
app.listen(PORT, () => {
  console.log(`🎵 Servidor Spotify rodando na porta ${PORT}`);
  console.log(`📡 URL para SL: https://<SEU_DOMINIO_AQUI>/current-track?avatar=<UUID>`);
});
