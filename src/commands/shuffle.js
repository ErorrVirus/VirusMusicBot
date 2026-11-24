const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the current queue.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        if (player.queue.length < 2) {
            return interaction.reply({ embeds: [errorEmbed('Need at least 2 songs in the queue to shuffle.')], flags: MessageFlags.Ephemeral });
        }

        const count = await player.shuffleQueue();
        client.manager.scheduleNowPlayingRefresh(player);
        return interaction.reply({ embeds: [successEmbed(`🔀 Shuffled **${count}** tracks in the queue.`)] });
    }
};
