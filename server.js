const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// ==== CONFIG ====
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "bb4c46d3e3e549bb9ebf5007e89a5c9e";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "f1090563300d4a598dbb711d39255499";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://mmcspotifysl.onrender.com/callback";

const usersDB = {}; // memory DB

app.use(express.json());
app.use(express.static("public"));

function getApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

// ==== LOGIN ====
app.get("/login", (req, res) => {
    const uuid = req.query.uuid;

    if (!uuid) return res.send("Missing UUID");

    const api = getApi();
    const scopes = [
        "user-read-currently-playing",
        "user-read-playback-state"
    ];

    const url = api.createAuthorizeURL(scopes, uuid, true);
    res.redirect(url);
});

// ==== CALLBACK ====
app.get("/callback", async (req, res) => {
    const code = req.query.code;
    const uuid = req.query.state;

    if (!code || !uuid) return res.send("Error: Missing data");

    try {
        const api = getApi();
        const data = await api.authorizationCodeGrant(code);

        usersDB[uuid] = {
            token: data.body.access_token,
            refresh: data.body.refresh_token,
            expires: Date.now() + (data.body.expires_in * 1000)
        };

        res.send(`
            <body style="background:#121212;color:white;text-align:center;padding-top:40px;font-family:sans-serif">
            <h1 style="color:#1DB954">Connected!</h1>
            <p><b>${uuid}</b> linked successfully.</p>
            <p>You may close this window.</p>
            </body>
        `);

    } catch (e) {
        res.send("Login error: " + e.message);
    }
});

// ==== CURRENT TRACK (VERSÃO FINAL E 100% FUNCIONAL) ====
app.get("/current-track", async (req, res) => {
    const uuid = req.query.uuid;

    if (!uuid || !usersDB[uuid]) {
        return res.json({
            track: "Not connected",
            artist: "Click to log in",
            error_code: "NOT_LOGGED"
        });
    }

    const api = getApi();
    api.setAccessToken(usersDB[uuid].token);
    api.setRefreshToken(usersDB[uuid].refresh);

    // Refresh token
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) {
            return res.json({
                track: "Session Error",
                artist: "Relog HUD",
                error_code: "REFRESH"
            });
        }
    }

    try {
        const playback = await api.getMyCurrentPlaybackState();

        if (!playback.body) {
            return res.json({
                is_playing: false,
                track: "Nothing playing",
                artist: "",
                progress: 0,
                duration: 0
            });
        }

        const body = playback.body;

        // === Pausado ===
        if (!body.is_playing) {
            return res.json({
                is_playing: false,
                track: "Paused",
                artist: "",
                progress: 0,
                duration: 0
            });
        }

        // === Tocando ===
        if (body.item) {
            const item = body.item;

            let artist = "Unknown";
            if (item.artists) artist = item.artists.map(a => a.name).join(", ");
            if (item.show) artist = item.show.name;

            return res.json({
                is_playing: true,
                track: item.name,
                artist: artist,
                progress: body.progress_ms,
                duration: item.duration_ms
            });
        }

        // === fallback ===
        return res.json({
            is_playing: false,
            track: "Nothing playing",
            artist: "",
            progress: 0,
            duration: 0
        });

    } catch (e) {
        return res.json({
            track: "Error",
            artist: e.message,
            error_code: "API"
        });
    }
});

app.listen(PORT, () => console.log("Server running on " + PORT));
