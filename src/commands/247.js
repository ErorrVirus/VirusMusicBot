const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode (keeps bot in the voice channel when idle).')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable 24/7 mode (toggles if omitted)')
        ),
    async execute(interaction, client) {
        const requested = interaction.options.getBoolean('enabled');
        const player = client.manager.getPlayer(interaction.guild.id);

        if (player && !player.isDestroyed()) {
            const { error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
            if (error) return interaction.reply(error);
            const next = requested !== null ? requested : !player.is247;
            await player.set247(next);
            return interaction.reply({ embeds: [successEmbed(`🕒 24/7 mode is now **${next ? 'enabled' : 'disabled'}**.`)] });
        }

        const current = client.manager.db.getGuildSettings(interaction.guild.id).mode_247;
        const next = requested !== null ? requested : !current;
        client.manager.db.updateGuildSettings(interaction.guild.id, { mode_247: next });
        return interaction.reply({ embeds: [successEmbed(`🕒 Server default 24/7 mode set to **${next ? 'enabled' : 'disabled'}**.`)] });
    }
};
