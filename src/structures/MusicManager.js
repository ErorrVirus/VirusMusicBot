const { EventEmitter } = require('events');
const { Shoukaku, Connectors } = require('shoukaku');
const MusicPlayer = require('./MusicPlayer');
const config = require('../config');

class MusicManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.players = new Map();

        const Nodes = [{
            name: config.lavalink.name,
            url: config.lavalink.url,
            auth: config.lavalink.auth,
            secure: config.lavalink.secure
        }];

        const ShoukakuOptions = {
            moveOnDisconnect: false,
            resumable: false,
            resumableTimeout: 30,
            reconnectTries: 20,
            reconnectInterval: 5000,
            restTimeout: 10000
        };

        this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, ShoukakuOptions);

        this.shoukaku.on('ready', (name) => console.log(`[Lavalink] Node ${name} is ready!`));
        this.shoukaku.on('error', (name, error) => console.error(`[Lavalink] Node ${name} emitted error:`, error));
        this.shoukaku.on('close', (name, code, reason) => console.log(`[Lavalink] Node ${name} closed with code ${code}. Reason: ${reason || 'No reason'}`));
        this.shoukaku.on('disconnect', (name, count) => console.warn(`[Lavalink] Node ${name} disconnected. Reconnecting... (Attempt ${count})`));
        
        // Handle events emitted by MusicPlayer
        this.on('playerStart', (player, track) => {
            const channel = this.client.channels.cache.get(player.textId);
            if (!channel) return;
            const { buildEmbed } = require('../utils/embedBuilder');
            const { formatTime } = require('../utils/helpers');
            
            const embed = buildEmbed({
                title: '🎶 Now Playing',
                description: `[**${track.info.title}**](${track.info.uri})`,
                thumbnail: track.info.artworkUrl || null,
                fields: [
                    { name: 'Author', value: track.info.author, inline: true },
                    { name: 'Duration', value: track.info.isStream ? 'LIVE' : formatTime(track.info.length), inline: true },
                    { name: 'Requested By', value: `<@${track.requester.id}>`, inline: true }
                ]
            });
            channel.send({ embeds: [embed] }).catch(() => {});
        });

        this.on('playerEmpty', (player) => {
            const channel = this.client.channels.cache.get(player.textId);
            if (channel) {
                const { buildEmbed } = require('../utils/embedBuilder');
                channel.send({ embeds: [buildEmbed({ description: 'Queue concluded. Disconnecting in 1 minute if no tracks are added.' })] }).catch(() => {});
            }
            
            player.connectionTimeout = setTimeout(() => {
                if (player && !player.current) {
                    player.destroy();
                }
            }, 60000);
        });

        this.on('playerClosed', (player, data) => {
            console.log(`Player closed in guild ${player.guildId}`, data);
            // Ignore normal disconnects
            if (data.code === 4014) return;
        });
    }

    async createPlayer(options) {
        let player = this.players.get(options.guildId);
        if (!player) {
            const node = this.shoukaku.options.nodeResolver(this.shoukaku.nodes);
            if (!node) throw new Error('No Lavalink nodes available');

            player = new MusicPlayer(this, node, options);
            await player.connect();
            this.players.set(options.guildId, player);
        }
        
        // Clear timeout if they add something
        if (player.connectionTimeout) {
            clearTimeout(player.connectionTimeout);
            player.connectionTimeout = null;
        }

        return player;
    }

    getPlayer(guildId) {
        return this.players.get(guildId);
    }

    async resolve(query, requester) {
        const node = this.shoukaku.options.nodeResolver(this.shoukaku.nodes);
        if (!node) throw new Error('No Lavalink nodes available');

        const result = await node.rest.resolve(query);
        if (!result) return null;

        if (result.loadType === 'track' || result.loadType === 'search') {
            const tracks = result.loadType === 'search' ? [result.data[0]] : [result.data];
            tracks.forEach(t => t.requester = requester);
            return { type: result.loadType, tracks, playlistName: null };
        } else if (result.loadType === 'playlist') {
            result.data.tracks.forEach(t => t.requester = requester);
            return { type: 'playlist', tracks: result.data.tracks, playlistName: result.data.info.name };
        }

        return null;
    }
}

module.exports = MusicManager;
