const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the currently playing track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        if (player.isPaused) return interaction.reply({ embeds: [errorEmbed('The track is already paused.')], ephemeral: true });

        player.player.setPaused(true);
        player.isPaused = true;
        interaction.reply({ embeds: [successEmbed('Track paused.')] });
    }
};
