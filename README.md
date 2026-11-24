# VirusMusicPro V3

Production-ready Discord music bot powered by **Node.js 24**, **discord.js v14**, **Shoukaku v4**, **Lavalink v4.2.2**, and **SQLite**, optimized for self-hosting on **TrueNAS SCALE**.

---

## Key Features
- **Serialized Per-Guild State Machine**: Async per-guild operation locks, unique `attemptId` tracking via Lavalink `userData`, stale event filtering, and deduplicated `exception` / `loadFailed` recovery.
- **Clean, Balanced Audio Engine**:
  - Atomic Lavalink player updates (track + volume + filters in one request—eliminating post-start filter race stutters).
  - Voice transport readiness polling instead of arbitrary fixed delays.
  - 10 full 15-band equalizer presets (`Flat` default) with automatic gain headroom attenuation.
- **Centralized Music Resolution (`TrackResolver`)**:
  - Supports song/artist search, YouTube & YouTube Music, Spotify tracks/playlists/albums/artists, SoundCloud, Apple Music / Deezer / Tidal (when enabled on Lavalink), and SSRF-protected radio/stream URLs.
  - Smart candidate scoring (prefers official/Topic tracks, filters covers/remixes/slowed unless requested, preserves legitimate short tracks `< 55s` and livestreams).
- **Pancake-Style Commands & Controls**:
  - 28 slash commands including `/play`, `/search`, `/artist`, `/autoplay`, `/247`, `/seek`, `/volume`, `/lyrics`, `/settings`, `/playlist`, `/stats`, `/ping`, `/help`, plus interactive 10-button Now Playing controls.
- **SQLite Persistence**: Stores guild settings, DJ roles, saved queues, user favorites, listening history, and custom playlists using Node.js 24 built-in `node:sqlite`.
- **Hardened Web Dashboard**: Separate `DASHBOARD_JWT_SECRET`, `scrypt` password hashing, CSRF protection, login rate limiting, `helmet` CSP, and live playback/JVM telemetry.

---

## Quick Start (Docker Compose / TrueNAS SCALE)

1. Copy `.env.example` to `.env` and fill in your credentials (never commit `.env`):
   ```bash
   cp .env.example .env
   ```
2. Build and start the stack:
   ```bash
   docker compose build
   docker compose up -d
   ```

For full TrueNAS SCALE setup, verification, and rollback instructions, see [TRUENAS_DEPLOYMENT.md](TRUENAS_DEPLOYMENT.md).
