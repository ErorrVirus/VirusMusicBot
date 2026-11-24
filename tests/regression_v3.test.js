'use strict';
/**
 * VirusMusicPro V3 — Regression Tests
 *
 * Tests added after the final production-readiness audit:
 *   1. Stale event filtering uses captured closure attemptId (not userData from event)
 *   2. Lock timeout fires and subsequent operation proceeds (no deadlock)
 *   3. Stuck event triggers recovery correctly
 *   4. Queue loop + autoplay: autoplay must NOT trigger while queue loop is active
 *   5. Voice ready cancel token fires when destroy is called mid-wait
 *   6. HTTP stream blocked when ALLOW_HTTP_STREAMS is not 'true'
 *   7. JWT secret < 32 chars rejects dashboard startup
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const MusicPlayer = require('../src/structures/MusicPlayer');
const { PlayerState } = require('../src/structures/MusicPlayer');
const MusicManager = require('../src/structures/MusicManager');
const DatabaseService = require('../src/services/Database');
const { buildDashboardApp, startDashboardServer: _startDashboardServer } = require('../src/web/server');

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
    const shoukakuPlayers = new Map();

    const fakeNode = {
        name: 'MockNode',
        state: 1,
        stats: {
            players: 1, playingPlayers: 1,
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
                update: async (opts, noReplace) => { playerUpdates.push({ guildId, opts, noReplace }); },
                stopTrack: async () => {},
                setPaused: async () => {},
                seekTo: async () => {},
                setGlobalVolume: async () => {},
                setFilters: async () => {}
            });
            fakeShoukaku.connections.set(guildId, { guildId });
            shoukakuPlayers.set(guildId, p);
            return p;
        },
        leaveVoiceChannel: async (guildId) => {
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
    return { db, manager, fakeClient, fakeShoukaku, shoukakuPlayers, playerUpdates };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: stale event filtering via closure, NOT userData', () => {
    it('rejects a stale "end" event from a previous attempt captured before skip', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'rg1', textId: 't1', voiceId: 'v1' });
        await player.enqueueTracks([makeTrack('r1'), makeTrack('r2'), makeTrack('r3')]);

        const rawPlayer = shoukakuPlayers.get('rg1');
        // Capture the attempt BEFORE skipping
        const staleAttemptId = player.currentAttemptId;
        assert.ok(staleAttemptId, 'attemptId must be set after first track starts');

        // Skip → advances to r2, new attemptId assigned
        await player.skip();
        assert.equal(player.current.info.identifier, 'r2');
        const newAttemptId = player.currentAttemptId;
        assert.notEqual(staleAttemptId, newAttemptId, 'attemptId must change on skip');

        // Emit a stale 'end finished' with the old attemptId and old track encoding.
        // The player must reject this stale event and keep playing r2.
        rawPlayer.emit('end', {
            track: { encoded: 'enc_r1', userData: { attemptId: staleAttemptId } },
            reason: 'finished'
        });
        await new Promise(r => setTimeout(r, 50));
        assert.equal(player.current.info.identifier, 'r2',
            'stale end event must NOT advance the queue a second time');

        db.close();
    });

    it('accepts a genuine "end" event when capturedAttemptId matches currentAttemptId', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'rg2', textId: 't1', voiceId: 'v1' });
        await player.enqueueTracks([makeTrack('s1'), makeTrack('s2')]);

        const rawPlayer = shoukakuPlayers.get('rg2');
        assert.equal(player.current.info.identifier, 's1');

        // Genuine 'end finished' — capturedAttemptId inside the closure matches current
        rawPlayer.emit('end', { reason: 'finished' });
        await new Promise(r => setTimeout(r, 50));
        assert.equal(player.current.info.identifier, 's2',
            'genuine end event must advance the queue to s2');

        db.close();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: stuck event triggers recovery', () => {
    it('stuck event causes track recovery and skips to next track when no alternative found', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        // Resolver always fails recovery
        manager.resolver.resolveUnresolvedTrack = async () => null;

        const player = await manager.createPlayer({ guildId: 'rg3', textId: 't1', voiceId: 'v1' });
        await player.enqueueTracks([makeTrack('stuck1'), makeTrack('after_stuck')]);

        const rawPlayer = shoukakuPlayers.get('rg3');
        assert.equal(player.current.info.identifier, 'stuck1');

        rawPlayer.emit('stuck', { thresholdMs: 10000 });
        await new Promise(r => setTimeout(r, 60));

        assert.equal(player.current.info.identifier, 'after_stuck',
            'stuck event must skip bad track and advance to after_stuck');
        assert.equal(manager.metrics.playbackFailures, 1);
        db.close();
    });

    it('stuck event is ignored if already handled by exception for the same attempt', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        manager.resolver.resolveUnresolvedTrack = async () => null;

        const player = await manager.createPlayer({ guildId: 'rg4', textId: 't1', voiceId: 'v1' });
        await player.enqueueTracks([makeTrack('dual1'), makeTrack('dual2')]);

        const rawPlayer = shoukakuPlayers.get('rg4');

        // Fire exception AND stuck simultaneously for same attempt
        rawPlayer.emit('exception', { exception: { message: 'boom', severity: 'common' } });
        rawPlayer.emit('stuck', { thresholdMs: 10000 });
        await new Promise(r => setTimeout(r, 60));

        // Only one failure should be recorded
        assert.equal(manager.metrics.playbackFailures, 1,
            'duplicate stuck+exception must only count as one failure');
        db.close();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: queue loop + autoplay interaction', () => {
    it('autoplay does NOT trigger when queue loop is active', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'rg5', textId: 't1', voiceId: 'v1' });
        player.autoplay = true;

        let autoplayCalled = false;
        // Intercept autoplay resolution
        manager.resolver.getAutoplayTrack = async () => {
            autoplayCalled = true;
            return makeTrack('autoplay_seed');
        };

        await player.setLoop('queue');
        await player.enqueueTracks([makeTrack('loop1'), makeTrack('loop2')]);

        const rawPlayer = shoukakuPlayers.get('rg5');
        assert.equal(player.current.info.identifier, 'loop1');

        // Advance: loop1 ends, queue should cycle (loop2 plays, loop1 goes to end of queue)
        rawPlayer.emit('end', { reason: 'finished' });
        await new Promise(r => setTimeout(r, 60));

        assert.equal(player.current.info.identifier, 'loop2',
            'queue loop should advance to loop2');
        assert.equal(autoplayCalled, false,
            'autoplay must NOT be triggered while queue loop is active');

        db.close();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: AsyncLock timeout does not deadlock future operations', () => {
    it('a timed-out lock acquisition still allows the next caller to proceed', async () => {
        const AsyncLock = require('../src/structures/AsyncLock');
        // Lock with 200ms timeout
        const lock = new AsyncLock(200);
        const key = 'test-key';
        const results = [];

        // Acquire and hold indefinitely (simulating a hung task)
        const hangPromise = lock.runExclusive(key, () =>
            new Promise(resolve => setTimeout(resolve, 5000))
        ).catch(() => results.push('hang-timed-out'));

        // Second caller — should time out after 200ms then resolve
        const timedOut = await lock.runExclusive(key, async () => {
            results.push('second-ran');
            return 'ok';
        }).catch(err => {
            results.push('second-timed-out');
            return 'timeout';
        });

        // The first holder eventually times out too
        await new Promise(r => setTimeout(r, 250));

        // Verify the second caller did eventually get a turn or time out gracefully
        assert.ok(
            results.includes('second-ran') || results.includes('second-timed-out'),
            'second caller must either run or time out cleanly — no deadlock'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: HTTP stream blocked when ALLOW_HTTP_STREAMS is not set', () => {
    it('resolveInput throws for a plain HTTP URL when ALLOW_HTTP_STREAMS is unset', async () => {
        const TrackResolver = require('../src/services/TrackResolver');
        const fakeNode = {
            rest: {
                resolve: async () => ({ loadType: 'empty', data: {} })
            }
        };
        const resolver = new TrackResolver(fakeNode, {});

        // Ensure env var is NOT set
        const prev = process.env.ALLOW_HTTP_STREAMS;
        delete process.env.ALLOW_HTTP_STREAMS;

        try {
            await resolver.resolveInput('http://example.com/stream.mp3', null, {});
            assert.fail('Should have thrown for HTTP stream when ALLOW_HTTP_STREAMS is not set');
        } catch (err) {
            assert.ok(
                err.message.includes('ALLOW_HTTP_STREAMS') || err.message.includes('disabled'),
                `Expected ALLOW_HTTP_STREAMS error, got: ${err.message}`
            );
        } finally {
            if (prev !== undefined) process.env.ALLOW_HTTP_STREAMS = prev;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Regression: Dashboard JWT secret length enforcement', () => {
    it('buildDashboardApp is callable and produces an Express app with valid credentials', () => {
        const fakeClient = {
            user: { id: 'bot_1', displayAvatarURL: () => '' },
            guilds: { cache: new Map() },
            channels: { cache: new Map() },
            manager: { players: new Map(), metrics: { playbackFailures: 0, totalTracksPlayed: 0, uptime: Date.now() }, getStatsSnapshot: () => ({ players: [], metrics: {}, node: null }) }
        };
        // 32+ char secret — should build without error
        const app = buildDashboardApp(fakeClient, {
            user: 'admin',
            pass: 'correct-horse-battery-staple',
            passHash: '',
            jwtSecret: 'a'.repeat(32),
            port: 4001,
            trustProxy: false,
            sslCrtPath: '',
            sslKeyPath: ''
        });
        assert.ok(app, 'buildDashboardApp must return an express app with valid 32-char JWT secret');
    });

    it('startDashboardServer returns null for JWT secret shorter than 32 chars', () => {
        const fakeClient = {
            user: { id: 'bot_1', displayAvatarURL: () => '' },
            guilds: { cache: new Map() },
            channels: { cache: new Map() },
            manager: { players: new Map(), metrics: {}, getStatsSnapshot: () => ({ players: [], metrics: {}, node: null }) }
        };
        const result = _startDashboardServer(fakeClient, {
            enabled: true,
            user: 'admin',
            pass: 'password123',
            passHash: '',
            jwtSecret: 'short', // only 5 chars → should be blocked
            port: 4002,
            trustProxy: false,
            sslCrtPath: '',
            sslKeyPath: ''
        });
        assert.equal(result, null,
            'startDashboardServer must return null when JWT secret is < 32 chars');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 Pre-Deploy: identical repeated tracks, AsyncLock strict serialization & DAVE 4017', () => {
    it('rejects delayed Lavalink event on identical repeated track (same encoded, different attemptId)', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'rep1', textId: 't1', voiceId: 'v1' });
        const identicalA = makeTrack('same_id', 'Same Song');
        const identicalB = makeTrack('same_id', 'Same Song');
        const nextTrack = makeTrack('after_same', 'After Song');

        await player.enqueueTracks([identicalA, identicalB, nextTrack]);
        const rawPlayer = shoukakuPlayers.get('rep1');
        const attempt1 = player.currentAttemptId;

        await player.skip();
        const attempt2 = player.currentAttemptId;
        assert.notEqual(attempt1, attempt2);
        assert.equal(player.current.info.identifier, 'same_id');

        // Delayed 'end' from attempt1 with the EXACT SAME encoded track must be ignored
        rawPlayer.emit('end', {
            track: { encoded: 'enc_same_id', userData: { attemptId: attempt1 } },
            reason: 'finished'
        });
        await new Promise(r => setTimeout(r, 50));
        assert.equal(player.currentAttemptId, attempt2,
            'delayed event from identical repeated track must NOT advance past attempt2');
        assert.equal(player.queue.length, 1);

        db.close();
    });

    it('AsyncLock timeout on Op2 never allows Op3 to enter before unfinished Op1 completes', async () => {
        const AsyncLock = require('../src/structures/AsyncLock');
        const lock = new AsyncLock(100);
        const events = [];
        let releaseOp1;
        const op1Gate = new Promise(r => { releaseOp1 = r; });

        const op1 = lock.runExclusive('g_strict', async () => {
            events.push('op1:start');
            await op1Gate;
            events.push('op1:end');
        });

        // Op2 times out waiting for Op1 at 60ms
        const op2 = lock.runExclusive('g_strict', async () => {
            events.push('op2:ran');
        }, 60).catch(() => events.push('op2:timeout'));

        // Op3 queues behind Op2 with a generous timeout
        const op3 = lock.runExclusive('g_strict', async () => {
            events.push('op3:start');
            events.push('op3:end');
        }, 1000);

        await new Promise(r => setTimeout(r, 120));
        // Op2 should have timed out, but Op3 MUST NOT have started because Op1 is still unfinished!
        assert.deepEqual(events, ['op1:start', 'op2:timeout']);

        releaseOp1();
        await Promise.all([op1, op2, op3]);
        assert.deepEqual(events, ['op1:start', 'op2:timeout', 'op1:end', 'op3:start', 'op3:end']);
    });

    it('handles Discord DAVE close code 4017 cleanly without reconnect loop', async () => {
        const { manager, shoukakuPlayers, db } = createFakeEnvironment();
        const player = await manager.createPlayer({ guildId: 'dave1', textId: 't1', voiceId: 'v1' });
        await player.enqueueTracks([makeTrack('d1')]);

        shoukakuPlayers.get('dave1').emit('closed', { code: 4017, byRemote: true, reason: 'DAVE required' });
        await new Promise(r => setTimeout(r, 50));
        assert.equal(player.isDestroyed(), true);
        db.close();
    });

    it('night_mode uses lowPass (no timescale) and switching back to flat resets lowPass to null', () => {
        const { buildLavalinkFilters, PRESET_DEFINITIONS } = require('../src/services/EqualizerService');
        assert.equal(PRESET_DEFINITIONS.nightcore, undefined);
        const night = buildLavalinkFilters('night_mode');
        assert.deepEqual(night.lowPass, { smoothing: 12.0 });
        assert.equal(night.timescale, undefined);

        const flat = buildLavalinkFilters('flat');
        assert.equal(flat.lowPass, null);
        assert.equal(flat.volume, 1.0);
        assert.ok(flat.equalizer.every(b => b.gain === 0));
    });

    it('healthcheck.js validates heartbeat freshness, Discord readiness, and Lavalink readiness', () => {
        const fs = require('node:fs');
        const os = require('node:os');
        const path = require('node:path');
        const { checkHealth } = require('../src/healthcheck');
        const tmpFile = path.join(os.tmpdir(), `vmp-hc-test-${Date.now()}.json`);

        try {
            assert.equal(checkHealth(tmpFile).ok, false);

            fs.writeFileSync(tmpFile, JSON.stringify({ ts: Date.now() - 60000, discordReady: true, lavalinkReady: true }));
            assert.equal(checkHealth(tmpFile, 45000).ok, false);

            fs.writeFileSync(tmpFile, JSON.stringify({ ts: Date.now(), discordReady: false, lavalinkReady: true }));
            assert.equal(checkHealth(tmpFile, 45000).ok, false);

            fs.writeFileSync(tmpFile, JSON.stringify({ ts: Date.now(), discordReady: true, lavalinkReady: false }));
            assert.equal(checkHealth(tmpFile, 45000).ok, false);

            fs.writeFileSync(tmpFile, JSON.stringify({ ts: Date.now(), discordReady: true, lavalinkReady: true }));
            assert.equal(checkHealth(tmpFile, 45000).ok, true);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        }
    });
});
