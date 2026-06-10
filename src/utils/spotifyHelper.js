const { getTracks, getData } = require('spotify-url-info')(fetch);

// ── Helpers ───────────────────────────────────────────────────────────────────
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(id));
}

// ── Spotify Anonymous Token (Embed Page Extraction) ───────────────────────────
// Extracts a short-lived access token directly from Spotify's embed page HTML.
// Works universally on any network — no separate auth endpoints needed.
let _cachedToken = null;
let _tokenExpiry = 0;

async function getSpotifyToken(seedId) {
    if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

    try {
        const embedId = seedId || '37i9dQZF1DXcBWIGoYBM5M';
        const resp = await fetchWithTimeout(
            `https://open.spotify.com/embed/playlist/${embedId}`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } },
            8000 // 8 second timeout
        );
        const html = await resp.text();

        const tokenMatch = html.match(/"accessToken":"([^"]+)"/);
        if (!tokenMatch) throw new Error('Could not find accessToken in embed page');

        const expiryMatch = html.match(/"accessTokenExpirationTimestampMs":(\d+)/);
        const expiry = expiryMatch ? parseInt(expiryMatch[1]) : (Date.now() + 3600000);

        _cachedToken = tokenMatch[1];
        _tokenExpiry = expiry - 60000;
        console.log('[Spotify] Got access token from embed page');
        return _cachedToken;
    } catch (err) {
        console.error('[Spotify] Failed to get token from embed page:', err.message);
        return null;
    }
}

// ── Paginated Playlist Fetcher ────────────────────────────────────────────────
// Fetches ALL tracks from a public playlist by paginating the Spotify API.
// Hard cap of 30 seconds total to avoid hanging Discord interactions.
async function fetchAllPlaylistPages(playlistId, token) {
    const allTracks = [];
    let offset = 0;
    const LIMIT = 100;
    const deadline = Date.now() + 30000; // 30s hard cap

    while (Date.now() < deadline) {
        const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${LIMIT}&fields=total,next,items(track(name,artists(name),duration_ms,uri,is_local))`;

        let resp;
        try {
            resp = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } }, 8000);
        } catch (err) {
            console.error(`[Spotify] Fetch timeout/error at offset ${offset}:`, err.message);
            break;
        }

        // Handle rate limit — wait up to 5s max, then give up
        if (resp.status === 429) {
            const retryAfter = Math.min(parseInt(resp.headers.get('retry-after') || '2'), 5) * 1000;
            console.warn(`[Spotify] Rate limited. Waiting ${retryAfter}ms...`);
            await new Promise(r => setTimeout(r, retryAfter));
            // Retry once more
            try {
                resp = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } }, 8000);
            } catch {
                break;
            }
        }

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
        const token = await getSpotifyToken(playlistId);
        if (token) {
            const tracks = await fetchAllPlaylistPages(playlistId, token);
            if (tracks.length > 0) {
                let name = 'Spotify Playlist';
                try {
                    const data = await getData(`https://open.spotify.com/playlist/${playlistId}`);
                    name = data?.name || name;
                } catch {}
                return { name, tracks };
            }
        }

        // Fallback to embed scraper (max ~50 tracks but always works)
        console.warn('[Spotify] Falling back to embed scraper');
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
            const deadline = Date.now() + 30000;

            while (Date.now() < deadline) {
                const url = `https://api.spotify.com/v1/albums/${albumId}/tracks?offset=${offset}&limit=${LIMIT}`;
                let resp;
                try {
                    resp = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } }, 8000);
                } catch { break; }

                if (!resp.ok) break;

                const page = await resp.json();

                if (offset === 0) {
                    try {
                        const albumResp = await fetchWithTimeout(
                            `https://api.spotify.com/v1/albums/${albumId}`,
                            { headers: { 'Authorization': `Bearer ${token}` } },
                            8000
                        );
                        if (albumResp.ok) {
                            const albumData = await albumResp.json();
                            albumName = albumData.name ? `${albumData.name} — ${albumData.artists?.[0]?.name || ''}` : albumName;
                        }
                    } catch {}
                }

                const items = (page.items || [])
                    .filter(t => t && t.name)
                    .map(t => ({ name: t.name, artist: (t.artists || []).map(a => a.name).join(', ') }));

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
            tracks = data.trackList.map(t => ({ name: t.title, artist: t.subtitle }));
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
