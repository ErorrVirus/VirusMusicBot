const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Play the previous track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const success = player.playPrevious();
        if (!success) return interaction.reply({ embeds: [errorEmbed('There is no previous track in history.')], ephemeral: true });

        interaction.reply({ embeds: [successEmbed('Playing the previous track.')] });
    }
};
