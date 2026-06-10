const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');
const { getPlaylistTracks, getAlbumTracks, getArtistTracks, toSearchQuery } = require('../utils/spotifyHelper');

// Detect localized Spotify URLs so we can clean them for LavaSrc
const LOCALE_REGEX = /spotify\.com\/[a-zA-Z]{2}(?:-[a-zA-Z0-9]+)?\//;
const SPOTIFY_URL = /spotify\.com\//;
const URL_REGEX = /^https?:\/\//;

const SPOTIFY_PLAYLIST = /open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/;
const SPOTIFY_ALBUM    = /open\.spotify\.com\/album\/([A-Za-z0-9]+)/;
const SPOTIFY_ARTIST   = /open\.spotify\.com\/artist\/([A-Za-z0-9]+)/;
const SPOTIFY_TRACK    = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;

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

        let query = interaction.options.getString('query').trim();
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

        // Clean localized URLs
        if (SPOTIFY_URL.test(query) && LOCALE_REGEX.test(query)) {
            query = query.replace(LOCALE_REGEX, 'spotify.com/');
        }

        // ── SPOTIFY PLAYLIST ──────────────────────────────────────────────────
        const playlistMatch = query.match(SPOTIFY_PLAYLIST);
        if (playlistMatch) {
            try {
                const player = await getPlayer();
                await interaction.editReply({ embeds: [buildEmbed({ description: '🔍 Fetching playlist from Spotify...' })] });

                const { name, tracks } = await getPlaylistTracks(playlistMatch[1]);

                if (!tracks.length) {
                    return interaction.editReply({ embeds: [errorEmbed('Could not load the playlist. Make sure it is **public** on Spotify!')] });
                }

                for (const t of tracks) {
                    player.queue.push({ isUnresolved: true, title: t.name, artist: t.artist });
                }
                interaction.editReply({ embeds: [successEmbed(`📋 Added **${tracks.length}** tracks from **${name}** to the queue.`)] });
                if (!player.current) player.playNext();
            } catch (err) {
                console.error('[Play] Spotify playlist error:', err);
                interaction.editReply({ embeds: [errorEmbed(`Failed to load playlist:\n\`${err.message}\``)] });
            }
            return;
        }

        // ── SPOTIFY ALBUM ─────────────────────────────────────────────────────
        const albumMatch = query.match(SPOTIFY_ALBUM);
        if (albumMatch) {
            try {
                const player = await getPlayer();
                await interaction.editReply({ embeds: [buildEmbed({ description: '🔍 Fetching album from Spotify...' })] });

                const { name, tracks } = await getAlbumTracks(albumMatch[1]);

                if (!tracks.length) {
                    return interaction.editReply({ embeds: [errorEmbed('Could not load the album. Is the Spotify link correct?')] });
                }

                for (const t of tracks) {
                    player.queue.push({ isUnresolved: true, title: t.name, artist: t.artist });
                }
                interaction.editReply({ embeds: [successEmbed(`💿 Added **${tracks.length}** tracks from **${name}** to the queue.`)] });
                if (!player.current) player.playNext();
            } catch (err) {
                console.error('[Play] Spotify album error:', err);
                interaction.editReply({ embeds: [errorEmbed(`Failed to load album:\n\`${err.message}\``)] });
            }
            return;
        }

        // ── SPOTIFY ARTIST ────────────────────────────────────────────────────
        const artistMatch = query.match(SPOTIFY_ARTIST);
        if (artistMatch) {
            try {
                const player = await getPlayer();
                await interaction.editReply({ embeds: [buildEmbed({ description: '🔍 Fetching artist top tracks from Spotify...' })] });

                const { name, tracks } = await getArtistTracks(artistMatch[1]);

                if (!tracks.length) {
                    return interaction.editReply({ embeds: [errorEmbed('Could not load the artist top tracks. Is the Spotify link correct?')] });
                }

                for (const t of tracks) {
                    player.queue.push({ isUnresolved: true, title: t.name, artist: t.artist });
                }
                interaction.editReply({ embeds: [successEmbed(`🎤 Added **${tracks.length}** top tracks from **${name}** to the queue.`)] });
                if (!player.current) player.playNext();
            } catch (err) {
                console.error('[Play] Spotify artist error:', err);
                interaction.editReply({ embeds: [errorEmbed(`Failed to load artist tracks:\n\`${err.message}\``)] });
            }
            return;
        }

        // ── UNSUPPORTED SPOTIFY LINKS (Liked Songs, etc.) ─────────────────────
        if (query.includes('spotify.com/collection') || query.includes('spotify.com/user')) {
            return interaction.editReply({ embeds: [errorEmbed('"Liked Songs" and private user collections cannot be loaded because Spotify does not allow external apps to read them. Please share a **public playlist** instead!')] });
        }

        // ── SINGLE SPOTIFY TRACK / YOUTUBE / SEARCH ───────────────────────────
        try {
            const player = await getPlayer();

            let resolveQuery = query;

            if (SPOTIFY_URL.test(query)) {
                // If it's a Spotify track, let LavaSrc try. If LavaSrc timed out, they can use names.
                // We will convert Spotify track to ytsearch string to bypass LavaSrc TCP timeout!
                if (SPOTIFY_TRACK.test(query)) {
                    try {
                        const { getData } = require('spotify-url-info')(fetch);
                        const data = await getData(query);
                        const trackName = data?.title || data?.name || '';
                        const artist = data?.subtitle || data?.artists?.[0]?.name || '';
                        resolveQuery = `ytsearch:${trackName} ${artist} audio`;
                    } catch {
                        resolveQuery = query;
                    }
                }
            } else if (!URL_REGEX.test(query)) {
                resolveQuery = `ytsearch:${query}`; // Plain text search
            }

            const result = await client.manager.resolve(resolveQuery, interaction.user);

            if (!result || !result.tracks.length) {
                return interaction.editReply({ embeds: [errorEmbed('No results found. If you used a Spotify link, Spotify might be blocking your server. Try searching by song name instead!')] });
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
