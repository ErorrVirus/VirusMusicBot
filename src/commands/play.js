const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from YouTube or Spotify')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The URL or search query')
                .setRequired(true)
        ),
    async execute(interaction, client) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        const checks = require('../utils/checks');

        if (await checks.checkBlacklist(member.user.id, interaction.guild.id)) {
            return interaction.reply({ content: 'You or this server are blacklisted from using this bot.', ephemeral: true });
        }

        if (!(await checks.checkDJ(member))) {
            return interaction.reply({ content: 'You must have the DJ role to play music!', ephemeral: true });
        }

        if (!member.voice.channelId) {
            return interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
        }

        const botVoiceChannel = interaction.guild.members.me.voice.channelId;
        if (botVoiceChannel && botVoiceChannel !== member.voice.channelId) {
            return interaction.reply({ content: 'I am already playing in another voice channel!', ephemeral: true });
        }

        await interaction.deferReply();

        let player = client.manager.players.get(interaction.guild.id);
        if (!player) {
            try {
                player = await client.manager.createPlayer({
                    guildId: interaction.guild.id,
                    textId: interaction.channel.id,
                    voiceId: member.voice.channelId,
                    volume: 100,
                    deaf: true,
                    mute: false
                });
            } catch (err) {
                return interaction.followUp({ content: `Failed to create player: ${err.message}` });
            }
        }

        try {
            const res = await client.manager.search(query, { requester: member.user });
            
            if (!res || !res.tracks.length) {
                return interaction.followUp({ content: 'No results found!' });
            }

            if (res.type === 'PLAYLIST') {
                for (const track of res.tracks) {
                    player.queue.add(track);
                }
                interaction.followUp({ content: `🎵 Added playlist **${res.playlistName}** (${res.tracks.length} tracks) to the queue.` });
            } else {
                const track = res.tracks[0];
                player.queue.add(track);
                interaction.followUp({ content: `🎵 Added **${track.title}** to the queue.` });
            }

            if (!player.playing && !player.paused) {
                player.play();
            }
            
        } catch (error) {
            console.error(error);
            interaction.followUp({ content: `An error occurred while searching: ${error.message}` });
        }
    }
};
