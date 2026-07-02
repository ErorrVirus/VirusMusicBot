const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');
const { formatTime, validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireVoice: false });
        if (error) return interaction.reply(error);

        let queueStr = 'The queue is currently empty.';
        if (player.queue.length > 0) {
            const tracks = player.queue.slice(0, 10).map((track, i) => {
                const title = track.info?.title ?? track.title ?? 'Unknown Track';
                const uri = track.info?.uri ?? '';
                const lengthStr = track.info?.length ? ` \`[${formatTime(track.info.length)}]\`` : '';
                const link = uri ? `[${title}](${uri})` : title;
                return `**${i + 1}.** ${link}${lengthStr}`;
            }).join('\n');

            queueStr = tracks;
            if (player.queue.length > 10) {
                queueStr += `\n*... and ${player.queue.length - 10} more track(s)*`;
            }
        }

        const embed = buildEmbed({
            title: `Queue for ${interaction.guild.name}`,
            description: `**Now Playing:**\n[${player.current.info.title}](${player.current.info.uri}) \`[${formatTime(player.current.info.length)}]\`\n\n**Up Next:**\n${queueStr}`,
            footer: { text: `Total tracks: ${player.queue.length} | Loop: ${player.loop}` }
        });

        interaction.reply({ embeds: [embed] });
    }
};
