const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check Discord gateway, API, and Lavalink voice latency.'),
    async execute(interaction, client) {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
        const wsPing = Math.round(client.ws.ping);
        const player = client.manager?.getPlayer(interaction.guildId);
        const voicePing = player && player.voicePing >= 0 ? `${player.voicePing}ms` : 'N/A';

        const embed = buildEmbed({
            color: '#10b981',
            title: '🏓 Pong!',
            fields: [
                { name: 'Discord WS', value: `\`${wsPing}ms\``, inline: true },
                { name: 'REST Roundtrip', value: `\`${roundTrip}ms\``, inline: true },
                { name: 'Voice Latency', value: `\`${voicePing}\``, inline: true }
            ]
        });

        return interaction.editReply({ content: null, embeds: [embed] });
    }
};
