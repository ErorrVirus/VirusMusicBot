require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
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

client.once('ready', () => {
    console.log(`✅ [Bot] Logged in as ${client.user.tag}`);
    client.user.setActivity({
        type: ActivityType.Custom,
        name: 'custom',
        state: 'Coded by ErorrVirus 💻'
    });
});

// Initialize Music Manager
client.manager = new MusicManager(client);

// Load Handlers
require('./handlers/eventHandler')(client);

client.login(config.discord.token);
