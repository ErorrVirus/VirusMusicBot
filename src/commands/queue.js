const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');
const { formatTrackLink, formatTrackDuration } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue.')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Queue page number')
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireCurrent: false, requireVoice: false });
        if (error) return interaction.reply(error);

        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(player.queue.length / pageSize));
        const page = Math.min(totalPages, interaction.options.getInteger('page') || 1);
        const start = (page - 1) * pageSize;

        let queueStr = 'The queue is currently empty.';
        if (player.queue.length > 0) {
            queueStr = player.queue.slice(start, start + pageSize).map((track, i) =>
                `**${start + i + 1}.** ${formatTrackLink(track)} \`[${formatTrackDuration(track)}]\``
            ).join('\n');
        }

        const currentStr = player.current
            ? `${formatTrackLink(player.current, true)} \`[${formatTrackDuration(player.current)}]\``
            : 'Nothing currently playing';

        const embed = buildEmbed({
            title: `Queue for ${interaction.guild.name}`,
            description: `**Now Playing:**\n${currentStr}\n\n**Up Next:**\n${queueStr}`,
            footer: { text: `Page ${page}/${totalPages} • ${player.queue.length} queued • Loop: ${player.loop} • Autoplay: ${player.autoplay ? 'On' : 'Off'}` }
        });

        return interaction.reply({ embeds: [embed] });
    }
};
