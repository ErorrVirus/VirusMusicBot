const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused track.'),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        if (!player.isPaused) return interaction.reply({ embeds: [errorEmbed('The track is not paused.')], ephemeral: true });

        player.player.setPaused(false);
        player.isPaused = false;
        interaction.reply({ embeds: [successEmbed('Track resumed.')] });
    }
};
