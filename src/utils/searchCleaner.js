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

    // 1. Artist + Cleaned title on SoundCloud (most accurate for original songs)
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${artist} - ${cleaned}`.trim());
        queries.push(`scsearch:${cleaned} ${artist}`.trim());
    }

    // 2. Cleaned title on SoundCloud
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`.trim());
    }

    // 3. Arabic title segment (essential for Arabic music like Moscow, Wegz, etc.)
    if (arabicPart && arabicPart.length > 2) {
        queries.push(`scsearch:${arabicPart}`.trim());
    }

    // 4. Base title + artist on SoundCloud
    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${base} ${artist}`.trim());
    }

    // 5. Raw title fallback
    if (title && title !== cleaned) {
        queries.push(`scsearch:${title}`.trim());
    }

    // 6. YouTube search as secondary backup
    if (cleaned) {
        queries.push(`ytsearch:${cleaned}`.trim());
    }

    return [...new Set(queries.map(q => q.trim()).filter(Boolean))];
}

module.exports = {
    cleanTitle,
    baseTitle,
    buildSearchQueries
};
