const helper = require('./src/utils/spotifyHelper');

async function test() {
    console.log('Testing Album');
    const result = await helper.getAlbumTracks('4yP0hdKOZPNshxUOjY0cZj'); // some album
    console.log('Total tracks:', result.tracks.length);
}
test().catch(console.error);
