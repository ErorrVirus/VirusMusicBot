const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Stop music and leave the voice channel.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        await player.destroy('Disconnect command');
        return interaction.reply({ embeds: [successEmbed('👋 Disconnected and cleared the queue.')] });
    }
};
