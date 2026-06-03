const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track in the queue.')
        .addIntegerOption(option => 
            option.setName('from')
                .setDescription('The current position of the track')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option => 
            option.setName('to')
                .setDescription('The new position for the track')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from > player.queue.length || to > player.queue.length) {
            return interaction.reply({ embeds: [errorEmbed(`There are only ${player.queue.length} tracks in the queue.`)], ephemeral: true });
        }

        const [moved] = player.queue.splice(from - 1, 1);
        player.queue.splice(to - 1, 0, moved);
        
        interaction.reply({ embeds: [successEmbed(`Moved **${moved.info.title}** to position **${to}**.`)] });
    }
};
