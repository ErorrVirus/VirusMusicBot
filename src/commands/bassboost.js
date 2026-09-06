const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bassboost')
        .setDescription('Set the bass boost level for punchy and deep sound.')
        .addStringOption(option =>
            option.setName('level')
                .setDescription('The bass boost intensity level')
                .setRequired(true)
                .addChoices(
                    { name: 'Off (Flat)', value: 'off' },
                    { name: 'Low (+4 dB)', value: 'low' },
                    { name: 'Medium (+8 dB)', value: 'medium' },
                    { name: 'High (+12 dB)', value: 'high' },
                    { name: 'Extreme (+18 dB)', value: 'extreme' }
                )
        ),

    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        const level = interaction.options.getString('level');
        await player.setBassBoost(level);

        const levelNames = {
            off: 'Off (Flat)',
            low: 'Low (+4 dB)',
            medium: 'Medium (+8 dB)',
            high: 'High (+12 dB)',
            extreme: 'Extreme (+18 dB)'
        };

        return interaction.reply({
            embeds: [successEmbed(`🔊 Bass Boost set to **${levelNames[level] || level}**!`)]
        });
    }
};
