const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, buildEmbed } = require('../utils/embedBuilder');
const { formatTime, createProgressBar } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('View the currently playing track and its progress.'),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        const track = player.current;
        const position = player.player.position || 0;
        const duration = track.info.length || 1; // Prevent division by zero

        const embed = buildEmbed({
            title: '🎶 Now Playing',
            description: `[**${track.info.title}**](${track.info.uri})\n\n` + 
                         `${createProgressBar(position, duration, 20)}\n\n` +
                         `\`${formatTime(position)} / ${track.info.isStream ? 'LIVE' : formatTime(duration)}\``,
            thumbnail: track.info.artworkUrl,
            fields: [
                { name: 'Author', value: track.info.author, inline: true },
                { name: 'Requested By', value: `<@${track.requester.id}>`, inline: true },
                { name: 'Volume', value: `${player.volume}%`, inline: true }
            ]
        });

        interaction.reply({ embeds: [embed] });
    }
};
