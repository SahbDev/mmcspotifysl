const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Spotify
const spotifyConfig = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
};

// Banco de dados em memória (Map)
const sessionStore = new Map();

app.use(express.json());

// --- FUNÇÕES AUXILIARES ---

function getClientForUser(session) {
    const client = new SpotifyWebApi({
        clientId: spotifyConfig.clientId,
        clientSecret: spotifyConfig.clientSecret
    });
    client.setAccessToken(session.accessToken);
    client.setRefreshToken(session.refreshToken);
    return client;
}

async function ensureValidToken(uuid, session) {
    if (Date.now() >= session.expiresAt - 60000) {
        console.log(`[${uuid.slice(0,8)}] Renovando token...`);
        const client = getClientForUser(session);
        try {
            const data = await client.refreshAccessToken();
            session.accessToken = data.body['access_token'];
            if (data.body['expires_in']) {
                session.expiresAt = Date.now() + (data.body['expires_in'] * 1000);
            }
            sessionStore.set(uuid, session);
            return session.accessToken;
        } catch (err) {
            console.error(`[${uuid.slice(0,8)}] Erro na renovação:`, err.message);
            return null;
        }
    }
    return session.accessToken;
}

// --- ROTAS ---

// Página inicial
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

// Login
app.get('/login', (req, res) => {
    const slUser = req.query.user;
    if (!slUser) return res.status(400).send("Erro: UUID do usuário obrigatório.");

    const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
    const authUrl = (new SpotifyWebApi(spotifyConfig)).createAuthorizeURL(scopes, slUser);
    res.redirect(authUrl);
});

// Callback
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const slUser = state;

    if (error || !slUser) return res.status(400).send(`Erro na autenticação: ${error}`);

    try {
        const data = await (new SpotifyWebApi(spotifyConfig)).authorizationCodeGrant(code);
        const { access_token, refresh_token, expires_in } = data.body;

        sessionStore.set(slUser, {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt: Date.now() + (expires_in * 1000),
            connectedAt: Date.now()
        });

        console.log(`🎉 NOVA SESSÃO: ${slUser}`);
        
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
    } catch (err) {
        console.error('❌ Erro na autenticação:', err);
        res.status(500).send(`Erro fatal: ${err.message}`);
    }
});

// API de dados para LSL
app.get('/current-track', async (req, res) => {
    const slUser = req.query.user;
    if (!slUser) return res.json({ error: "User required", is_connected: false });

    const session = sessionStore.get(slUser);
    if (!session) return res.json({ error: "Not connected", is_connected: false });

    const validToken = await ensureValidToken(slUser, session);
    if (!validToken) return res.json({ error: "Auth expired", is_connected: false });

    const client = getClientForUser(session);
    
    try {
        const playback = await client.getMyCurrentPlaybackState();
        
        if (playback.body && playback.body.item) {
            const track = playback.body.item;
            res.json({
                is_connected: true,
                is_playing: playback.body.is_playing,
                track: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                progress: playback.body.progress_ms || 0,
                duration: track.duration_ms || 0,
                error: false
            });
        } else {
            res.json({
                is_connected: true,
                is_playing: false,
                track: "Nada tocando",
                artist: "",
                progress: 0,
                duration: 0,
                error: false
            });
        }
    } catch (err) {
        console.error(`[${slUser.slice(0,8)}] Erro na API:`, err.message);
        res.json({ 
            error: "API Error", 
            is_connected: true,
            track: "Erro de conexão",
            artist: "",
            progress: 0,
            duration: 0
        });
    }
});

// Status
app.get('/status', (req, res) => {
    res.json({
        online: true,
        userCount: sessionStore.size,
        memory: process.memoryUsage(),
        uptime: process.uptime()
    });
});

// Health
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: Date.now(),
        version: '3.0-multi-tenant'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 SPOTIFY MULTI-TENANT SERVER rodando na porta ${PORT}`);
    console.log(`🔍 Status: https://mmcspotifysl.onrender.com/status`);
    console.log(`❤️  Health: https://mmcspotifysl.onrender.com/health`);
});
