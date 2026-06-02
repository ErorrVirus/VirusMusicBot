const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Moves a track to a different position in the queue')
        .addIntegerOption(option => 
            option.setName('from')
                .setDescription('The current queue position of the track')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option => 
            option.setName('to')
                .setDescription('The new queue position for the track')
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
            return interaction.reply({ content: 'You must have the DJ role to move tracks!', ephemeral: true });
        }

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from > player.queue.length || to > player.queue.length) {
            return interaction.reply({ content: `Invalid position! The queue only has ${player.queue.length} tracks.`, ephemeral: true });
        }

        if (from === to) {
            return interaction.reply({ content: 'The track is already at that position!', ephemeral: true });
        }

        const trackToMove = player.queue[from - 1];
        player.queue.splice(from - 1, 1);
        player.queue.splice(to - 1, 0, trackToMove);

        await interaction.reply({ content: `🚚 Moved **${trackToMove.title}** to position #${to}.` });
    }
};
