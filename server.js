const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURAÇÕES (Variáveis de Ambiente do Render) ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// === BANCO DE DADOS NA MEMÓRIA ===
// Guarda os tokens de cada avatar separadamente
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

// === FUNÇÃO AUXILIAR: TRADUTOR DE ERROS (FIM DO [object Object]) ===
function formatError(err) {
    try {
        if (!err) return "Erro Desconhecido";

        // 1. Erros vindos do corpo da resposta do Spotify
        if (err.body) {
            // Ex: User not registered in the Developer Dashboard
            if (err.body.error_description) return "Spotify: " + err.body.error_description;
            // Ex: The access token expired
            if (err.body.error && err.body.error.message) return "Spotify: " + err.body.error.message;
            // Ex: invalid_grant
            if (typeof err.body.error === 'string') return "Spotify: " + err.body.error;
        }

        // 2. Erros de conexão ou javascript simples
        if (err.message) return err.message;

        // 3. Última tentativa: força conversão para texto limpo
        return JSON.stringify(err).replace(/[{}"]/g, ' '); 

    } catch (e) {
        return "Erro Interno no Servidor";
    }
}

// === ROTA 1: LOGIN (LSL Manda o Usuário pra cá) ===
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid;
    
    if (!sl_uuid) {
        return res.send("ERRO: Faltou o UUID do Avatar. Use o HUD no Second Life.");
    }
    
    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-playback-position'];
    
    // Passamos o UUID no 'state' para não perdê-lo durante o login
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    res.redirect(authUrl);
});

// === ROTA 2: CALLBACK (Spotify devolve o Usuário pra cá) ===
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state; // Recuperamos o UUID aqui

    if (error) return res.send(`Erro do Spotify: ${error}`);
    if (!code || !sl_uuid) return res.send(`Erro Crítico: Código ou UUID faltando.`);

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);

        // SALVA O USUÁRIO NO BANCO
        usersDB[sl_uuid] = {
            accessToken: data.body.access_token,
            refreshToken: data.body.refresh_token,
            expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        console.log(`[LOGIN] Sucesso para: ${sl_uuid}`);
        
        res.send(`
            <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding-top:50px;">
                <h1 style="color:#1DB954; font-size:40px;">Conectado!</h1>
                <p>Seu HUD no Second Life já pode tocar música.</p>
                <div style="margin-top:20px; padding:10px; background:#282828; display:inline-block; border-radius:10px;">
                    UUID: ${sl_uuid}
                </div>
            </body>
        `);
    } catch (err) {
        console.error("Erro no Callback:", err);
        res.send(`Falha no Login: ${formatError(err)}`);
    }
});

// === ROTA 3: BUSCAR MÚSICA (LSL Pede a música aqui) ===
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    // 1. Verifica se o usuário existe no banco
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

    // 2. Verifica se precisa renovar o token (Refresh)
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            console.log(`[REFRESH] Renovando token de ${sl_uuid}...`);
            const data = await spotifyApi.refreshAccessToken();
            usersDB[sl_uuid].accessToken = data.body.access_token;
            
            const expiresIn = data.body.expires_in || 3600;
            usersDB[sl_uuid].expiresAt = Date.now() + (expiresIn * 1000);
            
            if (data.body.refresh_token) usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            spotifyApi.setAccessToken(data.body.access_token);
        } catch (err) {
            const msg = formatError(err);
            console.log("Erro no Refresh:", msg);
            return res.json({ 
                track: `Erro de Sessão`, 
                artist: 'Relogue o HUD',
                error_code: "REFRESH_ERROR" 
            });
        }
    }

    // 3. Busca a música no Spotify
    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        // Tratamento: Nada tocando ou player fechado
        if (playback.statusCode === 204 || !playback.body || Object.keys(playback.body).length === 0) {
            return res.json({
                is_playing: false,
                track: 'Nada tocando',
                artist: '',
                progress: 0, duration: 0
            });
        }

        const item = playback.body.item;
        
        // Tratamento: Comercial ou Podcast desconhecido
        if (!item) {
             return res.json({
                is_playing: false,
                track: 'Comercial / Outro',
                artist: 'Spotify',
                progress: 0, duration: 0
            });
        }

        // Formata Nomes dos Artistas
        let artistName = "Desconhecido";
        if (item.artists && item.artists.length > 0) {
            artistName = item.artists.map(a => a.name).join(', ');
        } else if (item.show) {
            artistName = item.show.name + " (Podcast)";
        }

        // SUCESSO: Retorna o JSON limpo
        res.json({
            is_playing: playback.body.is_playing,
            track: item.name,
            artist: artistName,
            progress: playback.body.progress_ms,
            duration: item.duration_ms
        });

    } catch (err) {
        const msg = formatError(err);
        console.error("Erro API:", msg);
        
        // Envia o erro REAL para o HUD (Sem [object Object])
        res.json({ 
            track: `Erro: ${msg.substring(0, 40)}...`, 
            artist: `Verifique Instruções`,
            error_code: "API_FAIL"
        });
    }
});

// Inicia o Servidor
app.listen(PORT, () => {
    console.log(`Servidor V6 Universal rodando na porta ${PORT}`);
});
