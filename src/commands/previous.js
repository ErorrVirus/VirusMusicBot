const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Play the previous track.'),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const success = player.playPrevious();
        if (!success) return interaction.reply({ embeds: [errorEmbed('There is no previous track in history.')], ephemeral: true });

        interaction.reply({ embeds: [successEmbed('Playing the previous track.')] });
    }
};
