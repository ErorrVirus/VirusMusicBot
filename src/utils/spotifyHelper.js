const { getTracks, getData } = require('spotify-url-info')(fetch);

// ── Spotify Anonymous Token (Web Player Approach) ─────────────────────────────
// Gets a short-lived anonymous access token from Spotify's web player endpoint.
// This is the same token the embed player uses. No login needed.
let _cachedToken = null;
let _tokenExpiry = 0;

async function getSpotifyToken() {
    if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

    try {
        // Step 1: Get client token
        const clientResp = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                client_data: {
                    client_version: '1.2.52.442.g6c6c22e9',
                    client_id: 'd8a5ed958d274c2e8ee717e6a4b0971d',
                    js_sdk_data: {
                        device_brand: 'unknown', device_id: 'unknown',
                        device_model: 'unknown', device_type: 'computer',
                        os: 'linux', os_version: 'unknown'
                    }
                }
            })
        });
        const clientData = await clientResp.json();
        const clientToken = clientData.granted_token?.token;
        if (!clientToken) throw new Error('No client token in response');

        // Step 2: Exchange for access token
        const accessResp = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
            headers: {
                'client-token': clientToken,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Referer': 'https://open.spotify.com/',
                'spotify-app-version': '1.2.52.442.g6c6c22e9',
                'app-platform': 'WebPlayer',
            }
        });
        const accessData = await accessResp.json();
        const accessToken = accessData.accessToken;
        const expiresIn = accessData.accessTokenExpirationTimestampMs || (Date.now() + 3600000);

        if (!accessToken) throw new Error('No access token in response');

        _cachedToken = accessToken;
        _tokenExpiry = expiresIn - 60000; // Renew 1 min early
        return accessToken;
    } catch (err) {
        console.error('[Spotify] Failed to get anonymous token:', err.message);
        return null;
    }
}

// ── Paginated Playlist Fetcher ────────────────────────────────────────────────
// Fetches ALL tracks from a public Spotify playlist by paginating through
// the official API using the anonymous web player token.
async function fetchAllPlaylistPages(playlistId, token) {
    const allTracks = [];
    let offset = 0;
    const LIMIT = 100;

    while (true) {
        const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${LIMIT}&fields=total,next,items(track(name,artists(name),duration_ms,uri,is_local))`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!resp.ok) {
            console.error(`[Spotify] API error at offset ${offset}: ${resp.status}`);
            break;
        }

        const page = await resp.json();
        const items = (page.items || [])
            .filter(item => item?.track && !item.track.is_local && item.track.name)
            .map(item => ({
                name: item.track.name,
                artist: (item.track.artists || []).map(a => a.name).join(', ')
            }));

        allTracks.push(...items);
        console.log(`[Spotify] Fetched ${allTracks.length} / ${page.total} tracks`);

        if (!page.next || allTracks.length >= page.total) break;
        offset += LIMIT;
    }

    return allTracks;
}

// ── Public Functions ──────────────────────────────────────────────────────────

async function getPlaylistTracks(playlistId) {
    try {
        // Try paginated API first
        const token = await getSpotifyToken();
        if (token) {
            const tracks = await fetchAllPlaylistPages(playlistId, token);
            if (tracks.length > 0) {
                // Get playlist name via getData (uses embed, still works)
                let name = 'Spotify Playlist';
                try {
                    const data = await getData(`https://open.spotify.com/playlist/${playlistId}`);
                    name = data?.name || name;
                } catch {}
                return { name, tracks };
            }
        }

        // Fallback to spotify-url-info (max 50 tracks)
        console.warn('[Spotify] Falling back to embed scraper (max 50 tracks)');
        const url = `https://open.spotify.com/playlist/${playlistId}`;
        const data = await getData(url);
        const tracks = await getTracks(url);
        return {
            name: data?.name || 'Spotify Playlist',
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching playlist:', err);
        return { name: 'Unknown Playlist', tracks: [] };
    }
}

async function getAlbumTracks(albumId) {
    try {
        const token = await getSpotifyToken();
        if (token) {
            const allTracks = [];
            let offset = 0;
            const LIMIT = 50;
            let albumName = 'Unknown Album';

            while (true) {
                const url = `https://api.spotify.com/v1/albums/${albumId}/tracks?offset=${offset}&limit=${LIMIT}`;
                const resp = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!resp.ok) break;

                const page = await resp.json();

                if (offset === 0) {
                    // Get album info on first page
                    try {
                        const albumResp = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (albumResp.ok) {
                            const albumData = await albumResp.json();
                            albumName = albumData.name ? `${albumData.name} — ${albumData.artists?.[0]?.name || ''}` : albumName;
                        }
                    } catch {}
                }

                const items = (page.items || [])
                    .filter(t => t && t.name)
                    .map(t => ({
                        name: t.name,
                        artist: (t.artists || []).map(a => a.name).join(', ')
                    }));

                allTracks.push(...items);
                if (!page.next) break;
                offset += LIMIT;
            }

            if (allTracks.length > 0) return { name: albumName, tracks: allTracks };
        }

        // Fallback
        const url = `https://open.spotify.com/album/${albumId}`;
        const data = await getData(url);
        const tracks = await getTracks(url);
        return {
            name: data?.name ? `${data.name} — ${data.artists?.[0]?.name || ''}` : 'Unknown Album',
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching album:', err);
        return { name: 'Unknown Album', tracks: [] };
    }
}

async function getArtistTracks(artistId) {
    try {
        const url = `https://open.spotify.com/artist/${artistId}`;
        const data = await getData(url);

        let tracks = [];
        if (data && data.trackList) {
            tracks = data.trackList.map(t => ({
                name: t.title,
                artist: t.subtitle
            }));
        } else {
            const rawTracks = await getTracks(url);
            tracks = rawTracks.filter(t => t && t.name);
        }

        return {
            name: data?.name ? `${data.name} — Top Tracks` : 'Unknown Artist',
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching artist:', err);
        return { name: 'Unknown Artist', tracks: [] };
    }
}

function toSearchQuery(track) {
    const artist = track.artist || '';
    return `ytsearch:${track.name} ${artist} audio`;
}

module.exports = { getPlaylistTracks, getAlbumTracks, getArtistTracks, toSearchQuery };
