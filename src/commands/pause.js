const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the currently playing track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        if (player.isPaused) {
            return interaction.reply({ embeds: [errorEmbed('The track is already paused.')], flags: MessageFlags.Ephemeral });
        }

        await player.setPaused(true);
        client.manager.scheduleNowPlayingRefresh(player);
        return interaction.reply({ embeds: [successEmbed('⏸️ Track paused.')] });
    }
};
