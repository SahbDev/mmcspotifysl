// server.js - VERSÃO COM SUPORTE AO PLAYER VISUAL
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração simples
const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback'
};

// Armazenamento em memória (simples)
const userSessions = new Map();

// Middleware básico
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - User: ${req.query.user}`);
    next();
});

// Rota de login
app.get('/login', (req, res) => {
    const userId = req.query.user;
    if (!userId) {
        return res.status(400).send('User ID required');
    }

    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, userId);
    
    res.redirect(authUrl);
});

// Callback de autenticação
app.get('/callback', async (req, res) => {
    const { code, state: userId } = req.query;
    
    try {
        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        userSessions.set(userId, {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000)
        });

        console.log(`✅ User ${userId} authenticated successfully`);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Connected</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: #1DB954;
                        color: white;
                    }
                    .success { 
                        background: white; 
                        color: #1DB954; 
                        padding: 30px; 
                        border-radius: 10px;
                        margin: 20px auto;
                        max-width: 400px;
                    }
                </style>
            </head>
            <body>
                <div class="success">
                    <h1>✅ Connected!</h1>
                    <p>Your Spotify account is now linked.</p>
                    <p>You can close this window and return to Second Life.</p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Obter cliente do Spotify para usuário
async function getSpotifyClient(userId) {
    const session = userSessions.get(userId);
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
            userSessions.delete(userId);
            return null;
        }
    }

    return spotifyApi;
}

// Rota de status (MANTIDO IGUAL - já funciona perfeitamente)
app.get('/status', async (req, res) => {
    const userId = req.query.user;
    
    if (!userId || !userSessions.has(userId)) {
        return res.json({ status: "disconnected" });
    }

    try {
        const spotifyApi = await getSpotifyClient(userId);
        if (!spotifyApi) {
            userSessions.delete(userId);
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
        console.error('Status error:', error.message);
        userSessions.delete(userId);
        res.json({ status: "disconnected" });
    }
});

// Rotas de controle (MANTIDAS IGUAIS)
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

// Função de controle unificada
async function handleControl(req, res, action) {
    const userId = req.query.user;
    const spotifyApi = await getSpotifyClient(userId);

    if (!spotifyApi) {
        return res.status(401).json({ error: "Not authenticated" });
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
        console.error(`Control error (${action}):`, error.message);
        res.status(500).json({ error: "Control failed" });
    }
}

// Rota de revogação
app.post('/revoke', (req, res) => {
    const userId = req.query.user;
    if (userId && userSessions.has(userId)) {
        userSessions.delete(userId);
        console.log(`🗑️ Session revoked for user ${userId}`);
    }
    res.json({ success: true });
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        users: userSessions.size,
        version: '2.1-player' 
    });
});

app.listen(PORT, () => {
    console.log(`🎵 Spotify Server running on port ${PORT}`);
    console.log(`🔑 Client ID: ${process.env.SPOTIFY_CLIENT_ID ? '✅' : '❌'}`);
});
