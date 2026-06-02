const { Connectors } = require("shoukaku");
const { Kazagumo, Plugins, KazagumoTrack } = require("kazagumo");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

class LavalinkManager {
    constructor(client) {
        this.client = client;

        // Helper to strip circular references for JSON DB storage
        this.sanitizeTrack = (t) => {
            if (!t) return null;
            return {
                encoded: t.track || t.encoded,
                info: {
                    title: t.title,
                    identifier: t.identifier,
                    author: t.author,
                    length: t.length,
                    isSeekable: t.isSeekable,
                    isStream: t.isStream,
                    uri: t.uri,
                    sourceName: t.sourceName
                }
            };
        };

        const Nodes = [{
            name: "LocalNode",
            url: `${process.env.LAVALINK_HOST || "127.0.0.1"}:${process.env.LAVALINK_PORT || "2333"}`,
            auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
            secure: false
        }];

        const plugins = [new Plugins.PlayerMoved(client)];

        const shoukakuOptions = {
            moveOnDisconnect: false,
            resumable: true,
            resumableTimeout: 60,
            reconnectTries: 100, // 100 tries * 15 seconds = 25 minutes of patience
            reconnectInterval: 15, // Time in seconds, NOT ms
            restTimeout: 60 // Time in seconds, NOT ms
        };

        this.manager = new Kazagumo({
            defaultSearchEngine: "youtube",
            plugins: plugins,
            send: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild) guild.shard.send(payload);
            }
        }, new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

        this.manager.shoukaku.on("ready", async (name) => {
            console.log(`Lavalink Node: ${name} is now connected`);
            // Attempt to auto-resume queues from DB
            try {
                const res = await client.db.query('SELECT * FROM music_queue_state');
                for (const row of res.rows) {
                    const guild = client.guilds.cache.get(row.guild_id);
                    if (guild && row.voice_channel_id) {
                        try {
                            const player = await this.manager.createPlayer({
                                guildId: row.guild_id,
                                textId: row.text_channel_id,
                                voiceId: row.voice_channel_id,
                                volume: 100,
                                deaf: true,
                                mute: false
                            });
                            // Re-add tracks
                            if (row.current_track) {
                                const raw = typeof row.current_track === 'string' ? JSON.parse(row.current_track) : row.current_track;
                                player.queue.add(new KazagumoTrack(raw, null));
                            }
                            if (row.queue) {
                                const queueArray = typeof row.queue === 'string' ? JSON.parse(row.queue) : row.queue;
                                for(const track of queueArray) {
                                    player.queue.add(new KazagumoTrack(track, null));
                                }
                            }
                            if(!player.playing && player.queue.current) player.play();
                            console.log(`[Auto-Resume] Resumed player for guild ${row.guild_id}`);
                        } catch(e) {
                            console.log(`[Auto-Resume] Failed for ${row.guild_id}`, e.message);
                        }
                    }
                }
            } catch(e) {
                console.error('[Auto-Resume] Error fetching DB state:', e);
            }
        });

        this.manager.shoukaku.on("error", (name, error) => console.error(`Lavalink Node: ${name} threw an error:`, error));
        this.manager.shoukaku.on("close", (name, code, reason) => console.log(`Lavalink Node: ${name} closed with code ${code}. Reason: ${reason || "No reason"}`));

        this.manager.on("playerStart", async (player, track) => {
            const channel = client.channels.cache.get(player.textId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🎶 Now Playing')
                    .setDescription(`**[${track.title}](${track.uri})**`)
                    .addFields({ name: 'Author', value: track.author || 'Unknown', inline: true })
                    .setColor('#FF0000');

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
                    );

                const msg = await channel.send({ embeds: [embed], components: [row] });
                player.data.set('nowPlayingMessage', msg);
            }

            // Save state to DB safely
            const safeTrack = this.sanitizeTrack(track);
            const safeQueue = player.queue.map(t => this.sanitizeTrack(t));
            await client.db.saveQueueState(player.guildId, player.voiceId, player.textId, safeTrack, safeQueue);
            
            // Log history
            await client.db.query(
                'INSERT INTO play_history (guild_id, user_id, track_title, track_uri) VALUES ($1, $2, $3, $4)',
                [player.guildId, track.requester?.id || 'unknown', track.title, track.uri]
            );
        });

        this.manager.on("playerEnd", async (player) => {
            // Remove previous NowPlaying message if possible
            const msg = player.data.get('nowPlayingMessage');
            if (msg) {
                msg.delete().catch(() => {});
            }
        });

        this.manager.on("playerEmpty", async player => {
            const channel = client.channels.cache.get(player.textId);
            if (channel) {
                channel.send(`Queue ended. Disconnecting...`);
            }
            await client.db.clearQueueState(player.guildId);
            player.destroy();
        });

        this.manager.on("playerUpdate", async player => {
             // Occasionally save state changes like queue shuffle or skips
             if (player.queue.current) {
                 const safeTrack = this.sanitizeTrack(player.queue.current);
                 const safeQueue = player.queue.map(t => this.sanitizeTrack(t));
                 await client.db.saveQueueState(player.guildId, player.voiceId, player.textId, safeTrack, safeQueue);
             }
        });
    }
}

module.exports = LavalinkManager;
