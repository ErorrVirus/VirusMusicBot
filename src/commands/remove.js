const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { getTrackTitle } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue.')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('The queue position of the track to remove')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const position = interaction.options.getInteger('position');
        const result = await player.removeTrack(position);
        if (!result.ok) {
            return interaction.reply({ embeds: [errorEmbed(result.reason)], flags: 64 });
        }

        const trackName = getTrackTitle(result.track);
        return interaction.reply({ embeds: [successEmbed(`Removed **${trackName}** from the queue.`)] });
    }
};
