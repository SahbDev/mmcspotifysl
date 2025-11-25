const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Spotify
const spotifyConfig = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://mmcspotifysl.onrender.com/callback'
};

// Armazenamento de sessões
const playerSessions = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// LOGIN - Fluxo corrigido
app.get('/login', (req, res) => {
    const { player_id, user_id } = req.query;
    
    if (!player_id) {
        return res.status(400).send('Player ID required');
    }

    console.log(`🔗 Login request - Player: ${player_id}, User: ${user_id}`);

    const spotifyApi = new SpotifyWebApi(spotifyConfig);
    const scopes = [
        'user-read-playback-state',
        'user-modify-playback-state', 
        'user-read-currently-playing'
    ];
    
    // Estado inclui ambos player_id e user_id
    const state = JSON.stringify({ 
        player_id: player_id, 
        user_id: user_id 
    });
    
    const authUrl = spotifyApi.createAuthorizeURL(scopes, state);
    console.log(`📍 Redirecting to Spotify auth: ${authUrl}`);
    
    res.redirect(authUrl);
});

// CALLBACK - Processamento robusto
app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        console.error('❌ Spotify auth error:', error);
        return res.status(400).send(`Authentication failed: ${error}`);
    }

    if (!code || !state) {
        return res.status(400).send('Missing code or state');
    }

    try {
        // Parse do estado
        const stateObj = JSON.parse(state);
        const playerId = stateObj.player_id;
        const userId = stateObj.user_id;

        console.log(`🔄 Processing callback - Player: ${playerId}, User: ${userId}`);

        const spotifyApi = new SpotifyWebApi(spotifyConfig);
        const authData = await spotifyApi.authorizationCodeGrant(code);
        
        // Salvar sessão
        playerSessions.set(playerId, {
            accessToken: authData.body.access_token,
            refreshToken: authData.body.refresh_token,
            expiresAt: Date.now() + (authData.body.expires_in * 1000),
            userId: userId,
            connectedAt: new Date().toISOString()
        });

        console.log(`✅ Session created - Player: ${playerId}`);
        console.log(`📊 Active sessions: ${playerSessions.size}`);

        // HTML de sucesso
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Connected</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        background: linear-gradient(135deg, #1DB954, #191414);
                        color: white;
                        margin: 0;
                        padding: 20px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        text-align: center;
                    }
                    .container {
                        background: rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(10px);
                        padding: 40px;
                        border-radius: 15px;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        max-width: 500px;
                        width: 90%;
                    }
                    .success-icon {
                        font-size: 48px;
                        margin-bottom: 20px;
                    }
                    h1 {
                        margin: 0 0 15px 0;
                        font-size: 28px;
                    }
                    p {
                        margin: 10px 0;
                        line-height: 1.5;
                    }
                    .info {
                        background: rgba(255, 255, 255, 0.2);
                        padding: 15px;
                        border-radius: 8px;
                        margin: 20px 0;
                        font-family: monospace;
                        font-size: 12px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">✅</div>
                    <h1>Successfully Connected!</h1>
                    <p>Your Spotify account is now linked to your player.</p>
                    <p><strong>You can safely close this window and return to Second Life.</strong></p>
                    
                    <div class="info">
                        <div>Player: ${playerId}</div>
                        <div>User: ${userId}</div>
                        <div>Time: ${new Date().toLocaleString()}</div>
                    </div>
                    
                    <p style="font-size: 12px; opacity: 0.8;">
                        If you experience issues, use the RECONNECT option in your player menu.
                    </p>
                </div>
                
                <script>
                    // Fechar automaticamente após 3 segundos
                    setTimeout(() => {
                        window.close();
                    }, 3000);
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Callback error:', error);
        res.status(500).send(`
            <html>
            <body style="font-family: Arial; padding: 50px; text-align: center; background: #ff4444; color: white;">
                <h1>❌ Connection Failed</h1>
                <p>Error: ${error.message}</p>
                <p>Please try reconnecting from your player.</p>
            </body>
            </html>
        `);
    }
});

