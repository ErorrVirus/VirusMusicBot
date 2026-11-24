# VirusMusicPro V3 — Audit Report

## 1. Bugs Discovered & Root Causes

| Area | Bug / Issue | Root Cause | Fix Implemented |
| :--- | :--- | :--- | :--- |
| `src/commands/move.js` | `ReferenceError: errorEmbed is not defined` on out-of-bounds move | `errorEmbed` was called on line 29 without being imported | Imported `errorEmbed` and delegated validation to serialized `player.moveTrack()` |
| `src/commands/remove.js` | `TypeError` on unresolved Spotify/YouTube tracks | Directly accessed `removed.info.title`; unresolved tracks only have `removed.title` | Created `src/utils/trackUtils.js` (`getTrackTitle`) and delegated to `player.removeTrack()` |
| `src/events/ready.js` | `DeprecationWarning` on startup & unguarded init | Used `'ready'` instead of `Events.ClientReady` (`'clientReady'`) | Switched to `Events.ClientReady` with `initialized` guard |
| `src/events/interactionCreate.js` | Unawaited async player calls, unused `music_previous`, duplicate clicks | `playPrevious()`/`playNext()` called without `await`; no per-user button lock or stale session check | Added async/await, per-user/message guard, session ID validation, component disabling, and all 10 buttons |
| `src/structures/MusicPlayer.js` | Startup audio stutter & filter race | Called `playTrack()`, then `setEqualizer()`, then `setGlobalVolume()` as 3 separate PATCH calls during buffer init; blind 600ms sleep | Combined into single atomic `player.update({ track, volume, filters })` on init; replaced blind sleep with bounded `voice.connected` readiness probe |
| `src/structures/MusicPlayer.js` | Duplicate track failure recovery & stale event skips | Both `exception` and `end (loadFailed)` triggered `handleTrackFailure()`; no `attemptId` tracking | Propagated `attemptId` in `track.userData`; deduplicated failures per `attemptId`; serialized all mutations under `AsyncLock` |
| `src/structures/MusicManager.js` | Invalid Shoukaku resume options | Passed `resumable`/`resumableTimeout` instead of Shoukaku v4.3.0 `resume`/`resumeTimeout`/`resumeByLibrary` | Fixed options to match verified Shoukaku v4.3.0 API |
| `src/structures/MusicManager.js` | Legitimate short songs rejected | Global `length > 55000` filter discarded short intros/interludes | Replaced with `isPreviewTrack()` targeting `/preview/` URLs and preview metadata |
| `src/web/server.js` | Critical auth & security flaws | Used `DASHBOARD_PASS` as JWT secret, lacked CSRF protection, lacked `scrypt` hashing, exited bot if dashboard creds missing | Added separate `DASHBOARD_JWT_SECRET`, `scrypt` + `timingSafeEqual`, CSRF HMAC tokens, `Secure` cookie logic, and non-fatal skip when disabled |
| `docker-compose.yml` / `compose.yaml` | Duplicate files & fragile startup | Cloned GitHub and ran `npm install` on every boot; duplicated Lavalink config in env vars + YAML | Consolidated to `compose.yaml`, built non-root `node:24-alpine` image, kept `lavalink/application.yml` as single source of truth |

---

## 2. Files Changed / Added / Removed

### Added
- `src/structures/AsyncLock.js` — Per-guild FIFO mutex lock with timeout protection
- `src/services/EqualizerService.js` — 10 full 15-band EQ presets (`flat` default) with gain headroom scaling
- `src/services/TrackResolver.js` — Centralized track/playlist/artist resolver + intelligent candidate scoring + bounded TTL cache
- `src/services/Database.js` — SQLite persistence (`node:sqlite`) for guild settings, saved queues, favorites, history, custom playlists
- `src/utils/trackUtils.js` — Normalized metadata helpers for resolved, unresolved, and live tracks
- `src/utils/ssrfGuard.js` — IPv4/IPv6 private range, DNS, and redirect SSRF guard for arbitrary URLs
- `src/utils/permissions.js` — DJ role, allowed channel, and bot voice permission checks
- `src/utils/logger.js` — Structured logger with secret/token redaction
- `src/commands/`: `search.js`, `artist.js`, `volume.js`, `seek.js`, `autoplay.js`, `clear.js`, `247.js`, `lyrics.js`, `help.js`, `ping.js`, `stats.js`, `settings.js`, `playlist.js`
- `.dockerignore`, `scripts/check-syntax.js`, `tests/*.test.js`
- `CHANGELOG.md`, `AUDIT_REPORT.md`, `TEST_REPORT.md`, `TRUENAS_DEPLOYMENT.md`

