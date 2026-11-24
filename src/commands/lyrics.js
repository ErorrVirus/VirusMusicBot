const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, buildEmbed } = require('../utils/embedBuilder');
const { getTrackTitle, getTrackArtist } = require('../utils/trackUtils');
const { cleanTitle } = require('../utils/searchCleaner');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Fetch lyrics for the currently playing song or a custom query.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title / artist (uses currently playing song if omitted)')
        ),

    async execute(interaction, client) {
        await interaction.deferReply();

        let query = interaction.options.getString('query');
        let trackTitle = query || '';
        let artistName = '';

        if (!query) {
            const player = client.manager?.getPlayer(interaction.guildId);
            if (!player || !player.current) {
                return interaction.editReply({ embeds: [errorEmbed('Nothing is playing. Provide a song name in `query`.')] });
            }
            trackTitle = cleanTitle(getTrackTitle(player.current));
            const rawArtist = getTrackArtist(player.current);
            artistName = rawArtist === 'Unknown Artist' ? '' : rawArtist.replace(/\s*-\s*Topic$/i, '').trim();
        }

        try {
            const searchQuery = `${trackTitle} ${artistName}`.trim();
            const url = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'VirusMusicPro/3.0 (https://github.com/ErorrVirus/VirusMusicBot)' },
                signal: AbortSignal.timeout(6000)
            });

            if (!resp.ok) {
                return interaction.editReply({ embeds: [errorEmbed(`Lyrics service returned HTTP ${resp.status}.`)] });
            }

            const results = await resp.json();
            const match = Array.isArray(results) ? results.find(r => r.plainLyrics || r.syncedLyrics) : null;

            if (!match) {
                return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${searchQuery}**.`)] });
            }

            const rawLyrics = match.plainLyrics || match.syncedLyrics.replace(/\[\d+:\d+(?:\.\d+)?\]\s*/g, '');
            const truncated = rawLyrics.length > 3900 ? `${rawLyrics.slice(0, 3900)}\n\n... *(lyrics truncated)*` : rawLyrics;

            return interaction.editReply({
                embeds: [buildEmbed({
                    color: '#5539CC',
                    title: `📜 ${match.trackName || trackTitle} — ${match.artistName || artistName || 'Unknown'}`,
                    description: truncated,
                    footer: { text: 'Powered by LRCLIB' }
                })]
            });
        } catch (err) {
            return interaction.editReply({
                embeds: [errorEmbed(`Lyrics lookup unavailable right now (${err.message}).`)]
            });
        }
    }
};
