const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const MusicPlayer = require('../src/structures/MusicPlayer');
const { PlayerState } = require('../src/structures/MusicPlayer');
const MusicManager = require('../src/structures/MusicManager');
const DatabaseService = require('../src/services/Database');
const voiceStateUpdate = require('../src/events/voiceStateUpdate');
const { createUnresolvedTrack } = require('../src/utils/trackUtils');

function makeTrack(id, title = `Track ${id}`, author = 'Artist') {
    return {
        encoded: `enc_${id}`,
        info: {
            identifier: id,
            isSeekable: true,
            author,
            length: 180000,
            isStream: false,
            position: 0,
            title,
            uri: `https://youtube.com/watch?v=${id}`,
            sourceName: 'youtube'
        },
        pluginInfo: {},
        requester: { id: 'user_1', username: 'Tester' }
    };
}

function createFakeEnvironment() {
    const db = new DatabaseService(':memory:');
    const playerUpdates = [];
    const filterCalls = [];
    const volumeCalls = [];
    const stopCalls = [];
    const leaveCalls = [];
    const shoukakuPlayers = new Map();

    const fakeNode = {
        name: 'MockNode',
        state: 1,
        stats: {
            players: 1,
            playingPlayers: 1,
            memory: { used: 100e6, allocated: 256e6, free: 156e6, reservable: 1024e6 },
            cpu: { cores: 4, systemLoad: 0.1, lavalinkLoad: 0.05 },
            frameStats: { sent: 1000, deficit: 0, nulled: 0 },
            uptime: 60000
        },
        rest: {
            getPlayer: async () => ({ voice: { connected: true, ping: 18 } }),
            resolve: async () => ({ loadType: 'empty', data: {} })
        },
        disconnect: () => {}
    };

    const fakeShoukaku = Object.assign(new EventEmitter(), {
        nodes: new Map([['MockNode', fakeNode]]),
        connections: new Map(),
        players: new Map(),
        getIdealNode: () => fakeNode,
        joinVoiceChannel: async ({ guildId }) => {
            const p = Object.assign(new EventEmitter(), {
                guildId,
                node: fakeNode,
                position: 0,
                update: async (opts, noReplace) => {
                    playerUpdates.push({ guildId, opts, noReplace });
                },
                stopTrack: async () => {
                    stopCalls.push(guildId);
                },
                setPaused: async () => {},
                seekTo: async () => {},
                setGlobalVolume: async (v) => {
                    volumeCalls.push({ guildId, v });
                },
                setFilters: async (f) => {
                    filterCalls.push({ guildId, f });
                }
            });
            fakeShoukaku.connections.set(guildId, { guildId });
            shoukakuPlayers.set(guildId, p);
            return p;
        },
        leaveVoiceChannel: async (guildId) => {
            leaveCalls.push(guildId);
            fakeShoukaku.connections.delete(guildId);
            shoukakuPlayers.delete(guildId);
        }
    });

    const fakeClient = {
        user: { id: 'bot_1', setActivity: () => {}, displayAvatarURL: () => '' },
        guilds: { cache: new Map() },
        channels: { cache: new Map() }
    };

    const manager = new MusicManager(fakeClient, { db, shoukaku: fakeShoukaku });
    fakeClient.manager = manager;
    return { db, manager, fakeClient, fakeShoukaku, shoukakuPlayers, playerUpdates, filterCalls, volumeCalls, stopCalls, leaveCalls };
}

