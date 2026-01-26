const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// ==== SUAS CHAVES ====
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "bb4c46d3e3e549bb9ebf5007e89a5c9e";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "f1090563300d4a598dbb711d39255499";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://mmcspotifysl.onrender.com/callback";

// Banco de dados em memória
const usersDB = {}; 

app.use(express.json());
app.use(express.static("public"));

function getApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

// ==== ROTA 1: LOGIN ====
app.get("/login", (req, res) => {
    const uuid = req.query.uuid;
    if (!uuid) return res.send("Erro: Faltando UUID");

    const api = getApi();
    const scopes = ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state"];
    res.redirect(api.createAuthorizeURL(scopes, uuid, true));
});

// ==== ROTA 2: CALLBACK ====
app.get("/callback", async (req, res) => {
    const { code, state: uuid } = req.query;
    if (!code || !uuid) return res.send("Erro: Dados faltando.");

    try {
        const api = getApi();
        const data = await api.authorizationCodeGrant(code);

        usersDB[uuid] = {
            token: data.body.access_token,
            refresh: data.body.refresh_token,
            expires: Date.now() + (data.body.expires_in * 1000)
        };

        res.send(`<body style="background:#000;color:#1DB954;text-align:center;font-family:sans-serif;padding-top:50px;"><h1>Connected!</h1><p>You can close this window.</p><script>setTimeout(window.close, 3000);</script></body>`);
    } catch (e) { res.send("Error: " + e.message); }
});

// ==== ROTA 3: CONTROLE ====
app.get("/control", async (req, res) => {
    const { uuid, cmd } = req.query;
    if (!usersDB[uuid]) return res.status(401).send("Not logged");
    
    const api = getApi();
    api.setAccessToken(usersDB[uuid].token);
    
    // Auto-Refresh rápido
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            api.setRefreshToken(usersDB[uuid].refresh);
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) { console.log("Refresh error"); }
    }

    try {
        if (cmd === "next") await api.skipToNext();
        if (cmd === "prev") await api.skipToPrevious();
        if (cmd === "pause") await api.pause();
        if (cmd === "play") await api.play();
        res.send("OK");
    } catch (e) { res.send("Error"); }
});

// ==== ROTA 4: TRACK INFO ====
app.get("/current-track", async (req, res) => {
    const { uuid } = req.query;
    if (!usersDB[uuid]) return res.json({ track: "Not connected", error_code: "NOT_LOGGED" });

    const api = getApi();
    api.setAccessToken(usersDB[uuid].token);

    // Auto-Refresh
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            api.setRefreshToken(usersDB[uuid].refresh);
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) { return res.json({ track: "Session Expired", error_code: "REFRESH" }); }
    }

    try {
        const playback = await api.getMyCurrentPlaybackState();
        
        if (!playback.body || !playback.body.item) {
            return res.json({ is_playing: "false", track: "Nothing Playing", duration: 0, progress: 0 });
        }

        const item = playback.body.item;
        const artist = item.artists ? item.artists.map(a => a.name).join(", ") : "Unknown";
        
        // Conversão para Texto (Blindagem contra bug do SL)
        const playingStatus = playback.body.is_playing ? "true" : "false";

        return res.json({
            is_playing: playingStatus, 
            track: item.name,
            artist: artist,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });
    } catch (e) { return res.json({ track: "API Error", error_code: "API" }); }
});

// ==== ROTA 5: LOGOUT (ESSENCIAL PARA O BOTÃO RESET) ====
app.get("/logout", (req, res) => {
    const { uuid } = req.query;
    if (usersDB[uuid]) {
        delete usersDB[uuid]; // Apaga o usuário da memória
    }
    res.send("Logged out");
});

app.listen(PORT, () => console.log("Server Running"));
