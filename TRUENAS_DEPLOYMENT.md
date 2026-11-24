# TrueNAS SCALE Deployment & Verification Guide (VirusMusicPro V3)

> [!NOTE]
> Host Node.js is **not** required on TrueNAS SCALE. All Node.js commands below run inside Docker (`node:24-alpine`) or use standard TrueNAS tools (`openssl`, `docker`).

## 1. Resource Allocation (Intel Core i5-4590 · 4 Cores · 15.5 GiB RAM)

| Service | Container Memory Limit | CPU Limit | Role |
| :--- | :--- | :--- | :--- |
| `virusmusicbot_lavalink` | `1792m` (`-Xms512m -Xmx1G -XX:+UseG1GC`) | `2.0` | Audio decoding, resampling (`HIGH`), Opus encoding (`8`) |
| `virusmusicbot_bot` | `512m` | `1.0` | Node.js 24 bot, SQLite DB, Express dashboard |
| `virusmusicbot_yt_cipher` | `512m` | `1.0` | YouTube signature deciphering |
| **Total Budget** | **~2.8 GiB max** | — | Leaves >12.5 GiB for TrueNAS ZFS ARC and other apps |

---

## 2. Pre-Upgrade Backup (Before Switching from V2)

Before pulling V3 or recreating containers, back up your existing deployment state, `.env`, persistent data, and running Docker image versions:

```bash
cd /mnt/YOUR_POOL/path/to/VirusMusicBot
mkdir -p ../vmp-backup-$(date +%F)
cp .env ../vmp-backup-$(date +%F)/.env
cp -a compose.yaml docker-compose.yml lavalink/application.yml ../vmp-backup-$(date +%F)/ 2>/dev/null || true
cp -a data ../vmp-backup-$(date +%F)/data 2>/dev/null || true
sudo docker ps -a --filter "name=virusmusicbot_" --format "{{.Names}}\t{{.Image}}\t{{.ID}}" > ../vmp-backup-$(date +%F)/running-images.txt
```

> [!IMPORTANT]
> V2 (`docker-compose.yml`) and V3 (`compose.yaml`) use the same container names (`virusmusicbot_bot`, `virusmusicbot_lavalink`, `virusmusicbot_yt_cipher`). Stop and remove V2 containers before starting V3 so Docker Compose does not hit name conflicts:
> ```bash
> sudo docker compose -f docker-compose.yml down
> ```

---

## 3. Environment Setup (`.env`) & Dashboard Security

1. Copy `.env.example` to `.env` if setting up fresh, and set mandatory values:
   - `DISCORD_TOKEN`, `CLIENT_ID`, `LAVALINK_PASSWORD`
   - `GUILD_ID=` (leave blank for global commands, or set your Discord server ID for instant guild-scoped command sync)
2. **Optional credentials** (startup succeeds without them):
   - `YOUTUBE_OAUTH_ENABLED=false` / `YOUTUBE_REFRESH_TOKEN=`
   - `LAVASRC_SPOTIFY_ENABLED=false` / `SPOTIFY_CLIENT_ID=` / `SPOTIFY_CLIENT_SECRET=` / `SPOTIFY_SPDC=` (bot resolves Spotify links via embed fallback even when disabled)
3. **Web Dashboard** (disabled by default: `DASHBOARD_ENABLED=false`):
   - Keep `DASHBOARD_BIND_IP=127.0.0.1` for local-only/Tailscale/SSH-tunnel access, or set it to your TrueNAS LAN IP (e.g., `192.168.1.50`) for LAN-only access. Never expose port `4000` directly to the internet.
   - Generate a 32+ char `DASHBOARD_JWT_SECRET` using `openssl` (no host Node.js required):
     ```bash
     openssl rand -hex 32
     ```
   - Generate a `scrypt` password hash (`DASHBOARD_PASS_HASH`) using the `node:24-alpine` container:
     ```bash
     sudo docker run --rm node:24-alpine node -e "const c=require('crypto'); const s=c.randomBytes(16).toString('hex'); console.log('scrypt:'+s+':'+c.scryptSync('YOUR_PASSWORD',s,64).toString('hex'));"
     ```
   - **Optional Native HTTPS**: Place `certificate.crt` and `private.key` inside `./certs/` and set:
     ```env
     SSL_CRT_PATH=/certs/certificate.crt
     SSL_KEY_PATH=/certs/private.key
     SSL_CERTS_HOST_DIR=./certs
     ```
