const logger = require('../utils/logger');
const { validateExternalUrl } = require('../utils/ssrfGuard');
const { buildSearchQueries, cleanTitle } = require('../utils/searchCleaner');
const { getPlaylistTracks, getAlbumTracks, getArtistTracks, getSingleTrack } = require('../utils/spotifyHelper');
const { getYouTubePlaylistTracks, getYouTubeSingleTrack } = require('../utils/youtubeHelper');
const { createUnresolvedTrack, getTrackTitle, getTrackArtist, getTrackIdentifier } = require('../utils/trackUtils');

const URL_REGEX = /^https?:\/\//i;
const SPOTIFY_URL = /(?:open\.spotify\.com|spotify\.link|spotify:)/i;
const SPOTIFY_PLAYLIST = /(?:open\.spotify\.com\/|spotify:)(?:[a-zA-Z0-9_-]+\/)?playlist[\/:]([A-Za-z0-9]+)/i;
const SPOTIFY_ALBUM = /(?:open\.spotify\.com\/|spotify:)(?:[a-zA-Z0-9_-]+\/)?album[\/:]([A-Za-z0-9]+)/i;
const SPOTIFY_ARTIST = /(?:open\.spotify\.com\/|spotify:)(?:[a-zA-Z0-9_-]+\/)?artist[\/:]([A-Za-z0-9]+)/i;
const SPOTIFY_TRACK = /(?:open\.spotify\.com\/|spotify:)(?:[a-zA-Z0-9_-]+\/)?track[\/:]([A-Za-z0-9]+)/i;

const YOUTUBE_URL = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;
const YOUTUBE_PLAYLIST = /(?:youtube\.com\/(?:playlist\?list=|watch\?.*list=)|music\.youtube\.com\/(?:playlist\?list=|watch\?.*list=))([A-Za-z0-9_-]+)/i;
const YOUTUBE_VIDEO = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

const SOUNDCLOUD_URL = /(?:soundcloud\.com|on\.soundcloud\.com)/i;
const APPLE_MUSIC_URL = /music\.apple\.com/i;
const DEEZER_URL = /deezer\.(?:com|page\.link)/i;
const TIDAL_URL = /tidal\.com/i;

const JUNK_VERSION_PATTERNS = [
    { key: 'remix', re: /\bremix\b/i },
    { key: 'sped up', re: /\bsped[\s-]?up\b|\bspeed[\s-]?up\b/i },
    { key: 'slowed', re: /\bslowed\b/i },
    { key: 'reverb', re: /\breverb\b/i },
    { key: 'nightcore', re: /\bnightcore\b/i },
    { key: 'karaoke', re: /\bkaraoke\b|\binstrumental\b/i },
    { key: 'cover', re: /\bcover\b/i },
    { key: 'acapella', re: /\bacapella\b|\ba cappella\b/i },
    { key: 'reaction', re: /\breaction\b|\breacts\b/i },
    { key: 'live', re: /\blive\b|\bconcert\b/i },
    { key: 'bass boosted', re: /\bbass[\s-]?boost(?:ed)?\b/i },
    { key: '8d', re: /\b8d\b/i }
];

/**
 * Simple bounded TTL cache so repeated lookups don't hit external APIs or leak memory.
 */
class BoundedCache {
    constructor(maxEntries = 400, ttlMs = 15 * 60 * 1000) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.map.delete(key);
            return undefined;
        }
        // Refresh insertion order (LRU)
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.map.has(key)) this.map.delete(key);
        while (this.map.size >= this.maxEntries) {
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
        }
        this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }

    clear() {
        this.map.clear();
    }
}

function isPreviewTrack(track) {
    if (!track) return false;
    const uri = track.info?.uri || track.uri || '';
    if (uri.includes('/preview/')) return true;
    if (track.pluginInfo?.isPreview) return true;
    // SoundCloud preview snippets are typically exactly ~30000ms with preview indicator
    if (track.info?.sourceName === 'soundcloud' && track.info?.length > 0 && track.info.length <= 31000 && uri.includes('preview')) {
        return true;
    }
    return false;
}

function normalizeTokens(str) {
    return cleanTitle(String(str || '').toLowerCase())
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
}

