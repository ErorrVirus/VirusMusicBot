const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildVolumeBar } = require('./helpers');

module.exports = {
    buildEmbed: (options) => {
        const embed = new EmbedBuilder()
            .setColor(options.color || '#2b2d31');

        if (options.title) embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.author) embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
        if (options.footer) embed.setFooter({ text: options.footer.text, iconURL: options.footer.iconURL });
        if (options.fields) embed.addFields(options.fields);

        return embed;
    },
    
    errorEmbed: (message) => {
        return new EmbedBuilder()
            .setColor('#ed4245')
            .setDescription(`❌ | ${message}`);
    },

    successEmbed: (message) => {
        return new EmbedBuilder()
            .setColor('#57f287')
            .setDescription(`✅ | ${message}`);
    },

    /**
     * Builds the 3-button playback control row (pause / stop / skip).
     * @param {boolean} isPaused
     */
    buildControlRow: (isPaused = false) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setEmoji(isPaused ? '▶️' : '⏸️')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
        );
    },

    /**
     * Builds the 5-button interactive volume slider row.
     *
     * Layout:  [◄◄ -20]  [◄ -10]  [🔉 ████████░░░░ 75%]  [+10 ►]  [+20 ►►]
     *
     * The centre button is disabled and shows the current volume bar.
     * The outer buttons are disabled when the volume is already at its limit.
     *
     * @param {number} volume  Current volume (1–200)
     */
    buildVolumeRow: (volume) => {
        const { icon } = buildVolumeBar(volume);

        // 12-step bar fits comfortably inside a Discord button label (max 80 chars)
        const STEPS   = 12;
        const filled  = Math.round((volume / 200) * STEPS);
        const empty   = STEPS - filled;
        const bar     = '█'.repeat(filled) + '░'.repeat(empty);
        const display = `${icon}  ${bar}  ${volume}%`;

        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('music_vol_m20')
                .setLabel('◄◄  -20')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(volume <= 1),
            new ButtonBuilder()
                .setCustomId('music_vol_m10')
                .setLabel('◄  -10')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(volume <= 1),
            // Centre: display-only, not clickable
            new ButtonBuilder()
                .setCustomId('music_vol_display')
                .setLabel(display)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('music_vol_p10')
                .setLabel('+10  ►')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(volume >= 200),
            new ButtonBuilder()
                .setCustomId('music_vol_p20')
                .setLabel('+20  ►►')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(volume >= 200)
        );
    }
};

