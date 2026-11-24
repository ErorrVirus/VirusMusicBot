const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');

let initialized = false;

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        if (initialized) {
            logger.warn('Ready', 'clientReady fired more than once; skipping duplicate initialization.');
            return;
        }
        initialized = true;

        logger.info('Bot', `Logged in as ${client.user.tag}`, { guildCount: client.guilds.cache.size });
        client.user.setActivity('ready to play any song', { type: ActivityType.Playing });

        try {
            await require('../handlers/commandHandler')(client);
        } catch (err) {
            logger.error('CommandHandler', 'Failed to initialize commands', { err });
        }

        try {
            client.dashboard = require('../web/server')(client);
        } catch (err) {
            logger.error('Dashboard', 'Failed to start dashboard', { err });
        }
    }
};
