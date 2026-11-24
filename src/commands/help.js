const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display all VirusMusicPro V3 commands and features.'),
    async execute(interaction) {
        const embed = buildEmbed({
            color: '#10b981',
            title: '🎶 VirusMusicPro V3 — Command Guide',
            description: 'High-fidelity Discord music bot powered by Lavalink v4 & Shoukaku.',
            fields: [
                {
                    name: '▶️ Playback',
                    value: '`/play`, `/search`, `/artist`, `/pause`, `/resume`, `/skip`, `/previous`, `/stop`, `/disconnect`, `/seek`',
                    inline: false
                },
                {
                    name: '📋 Queue & Modes',
                    value: '`/queue`, `/nowplaying`, `/loop`, `/shuffle`, `/move`, `/remove`, `/clear`, `/autoplay`, `/247`',
                    inline: false
                },
                {
                    name: '🎚️ Audio Tuning',
                    value: '`/volume`, `/equalizer`, `/bassboost`',
                    inline: false
                },
                {
                    name: '💾 Library & Info',
                    value: '`/playlist`, `/lyrics`, `/settings`, `/ping`, `/stats`, `/help`',
                    inline: false
                }
            ],
            footer: { text: 'VirusMusicPro V3' }
        });
        return interaction.reply({ embeds: [embed] });
    }
};
