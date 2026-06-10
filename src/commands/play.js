const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');
// Detect localized Spotify URLs so we can clean them for LavaSrc
const LOCALE_REGEX = /spotify\.com\/[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\//;
const SPOTIFY_URL = /spotify\.com\//;
const URL_REGEX = /^https?:\/\//;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song, album or playlist from YouTube or Spotify.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, YouTube URL, or Spotify link')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        await interaction.deferReply();

        const query = interaction.options.getString('query').trim();
        const member = interaction.member;

        if (!member.voice.channelId) {
            return interaction.editReply({ embeds: [errorEmbed('You must be in a voice channel to use this command.')] });
        }

        const botVoiceChannel = interaction.guild.members.me.voice.channelId;
        if (botVoiceChannel && botVoiceChannel !== member.voice.channelId) {
            return interaction.editReply({ embeds: [errorEmbed('I am already playing in another voice channel.')] });
        }

        if (!client.manager) {
            return interaction.editReply({ embeds: [errorEmbed('The music system is starting up. Please wait a few seconds and try again!')] });
        }

        // ── Helper: get or create a player ────────────────────────────────────
        const getPlayer = async () => {
            let player = client.manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = await client.manager.createPlayer({
                    guildId: interaction.guild.id,
                    textId: interaction.channel.id,
                    voiceId: member.voice.channelId
                });
            }
            return player;
        };

        // ── UNSUPPORTED SPOTIFY LINKS (Liked Songs, etc.) ─────────────────────
        if (query.includes('spotify.com/collection') || query.includes('spotify.com/user')) {
            return interaction.editReply({ embeds: [errorEmbed('"Liked Songs" and private user collections cannot be loaded because Spotify does not allow external apps to read them. Please share a **public playlist** instead!')] });
        }

        // ── SINGLE SPOTIFY TRACK / YOUTUBE / SEARCH ───────────────────────────
        try {
            const player = await getPlayer();

            // Build the resolve query:
            // - Spotify URLs: send raw so LavaSrc plugin can handle them
            // - Other URLs: send raw (YouTube, SoundCloud, etc.)
            // - Plain text: use ytsearch prefix
            let resolveQuery = query;

            if (SPOTIFY_URL.test(query)) {
                // LavaSrc regex fails on regional URLs like /intl-ar/, so we must strip it out
                if (LOCALE_REGEX.test(query)) {
                    resolveQuery = query.replace(LOCALE_REGEX, 'spotify.com/');
                }
            } else if (!URL_REGEX.test(query)) {
                resolveQuery = `ytsearch:${query}`; // Plain text search
            }

            const result = await client.manager.resolve(resolveQuery, interaction.user);

            if (!result || !result.tracks.length) {
                return interaction.editReply({ embeds: [errorEmbed('No results found. If you used a Spotify link, make sure your Spotify credentials are set in Dockge .env!')] });
            }

            if (result.type === 'playlist') {
                for (const track of result.tracks) player.queue.push(track);
                interaction.editReply({ embeds: [successEmbed(`Added **${result.tracks.length}** tracks from **${result.playlistName}** to the queue.`)] });
            } else {
                const track = result.tracks[0];
                player.queue.push(track);
                interaction.editReply({ embeds: [successEmbed(`Added [**${track.info.title}**](${track.info.uri}) to the queue.`)] });
            }

            if (!player.current) player.playNext();

        } catch (err) {
            console.error('[Play] Error:', err);
            const msg = err.message || 'Something went wrong while looking up the track.';
            interaction.editReply({ embeds: [errorEmbed(`An error occurred while trying to play the track:\n\`${msg}\``)] });
        }
    }
};
