const { EventEmitter } = require('node:events');
const { Shoukaku, Connectors } = require('shoukaku');
const { ActivityType } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const MusicPlayer = require('./MusicPlayer');
const TrackResolver = require('../services/TrackResolver');
const DatabaseService = require('../services/Database');
const { buildNowPlayingEmbed, buildControlRows, buildEmbed, errorEmbed } = require('../utils/embedBuilder');

class MusicManager extends EventEmitter {
    constructor(client, options = {}) {
        super();
        this.client = client;
        this.players = new Map();
        this.db = options.db || new DatabaseService();
        this.metrics = {
            playbackFailures: 0,
            tracksStarted: 0,
            lavalinkDisconnects: 0
        };

        const nodes = options.nodes || [{
            name: config.lavalink.name,
            url: config.lavalink.url,
            auth: config.lavalink.auth,
            secure: config.lavalink.secure
        }];

        // Verified Shoukaku v4.3.0 options
        const shoukakuOptions = options.shoukakuOptions || {
            moveOnDisconnect: false,
            resume: true,
            resumeTimeout: 60,
            resumeByLibrary: true,
            reconnectTries: 100,
            reconnectInterval: 5,
            restTimeout: 10,
            voiceConnectionTimeout: 15
        };

        this.shoukaku = options.shoukaku || new Shoukaku(new Connectors.DiscordJS(client), nodes, shoukakuOptions);
        this.resolver = options.resolver || new TrackResolver(this);
        this._npEditTimers = new Map();

        this._bindShoukakuEvents();
        this._bindPlayerManagerEvents();
    }

    _bindShoukakuEvents() {
        this.shoukaku.on('ready', (name, lavalinkResume, libraryResume) => {
            logger.info('Lavalink', `Node ${name} is ready`, { lavalinkResume, libraryResume });
        });
        this.shoukaku.on('error', (name, error) => {
            logger.error('Lavalink', `Node ${name} emitted error`, { err: error });
        });
        this.shoukaku.on('close', (name, code, reason) => {
            logger.warn('Lavalink', `Node ${name} websocket closed`, { code, reason: reason || 'No reason' });
        });
        this.shoukaku.on('disconnect', (name, count) => {
            this.metrics.lavalinkDisconnects += 1;
            logger.warn('Lavalink', `Node ${name} disconnected`, { movedPlayers: count });
        });
        this.shoukaku.on('reconnecting', (name, left, interval) => {
            logger.info('Lavalink', `Node ${name} reconnecting`, { reconnectsLeft: left, intervalSec: interval });
        });
    }

    _bindPlayerManagerEvents() {
        this.on('playerStart', async (player, track) => {
            this.metrics.tracksStarted += 1;
            const channel = this.client.channels?.cache?.get(player.textId);
            if (!channel) return;

            await this.retireNowPlayingMessage(player).catch(() => {});

            if (this.client.user) {
                this.client.user.setActivity('music 🎵', { type: ActivityType.Listening });
            }

            try {
                const embed = buildNowPlayingEmbed(player, track, this.client.user?.displayAvatarURL?.());
                const rows = buildControlRows(player, false);
                const msg = await channel.send({ embeds: [embed], components: rows });
                player.nowPlayingMessage = msg;
            } catch (err) {
                logger.error('MusicManager', 'Failed to send Now Playing message', { guildId: player.guildId, err: err.message });
            }
        });

        this.on('playerEmpty', (player) => {
            const anyActive = [...this.players.values()].some(p => p.current && !p.isDestroyed());
            if (!anyActive && this.client.user) {
                this.client.user.setActivity('ready to play any song', { type: ActivityType.Playing });
            }

            this.retireNowPlayingMessage(player).catch(() => {});
            const channel = this.client.channels?.cache?.get(player.textId);
            if (channel && !player.isDestroyed()) {
                const msg = player.is247
                    ? 'Queue concluded. Staying in voice channel (**24/7 mode** enabled).'
                    : `Queue concluded. Disconnecting in ${Math.round((player.idleTimeoutMs || 60000) / 1000)} seconds if no tracks are added.`;
                channel.send({ embeds: [buildEmbed({ description: msg })] }).catch(() => {});
            }
        });

        this.on('playerErrorNotice', (player, text) => {
            const channel = this.client.channels?.cache?.get(player.textId);
            if (channel && !player.isDestroyed()) {
                channel.send({ embeds: [errorEmbed(text)] }).catch(() => {});
            }
        });
    }

