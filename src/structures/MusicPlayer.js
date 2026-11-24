const crypto = require('node:crypto');
const AsyncLock = require('./AsyncLock');
const logger = require('../utils/logger');
const { buildLavalinkFilters, mapBassLevelToPreset, PRESET_DEFINITIONS } = require('../services/EqualizerService');
const {
    isUnresolvedTrack,
    getTrackTitle,
    getTrackArtist,
    getTrackSource,
    getTrackIdentifier
} = require('../utils/trackUtils');

const PlayerState = Object.freeze({
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    LOADING: 'LOADING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    RECOVERING: 'RECOVERING',
    DESTROYING: 'DESTROYING',
    DESTROYED: 'DESTROYED'
});

const config = require('../config');

const MAX_TRACK_RETRIES = config.playback?.maxTrackRetries ?? 2;
const MAX_CONSECUTIVE_FAILURES = config.playback?.maxConsecutiveFailures ?? 5;
// Voice ready timeout is configurable via VOICE_READY_TIMEOUT_MS env var (default: 10 000 ms)
const VOICE_READY_MAX_WAIT_MS = config.playback?.voiceReadyTimeoutMs ?? 10000;
const VOICE_READY_POLL_MS = 75;

class MusicPlayer {
    constructor(manager, node, options) {
        this.manager = manager;
        this.client = manager.client;
        this.node = node;
        this.guildId = options.guildId;
        this.textId = options.textId;
        this.voiceId = options.voiceId;

        this.lock = new AsyncLock(20000);
        this.state = PlayerState.IDLE;

        // Raw Shoukaku Player
        this.player = null;

        // Queue System
        this.queue = [];
        this.current = null;
        this.previous = [];
        this.lastPlayedTrack = null;

        // Guild-specific settings (hydrated from DB if available)
        const settings = manager.db ? manager.db.getGuildSettings(this.guildId) : {};
        this.loop = 'none'; // 'none' | 'track' | 'queue'
        this.volume = settings.default_volume ?? 100;
        this.preset = PRESET_DEFINITIONS[settings.default_equalizer] ? settings.default_equalizer : 'flat';
        this.autoplay = Boolean(settings.autoplay);
        this.is247 = Boolean(settings.mode_247);
        this.maxQueueSize = settings.max_queue_size ?? 500;
        this.idleTimeoutMs = settings.idle_timeout_ms ?? 60000;
        this.isPaused = false;

        // Playback attempt tracking to reject stale Lavalink events
        this.attemptCounter = 0;
        this.currentAttemptId = null;
        this._lockEpoch = 0;
        this.sessionId = crypto.randomUUID().slice(0, 12);
        this._handledFailureAttempts = new Set();
        this._recentAutoplayKeys = [];
        this.consecutiveFailures = 0;

        // Voice & filter state
        this.voiceConnected = false;
        this.voicePing = -1;
        this.isNewConnection = true;
        this._filtersInitialized = false;
        this._reconnectAttempts = 0;

        // Timers & messages
        this.nowPlayingMessage = null;
        this.connectionTimeout = null;
        this._idleTimerToken = 0;

        // Diagnostic timings
        this.lastVoiceConnectMs = null;
        this.lastResolveMs = null;
        this.lastPlayStartMs = null;
    }

    isDestroyed() {
        return this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED;
    }

    _nextAttemptId() {
        this.attemptCounter += 1;
        return `${this.guildId}-${this.attemptCounter}-${crypto.randomBytes(3).toString('hex')}`;
    }

    _markFailureHandled(attemptId) {
        if (!attemptId) return;
        this._handledFailureAttempts.add(attemptId);
        if (this._handledFailureAttempts.size > 30) {
            const oldest = this._handledFailureAttempts.values().next().value;
            this._handledFailureAttempts.delete(oldest);
        }
    }

    _recordAutoplaySeed(track) {
        if (!track) return;
        const id = getTrackIdentifier(track);
        const title = getTrackTitle(track).toLowerCase();
        for (const key of [id, title]) {
            if (key && !this._recentAutoplayKeys.includes(key)) {
                this._recentAutoplayKeys.push(key);
            }
        }
        while (this._recentAutoplayKeys.length > 40) {
            this._recentAutoplayKeys.shift();
        }
    }

