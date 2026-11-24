const { SlashCommandBuilder, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');
const { errorEmbed, successEmbed, buildEmbed } = require('../utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure per-server music settings (Manage Server required).')
        .addSubcommand(sub =>
            sub.setName('view').setDescription('View current server settings.')
        )
        .addSubcommand(sub =>
            sub.setName('djrole')
                .setDescription('Set or clear the DJ role.')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to grant DJ permissions (omit to clear)'))
        )
        .addSubcommand(sub =>
            sub.setName('volume')
                .setDescription('Set default volume for new players (1-200).')
                .addIntegerOption(opt => opt.setName('level').setDescription('Default volume').setRequired(true).setMinValue(1).setMaxValue(200))
        )
        .addSubcommand(sub =>
            sub.setName('equalizer')
                .setDescription('Set default equalizer preset for this server.')
                .addStringOption(opt =>
                    opt.setName('preset')
                        .setDescription('Equalizer preset')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Flat', value: 'flat' },
                            { name: 'Rich', value: 'rich' },
                            { name: 'Bass Boost', value: 'bass_boost' },
                            { name: 'Deep Bass', value: 'deep_bass' },
                            { name: 'Vocal', value: 'vocal' },
                            { name: 'Treble', value: 'treble' },
                            { name: 'Rock', value: 'rock' },
                            { name: 'Pop', value: 'pop' },
                            { name: 'Electronic', value: 'electronic' },
                            { name: 'Night Mode', value: 'night_mode' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('maxqueue')
                .setDescription('Set maximum queue size (10-5000).')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Max queued tracks').setRequired(true).setMinValue(10).setMaxValue(5000))
        )
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Restrict music commands to one text channel (omit to allow all channels).')
                .addChannelOption(opt =>
                    opt.setName('target')
                        .setDescription('Text channel for music commands')
                        .addChannelTypes(ChannelType.GuildText)
                )
        )
        .addSubcommand(sub =>
            sub.setName('idletimeout')
                .setDescription('Set idle disconnect timeout in seconds (10-3600).')
                .addIntegerOption(opt => opt.setName('seconds').setDescription('Idle timeout in seconds').setRequired(true).setMinValue(10).setMaxValue(3600))
        ),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();
        const db = client.manager.db;

        if (sub === 'view') {
            const s = db.getGuildSettings(interaction.guild.id);
            return interaction.reply({
                embeds: [buildEmbed({
                    color: '#10b981',
                    title: `⚙️ Settings for ${interaction.guild.name}`,
                    fields: [
                        { name: 'DJ Role', value: s.dj_role_id ? `<@&${s.dj_role_id}>` : '`None (Everyone)`', inline: true },
                        { name: 'Default Volume', value: `\`${s.default_volume}%\``, inline: true },
                        { name: 'Default EQ', value: `\`${s.default_equalizer}\``, inline: true },
                        { name: 'Max Queue Size', value: `\`${s.max_queue_size}\``, inline: true },
                        { name: 'Autoplay', value: `\`${s.autoplay ? 'On' : 'Off'}\``, inline: true },
                        { name: '24/7 Mode', value: `\`${s.mode_247 ? 'On' : 'Off'}\``, inline: true },
                        { name: 'Allowed Channel', value: s.allowed_channel_id ? `<#${s.allowed_channel_id}>` : '`Any`', inline: true },
                        { name: 'Idle Timeout', value: `\`${Math.round(s.idle_timeout_ms / 1000)}s\``, inline: true }
                    ]
                })]
            });
        }

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ embeds: [errorEmbed('You need the **Manage Server** permission to change settings.')], flags: MessageFlags.Ephemeral });
        }

        switch (sub) {
            case 'djrole': {
                const role = interaction.options.getRole('role');
                db.updateGuildSettings(interaction.guild.id, { dj_role_id: role ? role.id : null });
                return interaction.reply({ embeds: [successEmbed(role ? `🎧 DJ role set to <@&${role.id}>.` : '🎧 DJ role cleared.')] });
            }
            case 'volume': {
                const level = interaction.options.getInteger('level');
                db.updateGuildSettings(interaction.guild.id, { default_volume: level });
                return interaction.reply({ embeds: [successEmbed(`🔊 Default volume set to **${level}%**.`)] });
            }
            case 'equalizer': {
                const preset = interaction.options.getString('preset');
                db.updateGuildSettings(interaction.guild.id, { default_equalizer: preset });
                return interaction.reply({ embeds: [successEmbed(`🎚️ Default equalizer set to **${preset}**.`)] });
            }
            case 'maxqueue': {
                const limit = interaction.options.getInteger('limit');
                db.updateGuildSettings(interaction.guild.id, { max_queue_size: limit });
                const player = client.manager.getPlayer(interaction.guild.id);
                if (player) player.maxQueueSize = limit;
                return interaction.reply({ embeds: [successEmbed(`📋 Max queue size set to **${limit}**.`)] });
            }
            case 'channel': {
                const ch = interaction.options.getChannel('target');
                db.updateGuildSettings(interaction.guild.id, { allowed_channel_id: ch ? ch.id : null });
                return interaction.reply({ embeds: [successEmbed(ch ? `💬 Music commands restricted to <#${ch.id}>.` : '💬 Channel restriction cleared.')] });
            }
            case 'idletimeout': {
                const sec = interaction.options.getInteger('seconds');
                db.updateGuildSettings(interaction.guild.id, { idle_timeout_ms: sec * 1000 });
                const player = client.manager.getPlayer(interaction.guild.id);
                if (player) player.idleTimeoutMs = sec * 1000;
                return interaction.reply({ embeds: [successEmbed(`⏱️ Idle timeout set to **${sec}s**.`)] });
            }
        }
    }
};
