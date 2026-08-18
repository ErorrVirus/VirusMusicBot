const { ActivityType } = require('discord.js');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`✅ [Bot] Logged in as ${client.user.tag}`);
        client.user.setActivity('ready to play any song', { type: ActivityType.Playing });

        // Load commands
        require('../handlers/commandHandler')(client);

        // Start Developer Dashboard
        try {
            require('../web/server')(client);
        } catch (err) {
            console.error('[Dashboard] Failed to start:', err.message);
        }
    }
};
