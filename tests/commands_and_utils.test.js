const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildLavalinkFilters,
    getPresetConfig,
    mapBassLevelToPreset,
    PRESET_DEFINITIONS
} = require('../src/services/EqualizerService');
const {
    getTrackTitle,
    getTrackArtist,
    isUnresolvedTrack,
    createUnresolvedTrack,
    formatTrackDuration
} = require('../src/utils/trackUtils');
const { validateExternalUrl, isPrivateIP } = require('../src/utils/ssrfGuard');
const { redactString, sanitizeMeta } = require('../src/utils/logger');
const moveCmd = require('../src/commands/move');
const removeCmd = require('../src/commands/remove');
const readyEvent = require('../src/events/ready');

function makeMockInteraction(options = {}) {
    const replies = [];
    return {
        guildId: '111111111111111111',
        guild: { id: '111111111111111111', name: 'Test Guild' },
        member: { voice: { channelId: '222222222222222222' } },
        options: {
            getInteger: (k) => options[k] ?? null,
            getString: (k) => options[k] ?? null
        },
        reply: async (payload) => {
            replies.push(payload);
            return payload;
        },
        replies
    };
}

describe('Phase 1-2 Bug Fixes, Equalizer, SSRF, and Metadata', () => {
    it('ready.js uses clientReady event (not deprecated ready)', () => {
        assert.equal(readyEvent.name, 'clientReady');
        assert.equal(readyEvent.once, true);
    });

    it('move.js handles invalid positions and empty queue without ReferenceError', async () => {
        const fakePlayer = {
            voiceId: '222222222222222222',
            current: { info: { title: 'Current' } },
            queue: [{ title: 'Song A', isUnresolved: true }],
            isDestroyed: () => false,
            moveTrack: async (from, to) => {
                if (from > fakePlayer.queue.length || to > fakePlayer.queue.length) {
                    return { ok: false, reason: `There are only **${fakePlayer.queue.length}** track(s) in the queue.` };
                }
                return { ok: true, track: fakePlayer.queue[0] };
            }
        };
        const fakeClient = { manager: { getPlayer: () => fakePlayer } };

        const ix = makeMockInteraction({ from: 1, to: 5 });
        await moveCmd.execute(ix, fakeClient);
        assert.equal(ix.replies.length, 1);
        assert.ok(ix.replies[0].embeds[0].data.description.includes('only **1**'));
    });

    it('remove.js removes unresolved Spotify/YouTube playlist tracks safely', async () => {
        const unresolved = createUnresolvedTrack({ title: 'Unresolved Track', artist: 'Artist X' });
        const fakePlayer = {
            voiceId: '222222222222222222',
            current: { info: { title: 'Playing' } },
            queue: [unresolved],
            isDestroyed: () => false,
            removeTrack: async (pos) => {
                const [removed] = fakePlayer.queue.splice(pos - 1, 1);
                return { ok: true, track: removed };
            }
        };
        const fakeClient = { manager: { getPlayer: () => fakePlayer } };

        const ix = makeMockInteraction({ position: 1 });
        await removeCmd.execute(ix, fakeClient);
        assert.equal(ix.replies.length, 1);
        assert.ok(ix.replies[0].embeds[0].data.description.includes('Unresolved Track'));
    });

    it('trackUtils normalizes resolved, unresolved, and live tracks', () => {
        const unresolved = createUnresolvedTrack({ title: 'Song One', artist: 'Band A', duration: 95000 });
        assert.equal(isUnresolvedTrack(unresolved), true);
        assert.equal(getTrackTitle(unresolved), 'Song One');
        assert.equal(getTrackArtist(unresolved), 'Band A');
        assert.equal(formatTrackDuration(unresolved), '01:35');

        const live = { encoded: 'abc', info: { title: 'Radio', author: 'FM', isStream: true, length: 0 } };
        assert.equal(isUnresolvedTrack(live), false);
        assert.equal(formatTrackDuration(live), 'LIVE');
    });

    it('EqualizerService implements all 10 presets with 15 bands and headroom protection', () => {
        const required = ['flat', 'rich', 'bass_boost', 'deep_bass', 'vocal', 'treble', 'rock', 'pop', 'electronic', 'night_mode'];
        for (const name of required) {
            assert.ok(PRESET_DEFINITIONS[name], `Missing preset ${name}`);
            const f = buildLavalinkFilters(name);
            assert.equal(f.equalizer.length, 15, `Preset ${name} must send all 15 bands`);
            for (let i = 0; i < 15; i++) {
                assert.equal(f.equalizer[i].band, i);
                assert.ok(f.equalizer[i].gain >= -0.25 && f.equalizer[i].gain <= 1.0);
            }
        }
        assert.equal(getPresetConfig().key, 'flat');
        const flatFilters = buildLavalinkFilters('flat');
        assert.equal(flatFilters.volume, 1.0);

        const deepFilters = buildLavalinkFilters('deep_bass');
        assert.ok(deepFilters.volume < 1.0, 'Headroom attenuation should apply when positive gains are used');

        assert.equal(mapBassLevelToPreset('off'), 'flat');
        assert.equal(mapBassLevelToPreset('extreme'), 'bass_extreme');
    });

    it('ssrfGuard blocks private IPs, localhost, credentials, and private redirects', async () => {
        assert.equal(isPrivateIP('127.0.0.1'), true);
        assert.equal(isPrivateIP('10.1.2.3'), true);
        assert.equal(isPrivateIP('192.168.1.50'), true);
        assert.equal(isPrivateIP('169.254.169.254'), true);
        assert.equal(isPrivateIP('::1'), true);
        assert.equal(isPrivateIP('8.8.8.8'), false);

        const r1 = await validateExternalUrl('http://127.0.0.1:2333/metrics');
        assert.equal(r1.safe, false);

        const r2 = await validateExternalUrl('http://user:pass@example.com/stream.mp3');
        assert.equal(r2.safe, false);

        const r3 = await validateExternalUrl('http://evil.example/stream', {
            resolveDns: async () => [{ address: '10.0.0.5', family: 4 }],
            checkRedirects: false
        });
        assert.equal(r3.safe, false);

        const r4 = await validateExternalUrl('https://public-radio.example/live.mp3', {
            resolveDns: async (host) => host === 'public-radio.example'
                ? [{ address: '93.184.216.34', family: 4 }]
                : [{ address: '192.168.0.10', family: 4 }],
            fetchFn: async () => ({ status: 302, headers: new Headers({ location: 'http://internal.local/secret' }) })
        });
        assert.equal(r4.safe, false);

        const r5 = await validateExternalUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
            resolveDns: async () => [{ address: '142.250.180.14', family: 4 }]
        });
        assert.equal(r5.safe, true);
    });

    it('logger redacts sensitive credentials and tokens', () => {
        const redacted = redactString('Authorization: Bearer secretToken12345 https://host/?token=abc999');
        assert.ok(!redacted.includes('secretToken12345'));
        assert.ok(!redacted.includes('abc999'));

        const clean = sanitizeMeta({ password: 'p1', jwtSecret: 's1', token: 't1', guildId: '123' });
        assert.equal(clean.password, '[REDACTED]');
        assert.equal(clean.jwtSecret, '[REDACTED]');
        assert.equal(clean.token, '[REDACTED]');
        assert.equal(clean.guildId, '123');
    });
});
