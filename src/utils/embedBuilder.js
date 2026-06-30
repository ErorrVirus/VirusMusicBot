const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { buildVolumeBar, buildSliderBar, formatTime } = require('./helpers');

module.exports = {
    // ── Generic builders ─────────────────────────────────────────────────────
    buildEmbed: (options) => {
        const embed = new EmbedBuilder().setColor(options.color || '#2b2d31');
        if (options.title)       embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        if (options.thumbnail)   embed.setThumbnail(options.thumbnail);
        if (options.image)       embed.setImage(options.image);
        if (options.author)      embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
        if (options.footer)      embed.setFooter({ text: options.footer.text, iconURL: options.footer.iconURL });
        if (options.fields)      embed.addFields(options.fields);
        return embed;
    },

    errorEmbed: (message) =>
        new EmbedBuilder().setColor('#ed4245').setDescription(`❌ | ${message}`),

    successEmbed: (message) =>
        new EmbedBuilder().setColor('#57f287').setDescription(`✅ | ${message}`),

    // ── Now Playing embed ────────────────────────────────────────────────────
    /**
     * Builds the rich Now Playing embed with the volume slider bar embedded
     * directly inside a field — so it lives *inside* the card, not below it.
     *
     * @param {object} track          Shoukaku track object
     * @param {number} volume         Current player volume (1–200)
     * @param {string} clientAvatarURL Bot avatar URL for the footer
     */
    buildNowPlayingEmbed: (track, volume, clientAvatarURL) => {
        const { icon, label } = buildVolumeBar(volume);
        const slider = buildSliderBar(volume);

        return new EmbedBuilder()
            .setColor('#5539CC')
            .setAuthor({
                name: 'Now Playing',
                iconURL: 'https://cdn.discordapp.com/emojis/1105021295240560700.gif'
            })
            .setTitle(track.info.title)
            .setURL(track.info.uri)
            .setThumbnail(
                track.info.artworkUrl ||
                'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?q=80&w=200&auto=format&fit=crop'
            )
            .addFields(
                { name: '👤  Author',       value: `\`${track.info.author}\``,                                           inline: true },
                { name: '⏱  Duration',     value: `\`${track.info.isStream ? '🔴 LIVE' : formatTime(track.info.length)}\``, inline: true },
                { name: '🎧  Requested By', value: `<@${track.requester?.id || 'unknown'}>`,                             inline: true },
                // Volume slider — formatted exactly like: 🔊 ▰▰▰▰▰▱▱▱ 50%
                {
                    name:   `Volume  ·  ${label}`,
                    value:  `${icon}  ${slider}  ${volume}%`,
                    inline: false
                }
            )
            .setFooter({ text: '✦  Coded by ErorrVirus', iconURL: clientAvatarURL });
    },

    // ── Playback control row ─────────────────────────────────────────────────
    /**
     * Row 1 — 5 modern media-player buttons in a single row.
     * ⏮  Previous  |  ⏸/▶  Pause/Resume  |  ⏭  Skip  |  🔉 Vol Down  |  🔊 Vol Up
     *
     * @param {boolean} isPaused
     * @param {boolean} hasPrevious  Whether there are tracks in the history
     */
    buildControlRow: (isPaused = false, hasPrevious = false) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('music_previous')
                .setEmoji('⏮')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrevious),
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setEmoji(isPaused ? '▶️' : '⏸️')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('⏭')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_voldown')
                .setEmoji('🔉')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_volup')
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary)
        );
    }
};
