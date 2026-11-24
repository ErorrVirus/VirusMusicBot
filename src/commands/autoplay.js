const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle automatic related track playback when the queue ends.')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable autoplay (toggles if omitted)')
        ),
    async execute(interaction, client) {
        const requested = interaction.options.getBoolean('enabled');
        const player = client.manager.getPlayer(interaction.guild.id);

        if (player && !player.isDestroyed()) {
            const { error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
            if (error) return interaction.reply(error);
            const next = requested !== null ? requested : !player.autoplay;
            await player.setAutoplay(next);
            client.manager.scheduleNowPlayingRefresh(player);
            return interaction.reply({ embeds: [successEmbed(`♾️ Autoplay is now **${next ? 'enabled' : 'disabled'}**.`)] });
        }

        const current = client.manager.db.getGuildSettings(interaction.guild.id).autoplay;
        const next = requested !== null ? requested : !current;
        client.manager.db.updateGuildSettings(interaction.guild.id, { autoplay: next });
        return interaction.reply({ embeds: [successEmbed(`♾️ Server default Autoplay set to **${next ? 'enabled' : 'disabled'}**.`)] });
    }
};
