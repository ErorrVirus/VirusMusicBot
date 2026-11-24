const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear all upcoming tracks in the queue without stopping the current song.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        if (player.queue.length === 0) {
            return interaction.reply({ embeds: [errorEmbed('The queue is already empty.')], flags: MessageFlags.Ephemeral });
        }

        const cleared = await player.clearQueue();
        client.manager.scheduleNowPlayingRefresh(player);
        return interaction.reply({ embeds: [successEmbed(`🧹 Cleared **${cleared}** upcoming track(s) from the queue.`)] });
    }
};
