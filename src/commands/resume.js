const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        if (!player.isPaused) return interaction.reply({ embeds: [errorEmbed('The track is not paused.')], ephemeral: true });

        player.player.setPaused(false);
        player.isPaused = false;
        interaction.reply({ embeds: [successEmbed('Track resumed.')] });
    }
};