4. **Pin `yt-cipher` to an immutable SHA256 digest**:
   ```bash
   sudo docker pull ghcr.io/kikkia/yt-cipher:master
   sudo docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/kikkia/yt-cipher:master
   # Add the printed digest to .env:
   # YT_CIPHER_IMAGE=ghcr.io/kikkia/yt-cipher@sha256:...
   ```

---

## 4. Host Bind Mount Permissions (TrueNAS Dataset ACLs & Distinct Container UIDs)

The containers run as **different non-root users**:
- **`virusmusicbot_bot`** (`node:24-alpine`): runs as `node` (**UID `1000` / GID `1000`**). Needs read/write access to `./data` (SQLite DB + `-wal`/`-shm` files) and `./logs`.
- **`virusmusicbot_lavalink`** (`ghcr.io/lavalink-devs/lavalink:4.2.2`): runs as `lavalink` (**UID `322` / GID `322`**). Needs read/write access to `./lavalink/plugins` and `./logs/lavalink`, and read access to `./lavalink/application.yml`.

> [!WARNING]
> **TrueNAS Dataset ACLs**: Use a **POSIX** (`Apps`) dataset for your stack directory rather than a `Restricted` NFSv4 ACL dataset, or `chown` will be blocked/overridden. Do **not** use `chmod 777`. If your dataset uses NFSv4 ACLs, grant explicit Read/Write/Execute ACL entries to UID `1000` (`data`, `logs`) and UID `322` (`lavalink/plugins`, `logs/lavalink`) in the TrueNAS UI.

```bash
cd /mnt/YOUR_POOL/path/to/VirusMusicBot
mkdir -p data logs lavalink/plugins logs/lavalink certs
sudo chown -R 1000:1000 data logs
sudo chown -R 322:322 lavalink/plugins logs/lavalink
sudo chmod 644 lavalink/application.yml
```

---

## 5. Build & Deploy on TrueNAS SCALE

```bash
cd /mnt/YOUR_POOL/path/to/VirusMusicBot
sudo docker compose -f compose.yaml config --quiet
sudo docker compose -f compose.yaml build --no-cache bot
sudo docker compose -f compose.yaml up -d
```

Verify container health and logs:
```bash
sudo docker compose -f compose.yaml ps
sudo docker compose -f compose.yaml logs -f --tail 100 bot lavalink
```

---

## 6. Live Discord Voice & Audio Quality Verification Checklist

1. **Discord Channel Bitrate**: Set your Discord voice channel bitrate to `96 kbps` (or `128–384 kbps` if boosted).
2. **Cold Join Playback**: Disconnect the bot completely, join voice, run `/play <song>` and verify zero startup stutter.
3. **Track Transitions & Controls**: Queue multiple tracks, test `/skip`, `/previous`, `/pause`, `/resume`, `/seek`, `/volume`, `/equalizer`, `/bassboost`, `/autoplay`, and Now Playing buttons.
4. **Audio Telemetry Check**: Run `/stats` and inspect **Frame Deficits** and **Lavalink JVM**.
5. **1000ms vs 5000ms Frame Buffer Tuning**:
   - Baseline in `lavalink/application.yml` is `frameBufferDurationMs: 5000` and `opusEncodingQuality: 8`.
   - To compare startup responsiveness vs jitter resilience, edit `frameBufferDurationMs: 1000`, run `sudo docker compose -f compose.yaml restart lavalink`, and compare `/stats` frame deficits and `/ping` voice latency.

---

## 7. Rollback Instructions

If you need to roll back to V2:

1. **Stop & remove V3 containers cleanly** (prevents container name conflicts):
   ```bash
   cd /mnt/YOUR_POOL/path/to/VirusMusicBot
   sudo docker compose -f compose.yaml down
   ```
2. **Restore backed-up config, `.env`, and persistent data**:
   ```bash
   cp ../vmp-backup-YYYY-MM-DD/.env .env
   cp -a ../vmp-backup-YYYY-MM-DD/docker-compose.yml ./docker-compose.yml
   cp -a ../vmp-backup-YYYY-MM-DD/application.yml ./lavalink/application.yml
   rm -rf data && cp -a ../vmp-backup-YYYY-MM-DD/data ./data
   ```
3. **Check out V2 commit (if using Git) and verify V2 image tags in `running-images.txt`**:
   ```bash
   git checkout 92b2005
   sudo docker compose -f docker-compose.yml up -d --force-recreate
   ```
4. **If rolling back only `data/` permissions** for a V2 root-based container, note V2 ran as `root` while V3 runs as UID `1000`.
