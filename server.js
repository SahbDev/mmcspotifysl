const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURAÇÕES ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI ||
'https://mmcspotifysl.onrender.com/callback';

// === BANCO DE DADOS NA MEMÓRIA ===
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

// === ROTA 1: LOGIN (AGORA COM TRAVA) ===
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    
    if (!sl_uuid) {
        return res.send("ERROR: UUID missing. Use the HUD.");
    }
    
    const spotifyApi = getSpotifyApi();
    // Adicionadas permissões de controle (user-modify-playback-state)
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position', 'user-modify-playback-state'];
    
    // O 'true' no final FORÇA o Spotify a mostrar a tela de login/confirmação
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid, true);
    
    res.redirect(authUrl);
});

// === ROTA 2: CALLBACK ===
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
        
        res.send(`
            <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
                <h1 style="color:#1DB954;">Connected!</h1>
                <p>Account linked to UUID:<br><b>${sl_uuid}</b></p>
                <p style="color:#ccc; font-size:12px;">You can close this window.</p>
            </body>
        `);
    } catch (err) {
        res.send(`Login Failed: ${formatError(err)}`);
    }
});

// === ROTA 3: BUSCAR MÚSICA ===
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    if (!sl_uuid || !usersDB[sl_uuid]) {
        // TRADUÇÃO
        return res.json({ track: 'Not Connected', artist: 'Touch to Log In', error_code: "NOT_LOGGED" });
    }

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // Refresh Token
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            // TRADUÇÃO
            return res.json({ track: `Session Error`, artist: 'Relog HUD', error_code: "REFRESH_ERROR" });
        }
    }

    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        // CORREÇÃO: Usar "Paused / Idle" para o LSL identificar o estado correto (204 = No Content)
        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({ is_playing: false, track: 'Paused / Idle', artist: '', progress: 0, duration: 0 });
        }

        const item = playback.body.item;
        // TRADUÇÃO
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
        // TRADUÇÃO
        res.json({ track: `Error: ${formatError(err).substring(0, 40)}...`, artist: `Check Instructions`, error_code: "API_FAIL" });
    }
});


// === ROTA 4: CONTROLE DE REPRODUÇÃO (NEXT, PREV, PAUSE/PLAY) ===
app.post('/control/:action', async (req, res) => {
    const sl_uuid = req.query.uuid;
    const action = req.params.action;

    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.status(401).json({ error: 'User not logged in.' });
    }

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // Refresh Token check
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            return res.status(401).json({ error: 'REFRESH_ERROR: Could not refresh token.' });
        }
    }

    try {
        let spotifyResponse;
        
        switch (action) {
            case 'next':
                spotifyResponse = await spotifyApi.skipToNext();
                break;
            case 'previous':
                spotifyResponse = await spotifyApi.skipToPrevious();
                break;
            case 'pause':
                // Verifica o estado atual para saber se deve pausar ou tocar
                const playback = await spotifyApi.getMyCurrentPlaybackState();
                if (playback.body && playback.body.is_playing) {
                    spotifyResponse = await spotifyApi.pause(); // Pausa
                } else {
                    spotifyResponse = await spotifyApi.play(); // Toca (Resume)
                }
                break;
            default:
                return res.status(400).json({ error: 'Invalid control action.' });
        }
        
        // Spotify retorna 204 para skip/pause bem-sucedidos
        res.status(200).json({ status: 'ok', action: action, message: `${action} command sent.` });
        
    } catch (err) {
        console.error(`[CONTROL_FAIL] ${sl_uuid} - ${action}: ${formatError(err)}`);
        // Pode ser erro 403 (Permissão negada, dispositivo inativo, etc.)
        res.status(500).json({ error: `Control API Failed: ${formatError(err)}` });
    }
});


app.listen(PORT, () => { console.log(`Server V7 Running on port ${PORT}`); });
