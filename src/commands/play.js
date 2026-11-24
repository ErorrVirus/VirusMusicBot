const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { checkBotVoicePermissions } = require('../utils/permissions');
const { formatTrackLink, formatTrackDuration } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song, artist, album, playlist, or stream URL.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, artist, YouTube, Spotify, SoundCloud, Apple Music, Deezer, Tidal, or stream URL')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        await interaction.deferReply();

        const query = interaction.options.getString('query').trim();
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.editReply({ embeds: [errorEmbed('You must be in a voice channel to use this command.')] });
        }

        const botVoiceChannelId = interaction.guild.members.me?.voice?.channelId;
        if (botVoiceChannelId && botVoiceChannelId !== voiceChannel.id) {
            return interaction.editReply({ embeds: [errorEmbed('I am already playing in another voice channel.')] });
        }

        const permError = checkBotVoicePermissions(interaction.guild, voiceChannel);
        if (permError) {
            return interaction.editReply({ embeds: [errorEmbed(permError)] });
        }

        if (!client.manager) {
            return interaction.editReply({ embeds: [errorEmbed('The music system is starting up. Please wait a few seconds.')] });
        }

        try {
            const result = await client.manager.resolve(query, interaction.user);
            if (!result || !result.tracks || !result.tracks.length) {
                return interaction.editReply({
                    embeds: [errorEmbed('No matching playable tracks were found for that query.')]
                });
            }

            let player = client.manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = await client.manager.createPlayer({
                    guildId: interaction.guild.id,
                    textId: interaction.channel.id,
                    voiceId: voiceChannel.id
                });
            } else {
                player.textId = interaction.channel.id;
            }

            const { added, truncated } = await player.enqueueTracks(result.tracks, { playIfIdle: true });
            if (added === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed(`Queue limit reached (**${player.maxQueueSize}** tracks). Remove tracks or use \`/clear\`.`)]
                });
            }

            if (result.type === 'playlist') {
                const truncNote = (result.truncated || truncated) ? ` *(capped to ${added})*` : '';
                return interaction.editReply({
                    embeds: [successEmbed(`📋 Added **${added}** tracks from **${result.playlistName}**${truncNote} to the queue.`)]
                });
            }

            const track = result.tracks[0];
            return interaction.editReply({
                embeds: [successEmbed(`Added ${formatTrackLink(track, true)} \`[${formatTrackDuration(track)}]\` to the queue.`)]
            });
        } catch (err) {
            const safeMsg = err?.message || 'Unknown playback error';
            return interaction.editReply({
                embeds: [errorEmbed(`Could not play that track:\n\`${safeMsg.slice(0, 400)}\``)]
            });
        }
    }
};
