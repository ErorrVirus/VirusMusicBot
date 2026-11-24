const { formatTime } = require('./helpers');

/**
 * Centralized metadata helpers supporting both resolved Lavalink tracks
 * (track.info.*) and unresolved/JIT-resolved tracks (track.title, track.artist, etc.).
 */

function isUnresolvedTrack(track) {
    return Boolean(track && (track.isUnresolved || !track.encoded));
}

function getTrackTitle(track) {
    if (!track) return 'Unknown Track';
    return track.info?.title || track.title || track.name || 'Unknown Track';
}

function getTrackArtist(track) {
    if (!track) return 'Unknown Artist';
    return track.info?.author || track.artist || track.author || 'Unknown Artist';
}

function getTrackUri(track) {
    if (!track) return '';
    return track.info?.uri || track.uri || '';
}

function getTrackDuration(track) {
    if (!track) return 0;
    const len = track.info?.length ?? track.duration ?? track.length ?? 0;
    return Number.isFinite(len) && len >= 0 ? len : 0;
}

function isTrackStream(track) {
    if (!track) return false;
    if (track.info?.isStream !== undefined) return Boolean(track.info.isStream);
    return Boolean(track.isStream);
}

function isTrackSeekable(track) {
    if (!track) return false;
    if (track.info?.isSeekable !== undefined) return Boolean(track.info.isSeekable);
    return !isTrackStream(track) && getTrackDuration(track) > 0;
}

function getTrackArtwork(track) {
    if (!track) return null;
    return track.info?.artworkUrl || track.artworkUrl || track.thumbnail || null;
}

function getTrackSource(track) {
    if (!track) return 'unknown';
    return track.info?.sourceName || track.sourceName || (track.isUnresolved ? 'metadata' : 'unknown');
}

function getTrackIsrc(track) {
    if (!track) return null;
    return track.info?.isrc || track.isrc || null;
}

function getTrackIdentifier(track) {
    if (!track) return '';
    return track.info?.identifier || track.identifier || getTrackUri(track) || `${getTrackTitle(track)}::${getTrackArtist(track)}`;
}

function formatTrackDuration(track) {
    if (isTrackStream(track)) return 'LIVE';
    const ms = getTrackDuration(track);
    if (!ms) return '??:??';
    return formatTime(ms);
}

function formatTrackLink(track, bold = false) {
    const title = getTrackTitle(track);
    const uri = getTrackUri(track);
    const safeTitle = bold ? `**${title}**` : title;
    return uri ? `[${safeTitle}](${uri})` : safeTitle;
}

function createUnresolvedTrack(data, requester = null) {
    return {
        isUnresolved: true,
        title: data.title || data.name || 'Unknown Track',
        artist: data.artist || data.author || '',
        duration: Number.isFinite(data.duration) ? data.duration : 0,
        uri: data.uri || '',
        artworkUrl: data.artworkUrl || null,
        isrc: data.isrc || null,
        album: data.album || null,
        sourceName: data.sourceName || 'spotify',
        requester
    };
}

/**
 * Serializes a track into a compact JSON-safe structure for SQLite persistence
 * (favorites, history, custom playlists, saved queues). Never stores voice tokens.
 */
function serializeTrack(track) {
    if (!track) return null;
    return {
        encoded: track.encoded || null,
        isUnresolved: isUnresolvedTrack(track),
        title: getTrackTitle(track),
        artist: getTrackArtist(track),
        duration: getTrackDuration(track),
        uri: getTrackUri(track),
        artworkUrl: getTrackArtwork(track),
        isrc: getTrackIsrc(track),
        sourceName: getTrackSource(track),
        isStream: isTrackStream(track),
        isSeekable: isTrackSeekable(track),
        identifier: getTrackIdentifier(track),
        requesterId: track.requester?.id || null,
        requesterTag: track.requester?.username || track.requester?.tag || null
    };
}

function deserializeTrack(raw) {
    if (!raw) return null;
    const requester = raw.requesterId
        ? { id: raw.requesterId, username: raw.requesterTag || 'Unknown' }
        : null;
    if (raw.encoded && !raw.isUnresolved) {
        return {
            encoded: raw.encoded,
            info: {
                identifier: raw.identifier || '',
                isSeekable: Boolean(raw.isSeekable),
                author: raw.artist || 'Unknown Artist',
                length: raw.duration || 0,
                isStream: Boolean(raw.isStream),
                position: 0,
                title: raw.title || 'Unknown Track',
                uri: raw.uri || '',
                artworkUrl: raw.artworkUrl || null,
                isrc: raw.isrc || null,
                sourceName: raw.sourceName || 'unknown'
            },
            pluginInfo: {},
            requester
        };
    }
    return createUnresolvedTrack(raw, requester);
}

module.exports = {
    isUnresolvedTrack,
    getTrackTitle,
    getTrackArtist,
    getTrackUri,
    getTrackDuration,
    isTrackStream,
    isTrackSeekable,
    getTrackArtwork,
    getTrackSource,
    getTrackIsrc,
    getTrackIdentifier,
    formatTrackDuration,
    formatTrackLink,
    createUnresolvedTrack,
    serializeTrack,
    deserializeTrack
};
