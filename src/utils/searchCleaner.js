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

function buildSearchQueries(title, artist = '') {
    const cleaned = cleanTitle(title);
    const queries = [];

    // 1. Cleaned title alone (YouTube titles almost always include the actual artist)
    if (cleaned) {
        queries.push(`scsearch:${cleaned}`);
    }

    // 2. Cleaned title + artist (if artist is not already in the title)
    if (artist && !cleaned.toLowerCase().includes(artist.toLowerCase())) {
        queries.push(`scsearch:${cleaned} ${artist}`.trim());
    }

    // 3. Raw title fallback
    queries.push(`scsearch:${title}`);

    // 4. Raw title + artist fallback
    if (artist) {
        queries.push(`scsearch:${title} ${artist}`.trim());
    }

    return [...new Set(queries)];
}

module.exports = {
    cleanTitle,
    buildSearchQueries
};
