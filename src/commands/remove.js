const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue')
        .addIntegerOption(option => 
            option.setName('position')
                .setDescription('The queue position of the track to remove')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        const checks = require('../utils/checks');
        if (!(await checks.checkDJ(interaction.member))) {
            return interaction.reply({ content: 'You must have the DJ role to remove tracks!', ephemeral: true });
        }

        const position = interaction.options.getInteger('position');

        if (position > player.queue.length) {
            return interaction.reply({ content: `Invalid position! The queue only has ${player.queue.length} tracks.`, ephemeral: true });
        }

        const removedTrack = player.queue[position - 1];
        player.queue.splice(position - 1, 1);

        await interaction.reply({ content: `🗑️ Removed **${removedTrack.title}** from the queue.` });
    }
};
