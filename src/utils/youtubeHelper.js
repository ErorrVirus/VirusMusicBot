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
        const video = await YouTube.getVideo(url);
        if (!video) return null;
        return {
            name: video.title,
            artist: video.channel?.name || ''
        };
    } catch (err) {
        console.error('[YouTubeHelper] Error fetching video:', err);
        return null;
    }
}

module.exports = {
    getYouTubePlaylistTracks,
    getYouTubeSingleTrack
};
