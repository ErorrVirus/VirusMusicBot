const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { buildVolumeBar, buildSliderBar, createProgressBar, formatTime } = require('./helpers');
const {
    getTrackTitle,
    getTrackArtist,
    getTrackUri,
    getTrackDuration,
    isTrackStream,
    getTrackArtwork,
    getTrackSource
} = require('./trackUtils');
const { getPresetConfig } = require('../services/EqualizerService');

const DEFAULT_ARTWORK = 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?q=80&w=200&auto=format&fit=crop';

module.exports = {
    buildEmbed: (options) => {
        const embed = new EmbedBuilder().setColor(options.color || '#2b2d31');
        if (options.title) embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.author) embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
        if (options.footer) embed.setFooter({ text: options.footer.text, iconURL: options.footer.iconURL });
        if (options.fields) embed.addFields(options.fields);
        return embed;
    },

    errorEmbed: (message) =>
        new EmbedBuilder().setColor('#ed4245').setDescription(`❌ | ${message}`),

    successEmbed: (message) =>
        new EmbedBuilder().setColor('#57f287').setDescription(`✅ | ${message}`),

    buildNowPlayingEmbed: (player, track, clientAvatarURL) => {
        const volume = player.volume ?? 100;
        const { icon, label } = buildVolumeBar(volume);
        const slider = buildSliderBar(volume);

        const title = getTrackTitle(track);
        const artist = getTrackArtist(track);
        const uri = getTrackUri(track);
        const duration = getTrackDuration(track);
        const isStream = isTrackStream(track);
        const position = player.player?.position || 0;
        const source = getTrackSource(track);
        const eqLabel = getPresetConfig(player.preset || 'flat').label.split(' (')[0];
        const requester = track?.requester?.id ? `<@${track.requester.id}>` : (track?.requester?.username || 'Autoplay');

        const durationText = isStream
            ? '🔴 LIVE'
            : `${formatTime(position)} / ${formatTime(duration)}`;

        const progressLine = isStream
            ? '🔴 **LIVE STREAM**'
            : `${createProgressBar(position, duration || 1, 16)}\n\`${durationText}\``;

        const embed = new EmbedBuilder()
            .setColor(player.isPaused ? '#faa61a' : '#5539CC')
            .setAuthor({ name: player.isPaused ? 'Paused' : 'Now Playing' })
            .setTitle(title.slice(0, 256))
            .setDescription(progressLine)
            .setThumbnail(getTrackArtwork(track) || DEFAULT_ARTWORK)
            .addFields(
                { name: '👤 Artist', value: `\`${artist.slice(0, 80)}\``, inline: true },
                { name: '📡 Source', value: `\`${source}\``, inline: true },
                { name: '🎧 Requested By', value: requester, inline: true },
                { name: '📋 Queue', value: `\`${player.queue.length} track(s)\``, inline: true },
                { name: '🔁 Loop', value: `\`${player.loop}\``, inline: true },
                { name: '♾️ Autoplay', value: `\`${player.autoplay ? 'On' : 'Off'}\``, inline: true },
                { name: '🎚️ Equalizer', value: `\`${eqLabel}\``, inline: true },
                { name: `Volume · ${label}`, value: `${icon} ${slider} ${volume}%`, inline: false }
            )
            .setFooter({
                text: `VirusMusicPro V3 • Session ${player.sessionId || ''}`.trim(),
                iconURL: clientAvatarURL || undefined
            });

        if (uri && /^https?:\/\//i.test(uri)) {
            embed.setURL(uri);
        }

        return embed;
    },

    buildControlRows: (player, disabled = false) => {
        const isPaused = Boolean(player?.isPaused);
        const loopMode = player?.loop || 'none';
        const autoplayOn = Boolean(player?.autoplay);
        const sid = player?.sessionId || '0';

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_previous:${sid}`)
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_pause:${sid}`)
                .setEmoji(isPaused ? '▶️' : '⏸️')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_skip:${sid}`)
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_stop:${sid}`)
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_loop:${sid}`)
                .setEmoji(loopMode === 'track' ? '🔂' : '🔁')
                .setStyle(loopMode === 'none' ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(disabled)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_voldown:${sid}`)
                .setEmoji('🔉')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_volup:${sid}`)
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_shuffle:${sid}`)
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_queue:${sid}`)
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`music_autoplay:${sid}`)
                .setEmoji('♾️')
                .setStyle(autoplayOn ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled)
        );

        return [row1, row2];
    },

    buildControlRow: (isPaused = false) => {
        return module.exports.buildControlRows({ isPaused, loop: 'none', autoplay: false, sessionId: '0' }, false)[0];
    },

    buildVolumeReplyEmbed: (volume, direction, user) => {
        const { color, label, icon } = buildVolumeBar(volume);
        const slider = buildSliderBar(volume);
        return new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: 'Volume Updated' })
            .setDescription(`\`\`\`\n${icon}  ${slider}  ${volume}%\n\`\`\`**${label}**`)
            .setFooter({
                text: `${direction} by ${user.username}`,
                iconURL: user.displayAvatarURL()
            });
    }
};
