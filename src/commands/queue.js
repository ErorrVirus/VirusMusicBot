const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, buildEmbed } = require('../utils/embedBuilder');
const { formatTime } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue.'),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        const queueStr = player.queue.length > 0 
            ? player.queue.slice(0, 10).map((track, i) => `**${i + 1}.** [${track.info.title}](${track.info.uri}) \`[${formatTime(track.info.length)}]\``).join('\n')
            : 'The queue is currently empty.';

        const embed = buildEmbed({
            title: `Queue for ${interaction.guild.name}`,
            description: `**Now Playing:**\n[${player.current.info.title}](${player.current.info.uri}) \`[${formatTime(player.current.info.length)}]\`\n\n**Up Next:**\n${queueStr}`,
            footer: { text: `Total tracks: ${player.queue.length} | Loop: ${player.loop}` }
        });

        interaction.reply({ embeds: [embed] });
    }
};
