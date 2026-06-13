const { Events } = require('discord.js');

module.exports = {
    name: Events.VoiceStateUpdate,
    execute(oldState, newState, client) {
        console.log(`[voiceStateUpdate] Triggered for user: ${oldState.id}, oldChannel: ${oldState.channelId}, newChannel: ${newState.channelId}`);
        // Check if the bot was the one who got disconnected
        if (oldState.id === client.user.id && oldState.channelId && !newState.channelId) {
            console.log(`[voiceStateUpdate] Bot was disconnected manually!`);
            const player = client.manager.getPlayer(oldState.guild.id);
            if (player) {
                console.log(`[voiceStateUpdate] Found player for guild ${oldState.guild.id}. Destroying it...`);
                // The bot was disconnected manually! Destroy the player to stop the loop and embeds.
                player.destroy('Manual disconnect by user via Discord UI');
            } else {
                console.log(`[voiceStateUpdate] No player found for guild ${oldState.guild.id}.`);
            }
        }
    }
};
