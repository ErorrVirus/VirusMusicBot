const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { getTrackTitle } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        await interaction.deferReply();
        const res = await player.skip();
        if (!res.ok) {
            return interaction.editReply({ embeds: [errorEmbed(res.reason)] });
        }
        return interaction.editReply({ embeds: [successEmbed(`⏭️ Skipped **${getTrackTitle(res.skipped)}**.`)] });
    }
};
