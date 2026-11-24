const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        if (!player.isPaused) {
            return interaction.reply({ embeds: [errorEmbed('The track is not paused.')], flags: MessageFlags.Ephemeral });
        }

        await player.setPaused(false);
        client.manager.scheduleNowPlayingRefresh(player);
        return interaction.reply({ embeds: [successEmbed('▶️ Track resumed.')] });
    }
};