/**
 * Scores a Lavalink candidate track against the intended query/metadata.
 * Higher score wins. Deprioritizes covers/remixes/reactions/live unless requested.
 * Supports short tracks (<55s) and livestreams without false rejection.
 */
function scoreTrackCandidate(track, context = {}) {
    if (!track || isPreviewTrack(track)) return -10000;

    const query = String(context.query || '');
    const expectedTitle = String(context.expectedTitle || query);
    const expectedArtist = String(context.expectedArtist || '');
    const expectedDuration = Number(context.expectedDuration || 0);
    const expectedIsrc = context.expectedIsrc || null;

    const title = track.info?.title || '';
    const author = track.info?.author || '';
    const titleLower = title.toLowerCase();
    const authorLower = author.toLowerCase();
    const queryLower = `${query} ${expectedTitle} ${expectedArtist}`.toLowerCase();

    let score = 0;

    // 1. Exact ISRC match is definitive
    if (expectedIsrc && track.info?.isrc && track.info.isrc === expectedIsrc) {
        score += 120;
    }

    // 2. Title token overlap
    const expectedTokens = normalizeTokens(expectedTitle);
    const candidateTokens = new Set(normalizeTokens(`${title} ${author}`));
    if (expectedTokens.length > 0) {
        let matched = 0;
        for (const tok of expectedTokens) {
            if (candidateTokens.has(tok)) matched += 1;
        }
        score += Math.round((matched / expectedTokens.length) * 45);
    }

    // 3. Artist match
    if (expectedArtist) {
        const artistTokens = normalizeTokens(expectedArtist);
        if (artistTokens.length > 0) {
            const artistMatched = artistTokens.filter(t => authorLower.includes(t) || titleLower.includes(t)).length;
            score += Math.round((artistMatched / artistTokens.length) * 35);
        }
    }

    // 4. Official audio / Topic channel preference
    if (authorLower.endsWith(' - topic') || authorLower.includes('vevo') || authorLower.includes('official')) {
        score += 18;
    }
    if (titleLower.includes('official audio') || titleLower.includes('official music video')) {
        score += 10;
    }
    if (track.info?.sourceName === 'youtube' || track.info?.sourceName === 'youtubemusic') {
        score += 5;
    }

    // 5. Duration match if expected duration is known (> 0)
    const length = track.info?.length || 0;
    if (expectedDuration > 0 && length > 0 && !track.info?.isStream) {
        const diff = Math.abs(length - expectedDuration);
        if (diff <= 4000) score += 25;
        else if (diff <= 10000) score += 12;
        else if (diff > 45000) score -= 25;
    }

    // 6. Penalize ultra-long compilations/1-hour loops unless requested
    if (!track.info?.isStream && length > 20 * 60 * 1000 && !/hour|mix|podcast|full album|live|concert|set/i.test(queryLower)) {
        score -= 40;
    }

    // 7. Deprioritize unwanted variants unless the user explicitly requested them
    for (const variant of JUNK_VERSION_PATTERNS) {
        const userAsked = variant.re.test(queryLower);
        const inCandidate = variant.re.test(titleLower) || variant.re.test(authorLower);
        if (inCandidate && !userAsked) {
            score -= 35;
        }
    }

    return score;
}

class TrackResolver {
    constructor(manager, options = {}) {
        this.manager = manager;
        this.maxPlaylistSize = Number(options.maxPlaylistSize || process.env.MAX_PLAYLIST_SIZE || 250);
        this.cache = new BoundedCache(400, 15 * 60 * 1000);
        this.lavalinkResolveTimeoutMs = Number(options.lavalinkResolveTimeoutMs || 10000);
    }

