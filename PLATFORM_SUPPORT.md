# VirusMusicPro V3 — Platform Support & Compatibility Matrix

> [!NOTE]
> Status key: ✅ Verified working (automated test) | ⚠️ Mocked (integration not live-tested) | ❌ Untested | 🚫 Disabled | 🔴 Deployment blocker

---

## Audio Source Support

| Platform | Status | Required Credentials | Resolution Type | Automated Tests | Real Playback Tested | Known Limitations |
|---|---|---|---|---|---|---|
| **YouTube (video)** | ⚠️ Mocked | None (OAuth optional) | Direct via YT plugin + YT-Cipher | ✅ TrackResolver mocked | ❌ Not live-tested | May block datacenter IPs; OAuth refresh token recommended (`YOUTUBE_REFRESH_TOKEN`) |
| **YouTube Music** | ⚠️ Mocked | None | Direct via YT plugin | ✅ Mocked | ❌ Not live-tested | Falls back from ytmsearch to ytsearch |
| **YouTube Playlists** | ⚠️ Mocked | None | Direct via YT plugin | ✅ Mocked | ❌ Not live-tested | Paginated via `youtube-sr` metadata; large playlists capped at `MAX_PLAYLIST_SIZE` (250) |
| **Spotify tracks** | ⚠️ Mocked | `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (optional; falls back to embed page token) | JIT metadata → YT Music search | ✅ Mocked | ❌ Not live-tested | No direct stream; LavaSrc resolves lazily. Needs `SPOTIFY_SPDC` for some premium content. |
| **Spotify playlists** | ⚠️ Mocked | Same as above | JIT (paginated API or fallback `spotify-url-info`) | ✅ Mocked | ❌ Not live-tested | Paginated; capped at 250. Anonymous embed token expires ~1h. |
| **Spotify albums** | ⚠️ Mocked | Same as above | JIT | ✅ Mocked | ❌ Not live-tested | Same caveats as playlists |
| **Spotify artists** | ⚠️ Mocked | Same as above | JIT (top tracks endpoint) | ✅ Mocked | ❌ Not live-tested | Returns top 10 US tracks only |
| **SoundCloud** | ❌ Untested | None | Direct (Lavalink built-in `scsearch:`) | ❌ No isolated test | ❌ Not live-tested | Preview tracks filtered (`soundcloudFilterOutPreviewTracks: true`) |
| **Apple Music** | 🚫 Disabled | Apple Music token | n/a | n/a | n/a | `appleMusic: false` in `lavalink/application.yml`. Enable requires `APPLE_MUSIC_API_TOKEN`. |
| **Deezer** | 🚫 Disabled | Deezer ARL cookie | n/a | n/a | n/a | `deezer: false` in `lavalink/application.yml` |
| **Tidal** | 🚫 Disabled | Tidal credentials | n/a | n/a | n/a | Not configured |
| **Direct audio URLs / radio** | 🚫 Disabled by default | None | Lavalink HTTP source | ❌ No test | ❌ Not live-tested | **`http: false` in Lavalink config.** Node.js SSRF guard does NOT prevent Lavalink from making the HTTP request (Lavalink fetches directly). Re-enable with `ALLOW_HTTP_STREAMS=true` in `.env` AND `http: true` in `lavalink/application.yml`. |
| **Lyrics (LRCLIB)** | ❌ Untested | None | LRCLIB REST API | ❌ No test | ❌ Not live-tested | Requires internet access from bot container (`/lyrics` command) |
| **Artist search** | ⚠️ Mocked | None | YouTube Music text search | ✅ Mocked | ❌ Not live-tested | Returns top 12 results, deduplicates by artist |

---

## Discord & Library Compatibility

| Component | Version | Status | Notes |
|---|---|---|---|
| **discord.js** | v14.27.0 | ✅ Verified | DAVE (Discord Audio Video Encryption) supported transparently in `@discordjs/ws` |
| **Shoukaku** | v4.3.0 | ✅ Verified | `player.update()`, `PlayerEvents`, `ShoukakuOptions`, `resume`/`resumeTimeout`/`reconnectTries` all verified against `dist/index.js` and `.d.ts` |
| **Node.js** | v24 LTS | ✅ Verified | `node:sqlite` built-in available (no npm package needed) |
| **Lavalink** | 4.2.2 | ⚠️ Mocked | REST API (`getPlayer`, `updatePlayer`) verified against d.ts; real playback not tested |
| **LavaSrc plugin** | 4.8.3 | ⚠️ Mocked | Spotify resolution via LavaSrc; falls back to metadata-based approach |
| **YT Plugin** | f45bbb7 (snapshot) | ⚠️ Mocked | YouTube + YouTube Music; YT-Cipher sidecar for IP rotation |

---

## Security Notes

| Item | Status | Detail |
|---|---|---|
| **SSRF guard (Node.js layer)** | ✅ Implemented | `ssrfGuard.js` validates URLs via DNS before passing to Lavalink |
| **Lavalink HTTP streams** | 🚫 Disabled | `http: false` in `lavalink/application.yml` — the Node SSRF guard alone is insufficient because Lavalink fetches URLs directly. Requires both env var and YAML change to re-enable. |
| **Dashboard auth** | ✅ Implemented | scrypt password hashing, HMAC CSRF tokens, JWT session, Helmet headers |
| **Dashboard JWT secret** | ✅ Enforced | Must be ≥32 chars; dashboard refuses to start otherwise (checked in `startDashboardServer`) |
| **DJ permission** | ✅ Implemented | 13 slash commands + 9 button types gated by `checkDjPermission` in `interactionCreate.js` |
| **YT Cipher image pinning** | ❌ Not pinned | `compose.yaml` uses `ghcr.io/kikkia/yt-cipher:master` (floating tag). Pin to digest on TrueNAS — see `TRUENAS_DEPLOYMENT.md`. |

---

## Audio Configuration Options

| Parameter | Default | Description | File |
|---|---|---|---|
| `VOICE_READY_TIMEOUT_MS` | `10000` | Max ms to wait for Lavalink voice ready confirmation | `.env` |
| `MAX_TRACK_RETRIES` | `2` | Per-track recovery attempts before skipping | `.env` |
| `MAX_CONSECUTIVE_FAILURES` | `5` | Consecutive failures before halting queue | `.env` |
| `IDLE_TIMEOUT_MS` | `60000` | Idle disconnect timeout (ms) | `.env` |
| `ALLOW_HTTP_STREAMS` | `false` | Enable direct HTTP audio URL playback | `.env` |
| `frameBufferDurationMs` | `1000` | Lavalink frame buffer size | `lavalink/application.yml` |
| `opusEncodingQuality` | `10` | Lavalink Opus quality (0–10) | `lavalink/application.yml` |