describe('MusicPlayer State Machine, Concurrency, Recovery & Multi-Guild Isolation', () => {
    it('sends track, userData, volume, and filters in one atomic update without post-play filter spam', async () => {
        const { manager, playerUpdates, filterCalls, volumeCalls, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'g1', textId: 't1', voiceId: 'v1' });
        const t1 = makeTrack('a1');
        const t2 = makeTrack('a2');

        await player.enqueueTracks([t1, t2]);
        assert.equal(playerUpdates.length, 1);
        assert.equal(playerUpdates[0].opts.track.encoded, 'enc_a1');
        assert.ok(playerUpdates[0].opts.track.userData.attemptId);
        assert.equal(playerUpdates[0].opts.volume, 100);
        assert.equal(playerUpdates[0].opts.filters.equalizer.length, 15);
        assert.equal(filterCalls.length, 0);
        assert.equal(volumeCalls.length, 0);

        // Next track skips redundant filter payload
        await player.skip();
        assert.equal(playerUpdates.length, 2);
        assert.equal(playerUpdates[1].opts.filters, undefined);
        db.close();
    });

    it('serializes two simultaneous play/enqueue calls and two simultaneous skips without double-skipping', async () => {
        const { manager, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'g2', textId: 't1', voiceId: 'v1' });
        const tracks = [makeTrack('1'), makeTrack('2'), makeTrack('3'), makeTrack('4')];

        await Promise.all([
            player.enqueueTracks([tracks[0], tracks[1]]),
            player.enqueueTracks([tracks[2], tracks[3]])
        ]);

        assert.equal(player.current.info.identifier, '1');
        assert.equal(player.queue.length, 3);

        await Promise.all([player.skip(), player.skip()]);
        assert.equal(player.current.info.identifier, '3');
        assert.equal(player.queue.length, 1);
        db.close();
    });

    it('deduplicates exception + loadFailed end event and skips bad track without stopping playlist', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        manager.resolver.resolveUnresolvedTrack = async () => null;

        const player = await manager.createPlayer({ guildId: 'g3', textId: 't1', voiceId: 'v1' });
        const bad = makeTrack('bad');
        const good = makeTrack('good');
        await player.enqueueTracks([bad, good]);

        const rawPlayer = shoukakuPlayers.get('g3');
        const badAttemptId = player.currentAttemptId;

        // Emit both exception and loadFailed for the exact same attempt simultaneously
        rawPlayer.emit('exception', {
            track: { userData: { attemptId: badAttemptId } },
            exception: { message: '403 Forbidden', severity: 'common' }
        });
        rawPlayer.emit('end', {
            track: { userData: { attemptId: badAttemptId } },
            reason: 'loadFailed'
        });

        await new Promise(r => setTimeout(r, 40));
        assert.equal(manager.metrics.playbackFailures, 1);
        assert.equal(player.current.info.identifier, 'good');
        db.close();
    });

    it('ignores stale events from previous playback attempts even on looped identical song', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'g4', textId: 't1', voiceId: 'v1' });
        const songA = makeTrack('same');
        const songB = makeTrack('next');
        await player.setLoop('track');
        await player.enqueueTracks([songA, songB]);

        const rawPlayer = shoukakuPlayers.get('g4');
        const oldAttempt = player.currentAttemptId;

        // Skip advances past looped songA to songB
        await player.skip();
        assert.equal(player.current.info.identifier, 'next');

        // Late 'end' event from oldAttempt arrives after replacement -> MUST be ignored
        rawPlayer.emit('end', {
            track: { userData: { attemptId: oldAttempt } },
            reason: 'finished'
        });
        await new Promise(r => setTimeout(r, 30));
        assert.equal(player.current.info.identifier, 'next');
        db.close();
    });

    it('handles skipping/stopping while an unresolved track is resolving', async () => {
        const { manager, db } = createFakeEnvironment();
        let resolveFirst;
        manager.resolver.resolveUnresolvedTrack = async (track) => {
            if (track.title === 'Slow Track') {
                return new Promise(res => { resolveFirst = () => res(makeTrack('slow_res')); });
            }
            return makeTrack('fast_res');
        };

        const player = await manager.createPlayer({ guildId: 'g5', textId: 't1', voiceId: 'v1' });
        const slow = createUnresolvedTrack({ title: 'Slow Track', artist: 'A' });
        const fast = createUnresolvedTrack({ title: 'Fast Track', artist: 'B' });

        const enqueuePromise = player.enqueueTracks([slow, fast]);
        await new Promise(r => setTimeout(r, 15));
        const stopPromise = player.stop();
        if (resolveFirst) resolveFirst();

        await Promise.all([enqueuePromise, stopPromise]);
        assert.equal(player.current, null);
        assert.equal(player.queue.length, 0);
        assert.equal(player.state, PlayerState.IDLE);
        db.close();
    });

    it('supports track looping, queue looping, volume, and EQ updates cleanly', async () => {
        const { manager, shoukakuPlayers, filterCalls, volumeCalls, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'g6', textId: 't1', voiceId: 'v1' });
        const t1 = makeTrack('l1');
        const t2 = makeTrack('l2');
        await player.enqueueTracks([t1, t2]);

        await player.setVolume(140);
        await player.setEqualizerPreset('rock');
        assert.equal(volumeCalls.at(-1).v, 140);
        assert.equal(filterCalls.at(-1).f.equalizer.length, 15);

        await player.setLoop('queue');
        const rawPlayer = shoukakuPlayers.get('g6');
        rawPlayer.emit('end', { track: { userData: { attemptId: player.currentAttemptId } }, reason: 'finished' });
        await new Promise(r => setTimeout(r, 30));
        assert.equal(player.current.info.identifier, 'l2');
        assert.equal(player.queue.length, 1);
        assert.equal(player.queue[0].info.identifier, 'l1');

        // Volume and preset remain preserved across track transitions
        assert.equal(player.volume, 140);
        assert.equal(player.preset, 'rock');
        db.close();
    });

    it('handles manual voice disconnect without reconnecting and protects idle timer races', async () => {
        const { manager, fakeClient, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'g7', textId: 't1', voiceId: 'v1' });
        player.idleTimeoutMs = 50;
        await player.enqueueTracks([makeTrack('x1')]);

        await voiceStateUpdate.execute(
            { id: 'bot_1', channelId: 'v1', guild: { id: 'g7' } },
            { id: 'bot_1', channelId: null, guild: { id: 'g7' } },
            fakeClient
        );
        assert.equal(player.isDestroyed(), true);
        assert.equal(manager.getPlayer('g7'), undefined);

        // Test idle timer invalidation when new track is added
        const player2 = await manager.createPlayer({ guildId: 'g8', textId: 't1', voiceId: 'v1' });
        player2.idleTimeoutMs = 40;
        await player2.stop();
        await player2.enqueueTracks([makeTrack('x2')]);
        await new Promise(r => setTimeout(r, 70));
        assert.equal(player2.isDestroyed(), false);
        assert.equal(player2.current.info.identifier, 'x2');
        db.close();
    });

    it('isolates multiple guilds independently and shuts down cleanly', async () => {
        const { manager, db } = createFakeEnvironment();
        const pA = await manager.createPlayer({ guildId: 'guildA', textId: 'tA', voiceId: 'vA' });
        const pB = await manager.createPlayer({ guildId: 'guildB', textId: 'tB', voiceId: 'vB' });

        await pA.setVolume(60);
        await pB.setVolume(150);
        await pA.setEqualizerPreset('vocal');
        await pB.setEqualizerPreset('bass_boost');

        await pA.enqueueTracks([makeTrack('A1')]);
        await pB.enqueueTracks([makeTrack('B1')]);

        assert.equal(pA.volume, 60);
        assert.equal(pB.volume, 150);
        assert.equal(pA.preset, 'vocal');
        assert.equal(pB.preset, 'bass_boost');
        assert.equal(pA.current.info.identifier, 'A1');
        assert.equal(pB.current.info.identifier, 'B1');

        await manager.shutdown();
        assert.equal(manager.players.size, 0);
        db.close();
    });

    it('handles Lavalink 4014 voice close vs transient voice close recovery', async () => {
        const { manager, shoukakuPlayers, fakeClient, db } = createFakeEnvironment();
        fakeClient.guilds.cache.set('g9', { shardId: 0, members: { me: { voice: { channelId: null } } } });
        const p9 = await manager.createPlayer({ guildId: 'g9', textId: 't1', voiceId: 'v1' });
        await p9.enqueueTracks([makeTrack('z1')]);

        shoukakuPlayers.get('g9').emit('closed', { code: 4014, byRemote: true, reason: 'Kicked' });
        await new Promise(r => setTimeout(r, 30));
        assert.equal(p9.isDestroyed(), true);

        // Transient close code 4006 triggers bounded reconnect
        const p10 = await manager.createPlayer({ guildId: 'g10', textId: 't1', voiceId: 'v1' });
        await p10.enqueueTracks([makeTrack('z2')]);
        shoukakuPlayers.get('g10').emit('closed', { code: 4006, byRemote: true, reason: 'Session expired' });
        await new Promise(r => setTimeout(r, 40));
        assert.equal(p10.isDestroyed(), false);
        assert.equal(p10.current.info.identifier, 'z2');
        db.close();
    });
});