    async retireNowPlayingMessage(player) {
        const msg = player.nowPlayingMessage;
        player.nowPlayingMessage = null;
        if (!msg) return;
        try {
            // Disable controls instead of hard-deleting if message still exists, or delete cleanly
            await msg.delete();
        } catch (_) {
            try {
                await msg.edit({ components: buildControlRows(player, true) });
            } catch (_) {}
        }
    }

    /**
     * Coalesces Now Playing message edits to protect against Discord API rate limits.
     */
    scheduleNowPlayingRefresh(player) {
        if (!player?.nowPlayingMessage || !player.current || player.isDestroyed()) return;
        const existing = this._npEditTimers.get(player.guildId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            this._npEditTimers.delete(player.guildId);
            if (!player.nowPlayingMessage || !player.current || player.isDestroyed()) return;
            try {
                await player.nowPlayingMessage.edit({
                    embeds: [buildNowPlayingEmbed(player, player.current, this.client.user?.displayAvatarURL?.())],
                    components: buildControlRows(player, false)
                });
            } catch (_) {}
        }, 300);
        if (timer.unref) timer.unref();
        this._npEditTimers.set(player.guildId, timer);
    }

    getActiveNode() {
        if (this.shoukaku.getIdealNode) {
            const ideal = this.shoukaku.getIdealNode();
            if (ideal && ideal.state === 1) return ideal;
        }
        for (const node of this.shoukaku.nodes.values()) {
            if (node.state === 1) return node;
        }
        return this.shoukaku.nodes.values().next().value || null;
    }

    async createPlayer(options) {
        let player = this.players.get(options.guildId);
        if (player && player.isDestroyed()) {
            this.players.delete(options.guildId);
            player = null;
        }

        if (!player) {
            const node = this.getActiveNode();
            if (!node) throw new Error('No Lavalink nodes available.');

            player = new MusicPlayer(this, node, options);
            this.players.set(options.guildId, player);
            try {
                await player.connect();
            } catch (err) {
                this.players.delete(options.guildId);
                throw err;
            }
        } else {
            player.textId = options.textId;
        }

        return player;
    }

    getPlayer(guildId) {
        const player = this.players.get(guildId);
        if (player && player.isDestroyed()) {
            this.players.delete(guildId);
            return undefined;
        }
        return player;
    }

    async resolve(query, requester) {
        return this.resolver.resolveInput(query, requester);
    }

    getStatsSnapshot() {
        const node = this.getActiveNode();
        const stats = node?.stats || null;
        return {
            lavalinkConnected: Boolean(node && node.state === 1),
            nodeName: node?.name || 'Primary Node',
            playersCount: this.players.size,
            activeStreams: [...this.players.values()].filter(p => p.current && !p.isDestroyed()).length,
            playbackFailures: this.metrics.playbackFailures,
            tracksStarted: this.metrics.tracksStarted,
            lavalinkDisconnects: this.metrics.lavalinkDisconnects,
            jvmMemory: stats?.memory || null,
            cpu: stats?.cpu || null,
            frameStats: stats?.frameStats || null,
            lavalinkUptime: stats?.uptime || 0
        };
    }

    async shutdown() {
        logger.info('MusicManager', 'Shutting down all active players...');
        for (const timer of this._npEditTimers.values()) clearTimeout(timer);
        this._npEditTimers.clear();

        const active = [...this.players.values()];
        await Promise.allSettled(active.map(p => p.destroy('Application shutdown')));

        for (const node of this.shoukaku.nodes.values()) {
            try {
                node.disconnect(1000, 'Application shutdown');
            } catch (_) {}
        }

        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MusicManager;
