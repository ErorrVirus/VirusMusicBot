const { EmbedBuilder } = require('discord.js');
const { errorEmbed, buildControlRow, buildVolumeRow } = require('../utils/embedBuilder');
const { buildVolumeBar } = require('../utils/helpers');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton()) {
            // Handle music buttons
            if (interaction.customId.startsWith('music_')) {
                const player = client.manager.getPlayer(interaction.guild.id);
                if (!player) {
                    return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
                }

                // Check voice channel
                if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice.channelId) {
                    return interaction.reply({ content: 'You must be in the same voice channel as me to use these buttons!', ephemeral: true });
                }

                try {
                    switch (interaction.customId) {

                        // ── Playback controls ──────────────────────────────────────────
                        case 'music_pause':
                            player.isPaused = !player.isPaused;
                            await player.player.setPaused(player.isPaused);

                            // Refresh the control row so the icon flips between ⏸ and ▶
                            if (player.nowPlayingMessage) {
                                player.nowPlayingMessage.edit({
                                    components: [
                                        buildControlRow(player.isPaused),
                                        buildVolumeRow(player.volume)
                                    ]
                                }).catch(() => {});
                            }

                            {
                                const { ActivityType } = require('discord.js');
                                if (player.isPaused) {
                                    client.user.setActivity('music (paused) ⏸️', { type: ActivityType.Listening });
                                } else {
                                    client.user.setActivity('music 🎵', { type: ActivityType.Listening });
                                }
                            }

                            return interaction.reply({
                                content: player.isPaused ? '⏸️ Paused the music.' : '▶️ Resumed the music.',
                                ephemeral: true
                            });

                        case 'music_skip':
                            player.player.stopTrack(); // triggers 'end' → playNext()
                            return interaction.reply({ content: '⏭️ Skipped the track!', ephemeral: true });

                        case 'music_stop':
                            player.destroy('Stop button pressed');
                            return interaction.reply({ content: '⏹️ Stopped the music and cleared the queue.', ephemeral: true });

                        // ── Volume slider ──────────────────────────────────────────────
                        // Layout: [◄◄ -20]  [◄ -10]  [🔉 ████████░░░░ 75%]  [+10 ►]  [+20 ►►]
                        //
                        // Pressing a left or right button:
                        //   1. Changes the volume in Lavalink
                        //   2. Live-edits the Now Playing message to update the bar display
                        //   3. Replies ephemerally with a colour-coded volume embed
                        case 'music_vol_m20':
                        case 'music_vol_m10':
                        case 'music_vol_p10':
                        case 'music_vol_p20': {
                            const deltas = {
                                music_vol_m20: -20,
                                music_vol_m10: -10,
                                music_vol_p10:  10,
                                music_vol_p20:  20
                            };
                            player.volume = Math.max(1, Math.min(200, player.volume + deltas[interaction.customId]));
                            await player.player.setGlobalVolume(player.volume);

                            // Live-edit the Now Playing message so the bar reflects the new volume
                            if (player.nowPlayingMessage) {
                                player.nowPlayingMessage.edit({
                                    components: [
                                        buildControlRow(player.isPaused),
                                        buildVolumeRow(player.volume)
                                    ]
                                }).catch(() => {});
                            }

                            // Ephemeral confirmation embed with colour-coded bar
                            const { bar, color, label, icon } = buildVolumeBar(player.volume);
                            return interaction.reply({
                                embeds: [
                                    new EmbedBuilder()
                                        .setColor(color)
                                        .setAuthor({ name: '🎚️  Volume' })
                                        .setDescription(
                                            `\`\`\`\n${icon}  ${bar}  ${player.volume}%\n\`\`\`` +
                                            `**${label}**`
                                        )
                                        .setFooter({
                                            text: `Adjusted by ${interaction.user.username}`,
                                            iconURL: interaction.user.displayAvatarURL()
                                        })
                                ],
                                ephemeral: true
                            });
                        }
                    }
                } catch (err) {
                    console.error('Button error:', err);
                    return interaction.reply({ content: 'An error occurred!', ephemeral: true });
                }
            }
            return;
        }

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
