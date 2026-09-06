const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equalizer')
        .setDescription('Apply an audio equalizer preset for studio-quality music.')
        .addStringOption(option =>
            option.setName('preset')
                .setDescription('The equalizer sound profile')
                .setRequired(true)
                .addChoices(
                    { name: 'Studio Rich (Enhanced Bass & Clarity) [Default]', value: 'rich' },
                    { name: 'Flat (Unprocessed Default)', value: 'off' },
                    { name: 'Pop', value: 'pop' },
                    { name: 'Rock', value: 'rock' },
                    { name: 'Electronic / EDM', value: 'electronic' },
                    { name: 'Vocal Focus', value: 'vocal' }
                )
        ),

    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        const preset = interaction.options.getString('preset');
        await player.setEqualizerPreset(preset);

        const presetLabels = {
            rich: 'Studio Rich (Enhanced Bass & Clarity)',
            off: 'Flat (Unprocessed)',
            pop: 'Pop',
            rock: 'Rock',
            electronic: 'Electronic / EDM',
            vocal: 'Vocal Focus'
        };

        return interaction.reply({
            embeds: [successEmbed(`🎚️ Equalizer sound profile set to **${presetLabels[preset] || preset}**!`)]
        });
    }
};
