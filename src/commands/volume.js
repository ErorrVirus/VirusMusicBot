const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set playback volume (1-200%).')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume percentage (1 to 200)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(200)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const level = interaction.options.getInteger('level');
        const updated = await player.setVolume(level);
        client.manager.scheduleNowPlayingRefresh(player);

        return interaction.reply({ embeds: [successEmbed(`🔊 Volume set to **${updated}%**.`)] });
    }
};
