const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the currently playing song'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'I am not playing anything!', ephemeral: true });
        }

        const memberVoice = interaction.member.voice.channelId;
        if (!memberVoice || memberVoice !== player.voiceId) {
            return interaction.reply({ content: 'You must be in the same voice channel as me!', ephemeral: true });
        }

        if (player.paused) {
            return interaction.reply({ content: 'The music is already paused!', ephemeral: true });
        }

        player.pause(true);
        return interaction.reply({ content: '⏸️ Paused the music.' });
    }
};
