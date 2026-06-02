const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || 'postgresql://virusmusic:youshallnotpass@127.0.0.1:5432/virusmusic',
});

pool.on('error', (err, client) => {
    console.error('[Database] Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    
    // Auto-initialize DB Schema
    init: async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id VARCHAR(32) PRIMARY KEY,
                announce_channel VARCHAR(32),
                volume INT DEFAULT 100,
                twenty_four_seven BOOLEAN DEFAULT FALSE,
                dj_role_id VARCHAR(32)
            );
            CREATE TABLE IF NOT EXISTS music_queue_state (
                guild_id VARCHAR(32) PRIMARY KEY,
                voice_channel_id VARCHAR(32) NOT NULL,
                text_channel_id VARCHAR(32) NOT NULL,
                current_track JSONB,
                queue JSONB DEFAULT '[]'::jsonb
            );
            CREATE TABLE IF NOT EXISTS play_history (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(32) NOT NULL,
                user_id VARCHAR(32) NOT NULL,
                track_title TEXT NOT NULL,
                track_uri TEXT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS blacklist (
                entity_id VARCHAR(32) PRIMARY KEY,
                type VARCHAR(10) NOT NULL,
                reason TEXT,
                blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS premium_guilds (
                guild_id VARCHAR(32) PRIMARY KEY,
                granted_by VARCHAR(32),
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('[Database] Schema verified successfully.');
    },

    // Helper to initialize guild settings
    initGuild: async (guildId) => {
        await pool.query(
            `INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
            [guildId]
        );
    },

    // Queue Persistence
    saveQueueState: async (guildId, voiceChannelId, textChannelId, currentTrack, queue) => {
        const query = `
            INSERT INTO music_queue_state (guild_id, voice_channel_id, text_channel_id, current_track, queue)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id) DO UPDATE 
            SET voice_channel_id = EXCLUDED.voice_channel_id,
                text_channel_id = EXCLUDED.text_channel_id,
                current_track = EXCLUDED.current_track,
                queue = EXCLUDED.queue
        `;
        await pool.query(query, [guildId, voiceChannelId, textChannelId, currentTrack, JSON.stringify(queue)]);
    },

    getQueueState: async (guildId) => {
        const res = await pool.query(`SELECT * FROM music_queue_state WHERE guild_id = $1`, [guildId]);
        return res.rows[0];
    },

    clearQueueState: async (guildId) => {
        await pool.query(`DELETE FROM music_queue_state WHERE guild_id = $1`, [guildId]);
    }
};
