const { errorEmbed } = require('../utils/embedBuilder');

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
                        case 'music_pause':
                            player.isPaused = !player.isPaused;
                            await player.player.setPaused(player.isPaused);
                            
                            // Update activity — generic to protect server privacy
                            {
                                const { ActivityType } = require('discord.js');
                                if (player.isPaused) {
                                    client.user.setActivity('music (paused) ⏸️', { type: ActivityType.Listening });
                                } else {
                                    client.user.setActivity('music 🎵', { type: ActivityType.Listening });
                                }
                            }

                            return interaction.reply({ content: player.isPaused ? '⏸️ Paused the music.' : '▶️ Resumed the music.', ephemeral: true });
                        
                        case 'music_skip':
                            player.player.stopTrack(); // triggers 'end' event which calls playNext() automatically
                            return interaction.reply({ content: '⏭️ Skipped the track!', ephemeral: true });

                        case 'music_stop':
                            player.destroy('Stop button pressed');
                            return interaction.reply({ content: '⏹️ Stopped the music and cleared the queue.', ephemeral: true });
                        
                        case 'music_voldown':
                            // Clamp to minimum 1 — volume of 0 can cause Lavalink
                            // DSP gain filter issues resulting in audio stutter.
                            player.volume = Math.max(1, player.volume - 10);
                            await player.player.setGlobalVolume(player.volume);
                            return interaction.reply({ content: `🔉 Volume decreased to **${player.volume}%**`, ephemeral: true });
                        
                        case 'music_volup':
                            player.volume = Math.min(200, player.volume + 10);
                            await player.player.setGlobalVolume(player.volume);
                            return interaction.reply({ content: `🔊 Volume increased to **${player.volume}%**`, ephemeral: true });
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