    async _resolveOnNode(identifier) {
        const node = this.manager.getActiveNode();
        if (!node) throw new Error('No Lavalink nodes are currently available.');

        let timer = null;
        try {
            return await Promise.race([
                node.rest.resolve(identifier),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`Lavalink resolve timeout for "${identifier}"`)), this.lavalinkResolveTimeoutMs);
                    if (timer.unref) timer.unref();
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    _selectBestTracks(tracks, context = {}, limit = 1) {
        const valid = (tracks || []).filter(t => t && !isPreviewTrack(t));
        if (!valid.length) return [];

        const scored = valid.map(track => ({
            track,
            score: scoreTrackCandidate(track, context)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(s => s.track);
    }

    async resolveRaw(identifier, requester = null, context = {}) {
        const start = Date.now();
        const result = await this._resolveOnNode(identifier);
        const durationMs = Date.now() - start;

        if (!result) return null;

        logger.debug('TrackResolver', 'Lavalink resolved identifier', {
            identifier: identifier.startsWith('http') ? '[URL]' : identifier,
            loadType: result.loadType,
            resolveMs: durationMs
        });

        switch (result.loadType) {
            case 'track': {
                const track = result.data;
                if (!track || isPreviewTrack(track)) return null;
                track.requester = requester;
                return { type: 'track', tracks: [track], playlistName: null };
            }
            case 'search': {
                const best = this._selectBestTracks(result.data, { ...context, query: context.query || identifier }, context.limit || 1);
                if (!best.length) return null;
                best.forEach(t => { t.requester = requester; });
                return { type: 'search', tracks: best, playlistName: null };
            }
            case 'playlist': {
                const rawTracks = (result.data?.tracks || []).filter(t => t && !isPreviewTrack(t));
                const capped = rawTracks.slice(0, this.maxPlaylistSize);
                capped.forEach(t => { t.requester = requester; });
                const name = result.data?.info?.name || result.data?.pluginInfo?.name || 'Playlist';
                return {
                    type: 'playlist',
                    tracks: capped,
                    totalTracks: rawTracks.length,
                    truncated: rawTracks.length > this.maxPlaylistSize,
                    playlistName: name
                };
            }
            case 'empty':
                return null;
            case 'error': {
                const msg = result.data?.message || 'Lavalink failed to load the track.';
                throw new Error(msg);
            }
            default:
                return null;
        }
    }

    async _expandSpotifyShortLink(url) {
        try {
            const check = await validateExternalUrl(url, { checkRedirects: false });
            if (!check.safe) return url;
            const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(4000) });
            if (res.url && SPOTIFY_URL.test(res.url)) {
                return res.url;
            }
        } catch (_) {}
        return url;
    }

    /**
     * Resolves any user query (URL or search phrase) into playable tracks or lazy unresolved tracks.
     */
    async resolveInput(rawQuery, requester = null, options = {}) {
        const startedAt = Date.now();
        let query = String(rawQuery || '').trim();
        if (!query) return null;

        if (query.includes('spotify.link/')) {
            query = await this._expandSpotifyShortLink(query);
        }

        // Reject unsupported private Spotify links cleanly
        if (query.includes('spotify.com/collection') || query.includes('spotify.com/user')) {
            throw new Error('Private Spotify collections ("Liked Songs") cannot be loaded. Please share a public playlist URL.');
        }

        // 1. Direct URL handling (with SSRF check for arbitrary URLs)
        if (URL_REGEX.test(query)) {
            if (SPOTIFY_URL.test(query)) {
                return this._resolveSpotifyUrl(query, requester, startedAt);
            }

            if (YOUTUBE_URL.test(query)) {
                return this._resolveYouTubeUrl(query, requester, startedAt);
            }

            if (SOUNDCLOUD_URL.test(query) || APPLE_MUSIC_URL.test(query) || DEEZER_URL.test(query) || TIDAL_URL.test(query)) {
                try {
                    const res = await this.resolveRaw(query, requester);
                    if (res && res.tracks.length) return res;
                } catch (err) {
                    if (APPLE_MUSIC_URL.test(query) || DEEZER_URL.test(query) || TIDAL_URL.test(query)) {
                        throw new Error(`This platform source is not enabled or failed on Lavalink: ${err.message}`);
                    }
                    throw err;
                }
                return null;
            }

            // Arbitrary HTTP/HTTPS audio URL or radio stream -> SSRF guard required.
            // NOTE: Even with SSRF guard, Lavalink makes the final HTTP request,
            // bypassing the bot's network layer. HTTP sources are disabled in
            // lavalink/application.yml by default (http: false). Re-enable there
            // AND set ALLOW_HTTP_STREAMS=true in .env only if you need radio streams.
            if (process.env.ALLOW_HTTP_STREAMS !== 'true') {
                throw new Error('Direct audio URL streaming is disabled. Set ALLOW_HTTP_STREAMS=true in .env and http: true in lavalink/application.yml to enable it.');
            }
            const ssrf = await validateExternalUrl(query);
            if (!ssrf.safe) {
                throw new Error(`Blocked unsafe URL: ${ssrf.reason}`);
            }
            return this.resolveRaw(ssrf.url, requester);
        }

        // 2. Direct Lavalink prefix (e.g., ytsearch:, ytmsearch:, scsearch:, spsearch:)
        if (/^(?:ytsearch|ytmsearch|scsearch|spsearch|amsearch|dzsearch):/i.test(query)) {
            return this.resolveRaw(query, requester, { query, limit: options.limit || 1 });
        }

        // 3. Plain text search (prefer YouTube Music -> YouTube -> SoundCloud)
        return this.searchText(query, requester, options);
    }

    async searchText(query, requester = null, options = {}) {
        const limit = options.limit || 1;
        const cacheKey = `search:${limit}:${query.toLowerCase()}`;
        if (limit === 1) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                const cloned = cached.tracks.map(t => ({ ...t, requester }));
                return { ...cached, tracks: cloned };
            }
        }

        const prefixes = ['ytmsearch:', 'ytsearch:', 'scsearch:'];
        let lastErr = null;

        for (const prefix of prefixes) {
            try {
                const res = await this.resolveRaw(`${prefix}${query}`, requester, {
                    query,
                    expectedTitle: options.expectedTitle || query,
                    expectedArtist: options.expectedArtist || '',
                    expectedDuration: options.expectedDuration || 0,
                    expectedIsrc: options.expectedIsrc || null,
                    limit
                });
                if (res && res.tracks.length) {
                    if (limit === 1) this.cache.set(cacheKey, res);
                    return res;
                }
            } catch (err) {
                lastErr = err;
                logger.warn('TrackResolver', `Search prefix ${prefix} failed`, { err: err.message });
            }
        }

        if (lastErr) throw lastErr;
        return null;
    }

