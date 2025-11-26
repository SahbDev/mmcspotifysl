const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
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

// === FUNÇÃO PARA DECIFRAR O ERRO ===
function getErrorMessage(err) {
    // Caso 1: Erro padrão do Spotify API (objeto dentro do body)
    if (err.body && err.body.error) {
        // Se error for um objeto { status: 401, message: "..." }
        if (typeof err.body.error === 'object' && err.body.error.message) {
            return err.body.error.message;
        }
        // Se error for apenas uma string (comum em auth: "invalid_grant")
        if (typeof err.body.error === 'string') {
            return err.body.error_description || err.body.error;
        }
    }
    
    // Caso 2: Erro genérico de Javascript ou Rede
    if (err.message) return err.message;
    
    // Caso 3: O erro é apenas uma string
    if (typeof err === 'string') return err;
    
    // Caso 4: Desconhecido (Transforma o objeto em texto para lermos)
    try {
        return JSON.stringify(err);
    } catch (e) {
        return "Erro Desconhecido";
    }
}

// ROTA DE LOGIN
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    if (!sl_uuid) return res.send("ERRO: Faltou o UUID. Use o HUD.");
    
    const spotifyApi = getSpotifyApi();
    const scopes = [
        'user-read-currently-playing', 
        'user-read-playback-state', 
        'user-read-playback-position'
    ];
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
        res.send(`<h1 style="color:green; text-align:center; font-family:sans-serif;">CONECTADO COM SUCESSO!</h1><p style="text-align:center;">Pode fechar e clicar no HUD.</p>`);
    } catch (err) {
        console.error("Erro no Callback:", err);
        res.send(`Erro no Login: ${getErrorMessage(err)}`);
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
            console.log(`[REFRESH] Renovando token de ${sl_uuid}...`);
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) {
                usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            }
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            console.error("Erro Refresh:", err);
            // Aqui usamos a nova função para ver o erro real
            return res.json({ 
                track: `Erro Login`, 
                artist: getErrorMessage(err).substring(0, 254), // Limita tamanho p/ SL
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
                progress: 0,
                duration: 0
            });
        }

        const item = playback.body.item;
        if (!item) {
             return res.json({
                is_playing: false,
                track: 'Podcast/Outro', // Mudado para ser mais amigável
                artist: 'Mídia não suportada',
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
        console.error("ERRO API:", err);
        // Usamos a função inteligente aqui também
        const msg = getErrorMessage(err);
        
        res.json({ 
            track: `Erro: ${msg.substring(0, 100)}`, // Corta para caber no HUD
            artist: `Verifique o servidor`,
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor V3 Final rodando na porta ${PORT}`);
});
