const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'I am not playing anything!', ephemeral: true });
        }

        const queue = player.queue;
        const embed = new EmbedBuilder()
            .setTitle(`Queue for ${interaction.guild.name}`)
            .setColor(0x5865F2)
            .setDescription(`**Now Playing:**\n[${player.queue.current.title}](${player.queue.current.uri}) - ${player.queue.current.author}`);

        if (queue.length > 0) {
            const tracks = queue.slice(0, 10).map((track, i) => `**${i + 1}.** [${track.title}](${track.uri})`);
            embed.addFields({ name: `Up Next (${queue.length} tracks)`, value: tracks.join('\n') });
        }

        return interaction.reply({ embeds: [embed] });
    }
};
