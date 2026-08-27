require('dotenv').config();
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const { setGlobalDispatcher, Agent } = require('undici');
setGlobalDispatcher(new Agent({
    keepAliveTimeout: 10000,
    keepAliveMaxTimeout: 30000,
    connect: { timeout: 10000 }
}));

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const MusicManager = require('./structures/MusicManager');

// Validate environment variables
config.validate();

// Global Error Handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize Music Manager
client.manager = new MusicManager(client);

// Load Handlers
require('./handlers/eventHandler')(client);

client.login(config.discord.token);
