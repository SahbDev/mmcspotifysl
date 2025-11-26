const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURAÇÕES ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// === BANCO DE DADOS NA MEMÓRIA ===
const usersDB = {}; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getSpotifyApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

function formatError(err) {
    try {
        if (!err) return "Erro Desconhecido";
        if (err.body) {
            if (err.body.error_description) return "Spotify: " + err.body.error_description;
            if (err.body.error && err.body.error.message) return "Spotify: " + err.body.error.message;
            if (typeof err.body.error === 'string') return "Spotify: " + err.body.error;
        }
        if (err.message) return err.message;
        return JSON.stringify(err).replace(/[{}"]/g, ' '); 
    } catch (e) {
        return "Erro Interno";
    }
}

// === ROTA 1: PÁGINA INICIAL ===
app.get('/', (req, res) => {
    res.send(`
        <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
            <h1 style="color:#1DB954;">🎵 MMC Spotify SL</h1>
            <p>Servidor rodando corretamente!</p>
            <p style="color:#ccc; font-size:12px;">Use o HUD no Second Life para conectar.</p>
        </body>
    `);
});

// === ROTA 2: LOGIN ===
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    
    if (!sl_uuid) {
        return res.send("ERRO: Faltou o UUID. Use o HUD.");
    }
    
    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position', 'user-modify-playback-state'];
    
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid, true);
    
    res.redirect(authUrl);
});

// === ROTA 3: CALLBACK ===
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state; 

    if (error) return res.send(`Erro: ${error}`);
    if (!code || !sl_uuid) return res.send(`Erro Crítico: Dados faltando.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        console.log(`[LOGIN] Sucesso para: ${sl_uuid}`);
        
        res.send(`
            <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
                <h1 style="color:#1DB954;">✅ Conectado!</h1>
                <p>Conta do Spotify vinculada com sucesso!</p>
                <p>UUID: <b>${sl_uuid}</b></p>
                <p style="color:#1DB954;">Agora você pode usar os controles no Second Life!</p>
                <p style="color:#ccc; font-size:12px;">Esta janela pode ser fechada.</p>
            </body>
        `);
    } catch (err) {
        res.send(`Falha no Login: ${formatError(err)}`);
    }
});

// === ROTA 4: BUSCAR MÚSICA ATUAL ===
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.json({ track: 'Não conectado', artist: 'Toque para Logar', error_code: "NOT_LOGGED" });
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
            return res.json({ track: `Erro Sessão`, artist: 'Relogue o HUD', error_code: "REFRESH_ERROR" });
        }
    }

    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({ is_playing: false, track: 'Nada tocando', artist: '', progress: 0, duration: 0 });
        }

        const item = playback.body.item;
        if (!item) return res.json({ is_playing: false, track: 'Comercial / Outro', artist: 'Spotify', progress: 0, duration: 0 });

        let artistName = "Desconhecido";
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
        res.json({ track: `Erro: ${formatError(err).substring(0, 40)}...`, artist: `Verifique Instruções`, error_code: "API_FAIL" });
    }
});

// === ROTA 5: CONTROLES PLAYBACK ===
app.post('/playback-control', async (req, res) => {
    const { uuid, action } = req.body;

    if (!uuid || !usersDB[uuid]) {
        return res.json({ success: false, error: 'Usuário não logado' });
    }

    let user = usersDB[uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    try {
        let result;
        switch (action) {
            case 'play':
                result = await spotifyApi.play();
                break;
            case 'pause':
                result = await spotifyApi.pause();
                break;
            case 'next':
                result = await spotifyApi.skipToNext();
                break;
            case 'previous':
                result = await spotifyApi.skipToPrevious();
                break;
            default:
                return res.json({ success: false, error: 'Ação inválida' });
        }

        res.json({ success: true, message: `Ação ${action} executada` });
    } catch (err) {
        res.json({ success: false, error: formatError(err) });
    }
});

// === ROTA 6: TOGGLE PLAY/PAUSE ===
app.post('/play-pause', async (req, res) => {
    const { uuid } = req.body;

    if (!uuid || !usersDB[uuid]) {
        return res.json({ success: false, error: 'Usuário não logado' });
    }

    let user = usersDB[uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();
        
        if (playback.body && playback.body.is_playing) {
            await spotifyApi.pause();
            res.json({ success: true, action: 'paused', message: 'Música pausada' });
        } else {
            await spotifyApi.play();
            res.json({ success: true, action: 'played', message: 'Música reproduzida' });
        }
    } catch (err) {
        res.json({ success: false, error: formatError(err) });
    }
});

app.listen(PORT, () => { 
    console.log(`🎵 MMC Spotify SL Server rodando na porta ${PORT}`);
    console.log(`✅ Pronto para receber conexões do Second Life!`);
});
