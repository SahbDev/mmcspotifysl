// server.js - VERSÃO 100% FUNCIONAL
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback'
};

// SIMPLES: Armazena por UUID do usuário
const userSessions = {};

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - User: ${req.query.user}`);
    next();
});

// LOGIN - Direto e simples
app.get('/login', (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).send('User ID required');

    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, userId);
    
    console.log(`🔗 Login for user: ${userId}`);
    res.redirect(authUrl);
});

// CALLBACK - Simples e funcional
app.get('/callback', async (req, res) => {
    const { code, state: userId } = req.query;
    
    try {
        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        // Salva sessão do usuário
        userSessions[userId] = {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000)
        };

        console.log(`✅ User ${userId} connected`);
        console.log(`📊 Total users: ${Object.keys(userSessions).length}`);

        res.send(`
            <html>
            <head><title>Connected</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #1DB954; color: white;">
                <div style="background: white; color: #1DB954; padding: 30px; border-radius: 10px; margin: 0 auto; max-width: 400px;">
                    <h1>✅ Connected!</h1>
                    <p>Your Spotify is now linked.</p>
                    <p><strong>Close this window and return to Second Life.</strong></p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).send('Authentication failed');
    }
});

// STATUS - Simples e direto
app.get('/status', async (req, res) => {
    const userId = req.query.user;
    
    if (!userId || !userSessions[userId]) {
        return res.json({ status: "disconnected" });
    }

    try {
        const session = userSessions[userId];
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
            } catch (error) {
                delete userSessions[userId];
                return res.json({ status: "disconnected" });
            }
        }

        const playbackState = await spotifyApi.getMyCurrentPlaybackState();
        
        if (!playbackState.body || !playbackState.body.item) {
            return res.json({ status: "paused" });
        }

        const track = playbackState.body.item;
        res.json({
            status: playbackState.body.is_playing ? "playing" : "paused",
            artist: track.artists.map(artist => artist.name).join(', '),
            track: track.name,
            progress: playbackState.body.progress_ms || 0,
            duration: track.duration_ms
        });

    } catch (error) {
        console.error(`Status error for ${userId}:`, error.message);
        delete userSessions[userId];
        res.json({ status: "disconnected" });
    }
});

// CONTROLES - Super simples
app.post('/play', async (req, res) => {
    await controlPlayer(req, res, 'play');
});

app.post('/pause', async (req, res) => {
    await controlPlayer(req, res, 'pause');
});

app.post('/next', async (req, res) => {
    await controlPlayer(req, res, 'next');
});

app.post('/previous', async (req, res) => {
    await controlPlayer(req, res, 'previous');
});

async function controlPlayer(req, res, action) {
    const userId = req.query.user;
    if (!userId || !userSessions[userId]) {
        return res.status(401).json({ error: "Not connected" });
    }

    try {
        const session = userSessions[userId];
        const spotifyApi = new SpotifyWebApi({
            ...spotifyConfig,
            accessToken: session.accessToken
        });

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
}

// HEALTH CHECK
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        activeUsers: Object.keys(userSessions).length,
        version: 'ULTRA-SIMPLE'
    });
});

app.listen(PORT, () => {
    console.log(`🎵 ULTRA-SIMPLE Spotify Server running on port ${PORT}`);
});
