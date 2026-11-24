const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');
const { checkBotVoicePermissions } = require('../utils/permissions');
const { getTrackTitle, getTrackArtist, formatTrackDuration, formatTrackLink } = require('../utils/trackUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for songs and choose from interactive results.')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title or artist to search')
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

        const res = await client.manager.resolver.searchText(query, interaction.user, { limit: 8 });
        if (!res || !res.tracks.length) {
            return interaction.editReply({ embeds: [errorEmbed('No matching songs found.')] });
        }

        const choices = res.tracks.slice(0, 8);
        const options = choices.map((t, index) => ({
            label: getTrackTitle(t).slice(0, 100),
            description: `${getTrackArtist(t)} · ${formatTrackDuration(t)}`.slice(0, 100),
            value: String(index)
        }));

        const select = new StringSelectMenuBuilder()
            .setCustomId(`search_select:${interaction.id}`)
            .setPlaceholder('Select a track to play')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);
        const listText = choices.map((t, i) => `**${i + 1}.** ${formatTrackLink(t)} — *${getTrackArtist(t)}* \`[${formatTrackDuration(t)}]\``).join('\n');

        const replyMsg = await interaction.editReply({
            embeds: [buildEmbed({
                title: `🔍 Search Results for "${query.slice(0, 80)}"`,
                description: listText,
                footer: { text: 'Select a track within 30 seconds.' }
            })],
            components: [row]
        });

        try {
            const picked = await replyMsg.awaitMessageComponent({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === `search_select:${interaction.id}`,
                time: 30000
            });

            await picked.deferUpdate();
            const chosen = choices[parseInt(picked.values[0], 10)];
            if (!chosen) {
                return interaction.editReply({ embeds: [errorEmbed('Invalid selection.')], components: [] });
            }

            const player = await client.manager.createPlayer({
                guildId: interaction.guild.id,
                textId: interaction.channel.id,
                voiceId: voiceChannel.id
            });
            await player.enqueueTracks([chosen], { playIfIdle: true });

            return interaction.editReply({
                embeds: [successEmbed(`Added ${formatTrackLink(chosen, true)} \`[${formatTrackDuration(chosen)}]\` to the queue.`)],
                components: []
            });
        } catch (_) {
            await interaction.editReply({
                embeds: [buildEmbed({ description: '⏱️ Search selection timed out.' })],
                components: []
            }).catch(() => {});
        }
    }
};
