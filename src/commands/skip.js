const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing song'),
    async execute(interaction, client) {
        const member = interaction.member;
        const checks = require('../utils/checks');

        if (await checks.checkBlacklist(member.user.id, interaction.guild.id)) {
            return interaction.reply({ content: 'You or this server are blacklisted.', ephemeral: true });
        }

        if (!(await checks.checkDJ(member))) {
            return interaction.reply({ content: 'You must have the DJ role!', ephemeral: true });
        }
        const player = client.manager.players.get(interaction.guild.id);
        
        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'I am not playing anything!', ephemeral: true });
        }

        const memberVoice = interaction.member.voice.channelId;
        if (!memberVoice || memberVoice !== player.voiceId) {
            return interaction.reply({ content: 'You must be in the same voice channel as me!', ephemeral: true });
        }

        player.skip();
        return interaction.reply({ content: '⏭️ Skipped the current song.' });
    }
};

