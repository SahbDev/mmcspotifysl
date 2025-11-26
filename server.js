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

// === FUNÇÃO BLINDADA PARA LER ERROS ===
function getErrorMessage(err) {
    try {
        // Se já for texto, retorna
        if (typeof err === 'string') return err;
        
        // Se não existir erro, retorna genérico
        if (!err) return "Erro Nulo Detectado";

        // Tenta achar erro dentro do 'body' (Padrão Spotify)
        if (err.body) {
            // Caso: { error: "invalid_grant", error_description: "User not registered..." }
            if (err.body.error_description) return String(err.body.error_description);
            
            // Caso: { error: { status: 401, message: "Token expired" } }
            if (err.body.error && err.body.error.message) return String(err.body.error.message);
            
            // Caso: { error: "Alguma string solta" }
            if (typeof err.body.error === 'string') return String(err.body.error);
        }

        // Tenta mensagem padrão de JavaScript
        if (err.message) return String(err.message);

        // Se tudo falhar, transforma o objeto bruto em texto (JSON)
        return JSON.stringify(err);
        
    } catch (e) {
        return "Erro Crítico na Leitura do Erro";
    }
}

// Login
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    if (!sl_uuid) return res.send("ERRO: Faltou o UUID. Use o HUD.");
    
    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    res.redirect(authUrl);
});

// Callback
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
        
        res.send(`<h1 style="color:green; font-family:sans-serif; text-align:center;">CONECTADO!</h1><p style="text-align:center;">Volte ao SL e clique no HUD.</p>`);
    } catch (err) {
        res.send(`Erro no Login: ${getErrorMessage(err)}`);
    }
});

// Busca Música
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
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            // AQUI ESTAVA O PROBLEMA: Agora usamos String() para garantir texto
            const msgErro = getErrorMessage(err);
            console.log("Erro no Refresh:", msgErro);
            
            return res.json({ 
                track: `Erro: ${msgErro.substring(0, 50)}`, // Corta curto p/ caber
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
        const msgErro = getErrorMessage(err);
        console.log("Erro na API:", msgErro);
        
        res.json({ 
            track: `Erro: ${msgErro.substring(0, 50)}`, 
            artist: `Tente Logar Novamente`,
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor V4 Blindado rodando na porta ${PORT}`);
});
