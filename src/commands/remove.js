const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue.')
        .addIntegerOption(option => 
            option.setName('position')
                .setDescription('The queue position of the track to remove')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const position = interaction.options.getInteger('position');
        if (position > player.queue.length) {
            return interaction.reply({ embeds: [errorEmbed(`There are only ${player.queue.length} tracks in the queue.`)], ephemeral: true });
        }

        const removed = player.queue.splice(position - 1, 1)[0];
        
        interaction.reply({ embeds: [successEmbed(`Removed **${removed.info.title}** from the queue.`)] });
    }
};
