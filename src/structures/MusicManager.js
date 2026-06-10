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
            reconnectTries: 100,
            reconnectInterval: 5000,
            restTimeout: 10000
        };

        this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, ShoukakuOptions);

        this.shoukaku.on('ready', (name) => console.log(`[Lavalink] Node ${name} is ready!`));
        this.shoukaku.on('error', (name, error) => console.error(`[Lavalink] Node ${name} emitted error:`, error));
        this.shoukaku.on('close', (name, code, reason) => console.log(`[Lavalink] Node ${name} closed with code ${code}. Reason: ${reason || 'No reason'}`));
        this.shoukaku.on('disconnect', (name, count) => console.warn(`[Lavalink] Node ${name} disconnected. Reconnecting... (Attempt ${count})`));
        
        // Handle events emitted by MusicPlayer
        this.on('playerStart', async (player, track) => {
            // ── CRITICAL: cancel the idle-disconnect timer whenever a song starts ──
            if (player.connectionTimeout) {
                clearTimeout(player.connectionTimeout);
                player.connectionTimeout = null;
            }

            const channel = this.client.channels.cache.get(player.textId);
            if (!channel) return;
            const { buildEmbed } = require('../utils/embedBuilder');
            const { formatTime } = require('../utils/helpers');
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
            
            // Set Bot Activity — generic to protect server privacy
            this.client.user.setActivity('music 🎵', { type: ActivityType.Listening });
            
            const embed = buildEmbed({
                author: { 
                    name: 'Now Playing', 
                    iconURL: 'https://cdn.discordapp.com/emojis/1105021295240560700.gif' // Or whatever icon
                },
                title: track.info.title,
                url: track.info.uri,
                thumbnail: track.info.artworkUrl || 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?q=80&w=200&auto=format&fit=crop',
                fields: [
                    { name: '👤 Author', value: `\`${track.info.author}\``, inline: true },
                    { name: '⏱️ Duration', value: `\`${track.info.isStream ? 'LIVE' : formatTime(track.info.length)}\``, inline: true },
                    { name: '🎧 Requested By', value: `<@${track.requester.id}>`, inline: true }
                ],
                footer: {
                    text: 'Coded by ErorrVirus',
                    iconURL: this.client.user.displayAvatarURL()
                }
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('music_pause').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('music_voldown').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('music_volup').setEmoji('🔊').setStyle(ButtonStyle.Secondary)
            );

            // Store message so we can delete/edit it later if needed, but not strictly required
            channel.send({ embeds: [embed], components: [row] }).catch(() => {});
        });

        this.on('playerEmpty', (player) => {
            // Restore Bot Activity
            const { ActivityType } = require('discord.js');
            this.client.user.setActivity('ready to play any song', { type: ActivityType.Playing });
            
            const channel = this.client.channels.cache.get(player.textId);
            if (channel) {
                const { buildEmbed } = require('../utils/embedBuilder');
                channel.send({ embeds: [buildEmbed({ description: 'Queue concluded. Disconnecting in 1 minute if no tracks are added.' })] }).catch(() => {});
            }

            if (player.connectionTimeout) clearTimeout(player.connectionTimeout);
            player.connectionTimeout = setTimeout(() => {
                if (player && !player.current) {
                    player.destroy('Idle timeout');
                }
            }, 60000);
        });

        this.on('playerClosed', (player, data) => {
            console.log(`Player closed in guild ${player.guildId}`, data);
            // Ignore normal disconnects
            if (data.code === 4014) return;
        });

        this.on('playerException', (player, data) => {
            console.error(`Track exception in guild ${player.guildId}:`, data);
        });

        this.on('playerStuck', (player, data) => {
            console.warn(`Track stuck in guild ${player.guildId}:`, data);
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

        let result;
        try {
            result = await node.rest.resolve(query);
        } catch (err) {
            console.error('[Resolve] REST error:', err);
            throw new Error('Failed to contact Lavalink. Is the node online?');
        }

        if (!result) return null;

        console.log(`[Resolve] loadType=${result.loadType} query="${query}"`);

        switch (result.loadType) {
            case 'track': {
                const track = result.data;
                track.requester = requester;
                return { type: 'track', tracks: [track], playlistName: null };
            }
            case 'search': {
                if (!result.data || !result.data.length) return null;
                const track = result.data[0];
                track.requester = requester;
                return { type: 'search', tracks: [track], playlistName: null };
            }
            case 'playlist': {
                const tracks = result.data.tracks || [];
                tracks.forEach(t => t.requester = requester);
                const name = result.data.info?.name || result.data.pluginInfo?.name || 'Unknown Playlist';
                return { type: 'playlist', tracks, playlistName: name };
            }
            case 'empty': {
                console.warn('[Resolve] Lavalink returned empty result for:', query);
                return null;
            }
            case 'error': {
                console.error('[Resolve] Lavalink error payload:', JSON.stringify(result, null, 2));
                throw new Error(result.data?.message || 'Lavalink encountered an error resolving the track.');
            }
            default: {
                console.warn('[Resolve] Unknown loadType:', result.loadType, JSON.stringify(result, null, 2));
                return null;
            }
        }
    }
}

module.exports = MusicManager;
