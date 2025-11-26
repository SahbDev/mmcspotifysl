const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Credenciais (Tenta usar as do ambiente, ou usa as fixas como fallback)
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

// ROTA DE LOGIN
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    if (!sl_uuid) return res.send("ERRO: Faltou o UUID. Use o HUD.");
    
    const spotifyApi = getSpotifyApi();
    // Escopos atualizados
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
        res.send(`Erro no Login: ${err.message}`);
    }
});

// ROTA DE BUSCA DE MÚSICA
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    // Checagem 1: Usuário existe?
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

    // Checagem 2: Token precisa renovar?
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            console.log(`[REFRESH] Renovando token de ${sl_uuid}...`);
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            // Se não vier expires_in, assume 1 hora
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) {
                usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            }
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            console.error("Erro Refresh:", err);
            return res.json({ 
                track: `Erro Refresh: ${err.statusCode}`, 
                artist: 'Relogue o HUD', 
                error_code: "REFRESH_ERROR" 
            });
        }
    }

    // Checagem 3: Buscar música
    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        // Tratamento para status 204 (Nada tocando) ou corpo vazio
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
        
        // Se item for nulo (ex: propaganda ou podcast local bugado)
        if (!item) {
             return res.json({
                is_playing: false,
                track: 'Comercial/Outro',
                artist: '',
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
        // AQUI ESTÁ A MÁGICA: Enviamos o erro real para o HUD
        const errorMsg = err.body && err.body.error ? err.body.error.message : err.message;
        
        res.json({ 
            track: `Erro: ${errorMsg}`, 
            artist: `Cod: ${err.statusCode}`,
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Diagnóstico rodando na porta ${PORT}`);
});
