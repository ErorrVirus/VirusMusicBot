const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { getTrackTitle } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track in the queue.')
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('The current position of the track')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('The new position for the track')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        const result = await player.moveTrack(from, to);
        if (!result.ok) {
            return interaction.reply({ embeds: [errorEmbed(result.reason)], flags: 64 });
        }

        const trackName = getTrackTitle(result.track);
        return interaction.reply({ embeds: [successEmbed(`Moved **${trackName}** from position **${from}** to **${to}**.`)] });
    }
};
