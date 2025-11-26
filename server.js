const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

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

// === NOVA FUNÇÃO DE FORMATAÇÃO DE ERRO ===
function formatError(err) {
    try {
        // Se err não existe
        if (!err) return "Erro Desconhecido (Null)";

        // 1. Tenta pegar a descrição do BODY (onde o Spotify detalha o erro)
        if (err.body) {
            if (err.body.error_description) return "Spotify: " + err.body.error_description;
            if (err.body.error && err.body.error.message) return "Spotify: " + err.body.error.message;
            if (typeof err.body.error === 'string') return "Spotify: " + err.body.error;
        }

        // 2. Se a mensagem for um Objeto (Causa do [object Object]), converte pra JSON
        if (typeof err.message === 'object') {
            return "Detalhe: " + JSON.stringify(err.message).replace(/[{}"]/g, ''); 
        }

        // 3. Se tiver mensagem de texto normal
        if (err.message && err.message !== "[object Object]") return err.message;

        // 4. Último recurso: JSON do erro completo
        return JSON.stringify(err).substring(0, 100); 

    } catch (e) {
        return "Erro Crítico de Leitura";
    }
}

// ROTA DE LOGIN
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    if (!sl_uuid) return res.send("ERRO: Faltou o UUID. Use o HUD.");
    
    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    res.redirect(authUrl);
});

// ROTA DE CALLBACK
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state;

    if (error) return res.send(`Erro do Spotify: ${error}`);
    if (!code || !sl_uuid) return res.send(`Erro: Código ou UUID faltando.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        console.log(`[LOGIN] Sucesso para ${sl_uuid}`);
        res.send(`<h1 style="color:green; font-family:sans-serif; text-align:center;">CONECTADO!</h1><p style="text-align:center;">Volte ao SL e clique no HUD.</p>`);
    } catch (err) {
        console.error("Erro Callback:", err);
        res.send(`Erro no Login: ${formatError(err)}`);
    }
});

// ROTA DE BUSCA DE MÚSICA
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.json({ 
            track: 'Não conectado', 
            artist: 'Toque para Logar', 
            error_code: "NOT_LOGGED"
        });
    }

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // Renovação de Token
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            console.log(`[REFRESH] Tentando renovar para ${sl_uuid}...`);
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
            console.log(`[REFRESH] Sucesso.`);
        } catch (err) {
            const msg = formatError(err);
            console.log("Erro Refresh:", msg);
            return res.json({ 
                track: `Erro: ${msg.substring(0, 40)}`, 
                artist: 'Relogue o HUD', 
                error_code: "REFRESH_ERROR" 
            });
        }
    }

    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({
                is_playing: false,
                track: 'Nada tocando',
                artist: '',
                progress: 0, duration: 0
            });
        }

        const item = playback.body.item;
        if (!item) {
             return res.json({
                is_playing: false,
                track: 'Podcast/Outro',
                artist: 'Tipo Desconhecido',
                progress: 0, duration: 0
            });
        }

        let artistName = "Desconhecido";
        if (item.artists && item.artists.length > 0) {
            artistName = item.artists.map(a => a.name).join(', ');
        } else if (item.show) {
            artistName = item.show.name;
        }

        res.json({
            is_playing: playback.body.is_playing,
            track: item.name,
            artist: artistName,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });

    } catch (err) {
        // AQUI ACONTECE A MÁGICA
        const msg = formatError(err);
        console.error("Erro API:", msg); // Aparece no Log do Render
        
        res.json({ 
            track: `Erro: ${msg.substring(0, 50)}`, // Corta para caber no HUD
            artist: `Verifique o Painel`,
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor V5 (Debug) rodando na porta ${PORT}`);
});
