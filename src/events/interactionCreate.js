const { errorEmbed } = require('../utils/embedBuilder');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`, error);
            const embed = errorEmbed('There was an error executing this command!');
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }
    }
};