// STATUS - Com verificação robusta
app.get('/status', async (req, res) => {
    const { player_id, user_id } = req.query;
    
    if (!player_id) {
        return res.json({ status: "disconnected" });
    }

    console.log(`📊 Status check - Player: ${player_id}, User: ${user_id}`);

    const session = playerSessions.get(player_id);
    if (!session) {
        console.log(`❌ No session found for player: ${player_id}`);
        return res.json({ status: "disconnected" });
    }

    try {
        const spotifyApi = new SpotifyWebApi({
            ...spotifyConfig,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken
        });

        // Refresh token se necessário
        if (Date.now() > session.expiresAt - 60000) {
            try {
                console.log(`🔄 Refreshing token for player: ${player_id}`);
                const refreshData = await spotifyApi.refreshAccessToken();
                session.accessToken = refreshData.body.access_token;
                session.expiresAt = Date.now() + (refreshData.body.expires_in * 1000);
            } catch (error) {
                console.log(`❌ Token refresh failed for player: ${player_id}`, error.message);
                playerSessions.delete(player_id);
                return res.json({ status: "disconnected" });
            }
        }

        // Obter estado de reprodução
        const playbackState = await spotifyApi.getMyCurrentPlaybackState();
        
        if (!playbackState.body || !playbackState.body.item) {
            return res.json({ status: "paused" });
        }

        const track = playbackState.body.item;
        const response = {
            status: playbackState.body.is_playing ? "playing" : "paused",
            artist: track.artists.map(a => a.name).join(', '),
            track: track.name,
            progress: playbackState.body.progress_ms || 0,
            duration: track.duration_ms
        };

        console.log(`✅ Status: ${response.status} - ${response.artist} - ${response.track}`);
        res.json(response);

    } catch (error) {
        console.error(`❌ Status error for player ${player_id}:`, error.message);
        
        // Se erro de autenticação, limpar sessão
        if (error.statusCode === 401 || error.statusCode === 403) {
            playerSessions.delete(player_id);
        }
        
        res.json({ status: "disconnected" });
    }
});

// CONTROLES
const controlHandlers = {
    play: (api) => api.play(),
    pause: (api) => api.pause(),
    next: (api) => api.skipToNext(),
    previous: (api) => api.skipToPrevious()
};

app.post('/:action', async (req, res) => {
    const { action } = req.params;
    const { player_id, user_id } = req.query;
    
    if (!player_id || !controlHandlers[action]) {
        return res.status(400).json({ error: "Invalid request" });
    }

    console.log(`🎮 Control: ${action} - Player: ${player_id}, User: ${user_id}`);

    const session = playerSessions.get(player_id);
    if (!session) {
        return res.status(401).json({ error: "Not connected" });
    }

    try {
        const spotifyApi = new SpotifyWebApi({
            ...spotifyConfig,
            accessToken: session.accessToken
        });

        await controlHandlers[action](spotifyApi);
        res.json({ success: true });
        
    } catch (error) {
        console.error(`❌ Control error (${action}):`, error.message);
        res.status(500).json({ error: "Control failed" });
    }
});

// HEALTH CHECK
app.get('/', (req, res) => {
    const sessionInfo = Array.from(playerSessions.entries()).map(([id, session]) => ({
        player_id: id,
        user_id: session.userId,
        connected: new Date(session.connectedAt).toLocaleString()
    }));

    res.json({
        status: 'online',
        server_time: new Date().toISOString(),
        active_sessions: playerSessions.size,
        sessions: sessionInfo,
        version: '2.0-definitive'
    });
});

// Limpeza periódica de sessões
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [playerId, session] of playerSessions.entries()) {
        // Limpar sessões com mais de 24 horas
        if (now - session.expiresAt > 24 * 60 * 60 * 1000) {
            playerSessions.delete(playerId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} expired sessions`);
    }
}, 30 * 60 * 1000); // A cada 30 minutos

app.listen(PORT, () => {
    console.log(`🎵 DEFINITIVE Spotify Server running on port ${PORT}`);
    console.log(`✅ Ready for multiple users`);
    console.log(`🔑 Spotify Client ID: ${process.env.SPOTIFY_CLIENT_ID ? 'Configured' : 'MISSING'}`);
});
