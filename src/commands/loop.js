const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Toggle loop mode for the track or queue')
        .addStringOption(option => 
            option.setName('mode')
                .setDescription('The loop mode to set')
                .setRequired(true)
                .addChoices(
                    { name: 'Track', value: 'track' },
                    { name: 'Queue', value: 'queue' },
                    { name: 'Off', value: 'none' }
                )
        ),
    async execute(interaction, client) {
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        const checks = require('../utils/checks');
        if (!(await checks.checkDJ(interaction.member))) {
            return interaction.reply({ content: 'You must have the DJ role to change loop modes!', ephemeral: true });
        }

        const mode = interaction.options.getString('mode');
        player.setLoop(mode);

        const modeNames = {
            'track': '🔂 Track',
            'queue': '🔁 Queue',
            'none': '➡️ Off'
        };

        await interaction.reply({ content: `Loop mode set to: **${modeNames[mode]}**` });
    }
};
