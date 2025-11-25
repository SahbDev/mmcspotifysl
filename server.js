const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));

// Rota principal - SERVE A PÁGINA COM OS ELEMENTOS QUE VOCÊ QUER REMOVER
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MMC - Spotify Player</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Arial', sans-serif;
            }
            body {
                background: linear-gradient(135deg, #1DB954 0%, #191414 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            .container {
                background: rgba(255, 255, 255, 0.95);
                border-radius: 15px;
                padding: 40px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                text-align: center;
                max-width: 500px;
                width: 100%;
            }
            h1 {
                color: #191414;
                margin-bottom: 10px;
                font-size: 28px;
            }
            .subtitle {
                color: #666;
                margin-bottom: 30px;
                font-size: 16px;
            }
            .connect-section {
                margin: 30px 0;
            }
            .connect-btn {
                background-color: #1DB954;
                color: white;
                padding: 15px 40px;
                text-decoration: none;
                border-radius: 50px;
                display: inline-block;
                font-weight: bold;
                font-size: 18px;
                transition: all 0.3s ease;
                border: none;
                cursor: pointer;
            }
            .connect-btn:hover {
                background-color: #1ed760;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(29, 185, 84, 0.4);
            }
            .url-info {
                background-color: #f8f9fa;
                padding: 15px;
                border-radius: 8px;
                margin-top: 25px;
                border-left: 4px solid #1DB954;
                font-size: 14px;
            }
            .url-info strong {
                color: #191414;
                display: block;
                margin-bottom: 5px;
            }
            .spotify-icon {
                font-size: 48px;
                color: #1DB954;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="spotify-icon">♪</div>
            <h1>MMC - Spotify Player</h1>
            <p class="subtitle">Connect your Spotify Account</p>
            
            <div class="connect-section">
                <a href="/auth/spotify" class="connect-btn">
                    🔗 Connect Spotify
                </a>
            </div>
            
            <div class="url-info">
                <strong>URL for Second Life:</strong>
                https://mmcspotifysl.onrender.com/current-track
            </div>
        </div>

        <script>
            document.querySelector('.connect-btn').addEventListener('click', function(e) {
                e.preventDefault();
                alert('Connecting to Spotify...');
                // Simulação de conexão
                setTimeout(() => {
                    window.location.href = '/auth/spotify';
                }, 1000);
            });
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Rota da API para Second Life
app.get('/current-track', (req, res) => {
    res.json({
        title: "Current Song",
        artist: "Artist Name",
        album: "Album Name",
        duration: 180,
        progress: 65,
        isPlaying: true,
        coverArt: "https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228",
        timestamp: new Date().toISOString()
    });
});

// Rota de autenticação do Spotify
app.get('/auth/spotify', (req, res) => {
    // Aqui iria a lógica real de autenticação com Spotify
    const html = `
    <html>
        <body style="background: #1DB954; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
            <div style="text-align: center; padding: 40px; background: rgba(0,0,0,0.8); border-radius: 15px;">
                <h2>✅ Spotify Connected Successfully!</h2>
                <p>You can now return to the application.</p>
                <a href="/" style="color: #1DB954; text-decoration: none; font-weight: bold;">← Back to Player</a>
            </div>
        </body>
    </html>
    `;
    res.send(html);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online', 
        service: 'MMC Spotify Player',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 MMC Spotify Player running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/current-track`);
});

module.exports = app;
