const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { getPresetConfig } = require('../services/EqualizerService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equalizer')
        .setDescription('Apply a studio equalizer preset (resets all 15 frequency bands cleanly).')
        .addStringOption(option =>
            option.setName('preset')
                .setDescription('Equalizer sound profile')
                .setRequired(true)
                .addChoices(
                    { name: 'Flat (Neutral Default)', value: 'flat' },
                    { name: 'Rich (Balanced Warmth & Clarity)', value: 'rich' },
                    { name: 'Bass Boost', value: 'bass_boost' },
                    { name: 'Deep Bass', value: 'deep_bass' },
                    { name: 'Vocal', value: 'vocal' },
                    { name: 'Treble', value: 'treble' },
                    { name: 'Rock', value: 'rock' },
                    { name: 'Pop', value: 'pop' },
                    { name: 'Electronic', value: 'electronic' },
                    { name: 'Night Mode', value: 'night_mode' }
                )
        ),

    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false });
        if (error) return interaction.reply(error);

        const preset = interaction.options.getString('preset');
        const applied = await player.setEqualizerPreset(preset);
        const cfg = getPresetConfig(applied);
        client.manager.scheduleNowPlayingRefresh(player);

        return interaction.reply({
            embeds: [successEmbed(`🎚️ Equalizer set to **${cfg.label}** (headroom gain: \`${cfg.filterVolume}x\`).`)]
        });
    }
};