    // ── Stale-event guard ────────────────────────────────────────────────────
    // IMPORTANT: Lavalink does NOT return userData inside TrackStartEvent,
    // TrackEndEvent, TrackExceptionEvent, or TrackStuckEvent payloads.
    // The userData field is only sent in the Lavalink REST *request*;
    // it is not echoed back in event objects. Therefore we cannot read
    // data?.track?.userData?.attemptId from events — it will always be
    // undefined and would make the guard a no-op.
    //
    // Instead we use a closure-captured attemptId that is supplied by
    // _attachPlayerListeners at the time each handler is registered,
    // and compare it against this.currentAttemptId inside the lock.
    _isEventForCurrentAttempt(data, capturedAttemptId) {
        if (this.isDestroyed()) return false;
        if (!this.currentAttemptId) return false;

        // 1. If Lavalink event returns track.userData.attemptId, check it
        const eventAttemptId = data?.track?.userData?.attemptId || data?.userData?.attemptId;
        if (eventAttemptId && eventAttemptId !== this.currentAttemptId) {
            logger.debug('MusicPlayer', 'Ignoring stale Lavalink event (attemptId mismatch)', {
                guildId: this.guildId,
                eventAttemptId,
                currentAttemptId: this.currentAttemptId
            });
            return false;
        }

        // 2. If track encoded is present and doesn't match current track encoded, it's stale
        const eventEncoded = data?.track?.encoded;
        if (eventEncoded && this.current?.encoded && eventEncoded !== this.current.encoded) {
            logger.debug('MusicPlayer', 'Ignoring stale Lavalink event (encoded mismatch)', {
                guildId: this.guildId,
                eventEncoded,
                currentEncoded: this.current.encoded
            });
            return false;
        }

        // 3. If event was captured before a concurrent transition changed currentAttemptId
        if (capturedAttemptId && capturedAttemptId !== this.currentAttemptId) {
            logger.debug('MusicPlayer', 'Ignoring stale Lavalink event (captured attemptId mismatch)', {
                guildId: this.guildId,
                capturedAttemptId,
                currentAttemptId: this.currentAttemptId
            });
            return false;
        }

        return true;
    }

    _persistQueueSnapshot() {
        if (!this.manager.db || this.isDestroyed()) return;
        try {
            this.manager.db.saveGuildQueue(this.guildId, {
                current: this.current,
                queue: this.queue,
                loop: this.loop,
                volume: this.volume,
                preset: this.preset,
                autoplay: this.autoplay
            });
        } catch (err) {
            logger.warn('MusicPlayer', 'Failed to persist queue snapshot', { guildId: this.guildId, err: err.message });
        }
    }

