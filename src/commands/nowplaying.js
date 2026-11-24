const { SlashCommandBuilder } = require('discord.js');
const { buildNowPlayingEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('View the currently playing track and its progress.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireVoice: false });
        if (error) return interaction.reply(error);

        const embed = buildNowPlayingEmbed(player, player.current, client.user?.displayAvatarURL?.());
        return interaction.reply({ embeds: [embed] });
    }
};
