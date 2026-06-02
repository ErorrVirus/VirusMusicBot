const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Shows the currently playing song with a progress bar'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        const track = player.queue.current;
        const position = player.position || 0;
        const duration = track.length || 0;

        // Create Progress Bar
        const size = 20;
        const currentProgress = Math.round((position / duration) * size) || 0;
        const emptyProgress = size - currentProgress;
        const progressString = '▬'.repeat(Math.max(0, currentProgress - 1)) + '🔘' + '▬'.repeat(Math.max(0, emptyProgress));

        const formatTime = (ms) => {
            if (!ms) return '00:00';
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        const embed = new EmbedBuilder()
            .setTitle('🎶 Now Playing')
            .setDescription(`**[${track.title}](${track.uri})**`)
            .addFields(
                { name: 'Author', value: track.author || 'Unknown', inline: true },
                { name: 'Requester', value: `<@${track.requester?.id || interaction.user.id}>`, inline: true },
                { name: 'Progress', value: `${formatTime(position)} ${progressString} ${formatTime(duration)}`, inline: false }
            )
            .setColor('#1DB954');

        if (track.thumbnail) {
            embed.setThumbnail(track.thumbnail);
        }

        await interaction.reply({ embeds: [embed] });
    }
};
