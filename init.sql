-- init.sql
-- PostgreSQL Schema for VirusMusicPro

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
    type VARCHAR(10) NOT NULL, -- 'user' or 'guild'
    reason TEXT,
    blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS premium_guilds (
    guild_id VARCHAR(32) PRIMARY KEY,
    granted_by VARCHAR(32),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
