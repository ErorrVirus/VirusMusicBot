module.exports = {
    formatTime: (ms) => {
        if (!ms || isNaN(ms)) return '00:00';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    },
    
    createProgressBar: (current, total, size = 15) => {
        if (!total) return '▬'.repeat(size);
        const progress = Math.round((size * current) / total);
        const emptyProgress = size - progress;

        const progressString = '▬'.repeat(Math.max(0, progress - 1)) + '🔘' + '▬'.repeat(Math.max(0, emptyProgress));
        return progressString;
    },

    /**
     * Builds a modern visual volume bar for Discord embeds.
     * @param {number} volume  - Current volume (1–200)
     * @param {number} max     - Maximum volume (default 200)
     * @returns {{ bar: string, color: number, label: string }}
     */
    buildVolumeBar: (volume, max = 200) => {
        const STEPS = 15;
        const filled  = Math.round((volume / max) * STEPS);
        const empty   = STEPS - filled;

        // Unicode block characters — look great in Discord's font
        const filledChar = '█';
        const emptyChar  = '░';
        const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);

        // Icon changes with volume level
        let icon;
        if      (volume === 0)   icon = '🔇';
        else if (volume <= 40)   icon = '🔈';
        else if (volume <= 100)  icon = '🔉';
        else                     icon = '🔊';

        // Embed side-bar color: blue → green → yellow → red
        let color;
        if      (volume === 0)   color = 0x636e72; // grey  (muted)
        else if (volume <= 40)   color = 0x74b9ff; // blue  (quiet)
        else if (volume <= 100)  color = 0x00b894; // green (normal)
        else if (volume <= 150)  color = 0xfdcb6e; // yellow (loud)
        else                     color = 0xe17055; // red   (max)

        // Human-readable label
        let label;
        if      (volume === 0)   label = 'Muted';
        else if (volume <= 40)   label = 'Quiet';
        else if (volume <= 100)  label = 'Normal';
        else if (volume <= 150)  label = 'Loud';
        else                     label = 'Maximum';

        return { bar, color, icon, label };
    }
};

