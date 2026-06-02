const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffles the current queue'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        const checks = require('../utils/checks');
        if (!(await checks.checkDJ(interaction.member))) {
            return interaction.reply({ content: 'You must have the DJ role to shuffle the queue!', ephemeral: true });
        }

        if (player.queue.length === 0) {
            return interaction.reply({ content: 'The queue is empty, nothing to shuffle!', ephemeral: true });
        }

        player.queue.shuffle();
        await interaction.reply({ content: '🔀 The queue has been shuffled!' });
    }
};
