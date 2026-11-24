const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');
const { checkBotVoicePermissions } = require('../utils/permissions');
const { getTrackTitle, formatTrackLink, formatTrackDuration } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Manage saved queues, personal favorites, custom playlists, and history.')
        .addSubcommand(sub => sub.setName('favorite-add').setDescription('Save the currently playing track to your favorites.'))
        .addSubcommand(sub => sub.setName('favorites').setDescription('View or play your favorite tracks.')
            .addBooleanOption(opt => opt.setName('play').setDescription('Queue all your favorites now')))
        .addSubcommand(sub => sub.setName('history').setDescription('View recent tracks played in this server.'))
        .addSubcommand(sub => sub.setName('recover').setDescription('Recover the last saved queue for this server into your voice channel.'))
        .addSubcommand(sub => sub.setName('create').setDescription('Create a new custom playlist.')
            .addStringOption(opt => opt.setName('name').setDescription('Playlist name').setRequired(true)))
        .addSubcommand(sub => sub.setName('save-queue').setDescription('Save the current song and queue into a custom playlist.')
            .addStringOption(opt => opt.setName('name').setDescription('Playlist name').setRequired(true)))
        .addSubcommand(sub => sub.setName('load').setDescription('Load one of your custom playlists into the queue.')
            .addStringOption(opt => opt.setName('name').setDescription('Playlist name').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List all of your custom playlists.'))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete one of your custom playlists.')
            .addStringOption(opt => opt.setName('name').setDescription('Playlist name').setRequired(true))),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();
        const db = client.manager.db;

        const ensureVoicePlayer = async () => {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) return { error: 'You must be in a voice channel first.' };
            const permErr = checkBotVoicePermissions(interaction.guild, voiceChannel);
            if (permErr) return { error: permErr };
            const player = await client.manager.createPlayer({
                guildId: interaction.guild.id,
                textId: interaction.channel.id,
                voiceId: voiceChannel.id
            });
            return { player };
        };

        switch (sub) {
            case 'favorite-add': {
                const player = client.manager.getPlayer(interaction.guild.id);
                if (!player || !player.current) {
                    return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: MessageFlags.Ephemeral });
                }
                db.addFavorite(interaction.user.id, player.current);
                return interaction.reply({ embeds: [successEmbed(`⭐ Saved **${getTrackTitle(player.current)}** to your favorites.`)] });
            }

            case 'favorites': {
                const favs = db.getFavorites(interaction.user.id);
                if (!favs.length) {
                    return interaction.reply({ embeds: [errorEmbed('You have no saved favorites yet.')], flags: MessageFlags.Ephemeral });
                }
                if (interaction.options.getBoolean('play')) {
                    const { player, error } = await ensureVoicePlayer();
                    if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });
                    favs.forEach(t => { t.requester = interaction.user; });
                    const { added } = await player.enqueueTracks(favs, { playIfIdle: true });
                    return interaction.reply({ embeds: [successEmbed(`⭐ Queued **${added}** favorite track(s).`)] });
                }
                const list = favs.slice(0, 15).map((t, i) => `**${i + 1}.** ${formatTrackLink(t)} \`[${formatTrackDuration(t)}]\``).join('\n');
                return interaction.reply({
                    embeds: [buildEmbed({ title: `⭐ ${interaction.user.username}'s Favorites (${favs.length})`, description: list })]
                });
            }

            case 'history': {
                const entries = db.getHistory(interaction.guild.id, 15);
                if (!entries.length) {
                    return interaction.reply({ embeds: [errorEmbed('No listening history recorded yet for this server.')], flags: MessageFlags.Ephemeral });
                }
                const list = entries.map((e, i) => `**${i + 1}.** ${formatTrackLink(e.track)} \`[${formatTrackDuration(e.track)}]\``).join('\n');
                return interaction.reply({
                    embeds: [buildEmbed({ title: `🕘 Recent History — ${interaction.guild.name}`, description: list })]
                });
            }

            case 'recover': {
                const saved = db.getSavedQueue(interaction.guild.id);
                if (!saved || (!saved.current && !saved.queue.length)) {
                    return interaction.reply({ embeds: [errorEmbed('No saved queue snapshot found for this server.')], flags: MessageFlags.Ephemeral });
                }
                const { player, error } = await ensureVoicePlayer();
                if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });
                const tracks = [saved.current, ...saved.queue].filter(Boolean);
                tracks.forEach(t => { t.requester = interaction.user; });
                await player.setVolume(saved.volume ?? 100);
                await player.setEqualizerPreset(saved.preset || 'flat');
                await player.setLoop(saved.loop || 'none');
                const { added } = await player.enqueueTracks(tracks, { playIfIdle: true });
                return interaction.reply({ embeds: [successEmbed(`♻️ Recovered **${added}** track(s) from the previous session.`)] });
            }

            case 'create': {
                const name = interaction.options.getString('name');
                const res = db.createCustomPlaylist(interaction.user.id, name);
                if (!res.ok) return interaction.reply({ embeds: [errorEmbed(res.reason)], flags: MessageFlags.Ephemeral });
                return interaction.reply({ embeds: [successEmbed(`📁 Created custom playlist **${res.name}**.`)] });
            }

            case 'save-queue': {
                const name = interaction.options.getString('name');
                const player = client.manager.getPlayer(interaction.guild.id);
                if (!player || (!player.current && !player.queue.length)) {
                    return interaction.reply({ embeds: [errorEmbed('No active tracks to save.')], flags: MessageFlags.Ephemeral });
                }
                db.createCustomPlaylist(interaction.user.id, name);
                const tracks = [player.current, ...player.queue].filter(Boolean);
                const res = db.addTracksToCustomPlaylist(interaction.user.id, name, tracks);
                if (!res.ok) return interaction.reply({ embeds: [errorEmbed(res.reason)], flags: MessageFlags.Ephemeral });
                return interaction.reply({ embeds: [successEmbed(`💾 Saved **${res.added}** track(s) to playlist **${name}**.`)] });
            }

            case 'load': {
                const name = interaction.options.getString('name');
                const pl = db.getCustomPlaylist(interaction.user.id, name);
                if (!pl || !pl.tracks.length) {
                    return interaction.reply({ embeds: [errorEmbed(`Playlist **${name}** was not found or is empty.`)], flags: MessageFlags.Ephemeral });
                }
                const { player, error } = await ensureVoicePlayer();
                if (error) return interaction.reply({ embeds: [errorEmbed(error)], flags: MessageFlags.Ephemeral });
                pl.tracks.forEach(t => { t.requester = interaction.user; });
                const { added } = await player.enqueueTracks(pl.tracks, { playIfIdle: true });
                return interaction.reply({ embeds: [successEmbed(`📂 Loaded **${added}** track(s) from **${pl.name}**.`)] });
            }

            case 'list': {
                const list = db.listCustomPlaylists(interaction.user.id);
                if (!list.length) {
                    return interaction.reply({ embeds: [errorEmbed('You have no custom playlists yet.')], flags: MessageFlags.Ephemeral });
                }
                const text = list.map((p, i) => `**${i + 1}.** **${p.name}** — ${p.track_count} track(s)`).join('\n');
                return interaction.reply({ embeds: [buildEmbed({ title: '📁 Your Custom Playlists', description: text })] });
            }

            case 'delete': {
                const name = interaction.options.getString('name');
                const ok = db.deleteCustomPlaylist(interaction.user.id, name);
                if (!ok) return interaction.reply({ embeds: [errorEmbed(`Playlist **${name}** not found.`)], flags: MessageFlags.Ephemeral });
                return interaction.reply({ embeds: [successEmbed(`🗑️ Deleted playlist **${name}**.`)] });
            }
        }
    }
};
