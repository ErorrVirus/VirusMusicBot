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

    // 1. Cleaned title + artist (e.g. "Never Gonna Give You Up Rick Astley")
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${cleaned} ${artist}`.trim());
    }

    // 2. Base title + artist (e.g. "Criminal IRIAS" if "Criminal (Club version)" had special chars)
    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${base} ${artist}`.trim());
    }

    // 3. Cleaned title alone
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`);
    }

    // 4. Base title alone
    if (base && base !== cleaned) {
        queries.push(`scsearch:${base}`);
    }

    // 5. Raw title + artist fallback
    if (artist) {
        queries.push(`scsearch:${title} ${artist}`.trim());
    } else {
        queries.push(`scsearch:${title}`);
    }

    return [...new Set(queries.map(q => q.trim()).filter(Boolean))];
}

module.exports = {
    cleanTitle,
    baseTitle,
    buildSearchQueries
};
