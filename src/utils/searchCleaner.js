/**
 * Cleans song titles and generates robust fallback search queries for SoundCloud.
 */

function cleanTitle(title) {
    if (!title) return '';
    return title
        .replace(/\|.*$/, '') // Remove anything after a pipe "|" (e.g. | Animated Video)
        .replace(/\[[^\]]*\]/g, '') // Remove brackets [Official Video]
        .replace(/\((?:official|audio|video|lyrics|hd|hq|4k|animated|visualizer|clip|music video|prod\.)[^\)]*\)/gi, '')
        .replace(/[—–]/g, '-')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function baseTitle(title) {
    if (!title) return '';
    // Strip everything inside parentheses or brackets completely
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
    const arabicPart = (title.match(/[\u0600-\u06FF\s\d]+/g) || []).join(' ').replace(/\s+/g, ' ').trim();

    // 1. Artist + Cleaned title on YouTube (full-length 48kHz Opus)
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`ytsearch:${artist} - ${cleaned}`.trim());
        queries.push(`ytsearch:${cleaned} ${artist}`.trim());
    }

    // 2. Cleaned title on YouTube
    if (cleaned) {
        queries.push(`ytsearch:${cleaned}`.trim());
    }

    // 3. Arabic title segment
    if (arabicPart && arabicPart.length > 2) {
        queries.push(`ytsearch:${arabicPart}`.trim());
    }

    // 4. Base title + artist on YouTube
    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`ytsearch:${base} ${artist}`.trim());
    }

    // 5. Raw title on YouTube
    if (title && title !== cleaned) {
        queries.push(`ytsearch:${title}`.trim());
    }

    // 6. SoundCloud as fallback
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
