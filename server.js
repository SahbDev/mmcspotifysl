const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Rota principal - HTML INTEGRADO NO SERVER.JS
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MMC - Spotify Player</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f0f0f0;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #1DB954;
                text-align: center;
            }
            .connect-section {
                text-align: center;
                margin: 30px 0;
            }
            .connect-btn {
                background-color: #1DB954;
                color: white;
                padding: 12px 25px;
                text-decoration: none;
                border-radius: 25px;
                display: inline-block;
                font-weight: bold;
            }
            .connect-btn:hover {
                background-color: #1ed760;
            }
            .url-info {
                background-color: #f8f9fa;
                padding: 15px;
                border-radius: 5px;
                margin-top: 20px;
                font-family: monospace;
                word-break: break-all;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>MMC - Spotify Player</h1>
            
            <div class="connect-section">
                <h2>Connect your Spotify Account</h2>
                <a href="/auth/spotify" class="connect-btn">
                    🔗 Connect Spotify
                </a>
            </div>
            
            <div class="url-info">
                <strong>URL for Second Life:</strong><br>
                https://mmcspotifysl.onrender.com/current-track
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// Rota para obter a música atual (API)
app.get('/current-track', (req, res) => {
    const currentTrack = {
        title: "Song Name",
        artist: "Artist Name", 
        album: "Album Name",
        cover: "https://example.com/cover.jpg",
        progress: 45,
        duration: 180,
        isPlaying: true,
        timestamp: new Date().toISOString()
    };
    
    res.json(currentTrack);
});

// Rota de autenticação do Spotify
app.get('/auth/spotify', (req, res) => {
    // Simulação de autenticação
    console.log('Iniciando autenticação Spotify...');
    
    // Redireciona de volta para a página principal após "autenticação"
    setTimeout(() => {
        res.redirect('/?connected=true');
    }, 1000);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log('=== MMC Spotify Player ===');
    console.log(`Servidor rodando na porta: ${PORT}`);
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`API Current Track: http://localhost:${PORT}/current-track`);
    console.log('==========================');
});

module.exports = app;
