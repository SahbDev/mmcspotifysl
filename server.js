const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = process.env.PORT || 3000;

// Credenciais (Mantive sua lógica de variáveis de ambiente)
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'bb4c46d3e3e549bb9ebf5007e89a5c9e';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'f1090563300d4a598dbb711d39255499';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback';

// === ARMAZENAMENTO NA MEMÓRIA ===
// Aqui guardamos os tokens de cada avatar separadamente.
// Estrutura: { "UUID_DO_AVATAR": { accessToken: "...", refreshToken: "...", expiresAt: 12345 } }
const usersDB = {}; 

app.use(express.static('public'));
app.use(express.json());

// ================= FUNÇÕES AUXILIARES =================

// Função para criar uma instância da API para um usuário específico
function getSpotifyApi() {
    return new SpotifyWebApi({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT_URI
    });
}

// ================= ROTAS =================

app.get('/', (req, res) => {
    res.send('Servidor Spotify Multi-Usuário Ativo. Use o HUD no Second Life para conectar.');
});

// 1. LOGIN: O Script LSL manda o usuário pra cá COM o UUID dele
app.get('/login', (req, res) => {
    const sl_uuid = req.query.uuid; // Recebe o UUID do avatar

    if (!sl_uuid) {
        return res.send("Erro: UUID do avatar não fornecido. Use o HUD no Second Life.");
    }

    const spotifyApi = getSpotifyApi();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state'];
    
    // Passamos o UUID no campo 'state' para recuperá-lo depois do login
    const authUrl = spotifyApi.createAuthorizeURL(scopes, sl_uuid);
    
    res.redirect(authUrl);
});

// 2. CALLBACK: O Spotify devolve o usuário pra cá com o código E o UUID (state)
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const sl_uuid = state; // Recuperamos o UUID aqui

    if (error || !code || !sl_uuid) {
        return res.send(`Erro na autenticação. Feche e tente novamente.`);
    }

    try {
        const spotifyApi = getSpotifyApi();
        const data = await spotifyApi.authorizationCodeGrant(code);
        const { access_token, refresh_token, expires_in } = data.body;

        // SALVA OS DADOS NO "CADERNO" DO USUÁRIO ESPECÍFICO
        usersDB[sl_uuid] = {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt: Date.now() + (expires_in * 1000)
        };

        // Envia a página de sucesso (Seu HTML original levemente ajustado)
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <body style="background-color: #222; color: white; font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1 style="color: #1DB954;">Conectado!</h1>
                <p>O usuário ${sl_uuid} foi vinculado ao Spotify.</p>
                <p>Você pode fechar esta janela e clicar no HUD novamente.</p>
            </body>
            </html>
        `);

    } catch (err) {
        console.error(err);
        res.send("Erro ao processar login. Tente novamente.");
    }
});

// 3. BUSCAR MÚSICA: O LSL pede a música mandando o UUID dele
app.get('/current-track', async (req, res) => {
    const sl_uuid = req.query.uuid;

    // Se não mandou UUID ou o UUID não está no nosso banco de memória
    if (!sl_uuid || !usersDB[sl_uuid]) {
        return res.json({ 
            is_playing: false, 
            track: 'Não conectado', 
            artist: 'Clique para logar', 
            error: true 
        });
    }

    let user = usersDB[sl_uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    // Verifica se o token venceu e precisa renovar
    if (Date.now() >= user.expiresAt - 60000) {
        try {
            console.log(`Renovando token de ${sl_uuid}...`);
            const data = await spotifyApi.refreshAccessToken();
            
            // Atualiza nosso banco de memória
            usersDB[sl_uuid].accessToken = data.body.access_token;
            usersDB[sl_uuid].expiresAt = Date.now() + (data.body.expires_in * 1000);
            spotifyApi.setAccessToken(data.body.access_token);
            
            // Se vier um novo refresh token, atualiza também
            if (data.body.refresh_token) {
                usersDB[sl_uuid].refreshToken = data.body.refresh_token;
            }
        } catch (err) {
            console.error("Erro ao renovar token:", err);
            return res.json({ error: true, track: "Re-login necessário" });
        }
    }

    // Busca a música
    try {
        const playback = await spotifyApi.getMyCurrentPlaybackState();

        if (playback.body && playback.body.item) {
            const track = playback.body.item;
            res.json({
                is_playing: playback.body.is_playing,
                track: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album.name,
                progress: playback.body.progress_ms || 0,
                duration: track.duration_ms || 0
            });
        } else {
            res.json({
                is_playing: false,
                track: 'Nenhuma música', // Ou mantenha vazio se preferir
                artist: '',
                duration: 0,
                progress: 0
            });
        }
    } catch (err) {
        console.error(err);
        res.json({ error: true });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
