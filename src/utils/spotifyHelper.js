// Spotify API helper — fetches playlist/album tracks directly
// using the Client Credentials flow (no user login needed for public content)

let tokenCache = { token: null, expires: 0 };

async function getSpotifyToken() {
    if (tokenCache.token && Date.now() < tokenCache.expires) {
        return tokenCache.token;
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

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
        console.error('[Spotify] Failed to get token:', res.status, await res.text());
        return null;
    }

    const data = await res.json();
    tokenCache = {
        token: data.access_token,
        expires: Date.now() + (data.expires_in - 60) * 1000
    };
    return tokenCache.token;
}

async function spotifyGet(url) {
    const token = await getSpotifyToken();
    if (!token) return null;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
        console.error('[Spotify] API error:', res.status, url);
        return null;
    }
    return res.json();
}

/**
 * Fetch all tracks from a Spotify playlist.
 * Returns an array of simplified track objects: { name, artists, duration_ms }
 */
async function getPlaylistTracks(playlistId) {
    const info = await spotifyGet(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`
    );
    if (!info) return { name: 'Unknown Playlist', tracks: [] };

    const tracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists(name),duration_ms,is_local))`;

    while (url) {
        const page = await spotifyGet(url);
        if (!page) break;
        for (const item of (page.items || [])) {
            if (item?.track && !item.track.is_local && item.track.name) {
                tracks.push(item.track);
            }
        }
        url = page.next;
    }

    return { name: info.name || 'Spotify Playlist', tracks };
}

/**
 * Fetch all tracks from a Spotify album.
 * Returns an array of simplified track objects: { name, artists, duration_ms }
 */
async function getAlbumTracks(albumId) {
    const info = await spotifyGet(`https://api.spotify.com/v1/albums/${albumId}`);
    if (!info) return { name: 'Unknown Album', tracks: [] };

    const tracks = [];
    let url = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`;

    while (url) {
        const page = await spotifyGet(url);
        if (!page) break;
        tracks.push(...(page.items || []).filter(t => t?.name));
        url = page.next;
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
