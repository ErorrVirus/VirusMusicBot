const { errorEmbed } = require('../utils/embedBuilder');
const { buildSearchQueries } = require('../utils/searchCleaner');

class MusicPlayer {
    constructor(manager, node, options) {
        this.manager = manager;
        this.client = manager.client;
        this.node = node;
        this.guildId = options.guildId;
        this.textId = options.textId;
        this.voiceId = options.voiceId;

        // Raw Shoukaku Player
        this.player = null;

        // Queue System
        this.queue = [];
        this.current = null;
        this.previous = [];
        
        // Settings
        this.loop = 'none'; // none, track, queue
        this.volume = 100;
        this.isPaused = false;
        
        // Reference to the Now Playing message so we can live-edit the volume bar
        this.nowPlayingMessage = null;
        
        this.connectionTimeout = null;
        this.isNewConnection = true;
    }

    async connect(retries = 2) {
        if (this.manager.shoukaku.connections.has(this.guildId)) {
            try {
                await this.manager.shoukaku.leaveVoiceChannel(this.guildId);
            } catch (_) {}
        }

        try {
            this.player = await this.manager.shoukaku.joinVoiceChannel({
                guildId: this.guildId,
                channelId: this.voiceId,
                shardId: 0,
                deaf: true
            });
            this.isNewConnection = true;
        } catch (err) {
            console.error(`[MusicPlayer] Voice connection error: ${err.message}`);
            if (retries > 0) {
                console.log(`[MusicPlayer] Retrying voice connection in 1s... (${retries} attempts left)`);
                try {
                    await this.manager.shoukaku.leaveVoiceChannel(this.guildId);
                } catch (_) {}
                await new Promise(r => setTimeout(r, 1000));
                return this.connect(retries - 1);
            }
            throw err;
        }

        this.player.on('start', () => this.manager.emit('playerStart', this, this.current));
        this.player.on('end', async (data) => {
            console.log(`[MusicPlayer] Track ended. Reason: ${data.reason}`);
            if (data.reason === 'replaced' || data.reason === 'stopped' || data.reason === 'cleanup') return;
            if (data.reason === 'loadFailed') {
                return this.handleTrackFailure('loadFailed');
            }
            this.playNext();
        });
        
        this.player.on('closed', (data) => {
            this.manager.emit('playerClosed', this, data);
        });

        this.player.on('exception', (data) => {
            this.manager.emit('playerException', this, data);
            const msg = data.exception?.message || 'Track exception';
            this.handleTrackFailure(msg);
        });

        this.player.on('stuck', (data) => {
            this.manager.emit('playerStuck', this, data);
            this.handleTrackFailure('stuck');
        });
    }

    async handleTrackFailure(reason = 'unknown') {
        if (this.current && !this.current._fallbackTried) {
            this.current._fallbackTried = true;
            const title = this.current.info?.title || this.current.title || '';
            const author = this.current.info?.author || this.current.artist || '';
            console.log(`[MusicPlayer] Track failed (${reason}). Trying seamless fallback for "${title}"...`);
            try {
                const fallbackQueries = buildSearchQueries(title, author);
                let fallbackRes = null;
                const requester = this.current?.requester || null;
                for (const q of fallbackQueries) {
                    // Skip ytsearch queries if YouTube client exception occurred
                    if (q.startsWith('ytsearch:') && (reason.includes('AllClients') || reason.includes('login') || reason.includes('403'))) {
                        continue;
                    }
                    fallbackRes = await this.manager.resolve(q, requester);
                    if (fallbackRes && fallbackRes.tracks.length) break;
                }

                if (fallbackRes && fallbackRes.tracks.length) {
                    this.current = fallbackRes.tracks[0];
                    this.current._fallbackTried = true;
                    try { await this.player.stopTrack(); } catch (_) {}
                    await new Promise(r => setTimeout(r, 200));
                    await this.player.playTrack({ track: { encoded: this.current.encoded } });
                    return;
                }
            } catch (e) {
                console.error('[MusicPlayer] Fallback attempt error:', e.message);
            }
        }
        this.playNext();
    }

    async play() {
        if (!this.queue.length && !this.current) return;

        if (!this.current) {
            this.current = this.queue.shift();
        }

        // Just-In-Time (JIT) Resolving for Spotify/YouTube bypass
        if (this.current.isUnresolved) {
            try {
                const candidateQueries = buildSearchQueries(this.current.title, this.current.artist);
                let res = null;
                for (const q of candidateQueries) {
                    res = await this.manager.resolve(q, this.current.requester);
                    if (res && res.tracks.length) break;
                }

                if (res && res.tracks.length) {
                    this.current = res.tracks[0];
                } else {
                    console.log(`[MusicPlayer] JIT Resolve failed for ${this.current.title}`);
                    return this.playNext();
                }
            } catch (err) {
                console.error('[MusicPlayer] JIT Resolve Error:', err.message);
                return this.playNext();
            }
        }

        try {
            // Give Discord Voice UDP socket & DAVE encryption handshake 600ms to stabilize on fresh joins
            if (this.isNewConnection) {
                this.isNewConnection = false;
                await new Promise(r => setTimeout(r, 600));
            }

            await this.player.playTrack({ track: { encoded: this.current.encoded } });
            // Only restore volume if it's not the default (100).
            // We intentionally do NOT call setGlobalVolume here on every track start
            // because that triggers a Lavalink filter update during audio buffer
            // initialization, causing a race condition that manifests as startup stutter.
            // Lavalink remembers the player's volume across tracks on the same session.
            if (this.volume !== 100) {
                await this.player.setGlobalVolume(this.volume);
            }
        } catch (error) {
            console.error('Failed to play track', error);
            this.playNext();
        }
    }

    stop() {
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.queue = [];
        this.current = null;
        
        if (this.nowPlayingMessage) {
            this.nowPlayingMessage.delete().catch(() => {});
            this.nowPlayingMessage = null;
        }

        if (this.player) {
            try {
                this.player.stopTrack();
            } catch (_) {}
        }

        this.manager.emit('playerEmpty', this);
    }

    async playNext() {
        if (this.current) {
            if (this.loop === 'track') {
                this.queue.unshift(this.current);
            } else if (this.loop === 'queue') {
                this.previous.push(this.current);
                this.queue.push(this.current);
            } else {
                this.previous.push(this.current);
            }
        }

        this.current = this.queue.shift() || null;

        if (!this.current) {
            this.manager.emit('playerEmpty', this);
            return;
        }

        await this.play();
    }

    playPrevious() {
        if (!this.previous.length) return false;
        
        if (this.current) {
            this.queue.unshift(this.current);
        }
        
        this.current = this.previous.pop();
        this.play();
        return true;
    }

    destroy(reason = 'Unknown') {
        console.log(`[MusicPlayer] Destroying player for guild ${this.guildId}. Reason: ${reason}`);
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.queue = [];
        this.previous = [];
        this.current = null;
        
        if (this.player) {
            try {
                this.player.setPaused(true);
                this.player.stopTrack();
                this.player.removeAllListeners();
            } catch (err) {
                console.warn('[MusicPlayer] Non-fatal error during player teardown:', err.message);
            }
            this.manager.shoukaku.leaveVoiceChannel(this.guildId);
        }
        
        this.manager.players.delete(this.guildId);
    }
}

module.exports = MusicPlayer;
