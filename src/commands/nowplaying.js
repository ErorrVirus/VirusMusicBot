const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');
const { formatTime, createProgressBar, validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('View the currently playing track and its progress.'),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client, { requireVoice: false });
        if (error) return interaction.reply(error);

        const track = player.current;
        const position = player.player?.position || 0;
        const duration = track?.info?.length || 1;
        const title = track?.info?.title ?? track?.title ?? 'Unknown Track';
        const uri = track?.info?.uri ?? '';
        const author = track?.info?.author ?? track?.artist ?? 'Unknown Artist';
        const requesterTag = track?.requester?.id ? `<@${track.requester.id}>` : (track?.requester?.username || 'Unknown');
        const artworkUrl = track?.info?.artworkUrl || null;
        const titleLink = uri ? `[**${title}**](${uri})` : `**${title}**`;

        const embed = buildEmbed({
            title: '🎶 Now Playing',
            description: `${titleLink}\n\n` + 
                         `${createProgressBar(position, duration, 20)}\n\n` +
                         `\`${formatTime(position)} / ${track?.info?.isStream ? 'LIVE' : formatTime(duration)}\``,
            thumbnail: artworkUrl,
            fields: [
                { name: 'Author', value: author, inline: true },
                { name: 'Requested By', value: requesterTag, inline: true },
                { name: 'Volume', value: `${player.volume}%`, inline: true }
            ]
        });

        interaction.reply({ embeds: [embed] });
    }
};
