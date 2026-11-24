const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection, parseDurationToMs, formatTime } = require('../utils/helpers');
const { isTrackSeekable, getTrackDuration } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific timestamp in the current track.')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Timestamp (e.g. 1:30, 0:45, or seconds like 90)')
                .setRequired(true)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        if (!isTrackSeekable(player.current)) {
            return interaction.reply({ embeds: [errorEmbed('This track or livestream is not seekable.')], flags: MessageFlags.Ephemeral });
        }

        const raw = interaction.options.getString('time');
        const targetMs = parseDurationToMs(raw);
        if (targetMs === null) {
            return interaction.reply({ embeds: [errorEmbed('Invalid timestamp format. Use `mm:ss`, `hh:mm:ss`, or seconds.')], flags: MessageFlags.Ephemeral });
        }

        const duration = getTrackDuration(player.current);
        if (duration > 0 && targetMs >= duration) {
            return interaction.reply({ embeds: [errorEmbed(`Timestamp exceeds track duration (${formatTime(duration)}).`)], flags: MessageFlags.Ephemeral });
        }

        await player.seek(targetMs);
        return interaction.reply({ embeds: [successEmbed(`⏩ Seeked to **${formatTime(targetMs)}**.`)] });
    }
};
