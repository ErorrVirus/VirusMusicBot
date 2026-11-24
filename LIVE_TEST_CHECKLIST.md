# VirusMusicPro V3 — Live Test Checklist

> [!IMPORTANT]
> Run these steps on your TrueNAS SCALE server **after** copying the project files and setting up your `.env`.
> Complete each section in order. Do not skip validation steps.

---

## Pre-Flight: Environment Setup

```bash
# 1. Navigate to your project directory
cd /mnt/MYserver/VirusMusicBot      # adjust to your actual path

# 2. Confirm .env exists and has required fields
grep -E "DISCORD_TOKEN|CLIENT_ID|LAVALINK_PASSWORD" .env

# 3. Generate a secure JWT secret if not set
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy output → DASHBOARD_JWT_SECRET in .env (must be ≥ 32 chars)

# 4. Verify compose file is valid
sudo docker compose config --quiet && echo "✅ compose.yaml is valid"
```

**Expected:** No errors; `DISCORD_TOKEN`, `CLIENT_ID`, `LAVALINK_PASSWORD` all printed.

---

## Step 1: Pull & Build

```bash
# Pull fresh images
sudo docker compose pull

# Build bot image (no cache to ensure clean build)
sudo docker compose build --no-cache bot

# Check image was built successfully
sudo docker images | grep virusmusicbot
```

**Expected:** Image `virusmusicbot-bot` or similar appears in image list.

---

## Step 2: Start Services

```bash
# Start all services detached
sudo docker compose up -d

# Wait 60-90s for Lavalink health check to pass, then verify
sudo docker compose ps
```

**Expected output:**
```
NAME                      STATUS
virusmusicbot_bot         Up (healthy) or Up
virusmusicbot_lavalink    Up (healthy)
virusmusicbot_yt_cipher   Up
```

---

## Step 3: Lavalink Health Check

```bash
# Check Lavalink container health status
sudo docker inspect virusmusicbot_lavalink --format '{{.State.Health.Status}}'

# Directly query the Lavalink REST version endpoint
curl -s -H "Authorization: $LAVALINK_PASSWORD" http://localhost:2333/version
```

> [!NOTE]
> `LAVALINK_PASSWORD` in the curl must match what's in your `.env` file.
> Replace `localhost` with the TrueNAS IP if testing from another machine.

**Expected:** `{"version": "4.2.2", ...}` JSON response. Health: `healthy`.

---

## Step 4: Bot Logs Check

```bash
# Tail bot logs and look for successful startup markers
sudo docker compose logs --tail 60 bot
```

**Expected log lines (in order):**
1. `Lavalink is healthy — starting bot...`
2. `✅ [Bot] Logged in as VirusMusic#8910`
3. `[Lavalink] Node Primary Node is ready!`
4. `Successfully reloaded commands for guild ...`

**Common failures:**
- `DISCORD_TOKEN is missing` → check `.env`
- `LAVALINK_PASSWORD is missing` → check `.env`
- `Could not connect to Lavalink` → check Lavalink health (Step 3)

---

## Step 5: Slash Command Registration

```bash
# Commands are auto-registered at startup for the configured guild.
# Verify by checking for the reload success line in bot logs:
sudo docker compose logs bot 2>&1 | grep "Successfully reloaded"
```

If commands don't appear in Discord:

```bash
# Force re-register (runs inside the bot container)
sudo docker compose exec bot node src/deploy-commands.js
```

> [!TIP]
> Guild commands appear immediately. Global commands can take up to 1 hour to propagate.

---

## Step 6: Audio Playback Tests (Manual — Discord)

Perform these tests in a Discord server where the bot is present:

| # | Action | Expected Result |
|---|---|---|
| 6.1 | `/play` a YouTube URL | Bot joins voice, track starts playing within ~3 seconds |
| 6.2 | `/play` a Spotify track URL | Bot resolves via YouTube Music and plays |
| 6.3 | `/play` a YouTube playlist URL | Multiple tracks queued; first plays immediately |
| 6.4 | `/skip` | Next track starts; no double-skip |
| 6.5 | `/pause` → `/resume` | Playback pauses and resumes from same position |
| 6.6 | `/volume 150` | Volume increases; `/stats` shows new volume |
| 6.7 | `/equalizer bass_boost` | Bass-boosted audio audible |
| 6.8 | `/loop track` → song ends | Same song replays automatically |
| 6.9 | `/loop queue` → queue exhausted | Queue cycles without autoplay trigger |
| 6.10 | `/autoplay` → queue exhausted with loop=none | Autoplay queues similar tracks |
| 6.11 | `/247` → everyone leaves voice | Bot stays in channel |
| 6.12 | Bot kicked from voice channel | Bot destroys player cleanly; no error spam |
| 6.13 | `/stats` | Shows frame deficit, voice ping, playback metrics |
| 6.14 | `/lyrics` | Shows lyrics for current track if available |

---

## Step 7: Dashboard Check

```bash
# Verify dashboard port is listening
curl -sk http://localhost:4000/login | grep -i "VirusMusicPro\|login" | head -3
```

**Expected:** HTML containing "login" form. Navigate to `http://TRUENAS_IP:4000` in a browser.

> [!CAUTION]
> Never expose port 4000 directly to the internet. Use Tailscale, WireGuard, or Nginx reverse proxy with TLS.

---

## Step 8: Audio Latency Benchmark (Optional)

1. Edit `lavalink/application.yml`:
   - Set `frameBufferDurationMs: 1000` (default; try `5000` if stuttering persists)
   - Set `opusEncodingQuality: 10` (highest quality)

2. Restart Lavalink: `sudo docker compose restart lavalink`

3. Play a song for 30 seconds in Discord.

4. Run `/stats` and note:
   - `Frame Deficit` → should be 0 on healthy hardware
   - `Voice Ping` → should be < 100ms
   - `Playback Failures` → should be 0 for a stable track

5. If frame deficit > 0, try `opusEncodingQuality: 5` or increase `-Xmx` in compose.yaml Lavalink environment.

---

## Step 9: YT Cipher Image Pinning (Security)

```bash
# Pull the current yt-cipher image to get its digest
sudo docker pull ghcr.io/kikkia/yt-cipher:master

# Get the digest
sudo docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/kikkia/yt-cipher:master
# Output example: ghcr.io/kikkia/yt-cipher@sha256:abc123...

# Add to .env:
echo "YT_CIPHER_IMAGE=ghcr.io/kikkia/yt-cipher@sha256:abc123..." >> .env

# Redeploy
sudo docker compose up -d --force-recreate yt-cipher
```

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Bot logs: `permission denied while trying to connect to Docker` | Running as non-root user | Use `sudo docker` or add user to `docker` group |
| Lavalink stuck in `starting` | Plugin download failed; needs internet | Check Lavalink logs: `sudo docker compose logs lavalink` |
| Bot connects but no audio | Lavalink not `healthy` | Wait 60s; check `sudo docker compose ps` |
| `no configuration file provided` | Running `docker compose` from wrong dir | `cd` to the VirusMusicBot directory first |
| Dashboard shows blank page | JWT secret < 32 chars | Regenerate `DASHBOARD_JWT_SECRET` |
| Spotify tracks fail to resolve | Missing client credentials | Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` |
| YouTube blocks with 403 | Datacenter IP blocked | Set `YOUTUBE_REFRESH_TOKEN` via YouTube OAuth |
| Stutter on first connection | Voice ready check; normal | Fixed in V3 — voice ready timeout now 10 000 ms; bot waits for Lavalink confirmation |
