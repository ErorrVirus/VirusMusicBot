const { getTracks, getData } = require('spotify-url-info')(fetch);

async function getPlaylistTracks(playlistId) {
    try {
        const url = `https://open.spotify.com/playlist/${playlistId}`;
        const data = await getData(url);
        const tracks = await getTracks(url);
        
        return { 
            name: data?.name || 'Spotify Playlist', 
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching playlist:', err);
        return { name: 'Unknown Playlist', tracks: [] };
    }
}

async function getAlbumTracks(albumId) {
    try {
        const url = `https://open.spotify.com/album/${albumId}`;
        const data = await getData(url);
        const tracks = await getTracks(url);
        
        return { 
            name: data?.name ? `${data.name} — ${data.artists?.[0]?.name || ''}` : 'Unknown Album', 
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching album:', err);
        return { name: 'Unknown Album', tracks: [] };
    }
}

function toSearchQuery(track) {
    const artist = track.artist || '';
    return `ytsearch:${track.name} ${artist} audio`;
}
async function getArtistTracks(artistId) {
    try {
        const url = `https://open.spotify.com/artist/${artistId}`;
        const data = await getData(url);
        const tracks = await getTracks(url);
        
        return { 
            name: data?.name ? `${data.name} — Top Tracks` : 'Unknown Artist', 
            tracks: tracks.filter(t => t && t.name)
        };
    } catch (err) {
        console.error('[Spotify] Error fetching artist:', err);
        return { name: 'Unknown Artist', tracks: [] };
    }
}

module.exports = { getPlaylistTracks, getAlbumTracks, getArtistTracks, toSearchQuery };
