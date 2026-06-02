const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Plays the previously played track'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        const checks = require('../utils/checks');
        if (!(await checks.checkDJ(interaction.member))) {
            return interaction.reply({ content: 'You must have the DJ role to play previous tracks!', ephemeral: true });
        }

        if (!player.queue.previous) {
            return interaction.reply({ content: 'There is no previous track to play!', ephemeral: true });
        }

        // Kazagumo stores the previous track in `queue.previous`
        // To play it, we need to add it to the front of the queue and skip the current track
        const previousTrack = player.queue.previous;
        
        // Add the previous track to the very beginning of the queue
        player.queue.unshift(previousTrack);
        
        // Skip the current track so the previous one starts playing immediately
        player.skip();

        await interaction.reply({ content: `⏪ Playing previous track: **${previousTrack.title}**` });
    }
};
