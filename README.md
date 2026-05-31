# 🎵 VirusMusicPro

A production-ready, modular Discord music bot built with **discord.py**, **yt-dlp**, **FFmpeg**, and **Spotipy** — delivering premium music playback that rivals Pancake and Groovy.

---

## ✨ Features

| Feature | Details |
|---|---|
| **YouTube playback** | Video URLs, playlist URLs, and search queries |
| **Spotify integration** | Track, playlist & album URLs resolved via Spotipy → yt-dlp |
| **Slash commands** | `/play`, `/skip`, `/queue`, `/stop`, `/np` |
| **Per-guild queues** | Fully isolated `asyncio.Queue` per server |
| **Smooth streaming** | Optimised FFmpeg reconnect options — no stuttering |
| **Auto-disconnect** | Leaves voice after configurable inactivity timeout |
| **Lazy playlist resolution** | Playlists enqueue instantly; audio resolves per-track just before play |
| **Rich embeds** | Now-playing, queue, error — all in styled Discord embeds |

---

## 📁 Project Structure

```
VirusMusicPro/
├── bot.py                  # Entry point — Bot class, startup, global error handler
├── config.py               # All constants & env vars (FFmpeg, yt-dlp, colours, limits)
├── requirements.txt        # Python dependencies
├── .env.example            # Template — copy to .env and fill in secrets
├── .gitignore
│
├── models/
│   └── track.py            # Track dataclass (title, url, duration, requester, etc.)
│
├── services/
│   ├── ytdl_source.py      # Async yt-dlp wrapper (search, single video, playlist)
│   └── spotify_resolver.py # Spotify URL → search query resolver (tracks/playlists/albums)
│
├── core/
│   ├── guild_player.py     # GuildPlayer — voice client + async playback loop per guild
│   └── player_registry.py  # Registry mapping guild_id → GuildPlayer
│
└── cogs/
    └── music.py            # MusicCog — all slash commands
```

---

## 🔧 Prerequisites

### 1. Python 3.10 or newer
Download from [python.org](https://www.python.org/downloads/).

### 2. FFmpeg (required for audio processing)

**Windows:**
```powershell
# Option A — Chocolatey (recommended)
choco install ffmpeg

# Option B — Winget
winget install Gyan.FFmpeg

# Option C — Manual
# Download from https://ffmpeg.org/download.html, extract,
# and add the /bin folder to your system PATH.
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt update && sudo apt install ffmpeg -y
```

Verify the installation:
```bash
ffmpeg -version
```

---

## 🚀 Installation

### Step 1 — Clone / Download the project

```bash
git clone https://github.com/yourname/VirusMusicPro.git
cd VirusMusicPro
```

### Step 2 — Create a virtual environment (highly recommended)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### Step 3 — Install dependencies

```bash
pip install -r requirements.txt
```

---

## 🔑 Configuration

### Step 1 — Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in all three credentials:

```env
DISCORD_TOKEN=your_discord_bot_token_here
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
```

### Step 2 — Get your Discord bot token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Navigate to **Bot** → click **Add Bot**
4. Under **Token**, click **Reset Token** and copy it into `.env`
5. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** *(optional but recommended)*
   - ✅ **Voice States** *(required)*
6. Navigate to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`, `Embed Links`, `Read Message History`
7. Copy the generated URL, open it in your browser, and invite the bot to your server.

### Step 3 — Get your Spotify credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Set any Redirect URI (e.g. `http://localhost:8888/callback`) — it won't be used
4. Copy the **Client ID** and **Client Secret** into `.env`

---

## ▶️ Running the Bot

```bash
python bot.py
```

You should see output like:

```
INFO     2024-01-15 10:30:00 | VirusMusicPro           | Loaded cog: cogs.music
INFO     2024-01-15 10:30:01 | VirusMusicPro           | Synced 5 application command(s) globally.
INFO     2024-01-15 10:30:01 | VirusMusicPro           | ✅  Logged in as VirusMusicPro#1234 (ID: ...) — latency 42ms
```

> **Note:** Global slash commands can take up to 1 hour to appear in Discord after first sync. For instant testing during development, see [Guild-Specific Sync](#guild-specific-sync-development-tip) below.

---

## 🎮 Commands

| Command | Description |
|---|---|
| `/play <query or URL>` | Play a YouTube/Spotify track, playlist, album, or search query |
| `/pause` | Pause the currently playing track |
| `/resume` | Resume paused playback |
| `/skip` | Skip the current track |
| `/queue [page]` | Show the upcoming tracklist (paginated) |
| `/stop` | Stop playback, clear the queue, and disconnect |
| `/np` | Show the currently playing track |

### `/play` examples

```
/play Bohemian Rhapsody Queen
/play https://www.youtube.com/watch?v=dQw4w9WgXcQ
/play https://www.youtube.com/playlist?list=PLxxxxxx
/play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
/play https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO
/play https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv
```

---

## ⚙️ Optional Tuning (`.env` variables)

| Variable | Default | Description |
|---|---|---|
| `MAX_QUEUE_SIZE` | `200` | Maximum tracks per guild queue |
| `INACTIVITY_TIMEOUT` | `300` | Seconds before auto-disconnect when idle |

---

## 🛠️ Guild-Specific Sync (Development Tip)

Global command sync takes up to 1 hour. During development, sync to a specific test guild for instant updates:

In `bot.py`, modify `setup_hook`:

```python
async def setup_hook(self) -> None:
    await self.load_extension("cogs.music")
    
    # Replace with your test server's ID:
    TEST_GUILD = discord.Object(id=123456789012345678)
    self.tree.copy_global_to(guild=TEST_GUILD)
    await self.tree.sync(guild=TEST_GUILD)
```

---

## 🐳 Running with Docker (Optional)

Create a `Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "bot.py"]
```

```bash
docker build -t virusmusicpro .
docker run --env-file .env virusmusicpro
```

---

## 🔍 Troubleshooting

| Problem | Solution |
|---|---|
| `ffmpeg not found` | Ensure FFmpeg is installed and on your system `PATH` |
| `PyNaCl not found` | Run `pip install PyNaCl` |
| Commands not appearing | Wait up to 1 hour for global sync, or use guild-specific sync |
| Bot joins but no audio | Check `Speak` permission in the voice channel |
| Spotify playlist is slow to queue | Normal — large playlists resolve lazily per-track |
| Age-restricted YouTube video fails | Set `cookiesfrombrowser` in `config.py` YTDL options |
| `DISCORD_TOKEN` missing | Ensure `.env` is in the project root, not a subdirectory |

---

## 📄 License

MIT — free to use, modify, and distribute.
