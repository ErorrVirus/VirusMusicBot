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

function buildSearchQueries(title, artist = '', primaryPrefix = 'scsearch:') {
    const cleaned = cleanTitle(title);
    const base = baseTitle(title);
    const queries = [];

    // 1. YouTube cleaned title + artist
    if (artist && cleaned && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`${primaryPrefix}${cleaned} ${artist}`.trim());
    }

    // 2. YouTube base title + artist
    if (artist && base && !base.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`${primaryPrefix}${base} ${artist}`.trim());
    }

    // 3. YouTube cleaned title alone
    if (cleaned) {
        queries.push(`${primaryPrefix}${cleaned}`);
    }

    // 4. YouTube raw title + artist
    if (artist) {
        queries.push(`${primaryPrefix}${title} ${artist}`.trim());
    }

    // 5. Fallback to scsearch (SoundCloud) in case YouTube fails
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`);
    }

    return [...new Set(queries.map(q => q.trim()).filter(Boolean))];
}

module.exports = {
    cleanTitle,
    baseTitle,
    buildSearchQueries
};
