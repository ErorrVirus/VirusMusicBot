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
        // Use noembed API to bypass IP blocks for single videos
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        
        if (!data || data.error) {
            // Fallback to youtube-sr if noembed fails
            const video = await YouTube.getVideo(url);
            if (!video) return null;
            return { name: video.title, artist: video.channel?.name || '' };
        }
        
        return {
            name: data.title,
            artist: data.author_name || ''
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
