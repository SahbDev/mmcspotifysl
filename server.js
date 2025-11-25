// server.js - VERSÃO MULTI-USUÁRIO
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback'
};

// ⭐⭐ ARMAZENA POR PLAYER_ID único (não por user UUID)
const playerSessions = new Map();

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Player: ${req.query.player}`);
    next();
});

// LOGIN - usa player_id em vez de user
app.get('/login', (req, res) => {
    const playerId = req.query.player;
    if (!playerId) {
        return res.status(400).send('Player ID required');
    }

    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    // ⭐⭐ Passa player_id como state para recuperar depois
    const authUrl = spotifyApi.createAuthorizeURL(scopes, playerId);
    
    res.redirect(authUrl);
});

// CALLBACK - agora usa player_id do state
app.get('/callback', async (req, res) => {
    const { code, state: playerId } = req.query;
    
    try {
        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        // ⭐⭐ Salva sessão usando player_id único
        playerSessions.set(playerId, {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000)
        });

        console.log(`✅ Player ${playerId} authenticated successfully`);

        res.send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #1DB954; color: white;">
                <div style="background: white; color: #1DB954; padding: 30px; border-radius: 10px; margin: 20px auto; max-width: 400px;">
                    <h1>✅ Connected!</h1>
                    <p>Your Spotify is now linked to this player.</p>
                    <p>Close this window and return to Second Life.</p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).send('Authentication failed');
    }
});

// OBTER CLIENTE por player_id
async function getSpotifyClient(playerId) {
    const session = playerSessions.get(playerId);
    if (!session) {
        console.log(`❌ No session found for player: ${playerId}`);
        return null;
    }

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
            console.log(`🔄 Token refreshed for player: ${playerId}`);
        } catch (error) {
            console.log(`❌ Token refresh failed for player: ${playerId}`);
            playerSessions.delete(playerId);
            return null;
        }
    }

    return spotifyApi;
}

// STATUS - agora usa player_id
app.get('/status', async (req, res) => {
    const playerId = req.query.player;
    
    if (!playerId || !playerSessions.has(playerId)) {
        console.log(`❌ Player ${playerId} not authenticated`);
        return res.json({ status: "disconnected" });
    }

    try {
        const spotifyApi = await getSpotifyClient(playerId);
        if (!spotifyApi) {
            playerSessions.delete(playerId);
            return res.json({ status: "disconnected" });
        }

        const playbackState = await spotifyApi.getMyCurrentPlaybackState();
        
        if (!playbackState.body || !playbackState.body.item) {
            console.log(`⏸️ No playback for player: ${playerId}`);
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

        console.log(`✅ Player ${playerId}: ${response.status} - ${response.artist} - ${response.track}`);
        res.json(response);

    } catch (error) {
        console.error(`❌ Status error for player ${playerId}:`, error.message);
        playerSessions.delete(playerId);
        res.json({ status: "disconnected" });
    }
});

// CONTROLES - atualizados para player_id
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

// Função de controle atualizada
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
        console.log(`✅ Control ${action} executed for player: ${playerId}`);
        res.json({ success: true });
    } catch (error) {
        console.error(`❌ Control error (${action}) for player ${playerId}:`, error.message);
        res.status(500).json({ error: "Control failed" });
    }
}

// REVOGAR - atualizado para player_id
app.post('/revoke', (req, res) => {
    const playerId = req.query.player;
    if (playerId && playerSessions.has(playerId)) {
        playerSessions.delete(playerId);
        console.log(`🗑️ Session revoked for player: ${playerId}`);
    }
    res.json({ success: true });
});

// HEALTH CHECK com info de players
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        activePlayers: playerSessions.size,
        version: '3.0-multiplayer' 
    });
});

app.listen(PORT, () => {
    console.log(`🎵 Multi-User Spotify Server running on port ${PORT}`);
    console.log(`🔑 Client ID: ${process.env.SPOTIFY_CLIENT_ID ? '✅' : '❌'}`);
});
