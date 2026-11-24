const { ActivityType, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { errorEmbed, buildControlRows, buildVolumeReplyEmbed, buildEmbed } = require('../utils/embedBuilder');
const { checkDjPermission, checkAllowedTextChannel } = require('../utils/permissions');
const { getTrackTitle, formatTrackLink, formatTrackDuration } = require('../utils/trackUtils');

const DJ_ONLY_COMMANDS = new Set([
    'skip', 'stop', 'disconnect', 'remove', 'move', 'clear',
    'shuffle', 'loop', 'seek', 'volume', 'bassboost', 'equalizer',
    'autoplay', '247', 'previous'
]);

const DJ_ONLY_BUTTONS = new Set([
    'music_previous', 'music_pause', 'music_skip', 'music_stop',
    'music_loop', 'music_voldown', 'music_volup', 'music_shuffle', 'music_autoplay'
]);

// Prevent rapid duplicate button clicks per user/message
const activeButtonUsers = new Set();

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton()) {
            if (!interaction.customId.startsWith('music_')) return;
            await handleMusicButton(interaction, client);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        // Allowed text channel check (exempt /settings and /help)
        if (interaction.commandName !== 'settings' && interaction.commandName !== 'help') {
            const channelErr = checkAllowedTextChannel(interaction, client.manager?.db);
            if (channelErr) {
                return interaction.reply({ embeds: [errorEmbed(channelErr)], flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }

        // DJ check for playback control commands
        if (DJ_ONLY_COMMANDS.has(interaction.commandName)) {
            const djErr = checkDjPermission(interaction, client);
            if (djErr) {
                return interaction.reply({ embeds: [errorEmbed(djErr)], flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            logger.error('Command', `Error executing /${interaction.commandName}`, {
                guildId: interaction.guildId,
                err: error
            });
            const embed = errorEmbed('There was an error executing this command!');
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    }
};

async function handleMusicButton(interaction, client) {
    const [action, sessionId] = interaction.customId.split(':');
    const lockKey = `${interaction.user.id}:${interaction.message.id}`;

    if (activeButtonUsers.has(lockKey)) {
        return interaction.reply({ content: '⏳ Action already in progress...', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const player = client.manager?.getPlayer(interaction.guildId);
    const isStaleSession = !player || player.isDestroyed() || (sessionId && sessionId !== '0' && player.sessionId !== sessionId);

    if (isStaleSession) {
        // Disable outdated controls on stale messages
        await interaction.update({ components: buildControlRows(player || {}, true) }).catch(async () => {
            await interaction.reply({ content: '❌ These playback controls have expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
        });
        return;
    }

    if (action !== 'music_queue') {
        const userVoice = interaction.member?.voice?.channelId;
        if (!userVoice || userVoice !== player.voiceId) {
            return interaction.reply({ content: '❌ You must be in the same voice channel as me!', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    if (DJ_ONLY_BUTTONS.has(action)) {
        const djErr = checkDjPermission(interaction, client);
        if (djErr) {
            return interaction.reply({ embeds: [errorEmbed(djErr)], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    activeButtonUsers.add(lockKey);
    try {
        switch (action) {
            case 'music_previous': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const ok = await player.playPrevious();
                if (!ok) {
                    return interaction.editReply({ content: '❌ No previous tracks in history.' });
                }
                return interaction.editReply({ content: '⏮️ Playing previous track!' });
            }

            case 'music_pause': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const paused = await player.setPaused(!player.isPaused);
                client.manager.scheduleNowPlayingRefresh(player);
                if (client.user) {
                    client.user.setActivity(
                        paused ? 'music (paused) ⏸️' : 'music 🎵',
                        { type: ActivityType.Listening }
                    );
                }
                return interaction.editReply({ content: paused ? '⏸️ Paused the music.' : '▶️ Resumed the music.' });
            }

            case 'music_stop': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                await player.stop();
                return interaction.editReply({ content: '⏹️ Stopped the music and cleared the queue.' });
            }

            case 'music_skip': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const res = await player.skip();
                if (!res.ok) {
                    return interaction.editReply({ content: `❌ ${res.reason}` });
                }
                return interaction.editReply({ content: `⏭️ Skipped **${getTrackTitle(res.skipped)}**!` });
            }

            case 'music_loop': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const order = ['none', 'track', 'queue'];
                const next = order[(order.indexOf(player.loop) + 1) % order.length];
                await player.setLoop(next);
                client.manager.scheduleNowPlayingRefresh(player);
                return interaction.editReply({ content: `🔁 Loop mode set to **${next}**.` });
            }

            case 'music_voldown': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const vol = await player.setVolume(player.volume - 10);
                client.manager.scheduleNowPlayingRefresh(player);
                return interaction.editReply({ embeds: [buildVolumeReplyEmbed(vol, 'Decreased', interaction.user)] });
            }

            case 'music_volup': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const vol = await player.setVolume(player.volume + 10);
                client.manager.scheduleNowPlayingRefresh(player);
                return interaction.editReply({ embeds: [buildVolumeReplyEmbed(vol, 'Increased', interaction.user)] });
            }

            case 'music_shuffle': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const count = await player.shuffleQueue();
                if (count < 2) {
                    return interaction.editReply({ content: '❌ Need at least 2 queued tracks to shuffle.' });
                }
                client.manager.scheduleNowPlayingRefresh(player);
                return interaction.editReply({ content: `🔀 Shuffled **${count}** queued tracks!` });
            }

            case 'music_autoplay': {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const enabled = await player.setAutoplay(!player.autoplay);
                client.manager.scheduleNowPlayingRefresh(player);
                return interaction.editReply({ content: `♾️ Autoplay is now **${enabled ? 'enabled' : 'disabled'}**.` });
            }

            case 'music_queue': {
                const lines = player.queue.slice(0, 10).map((t, idx) =>
                    `**${idx + 1}.** ${formatTrackLink(t)} \`[${formatTrackDuration(t)}]\``
                );
                const queueBody = lines.length ? lines.join('\n') : 'The queue is empty.';
                const extra = player.queue.length > 10 ? `\n*...and ${player.queue.length - 10} more track(s)*` : '';
                return interaction.reply({
                    embeds: [buildEmbed({
                        title: `Queue (${player.queue.length} track(s))`,
                        description: `${queueBody}${extra}`
                    })],
                    flags: MessageFlags.Ephemeral
                });
            }

            default:
                return interaction.reply({ content: '❌ Unknown button action.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    } catch (err) {
        logger.error('Button', 'Button interaction failed', { guildId: interaction.guildId, action, err });
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ An error occurred processing that control.' }).catch(() => {});
        } else {
            await interaction.reply({ content: '❌ An error occurred processing that control.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    } finally {
        activeButtonUsers.delete(lockKey);
    }
}
