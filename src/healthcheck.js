'use strict';
/**
 * Container healthcheck script for VirusMusicPro bot.
 * Works identically when the web dashboard is disabled, HTTP, or HTTPS.
 *
 * Reads the heartbeat file written periodically by src/index.js and verifies:
 *   1. Heartbeat file exists and is fresh (< 45s old -> event loop is alive)
 *   2. Discord client is ready (client.isReady())
 *   3. At least one Lavalink node is ready (manager.getIdealNode() != null)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HEARTBEAT_FILE = process.env.HEALTHCHECK_FILE || path.join(os.tmpdir(), 'virusmusic-health.json');
const MAX_AGE_MS = Number(process.env.HEALTHCHECK_MAX_AGE_MS || 45000);

function checkHealth(filePath = HEARTBEAT_FILE, maxAgeMs = MAX_AGE_MS) {
    if (!fs.existsSync(filePath)) {
        return { ok: false, reason: 'Heartbeat file missing' };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data.ts !== 'number') {
            return { ok: false, reason: 'Invalid heartbeat payload' };
        }
        const ageMs = Date.now() - data.ts;
        if (ageMs > maxAgeMs) {
            return { ok: false, reason: `Heartbeat stale (${ageMs}ms > ${maxAgeMs}ms)` };
        }
        if (!data.discordReady) {
            return { ok: false, reason: 'Discord client not ready' };
        }
        if (!data.lavalinkReady) {
            return { ok: false, reason: 'No ready Lavalink node' };
        }
        return { ok: true, ageMs };
    } catch (err) {
        return { ok: false, reason: `Heartbeat read error: ${err.message}` };
    }
}

if (require.main === module) {
    const res = checkHealth();
    if (!res.ok) {
        console.error(`[Healthcheck] UNHEALTHY: ${res.reason}`);
        process.exit(1);
    }
    process.exit(0);
}

module.exports = { checkHealth, HEARTBEAT_FILE };
