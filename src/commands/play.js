const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a track or playlist from YouTube, Spotify, etc.')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The song name or URL to play')
                .setRequired(true)
        ),
    async execute(interaction, client) {
        await interaction.deferReply();

        const query = interaction.options.getString('query');
        const member = interaction.member;

        if (!member.voice.channelId) {
            return interaction.editReply({ embeds: [errorEmbed('You must be in a voice channel to use this command.')] });
        }

        const botVoiceChannel = interaction.guild.members.me.voice.channelId;
        if (botVoiceChannel && botVoiceChannel !== member.voice.channelId) {
            return interaction.editReply({ embeds: [errorEmbed('I am already playing in another voice channel.')] });
        }

        try {
            let player = client.manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = await client.manager.createPlayer({
                    guildId: interaction.guild.id,
                    textId: interaction.channel.id,
                    voiceId: member.voice.channelId
                });
            }

            // Always prioritize ytsearch if it's not a URL
            const isUrl = /^https?:\/\//.test(query);
            const resolveQuery = isUrl ? query : `ytsearch:${query}`;

            const result = await client.manager.resolve(resolveQuery, interaction.user);
            
            if (!result || !result.tracks.length) {
                return interaction.editReply({ embeds: [errorEmbed('No results found for your query.')] });
            }

            if (result.type === 'playlist') {
                for (const track of result.tracks) {
                    player.queue.push(track);
                }
                interaction.editReply({ embeds: [successEmbed(`Added ${result.tracks.length} tracks from **${result.playlistName}** to the queue.`)] });
            } else {
                const track = result.tracks[0];
                player.queue.push(track);
                interaction.editReply({ embeds: [successEmbed(`Added [**${track.info.title}**](${track.info.uri}) to the queue.`)] });
            }

            if (!player.current) {
                player.playNext();
            }

        } catch (error) {
            console.error(error);
            interaction.editReply({ embeds: [errorEmbed('An error occurred while trying to play the track.')] });
        }
    }
};
