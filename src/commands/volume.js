const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embedBuilder');
const { buildVolumeBar } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the volume of the player.')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('Volume amount (1-200)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(200)
        ),
    async execute(interaction, client) {
        const player = client.manager.getPlayer(interaction.guild.id);
        if (!player || !player.current) return interaction.reply({ embeds: [errorEmbed('I am not playing anything.')], ephemeral: true });

        if (interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ embeds: [errorEmbed('You must be in my voice channel to use this command.')], ephemeral: true });
        }

        const volume = Math.max(1, Math.min(200, interaction.options.getInteger('amount')));
        player.volume = volume;

        // Use setGlobalVolume (Lavalink v4 /volume endpoint) rather than the
        // filters DSP chain. This avoids audio pipeline stalls when changing
        // volume during active playback, especially at low levels (≤50%).
        await player.player.setGlobalVolume(volume);

        const { bar, color, label } = buildVolumeBar(volume);

        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: '🎚️  Volume Control' })
            .setDescription(
                `\`\`\`\n${bar}  ${volume}%\n\`\`\`` +
                `**Level:** ${label}`
            )
            .setFooter({ text: `Adjusted by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

        interaction.reply({ embeds: [embed] });
    }
};

