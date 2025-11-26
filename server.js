const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Credenciais
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// Banco de dados em memória
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

// Rota de Login
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    if (!sl_uuid) return res.send("Erro: Use o HUD no Second Life.");
    
    const spotifyApi = getSpotifyApi();
    // Adicionei 'user-read-playback-position' para garantir
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position'];
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    res.redirect(authUrl);
});

// Callback
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state;

    if (error || !code || !sl_uuid) return res.send(`Erro na autenticação.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };

        res.send(`<h1 style="color:green; text-align:center; margin-top:50px;">Conectado!</h1><p style="text-align:center;">Volte ao Second Life e toque no HUD.</p>`);
    } catch (err) {
        res.send("Erro ao processar login.");
    }
});

// Rota Principal (Dados da Música)
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    // 1. Verifica se está logado
    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.json({ 
            is_playing: false, 
            track: 'Não conectado', 
            artist: 'Toque para logar', 
            error_code: "NOT_LOGGED"
        });
    }

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // 2. Renova Token se necessário
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            usersDB[sl_uuid].expiresAt = Date.now() + (data.body.expires_in * 1000);
            spotifyApi.setAccessToken(data.body.access_token);
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
        } catch (err) {
            console.error("Erro refresh:", err);
            return res.json({ track: "Erro Login", artist: "Relogue o HUD", error_code: "REFRESH_FAIL" });
        }
    }

    // 3. Busca a música (Protegido contra falhas)
    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.body && playback.body.item) {
            const item = playback.body.item;
            
            // LÓGICA INTELIGENTE DE ARTISTA
            // Se for música, pega os artistas. Se for Podcast, pega o nome do Show.
            let artistName = "Desconhecido";
            if (item.artists && item.artists.length > 0) {
                artistName = item.artists.map(a => a.name).join(', ');
            } else if (item.show) {
                artistName = item.show.name + " (Podcast)";
            }

            res.json({
                is_playing: playback.body.is_playing,
                track: item.name || "Sem Nome",
                artist: artistName,
                progress: playback.body.progress_ms || 0,
                duration: item.duration_ms || 0
            });
        } else {
            // Nada tocando
            res.json({
                is_playing: false,
                track: 'Nenhuma música', 
                artist: '',
                duration: 0,
                progress: 0
            });
        }
    } catch (err) {
        console.error("Erro API Spotify:", err);
        // Retorna um JSON válido mesmo com erro, para não quebrar o HUD
        res.json({ 
            is_playing: false, 
            track: 'Erro API', 
            artist: 'Tente mais tarde',
            error_code: "API_FAIL"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor V2 rodando na porta ${PORT}`);
});
