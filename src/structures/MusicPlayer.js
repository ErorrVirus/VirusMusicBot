const { errorEmbed } = require('../utils/embedBuilder');

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
        
        this.connectionTimeout = null;
    }

    async connect() {
        this.player = await this.manager.shoukaku.joinVoiceChannel({
            guildId: this.guildId,
            channelId: this.voiceId,
            shardId: 0,
            deaf: true
        });

        this.player.on('start', () => this.manager.emit('playerStart', this, this.current));
        this.player.on('end', (data) => {
            if (data.reason === 'replaced') return;
            this.playNext();
        });
        
        this.player.on('closed', (data) => {
            this.manager.emit('playerClosed', this, data);
        });

        this.player.on('exception', (data) => {
            this.manager.emit('playerException', this, data);
            this.playNext();
        });

        this.player.on('stuck', (data) => {
            this.manager.emit('playerStuck', this, data);
            this.playNext();
        });
    }

    async play() {
        if (!this.queue.length && !this.current) return;

        if (!this.current) {
            this.current = this.queue.shift();
        }

        try {
            await this.player.playTrack({ track: this.current.encoded });
            await this.player.setGlobalVolume(this.volume);
        } catch (error) {
            console.error('Failed to play track', error);
            this.playNext();
        }
    }

    playNext() {
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

        this.play();
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

    destroy() {
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.queue = [];
        this.previous = [];
        this.current = null;
        if (this.player) this.manager.shoukaku.leaveVoiceChannel(this.guildId);
        this.manager.players.delete(this.guildId);
    }
}

module.exports = MusicPlayer;
