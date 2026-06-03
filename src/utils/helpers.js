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
    }
};
