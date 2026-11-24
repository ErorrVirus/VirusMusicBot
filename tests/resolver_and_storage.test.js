const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const TrackResolver = require('../src/services/TrackResolver');
const { scoreTrackCandidate, isPreviewTrack } = require('../src/services/TrackResolver');
const DatabaseService = require('../src/services/Database');

function makeLavalinkTrack({ id, title, author = 'Artist', length = 200000, sourceName = 'youtube', uri, isStream = false, isrc = null }) {
    return {
        encoded: `enc_${id}`,
        info: {
            identifier: id,
            isSeekable: !isStream,
            author,
            length,
            isStream,
            position: 0,
            title,
            uri: uri || `https://www.youtube.com/watch?v=${id}`,
            isrc,
            sourceName
        },
        pluginInfo: {}
    };
}

describe('TrackResolver Matching, Sources, Playlists & SQLite Persistence', () => {
    it('prefers original official tracks over covers/remixes/slowed unless requested, and keeps short <55s tracks', () => {
        const original = makeLavalinkTrack({ id: 'orig', title: 'Blinding Lights', author: 'The Weeknd - Topic', length: 200000 });
        const slowed = makeLavalinkTrack({ id: 'slow', title: 'Blinding Lights (Slowed + Reverb)', author: 'RandomChannel', length: 230000 });
        const cover = makeLavalinkTrack({ id: 'cov', title: 'Blinding Lights Acoustic Cover', author: 'CoverGuy', length: 195000 });

        assert.ok(
            scoreTrackCandidate(original, { query: 'Blinding Lights The Weeknd' }) >
            scoreTrackCandidate(slowed, { query: 'Blinding Lights The Weeknd' })
        );
        assert.ok(
            scoreTrackCandidate(original, { query: 'Blinding Lights The Weeknd' }) >
            scoreTrackCandidate(cover, { query: 'Blinding Lights The Weeknd' })
        );

        // When user explicitly asks for slowed version, slowed should NOT be penalized
        const slowedAsked = scoreTrackCandidate(slowed, { query: 'Blinding Lights slowed reverb' });
        assert.ok(slowedAsked > 0);

        // Legitimate 35s interlude is accepted, while SoundCloud /preview/ clip is rejected
        const shortTrack = makeLavalinkTrack({ id: 'short', title: 'Intro', author: 'Artist', length: 35000 });
        assert.equal(isPreviewTrack(shortTrack), false);
        assert.ok(scoreTrackCandidate(shortTrack, { query: 'Intro' }) > -1000);

        const preview = makeLavalinkTrack({ id: 'prev', title: 'Preview', uri: 'https://soundcloud.com/preview/123', length: 30000 });
        assert.equal(isPreviewTrack(preview), true);
    });

    it('resolves song by name, artist, YouTube URL, Spotify track, YouTube playlist, Spotify playlist, and artist search', async () => {
        const fakeManager = {
            getActiveNode: () => ({
                state: 1,
                rest: {
                    resolve: async (identifier) => {
                        if (identifier.includes('invalid-track-404')) {
                            return { loadType: 'error', data: { message: 'Not found' } };
                        }
                        if (identifier.startsWith('https://www.youtube.com/playlist')) {
                            return {
                                loadType: 'playlist',
                                data: {
                                    info: { name: 'YT Mix' },
                                    tracks: [
                                        makeLavalinkTrack({ id: 'p1', title: 'Song 1' }),
                                        makeLavalinkTrack({ id: 'p2', title: 'Song 2' })
                                    ]
                                }
                            };
                        }
                        if (identifier.startsWith('https://open.spotify.com/playlist/')) {
                            return {
                                loadType: 'playlist',
                                data: {
                                    info: { name: 'Spotify Vibes' },
                                    tracks: [
                                        makeLavalinkTrack({ id: 'sp1', title: 'Spotify Song 1', sourceName: 'spotify' }),
                                        makeLavalinkTrack({ id: 'sp2', title: 'Spotify Song 2', sourceName: 'spotify' })
                                    ]
                                }
                            };
                        }
                        if (identifier.startsWith('https://open.spotify.com/track/')) {
                            return {
                                loadType: 'track',
                                data: makeLavalinkTrack({ id: 'spt1', title: 'One Dance', author: 'Drake', sourceName: 'spotify' })
                            };
                        }
                        if (identifier.startsWith('https://www.youtube.com/watch?v=')) {
                            return {
                                loadType: 'track',
                                data: makeLavalinkTrack({ id: 'yt1', title: 'Direct Video' })
                            };
                        }
                        if (identifier.startsWith('ytmsearch:') || identifier.startsWith('ytsearch:')) {
                            return {
                                loadType: 'search',
                                data: [
                                    makeLavalinkTrack({ id: 's1', title: 'Numb', author: 'Linkin Park - Topic' }),
                                    makeLavalinkTrack({ id: 's2', title: 'Numb (Remix)', author: 'DJ X' })
                                ]
                            };
                        }
                        return { loadType: 'empty', data: {} };
                    }
                }
            })
        };

        const resolver = new TrackResolver(fakeManager, { maxPlaylistSize: 50 });
        const requester = { id: 'u1', username: 'User' };

        const byName = await resolver.resolveInput('Numb Linkin Park', requester);
        assert.equal(byName.tracks[0].info.identifier, 's1');

        const ytVideo = await resolver.resolveInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ', requester);
        assert.equal(ytVideo.tracks[0].info.identifier, 'yt1');

        const spTrack = await resolver.resolveInput('https://open.spotify.com/track/12345', requester);
        assert.equal(spTrack.tracks[0].info.identifier, 'spt1');

        const ytPl = await resolver.resolveInput('https://www.youtube.com/playlist?list=PL12345', requester);
        assert.equal(ytPl.type, 'playlist');
        assert.equal(ytPl.tracks.length, 2);

        const spPl = await resolver.resolveInput('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', requester);
        assert.equal(spPl.type, 'playlist');
        assert.equal(spPl.playlistName, 'Spotify Vibes');

        const artistRes = await resolver.searchArtist('Linkin Park', requester);
        assert.ok(artistRes.tracks.length > 0 || artistRes.artists.length > 0);

        await assert.rejects(() => resolver.resolveInput('https://www.youtube.com/watch?v=invalid-track-404', requester));
    });

    it('persists guild settings, saved queues, favorites, history, and custom playlists in SQLite', () => {
        const db = new DatabaseService(':memory:');
        const updated = db.updateGuildSettings('guild1', {
            dj_role_id: 'role99',
            default_volume: 85,
            default_equalizer: 'rich',
            autoplay: true,
            mode_247: true
        });
        assert.equal(updated.dj_role_id, 'role99');
        assert.equal(updated.default_volume, 85);
        assert.equal(updated.autoplay, true);
        assert.equal(updated.mode_247, true);

        const t1 = makeLavalinkTrack({ id: 't1', title: 'Track One' });
        db.saveGuildQueue('guild1', { current: t1, queue: [t1], loop: 'queue', volume: 85, preset: 'rich', autoplay: true });
        const recovered = db.getSavedQueue('guild1');
        assert.equal(recovered.current.info.title, 'Track One');
        assert.equal(recovered.queue.length, 1);
        assert.equal(recovered.loop, 'queue');

        db.addFavorite('user1', t1);
        assert.equal(db.getFavorites('user1').length, 1);

        db.addHistory('guild1', 'user1', t1);
        assert.equal(db.getHistory('guild1').length, 1);

        assert.equal(db.createCustomPlaylist('user1', 'Roadtrip').ok, true);
        assert.equal(db.addTracksToCustomPlaylist('user1', 'Roadtrip', [t1]).added, 1);
        assert.equal(db.getCustomPlaylist('user1', 'Roadtrip').tracks.length, 1);
        assert.equal(db.listCustomPlaylists('user1')[0].track_count, 1);
        assert.equal(db.deleteCustomPlaylist('user1', 'Roadtrip'), true);

        db.close();
    });
});
