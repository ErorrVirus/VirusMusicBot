require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID,
        guildId: process.env.GUILD_ID // Optional
    },
    lavalink: {
        name: 'Primary Node',
        url: `${process.env.LAVALINK_HOST || 'localhost'}:${process.env.LAVALINK_PORT || 2333}`,
        auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: false
    },
    validate() {
        if (!this.discord.token) throw new Error('DISCORD_TOKEN is missing from environment variables.');
        if (!this.discord.clientId) throw new Error('CLIENT_ID is missing from environment variables.');
    }
};
