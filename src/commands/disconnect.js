const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Clears the queue and disconnects the bot from the voice channel'),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player) {
            return interaction.reply({ content: 'I am not in a voice channel!', ephemeral: true });
        }

        const checks = require('../utils/checks');
        if (!(await checks.checkDJ(interaction.member))) {
            return interaction.reply({ content: 'You must have the DJ role to disconnect the bot!', ephemeral: true });
        }

        // Clear the queue and destroy the player
        player.destroy();
        
        // Also clear DB state so it doesn't auto-resume next time
        try {
            await client.db.clearQueueState(interaction.guild.id);
        } catch(e) {
            console.error('[Disconnect] Failed to clear DB state:', e);
        }

        await interaction.reply({ content: '👋 Disconnected and cleared the queue!' });
    }
};
