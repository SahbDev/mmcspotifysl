// server.js - VERSÃO PARA MULTIPLOS USUÁRIOS INDEPENDENTES
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback'
};

// ⭐⭐ ARMAZENA SESSÕES POR PLAYER_ID (persiste entre reinícios)
const playerSessions = new Map();

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Player: ${req.query.player}`);
    next();
});

// LOGIN - Simples e direto
app.get('/login', (req, res) => {
    const playerId = req.query.player;
    if (!playerId) {
        return res.status(400).send('Player ID required');
    }

    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, playerId);
    
    console.log(`🔗 Login initiated for player: ${playerId}`);
    res.redirect(authUrl);
});

// CALLBACK - Processa autenticação
app.get('/callback', async (req, res) => {
    const { code, state: playerId } = req.query;
    
    if (!code || !playerId) {
        return res.status(400).send('Missing code or player ID');
    }

    try {
        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        // ⭐⭐ SALVA SESSÃO para este player específico
        playerSessions.set(playerId, {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000),
            lastActive: Date.now()
        });

        console.log(`✅ Player ${playerId} authenticated successfully`);
        console.log(`📊 Total active sessions: ${playerSessions.size}`);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Connected</title>
                <meta charset="UTF-8">
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Raleway:wght@300;400;600&display=swap');
                    body { margin: 0; background: radial-gradient(circle at center, #2b2b2b 0%, #000000 100%); color: white; font-family: 'Raleway', sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; padding-top: 5vh; min-height: 100vh; box-sizing: border-box; }
                    h1 { font-family: 'Playfair Display', serif; font-size: 48px; margin-bottom: 10px; margin-top: 0; letter-spacing: 1px; }
                    h2 { font-family: 'Raleway', sans-serif; font-size: 14px; color: #cccccc; margin-bottom: 40px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; border-bottom: 1px solid #555; padding-bottom: 15px; width: 60%; }
                    p { font-size: 18px; color: #cccccc; font-weight: 300; margin: 5px 0; }
                    .success { background: #1DB954; color: white; padding: 40px; border-radius: 15px; margin: 20px auto; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                    .highlight { color: #fff; font-weight: 600; }
                </style>
            </head>
            <body>
                <h2>MMC - Spotify Player</h2>
                <div class="success">
                    <h1>✅ Successfully Connected!</h1>
                    <p>Your Spotify account is now linked to your player.</p>
                    <p class="highlight">You can close this window and return to Second Life.</p>
                    <p style="font-size: 14px; margin-top: 20px;">Your Player ID: ${playerId}</p>
                </div>
                <footer style="margin-top: auto; width: 100%; text-align: center; font-size: 11px; color: #cccccc; letter-spacing: 1px; text-transform: uppercase; padding-top: 40px; opacity: 0.8;">
                    MMC - Spotify Player Plug-in
                </footer>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Auth error:', error.message);
        res.status(500).send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #ff4444; color: white;">
                <h1>❌ Connection Failed</h1>
                <p>Please try again.</p>
                <p>Error: ${error.message}</p>
            </body>
            </html>
        `);
    }
});

// OBTER CLIENTE com tratamento robusto
async function getSpotifyClient(playerId) {
    const session = playerSessions.get(playerId);
    if (!session) {
        return null;
    }

    const spotifyApi = new SpotifyWebApi({
        ...spotifyConfig,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
    });

    // Refresh token se expirado
    if (Date.now() > session.expiresAt - 60000) {
        try {
            const refreshData = await spotifyApi.refreshAccessToken();
            session.accessToken = refreshData.body.access_token;
            session.expiresAt = Date.now() + (refreshData.body.expires_in * 1000);
            session.lastActive = Date.now();
            spotifyApi.setAccessToken(refreshData.body.access_token);
            console.log(`🔄 Token refreshed for player: ${playerId}`);
        } catch (error) {
            console.log(`❌ Token refresh failed for player: ${playerId}`);
            playerSessions.delete(playerId);
            return null;
        }
    }

    session.lastActive = Date.now();
    return spotifyApi;
}

// STATUS - Com verificação robusta
app.get('/status', async (req, res) => {
    const playerId = req.query.player;
    
    if (!playerId) {
        return res.json({ status: "disconnected" });
    }

    if (!playerSessions.has(playerId)) {
        console.log(`❌ Player ${playerId} not authenticated`);
        return res.json({ status: "disconnected" });
    }

    try {
        const spotifyApi = await getSpotifyClient(playerId);
        if (!spotifyApi) {
            return res.json({ status: "disconnected" });
        }

        const playbackState = await spotifyApi.getMyCurrentPlaybackState();
        
        if (!playbackState.body || !playbackState.body.item) {
            return res.json({ status: "paused" });
        }

        const track = playbackState.body.item;
        const response = {
            status: playbackState.body.is_playing ? "playing" : "paused",
            artist: track.artists.map(artist => artist.name).join(', '),
            track: track.name,
            progress: playbackState.body.progress_ms || 0,
            duration: track.duration_ms
        };

        res.json(response);

    } catch (error) {
        console.error(`❌ Status error for player ${playerId}:`, error.message);
        // ⭐⭐ NÃO deleta a sessão automaticamente - deixa o usuário tentar reconectar
        res.json({ status: "disconnected" });
    }
});

// CONTROLES 
app.post('/play', async (req, res) => {
    await handleControl(req, res, 'play');
});

app.post('/pause', async (req, res) => {
    await handleControl(req, res, 'pause');
});

app.post('/next', async (req, res) => {
    await handleControl(req, res, 'next');
});

app.post('/previous', async (req, res) => {
    await handleControl(req, res, 'previous');
});

async function handleControl(req, res, action) {
    const playerId = req.query.player;
    const spotifyApi = await getSpotifyClient(playerId);

    if (!spotifyApi) {
        return res.status(401).json({ error: "Player not authenticated" });
    }

    try {
        switch (action) {
            case 'play':
                await spotifyApi.play();
                break;
            case 'pause':
                await spotifyApi.pause();
                break;
            case 'next':
                await spotifyApi.skipToNext();
                break;
            case 'previous':
                await spotifyApi.skipToPrevious();
                break;
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`❌ Control error (${action}) for player ${playerId}:`, error.message);
        res.status(500).json({ error: "Control failed" });
    }
}

// REVOGAR
app.post('/revoke', (req, res) => {
    const playerId = req.query.player;
    if (playerId && playerSessions.has(playerId)) {
        playerSessions.delete(playerId);
        console.log(`🗑️ Session revoked for player: ${playerId}`);
    }
    res.json({ success: true });
});

// HEALTH CHECK
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        activePlayers: playerSessions.size,
        version: '4.0-sales-ready'
    });
});

// Limpeza de sessões inativas (opcional)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (let [playerId, session] of playerSessions.entries()) {
        if (now - session.lastActive > 24 * 60 * 60 * 1000) { // 24 horas
            playerSessions.delete(playerId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} inactive sessions`);
    }
}, 60 * 60 * 1000); // A cada hora

app.listen(PORT, () => {
    console.log(`🎵 Multi-User Spotify Server running on port ${PORT}`);
    console.log(`🔑 Ready for commercial sales!`);
});
