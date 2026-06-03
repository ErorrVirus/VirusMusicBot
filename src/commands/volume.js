const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the volume of the player.')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('Volume amount (1-200)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(200)
        ),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const volume = interaction.options.getInteger('amount');
        player.volume = volume;
        player.player.setGlobalVolume(volume);
        
        interaction.reply({ embeds: [successEmbed(`Volume set to **${volume}%**.`)] });
    }
};
