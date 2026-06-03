const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Toggle repeat mode.')
        .addStringOption(option => 
            option.setName('mode')
                .setDescription('The loop mode')
                .setRequired(true)
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Track', value: 'track' },
                    { name: 'Queue', value: 'queue' }
                )
        ),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const mode = interaction.options.getString('mode');
        player.loop = mode;
        
        interaction.reply({ embeds: [successEmbed(`Loop mode set to **${mode}**.`)] });
    }
};
