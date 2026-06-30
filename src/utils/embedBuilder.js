const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const { buildVolumeBar, buildSliderBar, formatTime } = require('./helpers');

// Volume presets shown in the dropdown (10 → 200, 20 options fits Discord's 25-option limit)
const VOLUME_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

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
     * Volume field visual:
     *   🔉  Volume  ·  75%  —  Normal
     *   ▬▬▬▬▬▬▬▬▬▬▬▬▬🔘▬▬▬▬▬
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
                name: '🎵  Now Playing',
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
                { name: '⏱️  Duration',     value: `\`${track.info.isStream ? '🔴 LIVE' : formatTime(track.info.length)}\``, inline: true },
                { name: '🎧  Requested By', value: `<@${track.requester?.id || 'unknown'}>`,                             inline: true },
                // Volume slider — the ▬▬🔘▬▬ bar lives inside the embed itself
                {
                    name:   `${icon}  Volume  ·  ${volume}%  —  ${label}`,
                    value:  slider,
                    inline: false
                }
            )
            .setFooter({ text: '✦  Coded by ErorrVirus', iconURL: clientAvatarURL });
    },

    // ── Playback control row ─────────────────────────────────────────────────
    /**
     * Row 1 — four modern media-player buttons.
     * ⏮  Previous  |  ⏸/▶  Pause/Resume  |  ⏹  Stop  |  ⏭  Skip
     *
     * Colour coding mirrors real player UIs:
     *   Green  = play  (positive / go)
     *   Blue   = pause (active state)
     *   Red    = stop  (destructive)
     *   Grey   = navigation (neutral)
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
                .setCustomId('music_stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('⏭')
                .setStyle(ButtonStyle.Secondary)
        );
    },

    // ── Volume select-menu row ───────────────────────────────────────────────
    /**
     * Row 2 — a dropdown select menu with 20 volume presets (10 % → 200 %).
     * Clicking a preset is the closest Discord can get to "sliding" a volume knob.
     * Each option shows a mini filled bar so the user sees the level at a glance.
     * The placeholder always shows the current volume so it acts as a live readout.
     *
     * @param {number} currentVolume  Current player volume (1–200)
     */
    buildVolumeMenu: (currentVolume) => {
        const options = VOLUME_LEVELS.map(vol => {
            const { icon, label } = buildVolumeBar(vol);
            const steps  = 10;
            const filled = Math.round((vol / 200) * steps);
            const empty  = steps - filled;
            const miniBar = '█'.repeat(filled) + '░'.repeat(empty);

            return {
                label:       `${icon}  ${miniBar}  ${vol}%`,
                description: label,
                value:       String(vol),
                default:     vol === currentVolume
            };
        });

        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('music_volume_select')
                .setPlaceholder(`🎚️  Volume  ·  ${currentVolume}%  —  Select to adjust`)
                .addOptions(options)
        );
    }
};
