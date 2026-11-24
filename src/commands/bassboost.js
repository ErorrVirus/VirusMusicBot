const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { getPresetConfig } = require('../services/EqualizerService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bassboost')
        .setDescription('Adjust bass boost intensity with automatic headroom protection.')
        .addStringOption(option =>
            option.setName('level')
                .setDescription('Bass boost intensity level')
                .setRequired(true)
                .addChoices(
                    { name: 'Off (Flat)', value: 'off' },
                    { name: 'Low (Subtle Warmth)', value: 'low' },
                    { name: 'Medium (Punchy)', value: 'medium' },
                    { name: 'High (Heavy)', value: 'high' },
                    { name: 'Extreme (Optional Maximum)', value: 'extreme' }
                )
        ),

    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const level = interaction.options.getString('level');
        const presetKey = await player.setBassBoost(level);
        const cfg = getPresetConfig(presetKey);
        client.manager.scheduleNowPlayingRefresh(player);

        return interaction.reply({
            embeds: [successEmbed(`🔊 Bass Boost set to **${cfg.label}** (headroom gain: \`${cfg.filterVolume}x\`).`)]
        });
    }
};