    async _resolveYouTubeUrl(url, requester) {
        const isPlaylist = YOUTUBE_PLAYLIST.test(url);
        const isVideo = YOUTUBE_VIDEO.test(url);

        if (!isPlaylist && !isVideo) {
            throw new Error('Unsupported YouTube URL. Please provide a valid YouTube video or playlist link.');
        }

        // 1. Primary: Lavalink YouTube plugin + YT-Cipher
        let primaryErr = null;
        try {
            const res = await this.resolveRaw(url, requester);
            if (res && res.tracks.length) return res;
        } catch (err) {
            primaryErr = err;
            logger.warn('TrackResolver', 'Lavalink YouTube resolution failed, trying fallback metadata', { err: err.message });
        }

        // 2. Fallback: youtube-sr / noembed metadata -> JIT search
        if (isPlaylist) {
            const tracks = await getYouTubePlaylistTracks(url);
            if (!tracks.length) {
                if (primaryErr) throw primaryErr;
                return null;
            }
            const capped = tracks.slice(0, this.maxPlaylistSize).map(t => createUnresolvedTrack({
                title: t.title,
                artist: t.artist,
                sourceName: 'youtube'
            }, requester));
            return {
                type: 'playlist',
                tracks: capped,
                totalTracks: tracks.length,
                truncated: tracks.length > this.maxPlaylistSize,
                playlistName: 'YouTube Playlist'
            };
        }

        const video = await getYouTubeSingleTrack(url);
        if (video && video.name) {
            const queries = buildSearchQueries(video.name, video.artist);
            for (const q of queries) {
                try {
                    const res = await this.resolveRaw(q, requester, {
                        query: `${video.name} ${video.artist}`,
                        expectedTitle: video.name,
                        expectedArtist: video.artist
                    });
                    if (res && res.tracks.length) return res;
                } catch (_) {}
            }
        }
        if (primaryErr) throw primaryErr;
        return null;
    }