### Modified
- `src/index.js`, `src/config.js`, `src/structures/MusicManager.js`, `src/structures/MusicPlayer.js`
- `src/events/ready.js`, `src/events/interactionCreate.js`, `src/events/voiceStateUpdate.js`
- `src/utils/embedBuilder.js`, `src/utils/helpers.js`, `src/utils/searchCleaner.js`
- `src/commands/`: `play.js`, `pause.js`, `resume.js`, `skip.js`, `previous.js`, `stop.js`, `disconnect.js`, `queue.js`, `nowplaying.js`, `loop.js`, `shuffle.js`, `move.js`, `remove.js`, `bassboost.js`, `equalizer.js`
- `src/web/server.js`
- `Dockerfile`, `compose.yaml`, `lavalink/application.yml`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`

### Removed
- `docker-compose.yml` (duplicate of `compose.yaml`)

---

## 3. Architecture & Dependency Decisions
- **Zero New Dependencies**: Leveraged Node.js 24 LTS built-in `node:sqlite` (`DatabaseSync`) for persistent storage and `node:test` for automated testing, avoiding native C++ build toolchains (`python3`/`make`/`g++`) inside `node:24-alpine`.
- **Single-Source Lavalink Config**: Removed redundant `LAVALINK_*` and `PLUGINS_*` environment overrides from `compose.yaml` so `lavalink/application.yml` governs audio settings while `.env` supplies secrets.
- **No Nested Lock Deadlocks**: Public `MusicPlayer` methods acquire `this.lock.runExclusive(this.guildId, ...)` and call private `_*Locked()` methods that never re-acquire the lock.

---

## 4. Security Improvements
1. **Separate JWT Secret**: `DASHBOARD_JWT_SECRET` is required independently of `DASHBOARD_PASS`; startup refuses to enable the dashboard if they match.
2. **Password Hashing & Constant-Time Comparison**: Supports `scrypt:<salt>:<hex>` (`DASHBOARD_PASS_HASH`) and SHA-256 + `crypto.timingSafeEqual` for plaintext fallback.
3. **CSRF & Cookie Hardening**: HMAC-signed CSRF tokens on `/login` and `/api/control`; `HttpOnly; SameSite=Lax` plus `Secure` when HTTPS/proxy TLS is active; `helmet` strict `'self'` CSP (moved styles/scripts to external `/style.css` and `/script.js`).
4. **SSRF Protection**: `ssrfGuard.js` blocks private, loopback, link-local, CGNAT, and internal hostnames/IPs across DNS resolution and HTTP redirects.
5. **Non-Root Container & No Docker Socket**: Node.js container runs as `node` user; Docker socket is never mounted.
6. **Log Redaction**: Passwords, tokens, JWT secrets, and URL query credentials are redacted by `logger.js`.

---

## 5. Audio Improvements
- **Startup Stutter Fix**: Sent track, `userData`, initial volume, and 15-band EQ filters in one atomic `player.update()` call; subsequent track transitions only send `{ track, paused: false }`.
- **Voice Readiness**: Replaced blind fixed sleep with bounded polling of Lavalink `voice.connected` (`75ms` intervals up to `1500ms`).
- **Balanced Equalizer**: Defaulted to `flat`, implemented all 10 presets with full 15-band resets, added `computeHeadroomVolume` attenuation to reduce digital clipping, and enabled `lowPass: true` in `lavalink/application.yml` for `night_mode`.
- **Lavalink Baseline**: Configured `bufferDurationMs: 400`, `frameBufferDurationMs: 5000`, `opusEncodingQuality: 8`, `resamplingQuality: HIGH`, `nonAllocating: true`, `trackStuckThresholdMs: 10000`, `useSeekGhosting: true`, `playerUpdateInterval: 5`, and `_JAVA_OPTIONS=-Xms512m -Xmx1G -XX:+UseG1GC`.

---

## 6. Test Results Summary
- **Syntax check (`npm run lint`)**: 57/57 JS files passed.
- **Automated suite (`npm test`)**: 25/25 tests passed across 5 suites (all mocked/in-process; see `TEST_REPORT.md`).

---

## 7. Remaining Limitations & Unverified Functionality
1. **Live Discord Voice & TrueNAS Execution**: Not run in this workspace (no live Discord token, no Lavalink container running locally, and sandbox blocks external network + loopback TCP fetch).
2. **1000ms vs 5000ms Frame Buffer Benchmark**: Baseline is set to `5000ms` with `opusEncodingQuality: 8`; real-world frame deficit and latency metrics must be observed on TrueNAS via `/stats` and the dashboard.
3. **YT-Cipher Image Digest Pinning**: `compose.yaml` defaults `YT_CIPHER_IMAGE` to `ghcr.io/kikkia/yt-cipher:master` because external registry inspection was unavailable offline; pin its exact `@sha256:...` digest on TrueNAS (instructions in `TRUENAS_DEPLOYMENT.md`).
4. **Additional Credentials Required for Optional Platforms**:
   - **Spotify**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and optionally `SPOTIFY_SPDC` for full LavaSrc/API access.
   - **YouTube OAuth**: `YOUTUBE_REFRESH_TOKEN` if YouTube blocks datacenter/residential IP playback.
   - **Apple Music / Deezer / Tidal**: Disabled in `lavalink/application.yml` by default because they require platform tokens/ARL/credentials in LavaSrc.
   - **Lyrics**: `/lyrics` queries the public `lrclib.net` API (requires internet access from the bot container).
   - **Dashboard**: Requires `DASHBOARD_USER`, `DASHBOARD_PASS` (or `DASHBOARD_PASS_HASH`), and a separate `DASHBOARD_JWT_SECRET`.

---

## 8. Exact Deployment Commands (When Ready)
```bash
# On TrueNAS SCALE in the project directory:
docker compose build
docker compose up -d
docker compose logs -f --tail 100 bot lavalink
```
