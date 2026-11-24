const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedBuilder');
const { formatTime } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View bot resource usage, Lavalink node health, and playback diagnostics.'),
    async execute(interaction, client) {
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const snap = client.manager?.getStatsSnapshot() || {};
        const jvmUsed = snap.jvmMemory ? `${Math.round(snap.jvmMemory.used / 1024 / 1024)} / ${Math.round(snap.jvmMemory.allocated / 1024 / 1024)} MiB` : 'N/A';
        const frameDeficit = snap.frameStats ? `${snap.frameStats.deficit} deficit / ${snap.frameStats.nulled} nulled` : 'N/A';

        const embed = buildEmbed({
            color: '#10b981',
            title: '📊 VirusMusicPro V3 — System & Audio Stats',
            fields: [
                { name: 'Servers', value: `\`${client.guilds.cache.size}\``, inline: true },
                { name: 'Active Players', value: `\`${snap.activeStreams ?? 0} / ${snap.playersCount ?? 0}\``, inline: true },
                { name: 'Uptime', value: `\`${formatTime(client.uptime || 0)}\``, inline: true },
                { name: 'Bot RSS RAM', value: `\`${memMB} MiB\``, inline: true },
                { name: 'Lavalink Status', value: `\`${snap.lavalinkConnected ? 'Connected' : 'Disconnected'}\``, inline: true },
                { name: 'Lavalink JVM', value: `\`${jvmUsed}\``, inline: true },
                { name: 'Frame Stats', value: `\`${frameDeficit}\``, inline: true },
                { name: 'Tracks Started', value: `\`${snap.tracksStarted ?? 0}\``, inline: true },
                { name: 'Playback Failures', value: `\`${snap.playbackFailures ?? 0}\``, inline: true }
            ]
        });

        return interaction.reply({ embeds: [embed] });
    }
};
