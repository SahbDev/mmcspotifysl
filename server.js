const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const port = process.env.PORT || 3000;

// BANCO DE DADOS EM MEMÓRIA (Multi-Usuário)
const users = {};

function getClient() {
    return new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.REDIRECT_URI
    });
}

// 1. LOGIN (Recebe ID do Avatar)
app.get('/login', (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.send("Erro: ID do avatar faltando.");

    const scopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
    const client = getClient();
    // O 'state' carrega o ID do avatar para a volta
    res.redirect(client.createAuthorizeURL(scopes, userId));
});

// 2. CALLBACK (Salva o Token e Mostra seu Site Bonito)
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; // state = userId
    const userId = state;

    if (!userId) return res.send("Erro Fatal: ID perdido.");

    try {
        const client = getClient();
        const data = await client.authorizationCodeGrant(code);

        // Salva na memória
        users[userId] = {
            access: data.body.access_token,
            refresh: data.body.refresh_token,
            expires: Date.now() + (data.body.expires_in * 1000)
        };

        // SEU HTML VISUAL (Aprovado)
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
                @keyframes pulse { 0% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.02); opacity: 1; } 100% { transform: scale(1); opacity: 0.9; } }
                body { margin: 0; background: radial-gradient(circle at center, #2b2b2b 0%, #000000 100%); color: white; font-family: 'Montserrat', sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; padding-top: 5vh; min-height: 100vh; }
                h1 { font-size: 42px; margin-bottom: 10px; animation: pulse 3s infinite ease-in-out; }
                h2 { font-size: 24px; color: #cccccc; margin-bottom: 30px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid #555; padding-bottom: 15px; width: 60%; }
                p { font-size: 18px; color: #cccccc; margin: 5px 0; }
                .menu-preview { margin-top: 25px; margin-bottom: 15px; max-width: 85%; width: 420px; border-radius: 12px; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.7); }
                .instruction { font-size: 14px; color: #cccccc; margin-top: 10px; }
                footer { margin-top: auto; width: 100%; font-size: 11px; color: rgba(255, 255, 255, 0.5); padding-bottom: 20px; }
            </style>
            </head>
            <body>
            <h2>MMC - Spotify Player</h2>
            <h1>You are now ready to press play <span style="color: #ff6b6b;">&lt;3</span></h1>
            <p>Your Spotify Player is ready to use!</p>
            <p style="font-size: 16px;">You can now close this tab. Thank you!</p>
            <img src="https://i.gyazo.com/fad06bc27b3dd7752587726c4a83b4cf.png" class="menu-preview">
            <p class="instruction">Click on your player to change tracks, pause, customize colors and more.</p>
            <footer>MMC - Spotify Player Plug-in Created by Saori Suki</footer>
            </body>
            </html>
        `);
    } catch (err) {
        res.send("Erro ao autenticar: " + err.message);
    }
});

// 3. CHECAGEM DE STATUS (O Cérebro)
app.get('/status', async (req, res) => {
    const userId = req.query.user;
    
    // SE NÃO TIVER USUÁRIO SALVO, MANDA CONFIGURAR
    if (!userId || !users[userId]) {
        return res.json({ status: "setup_required" });
    }

    const client = getClient();
    client.setAccessToken(users[userId].access);
    client.setRefreshToken(users[userId].refresh);

    // Renova Token se precisar
    if (Date.now() > users[userId].expires - 60000) {
        try {
            const data = await client.refreshAccessToken();
            users[userId].access = data.body.access_token;
            users[userId].expires = Date.now() + (data.body.expires_in * 1000);
            client.setAccessToken(data.body.access_token);
        } catch (err) {
            return res.json({ status: "setup_required" }); // Perdeu acesso -> Setup
        }
    }

    // Pega a música
    try {
        const data = await client.getMyCurrentPlaybackState();
        if (data.body && data.body.is_playing) {
            res.json({
                status: "playing",
                track: data.body.item.name,
                artist: data.body.item.artists.map(a => a.name).join(', '),
                cur: data.body.progress_ms,
                tot: data.body.item.duration_ms
            });
        } else {
            res.json({ status: "paused" });
        }
    } catch (err) {
        res.json({ status: "paused" }); // Erro de API = Pausado (não quebra)
    }
});

// 4. CONTROLES (Play, Pause, Next, Prev)
app.post('/control', async (req, res) => {
    const { user, cmd } = req.query;
    if (!user || !users[user]) return res.sendStatus(401);

    const client = getClient();
    client.setAccessToken(users[user].access);

    try {
        if (cmd === 'play') await client.play();
        if (cmd === 'pause') await client.pause();
        if (cmd === 'next') await client.skipToNext();
        if (cmd === 'prev') await client.skipToPrevious();
        res.send('OK');
    } catch (err) {
        res.sendStatus(200); // Ignora erro para não travar LSL
    }
});

// 5. REVOKE (Limpa usuário)
app.post('/revoke', (req, res) => {
    const userId = req.query.user;
    if (users[userId]) delete users[userId];
    res.send('Deleted');
});

app.listen(port, () => console.log('Server UP'));
