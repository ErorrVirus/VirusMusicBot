const { errorEmbed } = require('../utils/embedBuilder');
const { buildSearchQueries } = require('../utils/searchCleaner');

const EQ_PRESETS = {
    off: [],
    rich: [ // Studio Reference Balanced - Tight Punchy Bass, Crystal Clear Vocals & Smooth Highs
        { band: 0, gain: 0.07 },
        { band: 1, gain: 0.06 },
        { band: 2, gain: 0.04 },
        { band: 3, gain: 0.02 },
        { band: 4, gain: 0.00 },
        { band: 5, gain: 0.00 },
        { band: 6, gain: 0.00 },
        { band: 7, gain: 0.00 },
        { band: 8, gain: 0.00 },
        { band: 9, gain: 0.01 },
        { band: 10, gain: 0.02 },
        { band: 11, gain: 0.03 },
        { band: 12, gain: 0.03 },
        { band: 13, gain: 0.02 },
        { band: 14, gain: 0.01 }
    ],
    bass_low: [
        { band: 0, gain: 0.10 },
        { band: 1, gain: 0.08 },
        { band: 2, gain: 0.05 },
        { band: 3, gain: 0.02 },
        { band: 4, gain: 0.00 }
    ],
    bass_medium: [
        { band: 0, gain: 0.18 },
        { band: 1, gain: 0.14 },
        { band: 2, gain: 0.10 },
        { band: 3, gain: 0.05 },
        { band: 4, gain: 0.02 }
    ],
    bass_high: [
        { band: 0, gain: 0.28 },
        { band: 1, gain: 0.22 },
        { band: 2, gain: 0.16 },
        { band: 3, gain: 0.08 },
        { band: 4, gain: 0.04 }
    ],
    bass_extreme: [
        { band: 0, gain: 0.40 },
        { band: 1, gain: 0.32 },
        { band: 2, gain: 0.22 },
        { band: 3, gain: 0.12 },
        { band: 4, gain: 0.06 }
    ],
    pop: [
        { band: 0, gain: -0.02 },
        { band: 1, gain: -0.01 },
        { band: 2, gain: 0.08 },
        { band: 3, gain: 0.14 },
        { band: 4, gain: 0.16 },
        { band: 5, gain: 0.12 },
        { band: 6, gain: 0.05 },
        { band: 7, gain: -0.02 },
        { band: 8, gain: -0.03 },
        { band: 9, gain: 0.05 },
        { band: 10, gain: 0.08 },
        { band: 11, gain: 0.10 },
        { band: 12, gain: 0.08 },
        { band: 13, gain: 0.04 },
        { band: 14, gain: 0.02 }
    ],
    rock: [
        { band: 0, gain: 0.30 },
        { band: 1, gain: 0.25 },
        { band: 2, gain: 0.20 },
        { band: 3, gain: 0.10 },
        { band: 4, gain: 0.05 },
        { band: 5, gain: -0.05 },
        { band: 6, gain: -0.08 },
        { band: 7, gain: -0.04 },
        { band: 8, gain: 0.00 },
        { band: 9, gain: 0.08 },
        { band: 10, gain: 0.14 },
        { band: 11, gain: 0.18 },
        { band: 12, gain: 0.14 },
        { band: 13, gain: 0.08 },
        { band: 14, gain: 0.04 }
    ],
    electronic: [
        { band: 0, gain: 0.35 },
        { band: 1, gain: 0.30 },
        { band: 2, gain: 0.20 },
        { band: 3, gain: 0.05 },
        { band: 4, gain: -0.05 },
        { band: 5, gain: -0.05 },
        { band: 6, gain: 0.00 },
        { band: 7, gain: 0.05 },
        { band: 8, gain: 0.10 },
        { band: 9, gain: 0.15 },
        { band: 10, gain: 0.18 },
        { band: 11, gain: 0.15 },
        { band: 12, gain: 0.10 },
        { band: 13, gain: 0.05 },
        { band: 14, gain: 0.02 }
    ],
    vocal: [
        { band: 0, gain: -0.15 },
        { band: 1, gain: -0.10 },
        { band: 2, gain: -0.05 },
        { band: 3, gain: 0.00 },
        { band: 4, gain: 0.05 },
        { band: 5, gain: 0.15 },
        { band: 6, gain: 0.20 },
        { band: 7, gain: 0.20 },
        { band: 8, gain: 0.15 },
        { band: 9, gain: 0.10 },
        { band: 10, gain: 0.05 },
        { band: 11, gain: 0.00 },
        { band: 12, gain: -0.05 },
        { band: 13, gain: -0.10 },
        { band: 14, gain: -0.15 }
    ]
};

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
        
        // Equalizer Preset (Default: Rich Studio Enhancement)
        this.preset = 'rich';
        this.currentEqualizer = EQ_PRESETS.rich;
        
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

    async setEqualizerPreset(presetName) {
        const bands = EQ_PRESETS[presetName] !== undefined ? EQ_PRESETS[presetName] : EQ_PRESETS.rich;
        this.preset = presetName;
        this.currentEqualizer = bands;
        if (this.player) {
            await this.player.setEqualizer(bands);
        }
    }

    async setBassBoost(level) {
        let presetKey = 'off';
        if (level === 'low') presetKey = 'bass_low';
        else if (level === 'medium') presetKey = 'bass_medium';
        else if (level === 'high') presetKey = 'bass_high';
        else if (level === 'extreme') presetKey = 'bass_extreme';
        else if (level === 'off') presetKey = 'off';
        else presetKey = 'rich';

        await this.setEqualizerPreset(presetKey);
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

        console.log(`[MusicPlayer] play called for: "${this.current.info?.title || this.current.title}"`);

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
            // Allow Discord Voice UDP socket & DAVE encryption handshake to stabilize on fresh joins
            if (this.isNewConnection) {
                this.isNewConnection = false;
                await new Promise(r => setTimeout(r, 600));
            }

            await this.player.playTrack({ track: { encoded: this.current.encoded } });
            
            // Apply Rich Equalizer preset (Studio Bass & Clarity)
            if (this.currentEqualizer && this.currentEqualizer.length > 0) {
                await this.player.setEqualizer(this.currentEqualizer).catch(() => {});
            }

            if (this.volume !== 100) {
                await this.player.setGlobalVolume(this.volume).catch(() => {});
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
module.exports.EQ_PRESETS = EQ_PRESETS;
