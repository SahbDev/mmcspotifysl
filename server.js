const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURAÇÕES (Variáveis de Ambiente do Render) ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// === BANCO DE DADOS NA MEMÓRIA ===
// Guarda os tokens de cada avatar separadamente pela chave UUID
const usersDB = {}; 

app.use(express.static('public'));
app.use(express.json());

// === FUNÇÃO AUXILIAR: CRIA CONEXÃO SPOTIFY ===
function getSpotifyApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

// === FUNÇÃO AUXILIAR: TRADUTOR DE ERROS ===
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
        return "Erro Interno no Servidor";
    }
}

// === ROTA 1: LOGIN ===
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    
    if (!sl_uuid) {
        return res.send("ERRO: Faltou o UUID do Avatar. Use o HUD no Second Life.");
    }
    
    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position'];
    
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    res.redirect(authUrl);
});

// === ROTA 2: CALLBACK ===
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state; 

    if (error) return res.send(`Erro do Spotify: ${error}`);
    if (!code || !sl_uuid) return res.send(`Erro Crítico: Código ou UUID faltando.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        // SALVA O USUÁRIO NO BANCO USANDO O UUID COMO CHAVE
        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        console.log(`[LOGIN] Sucesso para: ${sl_uuid}`);
        
        res.send(`
            <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
                <h1 style="color:#1DB954; font-size:40px;">Conectado!</h1>
                <p>O UUID <b>${sl_uuid}</b> está pronto para tocar.</p>
            </body>
        `);
    } catch (err) {
        console.error("Erro no Callback:", err);
        res.send(`Falha no Login: ${formatError(err)}`);
    }
});

// === ROTA 3: BUSCAR MÚSICA ===
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    // 1. Verifica se este UUID específico fez login
    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.json({ 
            track: 'Não conectado', 
            artist: 'Toque para Logar', 
            error_code: "NOT_LOGGED"
        });
    }

    let user = usersDB[sl_uuid]; // Pega a sessão DESTE usuário
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // 2. Renova token se necessário
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            return res.json({ 
                track: `Erro de Sessão`, 
                artist: 'Relogue o HUD',
                error_code: "REFRESH_ERROR" 
            });
        }
    }

    // 3. Busca a música
    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({ is_playing: false, track: 'Nada tocando', artist: '', progress: 0, duration: 0 });
        }

        const item = playback.body.item;
        
        if (!item) {
             return res.json({ is_playing: false, track: 'Comercial / Outro', artist: 'Spotify', progress: 0, duration: 0 });
        }

        let artistName = "Desconhecido";
        if (item.artists && item.artists.length > 0) {
            artistName = item.artists.map(a => a.name).join(', ');
        } else if (item.show) {
            artistName = item.show.name + " (Podcast)";
        }

        res.json({
            is_playing: playback.body.is_playing,
            track: item.name,
            artist: artistName,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });

    } catch (err) {
        const msg = formatError(err);
        res.json({ 
            track: `Erro: ${msg.substring(0, 40)}...`, 
            artist: `Verifique Instruções`,
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor V6 Universal rodando na porta ${PORT}`);
});
