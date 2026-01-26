const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// ==== CONFIGURAÇÕES (Suas chaves já estão aqui) ====
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "bb4c46d3e3e549bb9ebf5007e89a5c9e";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "f1090563300d4a598dbb711d39255499";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://mmcspotifysl.onrender.com/callback";

// Banco de dados temporário (em memória)
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
    if (!uuid) return res.send("Erro: Faltando UUID (Second Life ID)");

    const api = getApi();
    // Permissões necessárias: ler o que toca e controlar (play/pause)
    const scopes = [
        "user-read-currently-playing", 
        "user-read-playback-state", 
        "user-modify-playback-state"
    ];

    const url = api.createAuthorizeURL(scopes, uuid, true);
    res.redirect(url);
});

// ==== ROTA 2: CALLBACK (Onde o Spotify devolve o login) ====
app.get("/callback", async (req, res) => {
    const code = req.query.code;
    const uuid = req.query.state;

    if (!code || !uuid) return res.send("Erro: Dados faltando no retorno do Spotify");

    try {
        const api = getApi();
        const data = await api.authorizationCodeGrant(code);

        // Salva o token do usuário
        usersDB[uuid] = {
            token: data.body.access_token,
            refresh: data.body.refresh_token,
            expires: Date.now() + (data.body.expires_in * 1000)
        };

        res.send(`
            <body style="background:#121212;color:white;text-align:center;padding-top:40px;font-family:sans-serif">
            <h1 style="color:#1DB954">Conectado com Sucesso!</h1>
            <p>O UUID <b>${uuid}</b> foi vinculado.</p>
            <p>Você já pode fechar esta janela e voltar para o Second Life.</p>
            </body>
        `);

    } catch (e) {
        res.send("Erro no Login: " + e.message);
    }
});

// ==== ROTA 3: CONTROLE (Play, Pause, Next) ====
app.get("/control", async (req, res) => {
    const uuid = req.query.uuid;
    const cmd = req.query.cmd; // Comandos: play, pause, next, prev

    if (!uuid || !usersDB[uuid]) return res.status(401).send("Não conectado");

    const api = getApi();
    api.setAccessToken(usersDB[uuid].token);
    api.setRefreshToken(usersDB[uuid].refresh);

    // Renovação automática do token se estiver vencendo
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) {
            console.log("Erro ao renovar token no controle:", e);
        }
    }

    try {
        if (cmd === "next") await api.skipToNext();
        else if (cmd === "prev") await api.skipToPrevious();
        else if (cmd === "pause") await api.pause();
        else if (cmd === "play") await api.play();
        
        res.send("OK");
    } catch (e) {
        // Ignora erros comuns (ex: dar play quando já está tocando)
        res.send("Erro no comando: " + e.message);
    }
});

// ==== ROTA 4: TRACK ATUAL (Para o HUD) ====
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

    // Renovação automática do token
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) {
            return res.json({ track: "Session Error", artist: "Relog HUD", error_code: "REFRESH" });
        }
    }

    try {
        const playback = await api.getMyCurrentPlaybackState();

        // Se nada estiver tocando ou o player estiver fechado
        if (!playback.body || !playback.body.item) {
            return res.json({
                is_playing: false,
                track: "Nothing playing",
                artist: "",
                progress: 0,
                duration: 0
            });
        }

        const body = playback.body;
        const item = body.item;
        let artist = "Unknown";
        
        // Formata o nome do artista
        if (item.artists) artist = item.artists.map(a => a.name).join(", ");
        else if (item.show) artist = item.show.name;

        return res.json({
            is_playing: body.is_playing,
            track: item.name,
            artist: artist,
            progress: body.progress_ms,
            duration: item.duration_ms
        });

    } catch (e) {
        return res.json({ track: "Error", artist: e.message, error_code: "API" });
    }
});

app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