    async _resolveSpotifyUrl(url, requester) {
        // 1. Try LavaSrc native Spotify resolution first if enabled on Lavalink
        try {
            const res = await this.resolveRaw(url, requester);
            if (res && res.tracks.length) {
                // LavaSrc can return a playlist of resolved/lazy tracks directly
                return res;
            }
        } catch (err) {
            logger.warn('TrackResolver', 'LavaSrc Spotify direct resolve failed, using Spotify helper fallback', { err: err.message });
        }

        // 2. Fallback: Spotify API / embed metadata helper -> lazy unresolved tracks
        const playlistMatch = url.match(SPOTIFY_PLAYLIST);
        if (playlistMatch) {
            const { name, tracks } = await getPlaylistTracks(playlistMatch[1]);
            if (!tracks.length) {
                throw new Error('Could not load the Spotify playlist. Make sure it is public.');
            }
            const capped = tracks.slice(0, this.maxPlaylistSize).map(t => createUnresolvedTrack({
                title: t.name,
                artist: t.artist,
                sourceName: 'spotify'
            }, requester));
            return {
                type: 'playlist',
                tracks: capped,
                totalTracks: tracks.length,
                truncated: tracks.length > this.maxPlaylistSize,
                playlistName: name
            };
        }

        const albumMatch = url.match(SPOTIFY_ALBUM);
        if (albumMatch) {
            const { name, tracks } = await getAlbumTracks(albumMatch[1]);
            if (!tracks.length) throw new Error('Could not load the Spotify album.');
            const capped = tracks.slice(0, this.maxPlaylistSize).map(t => createUnresolvedTrack({
                title: t.name,
                artist: t.artist,
                sourceName: 'spotify'
            }, requester));
            return {
                type: 'playlist',
                tracks: capped,
                totalTracks: tracks.length,
                truncated: tracks.length > this.maxPlaylistSize,
                playlistName: name
            };
        }

        const artistMatch = url.match(SPOTIFY_ARTIST);
        if (artistMatch) {
            const { name, tracks } = await getArtistTracks(artistMatch[1]);
            if (!tracks.length) throw new Error('Could not load the Spotify artist top tracks.');
            const capped = tracks.slice(0, this.maxPlaylistSize).map(t => createUnresolvedTrack({
                title: t.name,
                artist: t.artist,
                sourceName: 'spotify'
            }, requester));
            return {
                type: 'playlist',
                tracks: capped,
                totalTracks: tracks.length,
                truncated: tracks.length > this.maxPlaylistSize,
                playlistName: name
            };
        }

        const trackMatch = url.match(SPOTIFY_TRACK);
        if (trackMatch) {
            const data = await getSingleTrack(trackMatch[1]);
            if (!data || !data.name) throw new Error('Could not fetch Spotify track metadata.');
            return this.resolveUnresolvedTrack(createUnresolvedTrack({
                title: data.name,
                artist: data.artist,
                sourceName: 'spotify'
            }, requester));
        }

        throw new Error('Unsupported or unrecognized Spotify link format.');
    }

    /**
     * Resolves an unresolved metadata track into a playable Lavalink track.
     */
    async resolveUnresolvedTrack(track, options = {}) {
        const title = getTrackTitle(track);
        const artist = getTrackArtist(track);
        const requester = track.requester || null;
        const skipYouTube = Boolean(options.skipYouTube);

        const queries = [];
        if (track.isrc) queries.push(`ytmsearch:"${track.isrc}"`);
        queries.push(...buildSearchQueries(title, artist === 'Unknown Artist' ? '' : artist));

        for (const q of queries) {
            if (skipYouTube && (q.startsWith('ytsearch:') || q.startsWith('ytmsearch:'))) continue;
            try {
                const res = await this.resolveRaw(q, requester, {
                    query: `${title} ${artist}`,
                    expectedTitle: title,
                    expectedArtist: artist === 'Unknown Artist' ? '' : artist,
                    expectedDuration: track.duration || 0,
                    expectedIsrc: track.isrc || null
                });
                if (res && res.tracks.length) {
                    const resolved = res.tracks[0];
                    resolved.requester = requester;
                    return resolved;
                }
            } catch (_) {}
        }

        return null;
    }

