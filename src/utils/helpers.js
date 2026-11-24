const { MessageFlags } = require('discord.js');

module.exports = {
    formatTime: (ms) => {
        if (!ms || isNaN(ms)) return '00:00';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },

    parseDurationToMs: (input) => {
        if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.round(input * 1000));
        const str = String(input || '').trim();
        if (!str) return null;
        if (/^\d+$/.test(str)) return parseInt(str, 10) * 1000;
        const parts = str.split(':').map(p => Number(p));
        if (parts.some(n => !Number.isFinite(n) || n < 0)) return null;
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
        if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        return null;
    },

    createProgressBar: (current, total, size = 15) => {
        if (!total || total <= 0) return '▬'.repeat(size);
        const clamped = Math.max(0, Math.min(current, total));
        const progress = Math.round((size * clamped) / total);
        const emptyProgress = size - progress;
        return '▬'.repeat(Math.max(0, progress - 1)) + '🔘' + '▬'.repeat(Math.max(0, emptyProgress));
    },

    buildSliderBar: (volume, max = 200) => {
        const STEPS = 10;
        const pos = Math.round((Math.max(0, Math.min(volume, max)) / max) * STEPS);
        const before = '▰'.repeat(Math.max(0, pos));
        const after = '▱'.repeat(Math.max(0, STEPS - pos));
        return `${before}${after}`;
    },

    buildVolumeBar: (volume, max = 200) => {
        const STEPS = 15;
        const filled = Math.round((Math.max(0, Math.min(volume, max)) / max) * STEPS);
        const empty = STEPS - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);

        let icon;
        if (volume === 0) icon = '🔇';
        else if (volume <= 40) icon = '🔈';
        else if (volume <= 100) icon = '🔉';
        else icon = '🔊';

        let color;
        if (volume === 0) color = 0x636e72;
        else if (volume <= 40) color = 0x74b9ff;
        else if (volume <= 100) color = 0x00b894;
        else if (volume <= 150) color = 0xfdcb6e;
        else color = 0xe17055;

        let label;
        if (volume === 0) label = 'Muted';
        else if (volume <= 40) label = 'Quiet';
        else if (volume <= 100) label = 'Normal';
        else if (volume <= 150) label = 'Loud';
        else label = 'Maximum';

        return { bar, color, icon, label };
    },

    validatePlayerConnection: (interaction, client, { requireCurrent = true, requireVoice = true } = {}) => {
        const { errorEmbed } = require('./embedBuilder');
        const player = client.manager?.getPlayer(interaction.guild.id);
        if (!player || player.isDestroyed() || (requireCurrent && !player.current)) {
            return {
                player: null,
                error: { embeds: [errorEmbed('I am not playing anything right now.')], flags: MessageFlags.Ephemeral }
            };
        }

        if (requireVoice) {
            const voiceChannel = interaction.member?.voice?.channelId;
            if (!voiceChannel || voiceChannel !== player.voiceId) {
                return {
                    player: null,
                    error: { embeds: [errorEmbed('You must be in my voice channel to use this command.')], flags: MessageFlags.Ephemeral }
                };
            }
        }

        return { player, error: null };
    }
};
