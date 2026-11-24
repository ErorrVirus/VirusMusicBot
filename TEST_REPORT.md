# Test Report — VirusMusicPro V3

**Date**: 2026-11-25  
**Node.js Version Tested**: `v24.16.0` (built-in `node:test` and `node:sqlite`)

---

## 1. Automated Local Verification Results

| Check | Command | Result | Scope & Conditions |
| :--- | :--- | :--- | :--- |
| JS Syntax Check | `npm run lint` (`node scripts/check-syntax.js`) | **PASSED (58 files)** | Verified all `src/`, `tests/`, and `scripts/` JavaScript files |
| Unit & Integration Suite | `npm test` (`node --test tests/*.test.js`) | **PASSED (37/37 tests, 12 suites)** | Executed locally using mocked Shoukaku/Discord objects, in-memory SQLite (`:memory:`), and in-process Express dispatch |

### Suite Breakdown
1. **`tests/commands_and_utils.test.js` (7/7 passed)**
   - `ready.js` uses `clientReady` (`Events.ClientReady`).
   - `move.js` handles out-of-bounds/empty queue without `ReferenceError`.
   - `remove.js` safely handles unresolved Spotify/YouTube playlist tracks.
   - `trackUtils.js` normalizes resolved, unresolved, and live tracks.
   - `EqualizerService.js` validates all 10 presets (all 15 bands, valid gain bounds `[-0.25, 1.0]`, headroom attenuation, `flat` default).
   - `ssrfGuard.js` blocks loopback, private IPv4/IPv6, embedded credentials, private DNS resolutions, and private redirects.
   - `logger.js` redacts passwords, tokens, JWT secrets, and URL query credentials.
2. **`tests/commands_registry_and_buttons.test.js` (2/2 passed)**
   - Verifies all 28 slash commands load cleanly with valid Discord builder schemas and execute functions.
   - Verifies 2 rows × 5 buttons (10 controls) and stale session disabling.
3. **`tests/dashboard_and_config.test.js` (4/4 passed)**
   - `scrypt` password hashing & timing-safe verification.
   - Graceful dashboard skip when disabled or when `DASHBOARD_JWT_SECRET === DASHBOARD_PASS`.
   - In-process Express tests for `/health`, 401 unauthorized blocking, forged JWT rejection, CSRF-protected `/login`, and CSRF-protected `/api/control`.
   - `config.validate()` failure on missing mandatory Discord/Lavalink variables.
4. **`tests/playback_state_machine.test.js` (9/9 passed)**
   - Atomic `player.update()` on startup (no post-play filter/volume REST race).
   - Concurrent `/play` and concurrent `/skip` serialization (no double-skip).
   - Deduplication of `exception` + `end (loadFailed)` recovery; skipping dead tracks without halting playlists.
   - Stale event rejection via `attemptId` (including looped identical tracks).
   - Stopping/skipping while an unresolved track is resolving.
   - Track loop, queue loop, volume, and EQ preservation across transitions.
   - Manual voice disconnect (`voiceStateUpdate`) and idle timer token invalidation.
   - Multi-guild independent player state and graceful `shutdown()`.
   - Lavalink voice close `4014` teardown vs transient `4006` bounded reconnection.
5. **`tests/resolver_and_storage.test.js` (3/3 passed)**
   - Intelligent song scoring (official vs unwanted remix/slowed/cover, explicit variant override, `<55s` track acceptance, `/preview/` rejection).
   - Resolving song name, artist, YouTube URL, Spotify track, YouTube playlist, Spotify playlist, artist search, and unavailable URL error propagation.
   - SQLite persistence (`guild_settings`, `saved_queues`, `user_favorites`, `listening_history`, `custom_playlists`).
6. **`tests/regression_v3.test.js` (12/12 passed)**
   - Stale event rejection via closure-captured `attemptId`, `track.encoded` match, and `userData.attemptId` (including identical repeated tracks).
   - Genuine track completion acceptance.
   - Stuck event recovery trigger and duplicate exception suppression.
   - Queue loop + autoplay interaction (autoplay strictly suppressed while queue loop is active).
   - AsyncLock timeout non-blocking recovery and strict serialization (Op2 timing out never allows Op3 to enter before unfinished Op1 completes).
   - Discord DAVE close code `4017` clean teardown without reconnect loop.
   - Direct HTTP audio URL rejection when `ALLOW_HTTP_STREAMS` is unset.
   - Dashboard JWT secret minimum length (≥ 32 chars) enforcement.

---

## 2. Checks Not Runnable / Deferred to Live TrueNAS Environment
- **Docker Compose CLI Validation (`docker compose -f compose.yaml config`)**: Could not run locally on Windows host (`unknown shorthand flag: 'f'` — Docker Compose v2 plugin not active and `.docker/config.json` access blocked in sandbox). Run `docker compose config` directly on TrueNAS SCALE before deployment.
- **Live Discord Voice & Lavalink Playback**: Not executed because no live Discord bot token, voice channel, or running Lavalink container is available in this workspace.
- **Live Lyrics (`/lyrics`) & External Network Scraping Fallbacks**: Sandbox has no external internet access; live HTTP calls to `lrclib.net`, YouTube, and Spotify must be verified on TrueNAS.
- **`npm audit`**: Not run because network access is disabled in the local sandbox.
