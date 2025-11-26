// === ROTA 4: CONTROLES PLAYBACK ===
app.post('/playback-control', async (req, res) => {
    const { uuid, action } = req.body;

    if (!uuid || !usersDB[uuid]) {
        return res.json({ success: false, error: 'Usuário não logado' });
    }

    let user = usersDB[uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    try {
        let result;
        switch (action) {
            case 'play':
                result = await spotifyApi.play();
                break;
            case 'pause':
                result = await spotifyApi.pause();
                break;
            case 'next':
                result = await spotifyApi.skipToNext();
                break;
            case 'previous':
                result = await spotifyApi.skipToPrevious();
                break;
            default:
                return res.json({ success: false, error: 'Ação inválida' });
        }

        res.json({ success: true, message: `Ação ${action} executada` });
    } catch (err) {
        res.json({ success: false, error: formatError(err) });
    }
});

// === ROTA 5: TOGGLE PLAY/PAUSE ===
app.post('/play-pause', async (req, res) => {
    const { uuid } = req.body;

    if (!uuid || !usersDB[uuid]) {
        return res.json({ success: false, error: 'Usuário não logado' });
    }

    let user = usersDB[uuid];
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(user.accessToken);
    spotifyApi.setRefreshToken(user.refreshToken);

    try {
        // Primeiro verifica o estado atual
        const playback = await spotifyApi.getMyCurrentPlaybackState();
        
        if (playback.body && playback.body.is_playing) {
            await spotifyApi.pause();
            res.json({ success: true, action: 'paused', message: 'Música pausada' });
        } else {
            await spotifyApi.play();
            res.json({ success: true, action: 'played', message: 'Música reproduzida' });
        }
    } catch (err) {
        res.json({ success: false, error: formatError(err) });
    }
});
