// server.js - VERSÃO PARA TRANSFERÊNCIAS
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback'
};

// ⭐⭐ ARMAZENA SESSÕES - CADA PLAYER_ID É ÚNICO
const playerSessions = new Map();

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Player: ${req.query.player}`);
    next();
});

// ⭐⭐ ROTA DE LOGIN SIMPLIFICADA
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

// ⭐⭐ CALLBACK ROBUSTO
app.get('/callback', async (req, res) => {
    const { code, state: playerId } = req.query;
    
    if (!code || !playerId) {
        return res.status(400).send('Missing code or player ID');
    }

    try {
        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        // ⭐⭐ SALVA NOVA SESSÃO (sobrescreve qualquer sessão anterior)
        playerSessions.set(playerId, {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000),
            createdAt: Date.now()
        });

        console.log(`✅ NEW session created for player: ${playerId}`);
        console.log(`📊 Total active sessions: ${playerSessions.size}`);

        // ⭐⭐ HTML SIMPLES E FUNCIONAL
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Connected</title>
                <meta charset="UTF-8">
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: #1DB954;
                        color: white;
                        margin: 0;
                    }
                    .container {
                        background: white;
                        color: #1DB954;
                        padding: 40px;
                        border-radius: 10px;
                        margin: 0 auto;
                        max-width: 500px;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    }
                    h1 { margin-top: 0; }
                    .player-id {
                        background: #f0f0f0;
                        padding: 10px;
                        border-radius: 5px;
                        font-family: monospace;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Successfully Connected!</h1>
                    <p>Your Spotify account is now linked to your player.</p>
                    <p><strong>You can close this window and return to Second Life.</strong></p>
                    <div class="player-id">Player ID: ${playerId}</div>
                    <p style="font-size: 12px; color: #666;">If you experience issues, click "RECONNECT" in your player menu.</p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Auth error:', error.message);
        res.status(500).send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #ff4444; color: white;">
                <h1>❌ Connection Failed</h1>
                <p>Please try clicking "RECONNECT" in your player.</p>
                <p style="font-size: 12px;">Error: ${error.message}</p>
            </body>
            </html>
        `);
    }
});

// ⭐⭐ FUNÇÃO GET CLIENTE SIMPLIFICADA
async function getSpotifyClient(playerId) {
    const session = playerSessions.get(playerId);
    if (!session) return null;

    const spotifyApi = new SpotifyWebApi({
        ...spotifyConfig,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
    });

    // Refresh token se necessário
    if (Date.now() > session.expiresAt - 60000) {
        try {
            const refreshData = await spotifyApi.refreshAccessToken();
            session.accessToken = refreshData.body.access_token;
            session.expiresAt = Date.now() + (refreshData.body.expires_in * 1000);
            spotifyApi.setAccessToken(refreshData.body.access_token);
        } catch (error) {
            playerSessions.delete(playerId);
            return null;
        }
    }

    return spotifyApi;
}

// ⭐⭐ STATUS ENDPOINT SIMPLIFICADO
app.get('/status', async (req, res) => {
    const playerId = req.query.player;
    
    if (!playerId) {
        return res.json({ status: "disconnected" });
    }

    // ⭐⭐ VERIFICA SE EXISTE SESSÃO
    if (!playerSessions.has(playerId)) {
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
        res.json({ status: "disconnected" });
    }
});

// ⭐⭐ CONTROLES SIMPLIFICADOS
const createControlHandler = (action) => async (req, res) => {
    const playerId = req.query.player;
    const spotifyApi = await getSpotifyClient(playerId);

    if (!spotifyApi) {
        return res.status(401).json({ error: "Not connected" });
    }

    try {
        switch (action) {
            case 'play': await spotifyApi.play(); break;
            case 'pause': await spotifyApi.pause(); break;
            case 'next': await spotifyApi.skipToNext(); break;
            case 'previous': await spotifyApi.skipToPrevious(); break;
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Control failed" });
    }
};

app.post('/play', createControlHandler('play'));
app.post('/pause', createControlHandler('pause'));
app.post('/next', createControlHandler('next'));
app.post('/previous', createControlHandler('previous'));

// ⭐⭐ REVOKE - LIMPA SESSÃO
app.post('/revoke', (req, res) => {
    const playerId = req.query.player;
    if (playerId) {
        playerSessions.delete(playerId);
        console.log(`🗑️ Session revoked for player: ${playerId}`);
    }
    res.json({ success: true });
});

// ⭐⭐ HEALTH CHECK
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        activePlayers: playerSessions.size,
        version: '5.0-transfer-ready',
        message: 'Ready for commercial sales!'
    });
});

app.listen(PORT, () => {
    console.log(`🎵 Spotify Transfer-Ready Server running on port ${PORT}`);
    console.log(`🔑 Configured for: ${process.env.SPOTIFY_CLIENT_ID ? 'PRODUCTION' : 'DEVELOPMENT'}`);
});
