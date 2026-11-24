const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Play the previous track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        await interaction.deferReply();
        const success = await player.playPrevious();
        if (!success) {
            return interaction.editReply({ embeds: [errorEmbed('There is no previous track in history.')] });
        }

        return interaction.editReply({ embeds: [successEmbed('⏮️ Playing the previous track.')] });
    }
};
