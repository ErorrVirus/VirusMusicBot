/**
 * Cleans song titles and generates prioritized search queries for TrackResolver.
 */

function cleanTitle(title) {
    if (!title) return '';
    return title
        .replace(/\|.*$/, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\((?:official|audio|video|lyrics|hd|hq|4k|animated|visualizer|clip|music video|prod\.)[^\)]*\)/gi, '')
        .replace(/[—–]/g, '-')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function baseTitle(title) {
    if (!title) return '';
    return title
        .replace(/\|.*$/, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\([^\)]*\)/g, '')
        .replace(/[—–]/g, '-')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildSearchQueries(title, artist = '') {
    const cleaned = cleanTitle(title);
    const base = baseTitle(title);
    const queries = [];
    const arabicPart = (String(title || '').match(/[\u0600-\u06FF\s\d]+/g) || []).join(' ').replace(/\s+/g, ' ').trim();

    // 1. Prefer YouTube Music (ytmsearch) for clean official studio audio
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`ytmsearch:${artist} - ${cleaned}`.trim());
        queries.push(`ytsearch:${artist} - ${cleaned}`.trim());
    }

    if (cleaned) {
        queries.push(`ytmsearch:${cleaned}`.trim());
        queries.push(`ytsearch:${cleaned}`.trim());
    }

    if (arabicPart && arabicPart.length > 2) {
        queries.push(`ytmsearch:${arabicPart}`.trim());
        queries.push(`ytsearch:${arabicPart}`.trim());
    }

    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`ytsearch:${base} ${artist}`.trim());
    }

    if (title && title !== cleaned) {
        queries.push(`ytsearch:${title}`.trim());
    }

    // SoundCloud fallback
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${artist} - ${cleaned}`.trim());
    }
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`.trim());
    }

    return [...new Set(queries.map(q => q.trim()).filter(Boolean))];
}

module.exports = {
    cleanTitle,
    baseTitle,
    buildSearchQueries
};
