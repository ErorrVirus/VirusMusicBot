require('dotenv').config();
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const { setGlobalDispatcher, Agent } = require('undici');
setGlobalDispatcher(new Agent({
    keepAliveTimeout: 10000,
    keepAliveMaxTimeout: 30000,
    connect: { timeout: 10000 }
}));

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');
const MusicManager = require('./structures/MusicManager');

config.validate();

let isShuttingDown = false;
const HEARTBEAT_FILE = process.env.HEALTHCHECK_FILE || path.join(os.tmpdir(), 'virusmusic-health.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.manager = new MusicManager(client);
require('./handlers/eventHandler')(client);

function writeHeartbeat() {
    if (isShuttingDown) return;
    try {
        const payload = {
            ts: Date.now(),
            discordReady: client.isReady(),
            lavalinkReady: Boolean(client.manager && client.manager.getIdealNode())
        };
        fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(payload), 'utf8');
    } catch (_) {
        // Non-fatal if temp directory is unavailable
    }
}

const heartbeatTimer = setInterval(writeHeartbeat, 15000);
if (heartbeatTimer.unref) heartbeatTimer.unref();
client.once('clientReady', writeHeartbeat);
client.manager.shoukaku.on('ready', writeHeartbeat);

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearInterval(heartbeatTimer);
    try { fs.unlinkSync(HEARTBEAT_FILE); } catch (_) {}
    logger.info('Process', `Received ${signal}; starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
        logger.error('Process', 'Graceful shutdown timed out; forcing exit.');
        process.exit(1);
    }, 10000);
    if (forceTimer.unref) forceTimer.unref();

    try {
        if (client.dashboard && typeof client.dashboard.close === 'function') {
            await new Promise(resolve => client.dashboard.close(() => resolve()));
        }
        await client.manager.shutdown();
        client.destroy();
        logger.info('Process', 'Graceful shutdown complete.');
        process.exit(0);
    } catch (err) {
        logger.error('Process', 'Error during graceful shutdown', { err });
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    logger.error('Process', 'Unhandled Promise Rejection', { err: reason });
});

process.on('uncaughtException', (err) => {
    logger.error('Process', 'Uncaught Exception', { err });
});

client.login(config.discord.token);
