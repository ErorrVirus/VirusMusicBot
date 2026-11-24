require('dotenv').config();
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID,
        guildId: process.env.GUILD_ID || null
    },
    lavalink: {
        name: 'Primary Node',
        url: `${process.env.LAVALINK_HOST || 'localhost'}:${process.env.LAVALINK_PORT || 2333}`,
        auth: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE === 'true'
    },
    dashboard: {
        enabled: process.env.DASHBOARD_ENABLED === 'true',
        port: Number(process.env.DASHBOARD_PORT || 4000),
        user: process.env.DASHBOARD_USER || '',
        pass: process.env.DASHBOARD_PASS || '',
        passHash: process.env.DASHBOARD_PASS_HASH || '',
        jwtSecret: process.env.DASHBOARD_JWT_SECRET || '',
        trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : (process.env.TRUST_PROXY || false),
        sslCrtPath: process.env.SSL_CRT_PATH || '',
        sslKeyPath: process.env.SSL_KEY_PATH || ''
    },
    playback: {
        voiceReadyTimeoutMs: Number(process.env.VOICE_READY_TIMEOUT_MS || 10000),
        maxTrackRetries: Number(process.env.MAX_TRACK_RETRIES || 2),
        maxConsecutiveFailures: Number(process.env.MAX_CONSECUTIVE_FAILURES || 5),
        idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS || 60000)
    },
    validate() {
        if (!this.discord.token) throw new Error('DISCORD_TOKEN is missing from environment variables.');
        if (!this.discord.clientId) throw new Error('CLIENT_ID is missing from environment variables.');
        if (!this.lavalink.auth) throw new Error('LAVALINK_PASSWORD is missing from environment variables.');
        const jwtSecret = this.dashboard.jwtSecret;
        if (jwtSecret && jwtSecret.length < 32) {
            throw new Error('DASHBOARD_JWT_SECRET must be at least 32 characters long for security.');
        }
    }
};
