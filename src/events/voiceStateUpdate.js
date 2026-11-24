const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState, client) {
        if (!client.user || oldState.id !== client.user.id) return;

        const guildId = oldState.guild.id;
        const player = client.manager?.getPlayer(guildId);
        if (!player || player.isDestroyed()) return;

        // Bot was disconnected from voice channel (manually kicked or disconnected)
        if (oldState.channelId && !newState.channelId) {
            logger.info('VoiceState', 'Bot manually disconnected from voice channel; destroying player', {
                guildId,
                oldChannelId: oldState.channelId
            });
            await player.destroy('Manual disconnect by user via Discord UI');
            return;
        }

        // Bot was moved to a different voice channel
        if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            logger.info('VoiceState', 'Bot moved to a different voice channel', {
                guildId,
                from: oldState.channelId,
                to: newState.channelId
            });
            player.voiceId = newState.channelId;
        }
    }
};
