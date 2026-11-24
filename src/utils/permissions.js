const { PermissionsBitField, MessageFlags } = require('discord.js');
const { errorEmbed } = require('./embedBuilder');

/**
 * Validates that the bot has permissions to view, connect, and speak in the target voice channel.
 */
function checkBotVoicePermissions(guild, voiceChannel) {
    if (!guild || !voiceChannel) {
        return 'Voice channel not found.';
    }
    const me = guild.members.me;
    if (!me) return 'Bot guild member context is unavailable.';

    const perms = voiceChannel.permissionsFor(me);
    if (!perms) return 'Unable to inspect permissions for that voice channel.';

    const missing = [];
    if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missing.push('View Channel');
    if (!perms.has(PermissionsBitField.Flags.Connect)) missing.push('Connect');
    if (!perms.has(PermissionsBitField.Flags.Speak)) missing.push('Speak');

    if (missing.length > 0) {
        return `I am missing the following permission(s) in **${voiceChannel.name}**: **${missing.join(', ')}**.`;
    }

    if (voiceChannel.full && !me.voice?.channelId && !perms.has(PermissionsBitField.Flags.MoveMembers)) {
        return `Voice channel **${voiceChannel.name}** is full.`;
    }

    return null;
}

/**
 * Checks whether the guild has restricted music commands to a specific text channel.
 */
function checkAllowedTextChannel(interaction, db) {
    if (!db || !interaction.guildId) return null;
    const settings = db.getGuildSettings(interaction.guildId);
    if (settings.allowed_channel_id && interaction.channelId !== settings.allowed_channel_id) {
        return `Music commands are restricted to <#${settings.allowed_channel_id}>.`;
    }
    return null;
}

/**
 * Checks DJ permissions for control/queue-mutating actions.
 * Allowed if:
 *  - No DJ role is configured
 *  - User has Administrator or ManageGuild
 *  - User has the configured DJ role
 *  - User is alone in the bot's voice channel
 */
function checkDjPermission(interaction, client) {
    const db = client.manager?.db;
    if (!db || !interaction.guild || !interaction.member) return null;

    const settings = db.getGuildSettings(interaction.guild.id);
    if (!settings.dj_role_id) return null;

    const member = interaction.member;
    if (
        member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions?.has(PermissionsBitField.Flags.ManageGuild)
    ) {
        return null;
    }

    if (member.roles?.cache?.has(settings.dj_role_id)) {
        return null;
    }

    // Allow solo listeners in the voice channel to control playback
    const voiceChannel = member.voice?.channel;
    if (voiceChannel) {
        const nonBotMembers = voiceChannel.members.filter(m => !m.user.bot).size;
        if (nonBotMembers <= 1) return null;
    }

    return `You need the <@&${settings.dj_role_id}> role (or Manage Server) to use this control.`;
}

function ephemeralError(message) {
    return { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral };
}

module.exports = {
    checkBotVoicePermissions,
    checkAllowedTextChannel,
    checkDjPermission,
    ephemeralError
};
