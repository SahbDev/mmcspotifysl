const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// O servidor agora é NEUTRO. Não tem chaves fixas.
const REDIRECT_URI = process.env.REDIRECT_URI || "https://mmcspotifysl.onrender.com/callback";

// Banco de dados em memória
// Estrutura: { "UUID": { token, refresh, expires, clientId, clientSecret } }
const usersDB = {}; 

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para ler o formulário
app.use(express.static("public"));

// Rota principal (Página de Setup)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==== PASSO 1: O HUD Manda o Cliente pra cá ====
// Em vez de redirecionar direto pro Spotify, agora mostramos a página de Setup
app.get("/login", (req, res) => {
    const uuid = req.query.uuid;
    if (!uuid) return res.send("Error: Missing UUID from Second Life.");
    
    // Manda o usuário para a página de preencher chaves (index.html)
    // Passamos o UUID na URL para o front-end pegar
    res.redirect(`/?uuid=${uuid}`);
});

// ==== PASSO 2: O Cliente envia as chaves dele (Formulário) ====
app.post("/connect", (req, res) => {
    const { uuid, clientId, clientSecret } = req.body;

    if (!uuid || !clientId || !clientSecret) {
        return res.send("Error: Missing fields. Please fill everything.");
    }

    // Salvamos as credenciais do cliente (Temporariamente sem token)
    usersDB[uuid] = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        token: null
    };

    // Criamos o objeto da API com as chaves DELE
    const api = new SpotifyWebApi({
        clientId: usersDB[uuid].clientId,
        clientSecret: usersDB[uuid].clientSecret,
        redirectUri: REDIRECT_URI
    });

    const scopes = [
        "user-read-currently-playing", 
        "user-read-playback-state", 
        "user-modify-playback-state"
    ];

    // Agora sim, mandamos ele pro Spotify autenticar
    const authorizeURL = api.createAuthorizeURL(scopes, uuid, true);
    res.redirect(authorizeURL);
});

// ==== PASSO 3: O Spotify devolve o usuário ====
app.get("/callback", async (req, res) => {
    const code = req.query.code;
    const uuid = req.query.state; // Recuperamos o UUID pelo 'state'

    if (!code || !uuid || !usersDB[uuid]) {
        return res.send("Error: Session expired or invalid data. Please try again via HUD.");
    }

    try {
        // Recriamos a API usando as credenciais salvas desse usuário específico
        const api = new SpotifyWebApi({
            clientId: usersDB[uuid].clientId,
            clientSecret: usersDB[uuid].clientSecret,
            redirectUri: REDIRECT_URI
        });

        const data = await api.authorizationCodeGrant(code);

        // Atualizamos o DB com os tokens
        usersDB[uuid].token = data.body.access_token;
        usersDB[uuid].refresh = data.body.refresh_token;
        usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);

        res.send(`
            <body style="background:#000;color:white;font-family:sans-serif;text-align:center;padding-top:50px;">
                <h1 style="color:#1DB954">Connected Successfully!</h1>
                <p>Private Tunnel Established.</p>
                <p>Your UUID: <b>${uuid}</b></p>
                <p>You can close this window now.</p>
            </body>
        `);

    } catch (e) {
        console.error(e);
        res.send(`Error during connection: ${e.message}. Check if your Client ID/Secret are correct and Redirect URI is set to: ${REDIRECT_URI}`);
    }
});

// Função auxiliar para pegar a API já configurada do usuário
async function getUserApi(uuid) {
    if (!usersDB[uuid]) return null;

    const api = new SpotifyWebApi({
        clientId: usersDB[uuid].clientId,
        clientSecret: usersDB[uuid].clientSecret,
        redirectUri: REDIRECT_URI
    });

    api.setAccessToken(usersDB[uuid].token);
    api.setRefreshToken(usersDB[uuid].refresh);

    // Auto-Refresh se necessário
    if (Date.now() >= usersDB[uuid].expires - 60000) {
        try {
            const data = await api.refreshAccessToken();
            usersDB[uuid].token = data.body.access_token;
            usersDB[uuid].expires = Date.now() + (data.body.expires_in * 1000);
            api.setAccessToken(data.body.access_token);
        } catch (e) {
            console.log("Refresh Error:", e);
            return null; // Token morreu
        }
    }
    return api;
}

// ==== CONTROLE (Play/Pause) ====
app.get("/control", async (req, res) => {
    const { uuid, cmd } = req.query;
    const api = await getUserApi(uuid);

    if (!api) return res.status(401).send("Not connected or expired");

    try {
        if (cmd === "next") await api.skipToNext();
        else if (cmd === "prev") await api.skipToPrevious();
        else if (cmd === "pause") await api.pause();
        else if (cmd === "play") await api.play();
        res.send("OK");
    } catch (e) {
        res.send("Error: " + e.message);
    }
});

// ==== FAIXA ATUAL (Para o HUD) ====
app.get("/current-track", async (req, res) => {
    const { uuid } = req.query;
    
    // Se não tiver registro no DB, pede login
    if (!usersDB[uuid]) {
        return res.json({
            track: "Not connected",
            artist: "Click to set-up",
            error_code: "NOT_LOGGED"
        });
    }

    const api = await getUserApi(uuid);
    if (!api) {
        return res.json({ track: "Session Expired", artist: "Relog HUD", error_code: "REFRESH" });
    }

    try {
        const playback = await api.getMyCurrentPlaybackState();

        if (!playback.body || !playback.body.item) {
            return res.json({ is_playing: false, track: "Nothing playing", artist: "", progress: 0, duration: 0 });
        }

        const item = playback.body.item;
        let artist = "Unknown";
        if (item.artists) artist = item.artists.map(a => a.name).join(", ");
        else if (item.show) artist = item.show.name;

        return res.json({
            is_playing: playback.body.is_playing,
            track: item.name,
            artist: artist,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });

    } catch (e) {
        return res.json({ track: "Error", artist: "API Error", error_code: "API" });
    }
});

app.listen(PORT, () => console.log("MMC Server running on " + PORT));
