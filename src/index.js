const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const MusicManager = require('./structures/MusicManager');

// Validate environment variables
config.validate();

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
