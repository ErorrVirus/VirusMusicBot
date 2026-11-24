# Changelog

## [3.0.1] - 2026-11-25 (Final Production Readiness Verification)

### Fixed
- **Voice Connection Readiness**: Increased readiness timeout from 1500ms to 10000ms default (configurable via `VOICE_READY_TIMEOUT_MS`). Added token cancellation so `/stop` and `destroy()` immediately abort pending connection polling without sleeping.
- **Stale Event Filtering**: Strengthened `_isEventForCurrentAttempt()` across three layers: `userData.attemptId`, `track.encoded` mismatch detection, and closure-captured attempt ID to prevent race conditions during concurrent skips/replaces.
- **Lavalink HTTP Streams**: Explicitly disabled `http: false` in `lavalink/application.yml` and added `ALLOW_HTTP_STREAMS` gate in `TrackResolver.js` because Lavalink fetches stream URLs directly, bypassing Node.js SSRF guards.
- **Dashboard Security**: Enforced minimum 32-character requirement for `DASHBOARD_JWT_SECRET` in both config validation and dashboard startup.
- **Helper Utilities**: Fixed `startDashboardServer` export in `src/web/server.js` and confirmed syntax validation across all helpers.

### Added
- **`PLATFORM_SUPPORT.md`**: Complete compatibility matrix with status, credentials, resolution mode, and known limitations across all audio platforms.
- **`LIVE_TEST_CHECKLIST.md`**: Step-by-step pre-flight, container startup, Lavalink health check, Discord commands, and audio diagnostics benchmark guide for TrueNAS SCALE.
- **`PRODUCTION_READINESS.md`**: Comprehensive readiness report detailing verified, mocked, and disabled components.
- **`tests/regression_v3.test.js`**: 9 regression tests covering lock timeout recovery, stale event rejection, stuck event deduplication, queue loop + autoplay mutual exclusion, HTTP stream blocking, and JWT length enforcement. Full test suite now passes at **34/34**.

## [3.0.0] - 2026-11-25

### Fixed
- **Command Crash Fixes**:
  - Fixed missing `errorEmbed` import and added full bounds/empty-queue validation in `src/commands/move.js`.
  - Fixed crash when removing unresolved Spotify/YouTube playlist tracks (`track.title` vs `track.info.title`) in `src/commands/remove.js`.
  - Replaced deprecated `ready` event with `Events.ClientReady` (`clientReady`) and added one-time initialization guard in `src/events/ready.js`.
  - Fixed missing `await`s, duplicate rapid-click races, and stale session buttons in `src/events/interactionCreate.js`.
- **Playback Stability & State Machine**:
  - Added per-guild `AsyncLock` (`src/structures/AsyncLock.js`) serializing all queue/playback/timer/voice mutations.
  - Added explicit `PlayerState` lifecycle (`IDLE`, `CONNECTING`, `LOADING`, `PLAYING`, `PAUSED`, `RECOVERING`, `DESTROYING`, `DESTROYED`).
  - Added unique `attemptId` propagated via Lavalink `track.userData` to reject stale `start`/`end`/`exception`/`stuck` events.
  - Deduplicated `exception` + `end (loadFailed)` into a single authoritative recovery path with bounded retries.
  - Fixed invalid Shoukaku options (`resumable` / `resumableTimeout` -> `resume` / `resumeTimeout` / `resumeByLibrary` / `voiceConnectionTimeout`).
- **Audio Quality & Startup Stutter**:
  - Eliminated post-`playTrack()` `setEqualizer()` and `setGlobalVolume()` REST calls in favor of a single atomic `player.update()` call.
  - Replaced arbitrary voice startup sleep with bounded voice readiness probing (`voice.connected`).
  - Set Lavalink baseline (`frameBufferDurationMs: 5000`, `opusEncodingQuality: 8`, `resamplingQuality: HIGH`, `trackStuckThresholdMs: 10000`, `playerUpdateInterval: 5`, `_JAVA_OPTIONS=-Xms512m -Xmx1G -XX:+UseG1GC`).
  - Changed default EQ preset to `flat`, implemented 10 full 15-band presets with gain headroom scaling, and removed misleading dB labels.
- **Security & Deployment**:
  - Separated `DASHBOARD_JWT_SECRET` from `DASHBOARD_PASS`, added `scrypt` password hashing support, timing-safe comparisons, CSRF tokens, `Secure`/`HttpOnly`/`SameSite=Lax` cookies, configurable `TRUST_PROXY`, and `/health` endpoint.
  - Added `src/utils/ssrfGuard.js` to block private/loopback/link-local IPs and unsafe redirects on arbitrary audio URLs.
  - Removed duplicate `docker-compose.yml`, removed startup `git clone` / `npm install` from container boot, upgraded `Dockerfile` to `node:24-alpine` running as non-root `node` user.

### Added
- Centralized `TrackResolver` (`src/services/TrackResolver.js`) and `trackUtils` (`src/utils/trackUtils.js`).
- Built-in SQLite persistence (`src/services/Database.js` via `node:sqlite`).
- Structured redacting logger (`src/utils/logger.js`).
- New commands: `/search`, `/artist`, `/volume`, `/seek`, `/autoplay`, `/clear`, `/247`, `/lyrics`, `/help`, `/ping`, `/stats`, `/settings`, `/playlist`.
- Upgraded Now Playing embed with 10 interactive buttons across 2 rows.
- Automated `node:test` test suite (`tests/*.test.js`) and syntax checker (`scripts/check-syntax.js`).
