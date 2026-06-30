module.exports = {
    formatTime: (ms) => {
        if (!ms || isNaN(ms)) return '00:00';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours   = Math.floor((ms / (1000 * 60 * 60)) % 24);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },

    createProgressBar: (current, total, size = 15) => {
        if (!total) return '▬'.repeat(size);
        const progress      = Math.round((size * current) / total);
        const emptyProgress = size - progress;
        return '▬'.repeat(Math.max(0, progress - 1)) + '🔘' + '▬'.repeat(Math.max(0, emptyProgress));
    },

    /**
     * Renders a ▬▬▬🔘▬▬▬ slider track with the knob at the correct position.
     * Mimics a real media-player volume slider inside a Discord embed field.
     * @param {number} volume  Current volume (1–200)
     * @param {number} max     Maximum volume (default 200)
     * @returns {string}
     */
    buildSliderBar: (volume, max = 200) => {
        const STEPS  = 17;
        const pos    = Math.round((volume / max) * STEPS);
        const before = '▬'.repeat(Math.max(0, pos));
        const after  = '▬'.repeat(Math.max(0, STEPS - pos));
        return `${before}🔘${after}`;
    },

    /**
     * Builds volume metadata: icon, filled bar, colour, and human label.
     * @param {number} volume  Current volume (1–200)
     * @param {number} max     Maximum volume (default 200)
     * @returns {{ bar: string, color: number, icon: string, label: string }}
     */
    buildVolumeBar: (volume, max = 200) => {
        const STEPS  = 15;
        const filled = Math.round((volume / max) * STEPS);
        const empty  = STEPS - filled;
        const bar    = '█'.repeat(filled) + '░'.repeat(empty);

        let icon;
        if      (volume === 0)  icon = '🔇';
        else if (volume <= 40)  icon = '🔈';
        else if (volume <= 100) icon = '🔉';
        else                    icon = '🔊';

        let color;
        if      (volume === 0)  color = 0x636e72;
        else if (volume <= 40)  color = 0x74b9ff;
        else if (volume <= 100) color = 0x00b894;
        else if (volume <= 150) color = 0xfdcb6e;
        else                    color = 0xe17055;

        let label;
        if      (volume === 0)  label = 'Muted';
        else if (volume <= 40)  label = 'Quiet';
        else if (volume <= 100) label = 'Normal';
        else if (volume <= 150) label = 'Loud';
        else                    label = 'Maximum';

        return { bar, color, icon, label };
    }
};
