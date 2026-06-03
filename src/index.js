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

// Initialize Music Manager after a short delay to let Lavalink boot
setTimeout(() => {
    client.manager = new MusicManager(client);
}, 10000);

// Load Handlers
require('./handlers/eventHandler')(client);

client.login(config.discord.token);
