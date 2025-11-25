/////////////////////////////////////////////////////////////
//  MMC SPOTIFY PLAYER – SERVER ANTI-ERRO (FINAL)
//  SUPORTE REAL PARA VÁRIOS AVATARES, COMPLETAMENTE ISOLADOS
/////////////////////////////////////////////////////////////

const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const app = express();

const PORT = process.env.PORT || 3000;

// ENV VARS
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "https://mmcspotifysl.onrender.com/callback";

// VALIDATION
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ ERROR: Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  process.exit(1);
}

// STORAGE: TOKENS POR AVATAR (100% independente)
let userTokens = {};
let userTracks = {};

/////////////////////////////////////////////////////////////
// FUNÇÃO: REFRESH TOKEN POR AVATAR
/////////////////////////////////////////////////////////////
async function refreshTokenForAvatar(avatar) {
  const tokens = userTokens[avatar];
  if (!tokens) return null;

  // Se ainda está válido, retorna
  if (Date.now() < tokens.expiresAt - 60000) return tokens;

  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });

  api.setRefreshToken(tokens.refreshToken);

  try {
    const data = await api.refreshAccessToken();

    userTokens[avatar].accessToken = data.body.access_token;
    userTokens[avatar].expiresAt = Date.now() + data.body.expires_in * 1000;

    console.log(`🔄 Token atualizado para avatar ${avatar}`);
    return userTokens[avatar];
  } catch (err) {
    console.error("❌ ERRO REFRESH:", err);
    return null;
  }
}

/////////////////////////////////////////////////////////////
// FUNÇÃO: ATUALIZAR TRACK INDIVIDUAL
/////////////////////////////////////////////////////////////
async function updateTrack(avatar) {
  const tokens = userTokens[avatar];
  if (!tokens) return null;

  const valid = await refreshTokenForAvatar(avatar);
  if (!valid) return null;

  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });

  api.setAccessToken(valid.accessToken);
  api.setRefreshToken(valid.refreshToken);

  try {
    const playback = await api.getMyCurrentPlaybackState();

    if (playback.body && playback.body.item) {
      const t = playback.body.item;

      userTracks[avatar] = {
        is_playing: playback.body.is_playing,
        track: t.name,
        artist: t.artists.map(a => a.name).join(", "),
        duration: t.duration_ms || 0,
        progress: playback.body.progress_ms || 0,
        error: false,
        timestamp: Date.now(),
      };
    } else {
      userTracks[avatar] = {
        is_playing: false,
        track: "Nada tocando",
        artist: "",
        duration: 0,
        progress: 0,
        error: false,
        timestamp: Date.now(),
      };
    }

    return userTracks[avatar];
  } catch (err) {
    console.error("❌ Error fetch:", err.message);

    userTracks[avatar] = {
      is_playing: false,
      track: "Erro",
      artist: "",
      progress: 0,
      duration: 0,
      error: true,
      timestamp: Date.now(),
    };

    return userTracks[avatar];
  }
}

/////////////////////////////////////////////////////////////
// ROTAS
/////////////////////////////////////////////////////////////

// BLOQUEAR LOGIN SEM UUID (anti-erro!)
app.get("/login", (req, res) => {
  const avatar = req.query.avatar;

  if (!avatar || avatar.length < 5) {
    return res.status(400).send(`
      <h1 style='color:red;font-family:sans-serif'>
        ERRO: Login inválido<br><br>
        O login DEVE vir do Second Life usando ?avatar=UUID<br><br>
        (Clique no objeto no SL para abrir corretamente)
      </h1>
    `);
  }

  const scopes = ["user-read-currently-playing", "user-read-playback-state"];

  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });

  // STATE RECEBE O UUID (essencial)
  const authUrl = api.createAuthorizeURL(scopes, avatar, true);

  res.redirect(authUrl);
});

// CALLBACK — SÓ ACEITA SE HOUVER STATE=UUID
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!state || state.length < 5) {
    return res.status(400).send("<h1>ERRO: Callback sem avatar (STATE inválido)</h1>");
  }

  const avatar = state;

  const api = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });

  try {
    const data = await api.authorizationCodeGrant(code);

    userTokens[avatar] = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + data.body.expires_in * 1000,
    };

    console.log(`✅ Avatar autenticado: ${avatar}`);

    res.send(`
      <h1 style="background:#222;color:white;font-family:sans-serif;padding:40px;text-align:center">
        🎵 Conectado com sucesso!<br><br>
        Você já pode fechar esta aba.<br>
      </h1>
    `);

  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("Erro na autenticação.");
  }
});

// RETORNA MÚSICA INDIVIDUAL
app.get("/current-track", async (req, res) => {
  const avatar = req.query.avatar;

  if (!avatar || !userTokens[avatar]) {
    return res.json({
      success: true,
      track: "Nenhuma música",
      artist: "",
      progress: 0,
      duration: 0
    });
  }

  const data = await updateTrack(avatar);

  res.json({
    success: true,
    ...data
  });
});

// APAGAR TOKENS DE UM AVATAR
app.get("/logout", (req, res) => {
  const avatar = req.query.avatar;

  delete userTokens[avatar];
  delete userTracks[avatar];

  res.send(`<h1>Tokens removidos para avatar ${avatar}</h1>`);
});

/////////////////////////////////////////////////////////////
// SERVER ONLINE
/////////////////////////////////////////////////////////////
app.listen(PORT, () => {
  console.log(`🎵 Spotify Server rodando na porta ${PORT}`);
  console.log(`📡 Endpoint SL: /current-track?avatar=UUID`);
});
