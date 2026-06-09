// Spotify API helper — fetches playlist/album tracks directly
// using the Client Credentials flow (no user login needed for public content)

let tokenCache = { token: null, expires: 0 };

async function getSpotifyToken() {
    if (tokenCache.token && Date.now() < tokenCache.expires) {
        return tokenCache.token;
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.error('[Spotify] Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET env vars!');
        return null;
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
        const body = await res.text();
        console.error('[Spotify] Failed to get token:', res.status, body);
        return null;
    }

    const data = await res.json();
    tokenCache = {
        token: data.access_token,
        expires: Date.now() + (data.expires_in - 60) * 1000
    };
    console.log('[Spotify] Got new access token, expires in', data.expires_in, 'seconds');
    return tokenCache.token;
}

async function spotifyGet(url) {
    const token = await getSpotifyToken();
    if (!token) return null;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        const body = await res.text();
        console.error('[Spotify] API error:', res.status, url, body);
        return null;
    }
    return res.json();
}

/**
 * Fetch all tracks from a Spotify playlist.
 * NOTE: No "fields" filter — Spotify 403's on filtered requests for some apps.
 */
async function getPlaylistTracks(playlistId) {
    // Fetch playlist info (no fields filter)
    const info = await spotifyGet(
        `https://api.spotify.com/v1/playlists/${playlistId}?market=US`
    );
    if (!info) return { name: 'Unknown Playlist', tracks: [] };

    const tracks = [];
    // No "fields" parameter — causes 403 on restricted Spotify apps
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&market=US`;

    while (url) {
        const page = await spotifyGet(url);
        if (!page) break;
        for (const item of (page.items || [])) {
            const track = item?.track;
            if (track && !track.is_local && track.name) {
                tracks.push(track);
            }
        }
        url = page.next || null;
    }

    return { name: info.name || 'Spotify Playlist', tracks };
}

/**
 * Fetch all tracks from a Spotify album.
 */
async function getAlbumTracks(albumId) {
    const info = await spotifyGet(`https://api.spotify.com/v1/albums/${albumId}?market=US`);
    if (!info) return { name: 'Unknown Album', tracks: [] };

    const tracks = [];
    let url = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50&market=US`;

    while (url) {
        const page = await spotifyGet(url);
        if (!page) break;
        for (const track of (page.items || [])) {
            if (track?.name) tracks.push(track);
        }
        url = page.next || null;
    }

    return { name: `${info.name} — ${info.artists?.[0]?.name || ''}`, tracks };
}

/**
 * Convert a Spotify track object to a YouTube search query string.
 */
function toSearchQuery(track) {
    const artists = (track.artists || []).map(a => a.name).join(' ');
    return `ytsearch:${track.name} ${artists}`;
}

module.exports = { getPlaylistTracks, getAlbumTracks, toSearchQuery };
