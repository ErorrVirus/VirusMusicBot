const { EmbedBuilder } = require('discord.js');
const { errorEmbed, buildNowPlayingEmbed, buildControlRow } = require('../utils/embedBuilder');
const { buildVolumeBar } = require('../utils/helpers');

// Helper: rebuilds and edits the Now Playing message after any state change
async function refreshNowPlaying(player, client) {
    if (!player.nowPlayingMessage || !player.current) return;
    try {
        await player.nowPlayingMessage.edit({
            embeds:     [buildNowPlayingEmbed(player.current, player.volume, client.user.displayAvatarURL())],
            components: buildControlRow(player.isPaused, player.previous.length > 0)
        });
    } catch (_) {
        // Message may have been deleted — silently ignore
    }
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {

        // ── Button interactions ───────────────────────────────────────────────
        if (interaction.isButton()) {
            if (!interaction.customId.startsWith('music_')) return;

            const player = client.manager.getPlayer(interaction.guild.id);
            if (!player) {
                return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
            }
            if (!interaction.member.voice.channelId ||
                interaction.member.voice.channelId !== interaction.guild.members.me.voice.channelId) {
                return interaction.reply({ content: '❌ You must be in the same voice channel as me!', ephemeral: true });
            }

            try {
                switch (interaction.customId) {

                    case 'music_previous': {
                        const ok = player.playPrevious();
                        if (!ok) {
                            return interaction.reply({ content: '❌ No previous tracks in history.', ephemeral: true });
                        }
                        return interaction.reply({ content: '⏮️  Playing previous track!', ephemeral: true });
                    }

                    case 'music_pause': {
                        player.isPaused = !player.isPaused;
                        await player.player.setPaused(player.isPaused);

                        // Flip the button icon and update the embed in place
                        await refreshNowPlaying(player, client);

                        const { ActivityType } = require('discord.js');
                        client.user.setActivity(
                            player.isPaused ? 'music (paused) ⏸️' : 'music 🎵',
                            { type: ActivityType.Listening }
                        );

                        return interaction.reply({
                            content:   player.isPaused ? '⏸️  Paused the music.' : '▶️  Resumed the music.',
                            ephemeral: true
                        });
                    }

                    case 'music_stop': {
                        player.destroy('Stop button pressed');
                        return interaction.reply({ content: '⏹️  Stopped the music and cleared the queue.', ephemeral: true });
                    }

                    case 'music_skip': {
                        player.player.stopTrack(); // triggers 'end' → playNext()
                        return interaction.reply({ content: '⏭️  Skipped the track!', ephemeral: true });
                    }

                    // ── Volume button adjustments ──────────────────────────────
                    case 'music_voldown': {
                        // Decrease volume by 10%
                        player.volume = Math.max(1, player.volume - 10);
                        await player.player.setGlobalVolume(player.volume);

                        // Live-edit the Now Playing message — slider knob moves inside the embed
                        await refreshNowPlaying(player, client);

                        // Ephemeral confirmation
                        const { bar, color, label, icon } = buildVolumeBar(player.volume);
                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(color)
                                    .setAuthor({ name: 'Volume Updated' })
                                    .setDescription(
                                        `\`\`\`\n${icon}  ${bar}  ${player.volume}%\n\`\`\`` +
                                        `**${label}**`
                                    )
                                    .setFooter({
                                        text:    `Decreased by ${interaction.user.username}`,
                                        iconURL: interaction.user.displayAvatarURL()
                                    })
                            ],
                            ephemeral: true
                        });
                    }

                    case 'music_volup': {
                        // Increase volume by 10%
                        player.volume = Math.min(200, player.volume + 10);
                        await player.player.setGlobalVolume(player.volume);

                        // Live-edit the Now Playing message — slider knob moves inside the embed
                        await refreshNowPlaying(player, client);

                        // Ephemeral confirmation
                        const { bar, color, label, icon } = buildVolumeBar(player.volume);
                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(color)
                                    .setAuthor({ name: 'Volume Updated' })
                                    .setDescription(
                                        `\`\`\`\n${icon}  ${bar}  ${player.volume}%\n\`\`\`` +
                                        `**${label}**`
                                    )
                                    .setFooter({
                                        text:    `Increased by ${interaction.user.username}`,
                                        iconURL: interaction.user.displayAvatarURL()
                                    })
                            ],
                            ephemeral: true
                        });
                    }
                }
            } catch (err) {
                console.error('Button error:', err);
                return interaction.reply({ content: '❌ An error occurred!', ephemeral: true });
            }

            return;
        }

        // ── Slash commands ────────────────────────────────────────────────────
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`, error);
            const embed = errorEmbed('There was an error executing this command!');
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }
    }
};
