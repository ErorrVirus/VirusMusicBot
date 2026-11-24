const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const logger = require('../utils/logger');
const { serializeTrack, deserializeTrack, getTrackIdentifier } = require('../utils/trackUtils');

const DEFAULT_GUILD_SETTINGS = {
    dj_role_id: null,
    default_volume: 100,
    default_equalizer: 'flat',
    max_queue_size: 500,
    autoplay: 0,
    mode_247: 0,
    allowed_channel_id: null,
    idle_timeout_ms: 60000
};

class DatabaseService {
    constructor(dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'virusmusic.db')) {
        this.dbPath = dbPath;
        if (dbPath !== ':memory:') {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA foreign_keys = ON;');
        this._initSchema();
        logger.info('Database', `SQLite initialized at ${dbPath}`);
    }

    _initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                dj_role_id TEXT,
                default_volume INTEGER NOT NULL DEFAULT 100,
                default_equalizer TEXT NOT NULL DEFAULT 'flat',
                max_queue_size INTEGER NOT NULL DEFAULT 500,
                autoplay INTEGER NOT NULL DEFAULT 0,
                mode_247 INTEGER NOT NULL DEFAULT 0,
                allowed_channel_id TEXT,
                idle_timeout_ms INTEGER NOT NULL DEFAULT 60000,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS saved_queues (
                guild_id TEXT PRIMARY KEY,
                current_json TEXT,
                queue_json TEXT NOT NULL,
                loop_mode TEXT NOT NULL DEFAULT 'none',
                volume INTEGER NOT NULL DEFAULT 100,
                preset TEXT NOT NULL DEFAULT 'flat',
                autoplay INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id TEXT NOT NULL,
                track_key TEXT NOT NULL,
                track_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, track_key)
            );

            CREATE TABLE IF NOT EXISTS listening_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT,
                track_key TEXT NOT NULL,
                track_json TEXT NOT NULL,
                played_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_guild_time ON listening_history (guild_id, played_at DESC);

            CREATE TABLE IF NOT EXISTS custom_playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE (user_id, name)
            );

            CREATE TABLE IF NOT EXISTS custom_playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                track_json TEXT NOT NULL,
                FOREIGN KEY (playlist_id) REFERENCES custom_playlists(id) ON DELETE CASCADE
            );
        `);
    }

    getGuildSettings(guildId) {
        const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
        if (!row) return { guild_id: guildId, ...DEFAULT_GUILD_SETTINGS };
        return {
            guild_id: row.guild_id,
            dj_role_id: row.dj_role_id,
            default_volume: row.default_volume,
            default_equalizer: row.default_equalizer,
            max_queue_size: row.max_queue_size,
            autoplay: Boolean(row.autoplay),
            mode_247: Boolean(row.mode_247),
            allowed_channel_id: row.allowed_channel_id,
            idle_timeout_ms: row.idle_timeout_ms
        };
    }

    updateGuildSettings(guildId, patch) {
        const current = this.getGuildSettings(guildId);
        const merged = {
            dj_role_id: patch.dj_role_id !== undefined ? patch.dj_role_id : current.dj_role_id,
            default_volume: patch.default_volume !== undefined ? Math.max(1, Math.min(200, Number(patch.default_volume))) : current.default_volume,
            default_equalizer: patch.default_equalizer !== undefined ? String(patch.default_equalizer) : current.default_equalizer,
            max_queue_size: patch.max_queue_size !== undefined ? Math.max(10, Math.min(5000, Number(patch.max_queue_size))) : current.max_queue_size,
            autoplay: patch.autoplay !== undefined ? (patch.autoplay ? 1 : 0) : (current.autoplay ? 1 : 0),
            mode_247: patch.mode_247 !== undefined ? (patch.mode_247 ? 1 : 0) : (current.mode_247 ? 1 : 0),
            allowed_channel_id: patch.allowed_channel_id !== undefined ? patch.allowed_channel_id : current.allowed_channel_id,
            idle_timeout_ms: patch.idle_timeout_ms !== undefined ? Math.max(10000, Math.min(3600000, Number(patch.idle_timeout_ms))) : current.idle_timeout_ms
        };

        this.db.prepare(`
            INSERT INTO guild_settings (
                guild_id, dj_role_id, default_volume, default_equalizer, max_queue_size,
                autoplay, mode_247, allowed_channel_id, idle_timeout_ms, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                dj_role_id = excluded.dj_role_id,
                default_volume = excluded.default_volume,
                default_equalizer = excluded.default_equalizer,
                max_queue_size = excluded.max_queue_size,
                autoplay = excluded.autoplay,
                mode_247 = excluded.mode_247,
                allowed_channel_id = excluded.allowed_channel_id,
                idle_timeout_ms = excluded.idle_timeout_ms,
                updated_at = excluded.updated_at
        `).run(
            guildId,
            merged.dj_role_id,
            merged.default_volume,
            merged.default_equalizer,
            merged.max_queue_size,
            merged.autoplay,
            merged.mode_247,
            merged.allowed_channel_id,
            merged.idle_timeout_ms,
            Date.now()
        );

        return this.getGuildSettings(guildId);
    }

    saveGuildQueue(guildId, state) {
        const currentJson = state.current ? JSON.stringify(serializeTrack(state.current)) : null;
        const queueArr = (state.queue || []).slice(0, 500).map(serializeTrack).filter(Boolean);
        this.db.prepare(`
            INSERT INTO saved_queues (guild_id, current_json, queue_json, loop_mode, volume, preset, autoplay, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                current_json = excluded.current_json,
                queue_json = excluded.queue_json,
                loop_mode = excluded.loop_mode,
                volume = excluded.volume,
                preset = excluded.preset,
                autoplay = excluded.autoplay,
                updated_at = excluded.updated_at
        `).run(
            guildId,
            currentJson,
            JSON.stringify(queueArr),
            state.loop || 'none',
            state.volume ?? 100,
            state.preset || 'flat',
            state.autoplay ? 1 : 0,
            Date.now()
        );
    }

    getSavedQueue(guildId) {
        const row = this.db.prepare('SELECT * FROM saved_queues WHERE guild_id = ?').get(guildId);
        if (!row) return null;
        try {
            const current = row.current_json ? deserializeTrack(JSON.parse(row.current_json)) : null;
            const queue = JSON.parse(row.queue_json || '[]').map(deserializeTrack).filter(Boolean);
            return {
                current,
                queue,
                loop: row.loop_mode,
                volume: row.volume,
                preset: row.preset,
                autoplay: Boolean(row.autoplay),
                updatedAt: row.updated_at
            };
        } catch {
            return null;
        }
    }

    clearSavedQueue(guildId) {
        this.db.prepare('DELETE FROM saved_queues WHERE guild_id = ?').run(guildId);
    }

    addFavorite(userId, track) {
        const serialized = serializeTrack(track);
        if (!serialized) return false;
        const key = getTrackIdentifier(track).slice(0, 250);
        this.db.prepare(`
            INSERT INTO user_favorites (user_id, track_key, track_json, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, track_key) DO UPDATE SET
                track_json = excluded.track_json,
                created_at = excluded.created_at
        `).run(userId, key, JSON.stringify(serialized), Date.now());
        return true;
    }

    removeFavorite(userId, indexOrKey) {
        if (typeof indexOrKey === 'number') {
            const rows = this.db.prepare('SELECT track_key FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC').all(userId);
            const target = rows[indexOrKey - 1];
            if (!target) return false;
            this.db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND track_key = ?').run(userId, target.track_key);
            return true;
        }
        const info = this.db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND track_key = ?').run(userId, String(indexOrKey));
        return info.changes > 0;
    }

    getFavorites(userId, limit = 50) {
        const rows = this.db.prepare('SELECT track_json, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
        return rows.map(r => deserializeTrack(JSON.parse(r.track_json))).filter(Boolean);
    }

    addHistory(guildId, userId, track) {
        const serialized = serializeTrack(track);
        if (!serialized) return;
        const key = getTrackIdentifier(track).slice(0, 250);
        this.db.prepare(`
            INSERT INTO listening_history (guild_id, user_id, track_key, track_json, played_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(guildId, userId || null, key, JSON.stringify(serialized), Date.now());

        // Keep at most 100 entries per guild
        this.db.prepare(`
            DELETE FROM listening_history
            WHERE guild_id = ? AND id NOT IN (
                SELECT id FROM listening_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT 100
            )
        `).run(guildId, guildId);
    }

    getHistory(guildId, limit = 20) {
        const rows = this.db.prepare('SELECT track_json, played_at FROM listening_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT ?').all(guildId, limit);
        return rows.map(r => ({
            track: deserializeTrack(JSON.parse(r.track_json)),
            playedAt: r.played_at
        })).filter(item => item.track);
    }

    createCustomPlaylist(userId, name) {
        const cleanName = String(name).trim().slice(0, 64);
        if (!cleanName) return { ok: false, reason: 'Playlist name cannot be empty.' };
        try {
            this.db.prepare('INSERT INTO custom_playlists (user_id, name, created_at) VALUES (?, ?, ?)').run(userId, cleanName, Date.now());
            return { ok: true, name: cleanName };
        } catch {
            return { ok: false, reason: `Playlist "${cleanName}" already exists.` };
        }
    }

    addTracksToCustomPlaylist(userId, name, tracks) {
        const pl = this.db.prepare('SELECT id FROM custom_playlists WHERE user_id = ? AND lower(name) = lower(?)').get(userId, String(name).trim());
        if (!pl) return { ok: false, reason: `Playlist "${name}" not found.` };

        const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM custom_playlist_tracks WHERE playlist_id = ?').get(pl.id);
        let pos = countRow?.cnt || 0;
        const maxTracks = 200;
        if (pos >= maxTracks) return { ok: false, reason: `Playlist has reached the ${maxTracks}-track limit.` };

        const insert = this.db.prepare('INSERT INTO custom_playlist_tracks (playlist_id, position, track_json) VALUES (?, ?, ?)');
        let added = 0;
        for (const t of tracks) {
            if (pos >= maxTracks) break;
            const s = serializeTrack(t);
            if (!s) continue;
            pos += 1;
            insert.run(pl.id, pos, JSON.stringify(s));
            added += 1;
        }
        return { ok: true, added };
    }

    getCustomPlaylist(userId, name) {
        const pl = this.db.prepare('SELECT id, name FROM custom_playlists WHERE user_id = ? AND lower(name) = lower(?)').get(userId, String(name).trim());
        if (!pl) return null;
        const rows = this.db.prepare('SELECT track_json FROM custom_playlist_tracks WHERE playlist_id = ? ORDER BY position ASC').all(pl.id);
        return {
            name: pl.name,
            tracks: rows.map(r => deserializeTrack(JSON.parse(r.track_json))).filter(Boolean)
        };
    }

    listCustomPlaylists(userId) {
        return this.db.prepare(`
            SELECT p.name, COUNT(t.id) as track_count
            FROM custom_playlists p
            LEFT JOIN custom_playlist_tracks t ON t.playlist_id = p.id
            WHERE p.user_id = ?
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `).all(userId);
    }

    deleteCustomPlaylist(userId, name) {
        const info = this.db.prepare('DELETE FROM custom_playlists WHERE user_id = ? AND lower(name) = lower(?)').run(userId, String(name).trim());
        return info.changes > 0;
    }

    close() {
        try {
            this.db.close();
        } catch (_) {}
    }
}

module.exports = DatabaseService;
module.exports.DEFAULT_GUILD_SETTINGS = DEFAULT_GUILD_SETTINGS;
