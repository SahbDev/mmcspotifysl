// server.js - VERSÃO SIMPLES (já funciona)
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const PORT = process.env.PORT || 3000;

const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback'
};

const userSessions = new Map();

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

// LOGIN
app.get('/login', (req, res) => {
    const userId = req.query.user;
    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, userId);
    res.redirect(authUrl);
});

// CALLBACK
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

        res.send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #1DB954; color: white;">
                <div style="background: white; color: #1DB954; padding: 30px; border-radius: 10px; margin: 20px auto; max-width: 400px;">
                    <h1>✅ Connected!</h1>
                    <p>Your Spotify is now linked.</p>
                    <p>Close this window and return to Second Life.</p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        res.status(500).send('Authentication failed');
    }
});

// OBTER CLIENTE
async function getSpotifyClient(userId) {
    const session = userSessions.get(userId);
    if (!session) return null;

    const spotifyApi = new SpotifyWebApi({
        ...spotifyConfig,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
    });

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

// STATUS
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
        userSessions.delete(userId);
        res.json({ status: "disconnected" });
    }
});

// CONTROLES
app.post('/play', async (req, res) => {
    const userId = req.query.user;
    const spotifyApi = await getSpotifyClient(userId);
    if (spotifyApi) { await spotifyApi.play(); res.json({ success: true }); } 
    else { res.status(401).json({ error: "Not authenticated" }); }
});

app.post('/pause', async (req, res) => {
    const userId = req.query.user;
    const spotifyApi = await getSpotifyClient(userId);
    if (spotifyApi) { await spotifyApi.pause(); res.json({ success: true }); } 
    else { res.status(401).json({ error: "Not authenticated" }); }
});

app.post('/next', async (req, res) => {
    const userId = req.query.user;
    const spotifyApi = await getSpotifyClient(userId);
    if (spotifyApi) { await spotifyApi.skipToNext(); res.json({ success: true }); } 
    else { res.status(401).json({ error: "Not authenticated" }); }
});

app.post('/previous', async (req, res) => {
    const userId = req.query.user;
    const spotifyApi = await getSpotifyClient(userId);
    if (spotifyApi) { await spotifyApi.skipToPrevious(); res.json({ success: true }); } 
    else { res.status(401).json({ error: "Not authenticated" }); }
});

// REVOGAR
app.post('/revoke', (req, res) => {
    const userId = req.query.user;
    if (userId) userSessions.delete(userId);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🎵 Spotify Server running on port ${PORT}`);
});