    _clearIdleTimer() {
        this._idleTimerToken += 1;
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    _scheduleIdleTimerLocked() {
        this._clearIdleTimer();
        if (this.is247 || this.isDestroyed()) return;

        const token = this._idleTimerToken;
        const delay = this.idleTimeoutMs || 60000;
        this.connectionTimeout = setTimeout(() => {
            this.lock.runExclusive(this.guildId, async () => {
                if (token !== this._idleTimerToken) return;
                if (this.isDestroyed() || this.current || this.queue.length > 0 || this.is247) return;
                logger.info('MusicPlayer', 'Idle timeout reached; destroying player', { guildId: this.guildId });
                await this._destroyLocked('Idle timeout');
            }).catch(err => {
                logger.error('MusicPlayer', 'Idle timer error', { guildId: this.guildId, err: err.message });
            });
        }, delay);
        if (this.connectionTimeout.unref) this.connectionTimeout.unref();
    }

    async connect(retries = 2) {
        return this.lock.runExclusive(this.guildId, () => this._connectLocked(retries));
    }

    async _connectLocked(retries = 2) {
        if (this.isDestroyed()) throw new Error('Player is destroyed.');
        this.state = PlayerState.CONNECTING;
        const startedAt = Date.now();

        if (this.manager.shoukaku.connections.has(this.guildId)) {
            try {
                await this.manager.shoukaku.leaveVoiceChannel(this.guildId);
            } catch (_) {}
        }

        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (this.isDestroyed()) throw new Error('Player destroyed during voice connect.');
            try {
                this.player = await this.manager.shoukaku.joinVoiceChannel({
                    guildId: this.guildId,
                    channelId: this.voiceId,
                    shardId: this._getShardId(),
                    deaf: true
                });
                this.node = this.player.node || this.node;
                this.voiceConnected = false;
                this.isNewConnection = true;
                this._filtersInitialized = false;
                this.lastVoiceConnectMs = Date.now() - startedAt;
                this._attachPlayerListeners(this.player);
                this.state = PlayerState.IDLE;
                logger.info('MusicPlayer', 'Connected to voice channel', {
                    guildId: this.guildId,
                    voiceConnectMs: this.lastVoiceConnectMs
                });
                return this.player;
            } catch (err) {
                lastErr = err;
                logger.warn('MusicPlayer', 'Voice connection attempt failed', {
                    guildId: this.guildId,
                    attempt: attempt + 1,
                    err: err.message
                });
                try {
                    await this.manager.shoukaku.leaveVoiceChannel(this.guildId);
                } catch (_) {}
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 800));
                }
            }
        }

        this.state = PlayerState.IDLE;
        throw lastErr;
    }

    _getShardId() {
        const guild = this.client.guilds?.cache?.get(this.guildId);
        return guild?.shardId ?? 0;
    }

    _attachPlayerListeners(shoukakuPlayer) {
        shoukakuPlayer.removeAllListeners();

        shoukakuPlayer.on('update', (data) => {
            if (data?.state) {
                this.voiceConnected = Boolean(data.state.connected);
                if (typeof data.state.ping === 'number') {
                    this.voicePing = data.state.ping;
                }
            }
        });

        // ── 'start' ───────────────────────────────────────────────────────────
        // The attemptId is captured at registration time and re-checked inside
        // the lock so stale events from a previous track are always rejected,
        // even when _startCurrentTrackLocked has already advanced to the next
        // attempt before the event fires.
        shoukakuPlayer.on('start', (data) => {
            const capturedAttemptId = this.currentAttemptId;
            this.lock.runExclusive(this.guildId, async () => {
                if (!this._isEventForCurrentAttempt(data, capturedAttemptId)) return;
                this.state = this.isPaused ? PlayerState.PAUSED : PlayerState.PLAYING;
                this._clearIdleTimer();
                logger.info('MusicPlayer', 'Track playback started', {
                    guildId: this.guildId,
                    attemptId: this.currentAttemptId,
                    source: getTrackSource(this.current),
                    title: getTrackTitle(this.current),
                    playStartMs: this.lastPlayStartMs
                });
                this.manager.emit('playerStart', this, this.current);
            }).catch(err => logger.error('MusicPlayer', 'start listener error', { guildId: this.guildId, err: err.message }));
        });

        shoukakuPlayer.on('end', (data) => {
            const capturedAttemptId = this.currentAttemptId;
            this.lock.runExclusive(this.guildId, async () => {
                const reason = data?.reason || 'finished';
                if (!this._isEventForCurrentAttempt(data, capturedAttemptId)) return;

                const attemptId = this.currentAttemptId;
                logger.info('MusicPlayer', 'Track ended', {
                    guildId: this.guildId,
                    attemptId,
                    reason
                });

                if (reason === 'replaced' || reason === 'stopped' || reason === 'cleanup') {
                    return;
                }

                if (reason === 'loadFailed') {
                    if (this._handledFailureAttempts.has(attemptId)) {
                        logger.debug('MusicPlayer', 'Skipping duplicate loadFailed after exception', { guildId: this.guildId, attemptId });
                        return;
                    }
                    this._markFailureHandled(attemptId);
                    await this._recoverTrackLocked(attemptId, 'loadFailed');
                    return;
                }

                // Normal completion ('finished')
                this.consecutiveFailures = 0;
                await this._advanceQueueLocked();
            }).catch(err => logger.error('MusicPlayer', 'end listener error', { guildId: this.guildId, err: err.message }));
        });

        shoukakuPlayer.on('exception', (data) => {
            const capturedAttemptId = this.currentAttemptId;
            this.lock.runExclusive(this.guildId, async () => {
                if (!this._isEventForCurrentAttempt(data, capturedAttemptId)) return;
                const attemptId = this.currentAttemptId;
                const msg = data?.exception?.message || 'Track exception';
                logger.warn('MusicPlayer', 'Track exception received', {
                    guildId: this.guildId,
                    attemptId,
                    err: msg,
                    severity: data?.exception?.severity
                });

                if (this._handledFailureAttempts.has(attemptId)) return;
                this._markFailureHandled(attemptId);
                this.manager.emit('playerException', this, data);
                await this._recoverTrackLocked(attemptId, msg);
            }).catch(err => logger.error('MusicPlayer', 'exception listener error', { guildId: this.guildId, err: err.message }));
        });

        shoukakuPlayer.on('stuck', (data) => {
            const capturedAttemptId = this.currentAttemptId;
            this.lock.runExclusive(this.guildId, async () => {
                if (!this._isEventForCurrentAttempt(data, capturedAttemptId)) return;
                const attemptId = this.currentAttemptId;
                logger.warn('MusicPlayer', 'Track stuck detected', {
                    guildId: this.guildId,
                    attemptId,
                    thresholdMs: data?.thresholdMs
                });
                if (this._handledFailureAttempts.has(attemptId)) return;
                this._markFailureHandled(attemptId);
                this.manager.emit('playerStuck', this, data);
                await this._recoverTrackLocked(attemptId, 'stuck');
            }).catch(err => logger.error('MusicPlayer', 'stuck listener error', { guildId: this.guildId, err: err.message }));
        });

        shoukakuPlayer.on('closed', (data) => {
            this.lock.runExclusive(this.guildId, async () => {
                await this._handleVoiceClosedLocked(data);
            }).catch(err => logger.error('MusicPlayer', 'closed listener error', { guildId: this.guildId, err: err.message }));
        });
    }

    async _handleVoiceClosedLocked(data) {
        if (this.isDestroyed()) return;
        const code = data?.code;
        logger.warn('MusicPlayer', 'Voice WebSocket closed', {
            guildId: this.guildId,
            code,
            byRemote: data?.byRemote,
            reason: data?.reason
        });
        this.voiceConnected = false;
        this.manager.emit('playerClosed', this, data);

        // 4014 = kicked/disconnected or moved; verify voice channel state
        if (code === 4014) {
            const guild = this.client.guilds?.cache?.get(this.guildId);
            const meChannel = guild?.members?.me?.voice?.channelId;
            if (!meChannel) {
                await this._destroyLocked('Disconnected from voice (4014)');
            } else if (meChannel !== this.voiceId) {
                this.voiceId = meChannel;
            }
            return;
        }

        // 4017 = Discord DAVE (E2EE) protocol required / handshake failed
        if (code === 4017) {
            logger.error('MusicPlayer', 'Discord DAVE (E2EE) voice handshake failed (4017). Ensure Lavalink >= 4.2.2.', {
                guildId: this.guildId
            });
            await this._destroyLocked('Discord DAVE voice handshake failed (4017)');
            return;
        }

        // Transient Discord voice disconnect: attempt bounded recovery
        if (data?.byRemote && this._reconnectAttempts < 2 && this.current) {
            this._reconnectAttempts += 1;
            logger.info('MusicPlayer', 'Attempting bounded voice reconnection', {
                guildId: this.guildId,
                attempt: this._reconnectAttempts
            });
            try {
                await this._connectLocked(1);
                await this._startCurrentTrackLocked();
            } catch (err) {
                logger.error('MusicPlayer', 'Voice reconnection failed', { guildId: this.guildId, err: err.message });
                await this._destroyLocked('Voice reconnection failed');
            }
        }
    }

    async _waitForVoiceReady() {
        if (this.voiceConnected || !this.player) return;

        // A cancellation token increments each time destroy/stop is called,
        // so a concurrent _waitForVoiceReady loop exits immediately.
        const cancelToken = this._idleTimerToken;

        const deadline = Date.now() + VOICE_READY_MAX_WAIT_MS;
        while (Date.now() < deadline && !this.voiceConnected && !this.isDestroyed()) {
            // Abort if stop() or destroy() was called while we were polling
            if (this._idleTimerToken !== cancelToken) return;
            try {
                const remote = await this.player.node?.rest?.getPlayer(this.guildId);
                if (remote?.voice?.connected) {
                    this.voiceConnected = true;
                    if (typeof remote.voice.ping === 'number') {
                        this.voicePing = remote.voice.ping;
                    }
                    break;
                }
            } catch (_) {
                // Player may not yet exist on Lavalink REST before first update
                break;
            }
            await new Promise(r => setTimeout(r, VOICE_READY_POLL_MS));
        }

        if (!this.voiceConnected) {
            logger.debug('MusicPlayer', 'Voice ready check timed out / cancelled; starting anyway', {
                guildId: this.guildId,
                waitedMs: VOICE_READY_MAX_WAIT_MS
            });
        }
    }

    async _recoverTrackLocked(attemptId, reason) {
        if (this.isDestroyed()) return;
        this.manager.metrics.playbackFailures += 1;
        this.state = PlayerState.RECOVERING;

        if (this.current && (this.current._recoveryAttempts || 0) < MAX_TRACK_RETRIES) {
            this.current._recoveryAttempts = (this.current._recoveryAttempts || 0) + 1;
            const skipYouTube = /AllClients|login|403|Sign in/i.test(String(reason));
            logger.info('MusicPlayer', 'Attempting track recovery', {
                guildId: this.guildId,
                attemptId,
                recoveryAttempt: this.current._recoveryAttempts,
                title: getTrackTitle(this.current),
                reason
            });

            try {
                const replacement = await this.manager.resolver.resolveUnresolvedTrack(this.current, { skipYouTube });
                if (this.isDestroyed()) return;
                if (replacement && replacement.encoded) {
                    replacement._recoveryAttempts = this.current._recoveryAttempts;
                    this.current = replacement;
                    await this._startCurrentTrackLocked();
                    return;
                }
            } catch (err) {
                logger.warn('MusicPlayer', 'Track recovery lookup failed', {
                    guildId: this.guildId,
                    attemptId,
                    err: err.message
                });
            }
        }

        // Recovery failed for this track; advance to next track without halting playlist unless repeated
        this.consecutiveFailures += 1;
        const failedTitle = getTrackTitle(this.current);
        this.current = null;
        this.currentAttemptId = null;

        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.error('MusicPlayer', 'Too many consecutive track failures; halting queue playback', {
                guildId: this.guildId,
                consecutiveFailures: this.consecutiveFailures
            });
            this.loop = 'none';
            this.state = PlayerState.IDLE;
            this.manager.emit('playerErrorNotice', this, `Stopped playback after ${MAX_CONSECUTIVE_FAILURES} consecutive failed tracks (last: **${failedTitle}**).`);
            this._scheduleIdleTimerLocked();
            return;
        }

        this.manager.emit('playerErrorNotice', this, `Skipped unavailable track **${failedTitle}**.`);
        await this._advanceQueueLocked();
    }

    async enqueueTracks(tracks, { playIfIdle = true } = {}) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed()) return { added: 0, rejected: tracks.length };
            this._clearIdleTimer();

            const available = Math.max(0, this.maxQueueSize - this.queue.length);
            const toAdd = tracks.slice(0, available);
            this.queue.push(...toAdd);
            this._persistQueueSnapshot();

            if (playIfIdle && !this.current && this.state !== PlayerState.LOADING && this.state !== PlayerState.PLAYING) {
                await this._advanceQueueLocked();
            }

            return { added: toAdd.length, truncated: tracks.length > toAdd.length };
        });
    }

    async play() {
        return this.lock.runExclusive(this.guildId, () => this._playCurrentOrNextLocked());
    }

    async _playCurrentOrNextLocked() {
        if (this.isDestroyed()) return;
        if (!this.current && !this.queue.length) return;
        if (!this.current) {
            await this._advanceQueueLocked();
            return;
        }
        await this._startCurrentTrackLocked();
    }

    async _startCurrentTrackLocked() {
        if (this.isDestroyed() || !this.current || !this.player) return;
        const startEpoch = ++this._lockEpoch;
        this._clearIdleTimer();
        this.state = PlayerState.LOADING;

        // Resolve unresolved tracks just-in-time
        if (isUnresolvedTrack(this.current)) {
            const resStart = Date.now();
            try {
                const resolved = await this.manager.resolver.resolveUnresolvedTrack(this.current);
                this.lastResolveMs = Date.now() - resStart;
                if (this.isDestroyed() || startEpoch !== this._lockEpoch) return;
                if (!resolved || !resolved.encoded) {
                    logger.warn('MusicPlayer', 'JIT track resolution returned no match', {
                        guildId: this.guildId,
                        title: getTrackTitle(this.current),
                        resolveMs: this.lastResolveMs
                    });
                    this.consecutiveFailures += 1;
                    this.current = null;
                    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        this.state = PlayerState.IDLE;
                        this._scheduleIdleTimerLocked();
                        return;
                    }
                    await this._advanceQueueLocked();
                    return;
                }
                this.current = resolved;
            } catch (err) {
                this.lastResolveMs = Date.now() - resStart;
                if (this.isDestroyed() || startEpoch !== this._lockEpoch) return;
                logger.error('MusicPlayer', 'JIT resolve error', {
                    guildId: this.guildId,
                    title: getTrackTitle(this.current),
                    err: err.message
                });
                this.current = null;
                await this._advanceQueueLocked();
                return;
            }
        }

        if (this.isNewConnection) {
            this.isNewConnection = false;
            await this._waitForVoiceReady();
            if (this.isDestroyed() || startEpoch !== this._lockEpoch) return;
        }

        const attemptId = this._nextAttemptId();
        this.currentAttemptId = attemptId;
        this.isPaused = false;
        this._reconnectAttempts = 0;

        // Build single atomic Lavalink player update (track + userData + volume + filters on init)
        const playerOptions = {
            track: {
                encoded: this.current.encoded,
                userData: {
                    attemptId,
                    guildId: this.guildId
                }
            },
            paused: false
        };

        if (!this._filtersInitialized) {
            playerOptions.volume = this.volume;
            playerOptions.filters = buildLavalinkFilters(this.preset);
            this._filtersInitialized = true;
        }

        const playCallStart = Date.now();
        try {
            await this.player.update(playerOptions, false);
            this.lastPlayStartMs = Date.now() - playCallStart;
            this._recordAutoplaySeed(this.current);
            this.lastPlayedTrack = this.current;
            this._persistQueueSnapshot();

            if (this.manager.db && this.current) {
                this.manager.db.addHistory(this.guildId, this.current.requester?.id, this.current);
            }
        } catch (err) {
            logger.error('MusicPlayer', 'Lavalink player.update failed', {
                guildId: this.guildId,
                attemptId,
                err: err.message
            });
            if (!this._handledFailureAttempts.has(attemptId)) {
                this._markFailureHandled(attemptId);
                await this._recoverTrackLocked(attemptId, err.message);
            }
        }
    }

    async _advanceQueueLocked() {
        if (this.isDestroyed()) return;

        if (this.current) {
            if (this.loop === 'track') {
                this.queue.unshift(this.current);
            } else if (this.loop === 'queue') {
                this._pushHistory(this.current);
                this.queue.push(this.current);
            } else {
                this._pushHistory(this.current);
            }
        }

        this.current = this.queue.shift() || null;

        if (!this.current && this.autoplay && this.lastPlayedTrack) {
            try {
                const excludeSet = new Set(this._recentAutoplayKeys);
                const related = await this.manager.resolver.findAutoplayTrack(
                    this.lastPlayedTrack,
                    excludeSet,
                    this.lastPlayedTrack.requester || null
                );
                if (this.isDestroyed()) return;
                if (related) {
                    this.current = related;
                    logger.info('MusicPlayer', 'Autoplay queued related track', {
                        guildId: this.guildId,
                        title: getTrackTitle(related)
                    });
                }
            } catch (err) {
                logger.warn('MusicPlayer', 'Autoplay lookup failed', { guildId: this.guildId, err: err.message });
            }
        }

        if (!this.current) {
            this.currentAttemptId = null;
            this.state = PlayerState.IDLE;
            this.isPaused = false;
            this._persistQueueSnapshot();
            this.manager.emit('playerEmpty', this);
            this._scheduleIdleTimerLocked();
            return;
        }

        await this._startCurrentTrackLocked();
    }

    _pushHistory(track) {
        if (!track) return;
        this.previous.push(track);
        while (this.previous.length > 50) {
            this.previous.shift();
        }
    }

    async skip() {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed()) return { ok: false, reason: 'Player is no longer active.' };
            this._lockEpoch += 1;
            if (!this.current && !this.queue.length) {
                return { ok: false, reason: 'Nothing is currently playing.' };
            }
            const skipped = this.current;
            // Invalidate current attempt before advancing so stale 'end'/'exception' events from Lavalink are ignored
            this.currentAttemptId = null;
            if (this.loop === 'track') {
                // Skip should move past the looped track when explicitly skipped
                if (this.current) this._pushHistory(this.current);
                this.current = null;
            }
            if (this.player) {
                await this.player.stopTrack().catch(() => {});
            }
            await this._advanceQueueLocked();
            return { ok: true, skipped };
        });
    }

    async playPrevious() {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed() || !this.previous.length) return false;
            this.currentAttemptId = null;
            if (this.current) {
                this.queue.unshift(this.current);
            }
            this.current = this.previous.pop();
            await this._startCurrentTrackLocked();
            return true;
        });
    }

    async stop() {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed()) return;
            this._lockEpoch += 1;
            this._clearIdleTimer();
            this.currentAttemptId = null;
            this.queue = [];
            this.current = null;
            this.isPaused = false;
            this.state = PlayerState.IDLE;

            if (this.nowPlayingMessage) {
                this.manager.retireNowPlayingMessage(this).catch(() => {});
            }
            if (this.player) {
                await this.player.stopTrack().catch(() => {});
            }
            if (this.manager.db) {
                this.manager.db.clearSavedQueue(this.guildId);
            }
            this.manager.emit('playerEmpty', this);
            this._scheduleIdleTimerLocked();
        });
    }

    async setPaused(paused) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed() || !this.player || !this.current) return false;
            this.isPaused = Boolean(paused);
            this.state = this.isPaused ? PlayerState.PAUSED : PlayerState.PLAYING;
            await this.player.setPaused(this.isPaused);
            return this.isPaused;
        });
    }

    async seek(positionMs) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed() || !this.player || !this.current) return { ok: false, reason: 'Nothing is playing.' };
            await this.player.seekTo(positionMs);
            return { ok: true, position: positionMs };
        });
    }

    async setVolume(volume) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed()) return this.volume;
            const clamped = Math.max(1, Math.min(200, Math.round(Number(volume))));
            this.volume = clamped;
            if (this.player) {
                await this.player.setGlobalVolume(clamped);
            }
            this._persistQueueSnapshot();
            return clamped;
        });
    }

    async setEqualizerPreset(presetName) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.isDestroyed()) return this.preset;
            const filters = buildLavalinkFilters(presetName);
            this.preset = PRESET_DEFINITIONS[presetName] ? presetName : 'flat';
            if (this.player) {
                await this.player.setFilters(filters);
                this._filtersInitialized = true;
            }
            this._persistQueueSnapshot();
            return this.preset;
        });
    }

    async setBassBoost(level) {
        const presetKey = mapBassLevelToPreset(level);
        return this.setEqualizerPreset(presetKey);
    }

    async setLoop(mode) {
        return this.lock.runExclusive(this.guildId, async () => {
            this.loop = mode;
            this._persistQueueSnapshot();
            return mode;
        });
    }

    async setAutoplay(enabled) {
        return this.lock.runExclusive(this.guildId, async () => {
            this.autoplay = Boolean(enabled);
            if (this.manager.db) {
                this.manager.db.updateGuildSettings(this.guildId, { autoplay: this.autoplay });
            }
            this._persistQueueSnapshot();
            return this.autoplay;
        });
    }

    async set247(enabled) {
        return this.lock.runExclusive(this.guildId, async () => {
            this.is247 = Boolean(enabled);
            if (this.is247) {
                this._clearIdleTimer();
            } else if (!this.current && this.queue.length === 0) {
                this._scheduleIdleTimerLocked();
            }
            if (this.manager.db) {
                this.manager.db.updateGuildSettings(this.guildId, { mode_247: this.is247 });
            }
            return this.is247;
        });
    }

    async shuffleQueue() {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.queue.length < 2) return this.queue.length;
            for (let i = this.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
            }
            this._persistQueueSnapshot();
            return this.queue.length;
        });
    }

    async clearQueue() {
        return this.lock.runExclusive(this.guildId, async () => {
            const count = this.queue.length;
            this.queue = [];
            this._persistQueueSnapshot();
            return count;
        });
    }

    async moveTrack(fromPos, toPos) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.queue.length === 0) {
                return { ok: false, reason: 'The queue is currently empty.' };
            }
            if (!Number.isInteger(fromPos) || !Number.isInteger(toPos) || fromPos < 1 || toPos < 1) {
                return { ok: false, reason: 'Positions must be positive integers.' };
            }
            if (fromPos > this.queue.length || toPos > this.queue.length) {
                return { ok: false, reason: `There are only **${this.queue.length}** track(s) in the queue.` };
            }
            if (fromPos === toPos) {
                return { ok: false, reason: 'Source and destination positions are identical.' };
            }
            const [moved] = this.queue.splice(fromPos - 1, 1);
            this.queue.splice(toPos - 1, 0, moved);
            this._persistQueueSnapshot();
            return { ok: true, track: moved };
        });
    }

    async removeTrack(position) {
        return this.lock.runExclusive(this.guildId, async () => {
            if (this.queue.length === 0) {
                return { ok: false, reason: 'The queue is currently empty.' };
            }
            if (!Number.isInteger(position) || position < 1 || position > this.queue.length) {
                return { ok: false, reason: `There are only **${this.queue.length}** track(s) in the queue.` };
            }
            const [removed] = this.queue.splice(position - 1, 1);
            this._persistQueueSnapshot();
            return { ok: true, track: removed };
        });
    }

    async destroy(reason = 'Unknown') {
        return this.lock.runExclusive(this.guildId, () => this._destroyLocked(reason));
    }

    async _destroyLocked(reason = 'Unknown') {
        if (this.isDestroyed()) return;
        this._lockEpoch += 1;
        this.state = PlayerState.DESTROYING;
        logger.info('MusicPlayer', 'Destroying player', { guildId: this.guildId, reason });

        this._clearIdleTimer();
        this.currentAttemptId = null;
        this.queue = [];
        this.previous = [];
        this.current = null;
        this.voiceConnected = false;

        if (this.nowPlayingMessage) {
            await this.manager.retireNowPlayingMessage(this).catch(() => {});
        }

        if (this.player) {
            try {
                this.player.removeAllListeners();
                await this.player.stopTrack().catch(() => {});
            } catch (err) {
                logger.warn('MusicPlayer', 'Non-fatal teardown error', { guildId: this.guildId, err: err.message });
            }
        }

        try {
            await this.manager.shoukaku.leaveVoiceChannel(this.guildId);
        } catch (err) {
            logger.warn('MusicPlayer', 'leaveVoiceChannel error during destroy', { guildId: this.guildId, err: err.message });
        }

        this.player = null;
        this.state = PlayerState.DESTROYED;
        this.manager.players.delete(this.guildId);
    }
}

module.exports = MusicPlayer;
module.exports.PlayerState = PlayerState;
