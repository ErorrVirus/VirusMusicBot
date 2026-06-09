// Spotify API helper
// Uses sp_dc cookie to get a full-permission user token — bypasses all client_credentials restrictions

let partnerTokenCache = { token: null, expires: 0 };
let clientTokenCache  = { token: null, expires: 0 };

// ── Token via sp_dc cookie (full user permissions) ────────────────────────────
// This is what the Spotify Web Player uses internally.
// It can access ALL public playlists and albums without restrictions.
async function getPartnerToken() {
    if (partnerTokenCache.token && Date.now() < partnerTokenCache.expires) {
        return partnerTokenCache.token;
    }

    const spDc = process.env.SPOTIFY_SPDC;
    if (!spDc) {
        console.warn('[Spotify] SPOTIFY_SPDC not set, skipping partner token');
        return null;
    }

    try {
        const res = await fetch(
            'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
            {
                headers: {
                    'Cookie': `sp_dc=${spDc}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://open.spotify.com/',
                }
            }
        );

        if (!res.ok) {
            console.error('[Spotify] Partner token request failed:', res.status, await res.text());
            return null;
        }

        const data = await res.json();
        if (!data.accessToken || data.isAnonymous) {
            console.error('[Spotify] Partner token is anonymous or missing — sp_dc cookie may be expired!', data);
            return null;
        }

        const expiresIn = data.accessTokenExpirationTimestampMs
            ? Math.max(data.accessTokenExpirationTimestampMs - Date.now() - 60000, 0)
            : 3540000; // default ~59 min

        partnerTokenCache = { token: data.accessToken, expires: Date.now() + expiresIn };
        console.log('[Spotify] ✅ Got partner token via sp_dc (expires in', Math.round(expiresIn / 60000), 'min)');
        return data.accessToken;

    } catch (err) {
        console.error('[Spotify] Error fetching partner token:', err);
        return null;
    }
}

// ── Token via Client Credentials (fallback, limited permissions) ──────────────
async function getClientToken() {
    if (clientTokenCache.token && Date.now() < clientTokenCache.expires) {
        return clientTokenCache.token;
    }

    const clientId     = process.env.SPOTIFY_CLIENT_ID;
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
        console.error('[Spotify] Client credentials token failed:', res.status, await res.text());
        return null;
    }

    const data = await res.json();
    clientTokenCache = {
        token: data.access_token,
        expires: Date.now() + (data.expires_in - 60) * 1000
    };
    console.log('[Spotify] Got client credentials token');
    return data.access_token;
}

// ── Best available token (partner preferred) ──────────────────────────────────
async function getBestToken() {
    return (await getPartnerToken()) || (await getClientToken());
}

async function spotifyGet(url) {
    const token = await getBestToken();
    if (!token) {
        console.error('[Spotify] No token available! Check SPOTIFY_SPDC, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
        return null;
    }

    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        }
    });

    if (!res.ok) {
        const body = await res.text();
        console.error('[Spotify] API error:', res.status, url, body);
        // If 401/403, clear cached tokens so next call tries fresh
        if (res.status === 401 || res.status === 403) {
            partnerTokenCache = { token: null, expires: 0 };
            clientTokenCache  = { token: null, expires: 0 };
        }
        return null;
    }

    return res.json();
}

// ── Playlist tracks ───────────────────────────────────────────────────────────
async function getPlaylistTracks(playlistId) {
    const info = await spotifyGet(`https://api.spotify.com/v1/playlists/${playlistId}?market=US`);
    if (!info) return { name: 'Unknown Playlist', tracks: [] };

    const tracks = [];
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

// ── Album tracks ──────────────────────────────────────────────────────────────
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

// ── Search query builder ──────────────────────────────────────────────────────
function toSearchQuery(track) {
    const artists = (track.artists || []).map(a => a.name).join(' ');
    return `ytsearch:${track.name} ${artists}`;
}

module.exports = { getPlaylistTracks, getAlbumTracks, toSearchQuery };