    /**
     * Finds artist candidates and/or artist tracks for /artist.
     */
    async searchArtist(input, requester = null) {
        const trimmed = String(input || '').trim();
        if (!trimmed) return { artists: [], tracks: [], playlistName: null };

        // Direct Spotify artist URL
        const spMatch = trimmed.match(SPOTIFY_ARTIST);
        if (spMatch) {
            const { name, tracks } = await getArtistTracks(spMatch[1]);
            return {
                artists: [],
                tracks: tracks.map(t => createUnresolvedTrack({ title: t.name, artist: t.artist, sourceName: 'spotify' }, requester)),
                playlistName: name
            };
        }

        // Direct YouTube/SoundCloud/Apple/Deezer/Tidal artist URL
        if (URL_REGEX.test(trimmed)) {
            const res = await this.resolveInput(trimmed, requester);
            return {
                artists: [],
                tracks: res?.tracks || [],
                playlistName: res?.playlistName || trimmed
            };
        }

        // Search top tracks on YouTube Music for the artist query and group distinct artists
        const res = await this.resolveRaw(`ytmsearch:${trimmed}`, requester, {
            query: trimmed,
            expectedArtist: trimmed,
            limit: 12
        }).catch(() => null) || await this.resolveRaw(`ytsearch:${trimmed} top songs`, requester, {
            query: trimmed,
            expectedArtist: trimmed,
            limit: 12
        }).catch(() => null);

        if (!res || !res.tracks.length) {
            return { artists: [], tracks: [], playlistName: null };
        }

        const byArtist = new Map();
        for (const track of res.tracks) {
            const author = (track.info?.author || 'Unknown Artist').replace(/\s*-\s*Topic$/i, '').trim();
            const key = author.toLowerCase();
            if (!byArtist.has(key)) {
                byArtist.set(key, { name: author, tracks: [] });
            }
            byArtist.get(key).tracks.push(track);
        }

        const artists = [...byArtist.values()];
        // If there's a single dominant exact match or only 1 artist group, return directly
        if (artists.length === 1) {
            return { artists: [], tracks: artists[0].tracks, playlistName: `${artists[0].name} — Popular Tracks` };
        }

        return { artists: artists.slice(0, 8), tracks: [], playlistName: null };
    }

    /**
     * Autoplay recommendation lookup avoiding recently played tracks.
     */
    async findAutoplayTrack(seedTrack, excludedKeys = new Set(), requester = null) {
        if (!seedTrack) return null;
        const title = getTrackTitle(seedTrack);
        const artist = getTrackArtist(seedTrack);
        const seedId = seedTrack.info?.identifier;
        const source = seedTrack.info?.sourceName;

        const candidates = [];

        // 1. If YouTube track, try YouTube Mix playlist RD<videoId>
        if ((source === 'youtube' || source === 'youtubemusic') && seedId && /^[A-Za-z0-9_-]{11}$/.test(seedId)) {
            try {
                const mixRes = await this.resolveRaw(`https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`, requester);
                if (mixRes && mixRes.tracks.length) {
                    candidates.push(...mixRes.tracks);
                }
            } catch (_) {}
        }

        // 2. Fallback: search similar tracks by artist / title
        if (candidates.length < 3) {
            const query = artist && artist !== 'Unknown Artist' ? `${artist} songs` : `${cleanTitle(title)} mix`;
            try {
                const searchRes = await this.resolveRaw(`ytmsearch:${query}`, requester, { query, limit: 8 });
                if (searchRes && searchRes.tracks.length) {
                    candidates.push(...searchRes.tracks);
                }
            } catch (_) {}
        }

        for (const cand of candidates) {
            const key = getTrackIdentifier(cand);
            const candTitle = cleanTitle(getTrackTitle(cand)).toLowerCase();
            if (!excludedKeys.has(key) && !excludedKeys.has(candTitle)) {
                cand.requester = requester;
                return cand;
            }
        }

        return null;
    }
}

module.exports = TrackResolver;
module.exports.BoundedCache = BoundedCache;
module.exports.scoreTrackCandidate = scoreTrackCandidate;
module.exports.isPreviewTrack = isPreviewTrack;
