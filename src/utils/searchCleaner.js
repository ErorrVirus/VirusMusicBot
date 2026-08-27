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

    // 1. Cleaned English title on SoundCloud and YouTube
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`);
        queries.push(`ytsearch:${cleaned}`);
    }

    // 2. Arabic title segment (essential for Arabic music on SoundCloud/YouTube)
    if (arabicPart && arabicPart.length > 2) {
        queries.push(`scsearch:${arabicPart}`);
        queries.push(`ytsearch:${arabicPart}`);
    }

    // 3. Cleaned title + artist
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${cleaned} ${artist}`.trim());
        queries.push(`ytsearch:${cleaned} ${artist}`.trim());
    }

    // 4. Base title + artist
    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${base} ${artist}`.trim());
        queries.push(`ytsearch:${base} ${artist}`.trim());
    }

    // 5. Raw title fallback
    if (title && title !== cleaned) {
        queries.push(`scsearch:${title}`.trim());
        queries.push(`ytsearch:${title}`.trim());
    }

    return [...new Set(queries.map(q => q.trim()).filter(Boolean))];
}

module.exports = {
    cleanTitle,
    baseTitle,
    buildSearchQueries
};
