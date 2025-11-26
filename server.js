const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURATIONS ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// === IN-MEMORY DATABASE ===
const usersDB = {}; 

app.use(express.static('public'));
app.use(express.json());

function getSpotifyApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

function formatError(err) {
    try {
        if (!err) return "Unknown Error";
        if (err.body) {
            if (err.body.error_description) return "Spotify: " + err.body.error_description;
            if (err.body.error && err.body.error.message) return "Spotify: " + err.body.error.message;
            if (typeof err.body.error === 'string') return "Spotify: " + err.body.error;
        }
        if (err.message) return err.message;
        return JSON.stringify(err).replace(/[{}"]/g, ' '); 
    } catch (e) {
        return "Internal Error";
    }
}

// === HELPER FUNCTION: AUTHENTICATE AND REFRESH TOKEN (FOR ALL ROUTES) ===
async function getAuthenticatedApi(sl_uuid) {
    if (!sl_uuid || !usersDB[sl_uuid]) return null;

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // Check if the token needs to be refreshed (Refresh Token)
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
            console.log(`[REFRESH] Token refreshed for ${sl_uuid}`);
        } catch (err) {
            console.error(`[REFRESH ERROR] Failed to refresh for ${sl_uuid}`);
            return null;
        }
    }
    return spotifyApi;
}

// === ROUTE 1: LOGIN (WITH CONTROL SCOPE) ===
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    
    if (!sl_uuid) {
        return res.send("ERROR: Missing UUID. Please use the HUD.");
    }
    
    const spotifyApi = getSpotifyApi();
    // Scope includes 'user-modify-playback-state' for Play/Pause/Next
    const scopes = [
        'user-read-currently-playing', 
        'user-read-playback-state', 
        'user-read-playback-position',
        'user-modify-playback-state' 
    ];
    
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid, true);
    res.redirect(authUrl);
});

// === ROUTE 2: CALLBACK (SUCCESS SCREEN) ===
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state; 

    if (error) return res.send(`Error: ${error}`);
    if (!code || !sl_uuid) return res.send(`Critical Error: Missing data.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        console.log(`[LOGIN] Success for: ${sl_uuid}`);
        
        // --- ENGLISH SUCCESS SCREEN (AWESOME!) ---
        res.send(`
            <body style="background:#191414; color:#FFFFFF; font-family:sans-serif; text-align:center; padding-top:100px;">
                <h1 style="color:#1DB954; font-size:48px;">Awesome!</h1>
                <p>Your Spotify Player is ready for use!</p>
                <p style="color:#BBBBBB;">You can close this tab now. Thank you!</p>
            </body>
        `);
    } catch (err) {
        res.send(`Login Failed: ${formatError(err)}`);
    }
});

// === ROUTE 3: FETCH TRACK DATA ===
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const spotifyApi = await getAuthenticatedApi(sl_uuid);

    if (!spotifyApi) {
        // --- ENGLISH RESPONSE ---
        return res.json({ track: 'Not Connected', artist: 'Tap to Log In', error_code: "NOT_LOGGED" });
    }

    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({ is_playing: false, track: 'No music playing', artist: '', progress: 0, duration: 0 });
        }

        const item = playback.body.item;
        if (!item) return res.json({ is_playing: false, track: 'Commercial / Other', artist: 'Spotify', progress: 0, duration: 0 });

        let artistName = "Unknown";
        if (item.artists && item.artists.length > 0) artistName = item.artists.map(a => a.name).join(', ');
        else if (item.show) artistName = item.show.name;

        res.json({
            is_playing: playback.body.is_playing,
            track: item.name,
            artist: artistName,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });

    } catch (err) {
        res.json({ track: `Error: ${formatError(err).substring(0, 40)}...`, artist: `Check Instructions`, error_code: "API_FAIL" });
    }
});

// === CONTROL ROUTES (PLAY/PAUSE/NEXT) ===

app.post('/next', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const spotifyApi = await getAuthenticatedApi(sl_uuid);
    if (!spotifyApi) return res.status(401).send("Not Logged In");

    try {
        await spotifyApi.skipToNext();
        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send(formatError(err));
    }
});

app.post('/previous', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const spotifyApi = await getAuthenticatedApi(sl_uuid);
    if (!spotifyApi) return res.status(401).send("Not Logged In");

    try {
        await spotifyApi.skipToPrevious();
        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send(formatError(err));
    }
});

app.post('/pause', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const spotifyApi = await getAuthenticatedApi(sl_uuid);
    if (!spotifyApi) return res.status(401).send("Not Logged In");

    try {
        await spotifyApi.pause();
        res.send("OK");
    } catch (err) {
        console.error(err); 
        res.status(500).send(formatError(err));
    }
});

app.post('/play', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const spotifyApi = await getAuthenticatedApi(sl_uuid);
    if (!spotifyApi) return res.status(401).send("Not Logged In");

    try {
        await spotifyApi.play();
        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send(formatError(err));
    }
});

app.listen(PORT, () => { console.log(`Server V8 Running on port ${PORT}`); });
