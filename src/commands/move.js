const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../utils/embedBuilder');
const { validatePlayerConnection } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track in the queue.')
        .addIntegerOption(option => 
            option.setName('from')
                .setDescription('The current position of the track')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option => 
            option.setName('to')
                .setDescription('The new position for the track')
                .setRequired(true)
                .setMinValue(1)
        ),
    async execute(interaction, client) {
        const { player, error } = validatePlayerConnection(interaction, client);
        if (error) return interaction.reply(error);

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from > player.queue.length || to > player.queue.length) {
            return interaction.reply({ embeds: [errorEmbed(`There are only ${player.queue.length} tracks in the queue.`)], ephemeral: true });
        }

        const [moved] = player.queue.splice(from - 1, 1);
        player.queue.splice(to - 1, 0, moved);

        // H-4: isUnresolved Spotify tracks don't have .info yet (JIT resolve pending)
        const trackName = moved.info?.title ?? moved.title ?? 'Unknown track';
        interaction.reply({ embeds: [successEmbed(`Moved **${trackName}** to position **${to}**.`)] });
    }
};
