const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Change the volume of the music')
        .addIntegerOption(option => 
            option.setName('level')
                .setDescription('Volume level (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        ),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'I am not playing anything!', ephemeral: true });
        }

        const memberVoice = interaction.member.voice.channelId;
        if (!memberVoice || memberVoice !== player.voiceId) {
            return interaction.reply({ content: 'You must be in the same voice channel as me!', ephemeral: true });
        }

        const volume = interaction.options.getInteger('level');
        player.setVolume(volume);
        
        return interaction.reply({ content: `🔊 Volume set to **${volume}%**` });
    }
};
