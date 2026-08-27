const YouTube = require('youtube-sr').default;

async function getYouTubePlaylistTracks(url) {
    try {
        const playlist = await YouTube.getPlaylist(url, { fetchAll: true });
        if (!playlist || !playlist.videos) return [];
        return playlist.videos.map(video => ({
            title: video.title,
            artist: video.channel?.name || '',
            isUnresolved: true,
            requester: null // Set later
        }));
    } catch (err) {
        console.error('[YouTubeHelper] Error fetching playlist:', err);
        return [];
    }
}

async function getYouTubeSingleTrack(url) {
    try {
        // Use noembed API with 4s timeout to bypass IP blocks for single videos
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && !data.error && data.title) {
                return { name: data.title, artist: data.author_name || '' };
            }
        }
    } catch (_) {}

    try {
        const video = await Promise.race([
            YouTube.getVideo(url),
            new Promise((_, reject) => setTimeout(() => reject(new Error('YouTube scrape timeout')), 4000))
        ]);
        if (video && video.title) {
            return { name: video.title, artist: video.channel?.name || '' };
        }
    } catch (err) {
        console.warn('[YouTubeHelper] Video lookup failed or timed out:', err.message);
    }

    return null;
}

module.exports = {
    getYouTubePlaylistTracks,
    getYouTubeSingleTrack
};
