const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');
const { checkBotVoicePermissions } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('artist')
        .setDescription('Play popular songs from an artist name or supported artist URL.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Artist name or artist URL')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        await interaction.deferReply();

        const query = interaction.options.getString('query').trim();
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.editReply({ embeds: [errorEmbed('You must be in a voice channel to use this command.')] });
        }

        const botVoiceId = interaction.guild.members.me?.voice?.channelId;
        if (botVoiceId && botVoiceId !== voiceChannel.id) {
            return interaction.editReply({ embeds: [errorEmbed('I am already playing in another voice channel.')] });
        }

        const permError = checkBotVoicePermissions(interaction.guild, voiceChannel);
        if (permError) {
            return interaction.editReply({ embeds: [errorEmbed(permError)] });
        }

        const result = await client.manager.resolver.searchArtist(query, interaction.user);
        let tracksToQueue = result.tracks;
        let label = result.playlistName || query;

        // If multiple distinct artists matched, present selection menu
        if ((!tracksToQueue || !tracksToQueue.length) && result.artists && result.artists.length > 1) {
            const options = result.artists.map((a, idx) => ({
                label: a.name.slice(0, 100),
                description: `${a.tracks.length} matching popular track(s)`.slice(0, 100),
                value: String(idx)
            }));

            const select = new StringSelectMenuBuilder()
                .setCustomId(`artist_select:${interaction.id}`)
                .setPlaceholder('Choose the artist you meant')
                .addOptions(options);

            const msg = await interaction.editReply({
                embeds: [buildEmbed({
                    title: `🎤 Multiple Artists Found for "${query.slice(0, 80)}"`,
                    description: result.artists.map((a, i) => `**${i + 1}.** ${a.name} (${a.tracks.length} tracks)`).join('\n'),
                    footer: { text: 'Select an artist within 30 seconds.' }
                })],
                components: [new ActionRowBuilder().addComponents(select)]
            });

            try {
                const picked = await msg.awaitMessageComponent({
                    componentType: ComponentType.StringSelect,
                    filter: i => i.user.id === interaction.user.id && i.customId === `artist_select:${interaction.id}`,
                    time: 30000
                });
                await picked.deferUpdate();
                const selectedArtist = result.artists[parseInt(picked.values[0], 10)];
                if (!selectedArtist) {
                    return interaction.editReply({ embeds: [errorEmbed('Invalid artist selection.')], components: [] });
                }

                // Fetch fuller popular tracks for the selected artist
                const deepSearch = await client.manager.resolver.resolveRaw(`ytmsearch:${selectedArtist.name}`, interaction.user, {
                    query: selectedArtist.name,
                    expectedArtist: selectedArtist.name,
                    limit: 10
                }).catch(() => null);

                tracksToQueue = deepSearch?.tracks?.length ? deepSearch.tracks : selectedArtist.tracks;
                label = `${selectedArtist.name} — Popular Tracks`;
            } catch (_) {
                return interaction.editReply({
                    embeds: [buildEmbed({ description: '⏱️ Artist selection timed out.' })],
                    components: []
                }).catch(() => {});
            }
        }

        if (!tracksToQueue || !tracksToQueue.length) {
            return interaction.editReply({ embeds: [errorEmbed('No tracks found for that artist.')], components: [] });
        }

        const player = await client.manager.createPlayer({
            guildId: interaction.guild.id,
            textId: interaction.channel.id,
            voiceId: voiceChannel.id
        });
        const { added } = await player.enqueueTracks(tracksToQueue, { playIfIdle: true });

        return interaction.editReply({
            embeds: [successEmbed(`🎤 Queued **${added}** track(s) for **${label}**.`)],
            components: []
        });
    }
};
