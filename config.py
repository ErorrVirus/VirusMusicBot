# ============================================================
#  VirusMusicPro — Bot Configuration
#  Central place for all non-secret tuneable settings.
# ============================================================

import os
from dotenv import load_dotenv

# Load .env file into the environment (safe to call multiple times)
load_dotenv()


# ── Credentials (read from environment) ─────────────────────
DISCORD_TOKEN: str = os.environ["DISCORD_TOKEN"]
SPOTIFY_CLIENT_ID: str = os.environ["SPOTIFY_CLIENT_ID"]
SPOTIFY_CLIENT_SECRET: str = os.environ["SPOTIFY_CLIENT_SECRET"]

# ── Spotify OAuth (required for playlist & album access) ─────
# Spotify no longer allows the Client Credentials flow to access
# playlist tracks — even public ones.  To support playlists and albums
# you must authenticate once as a real Spotify user.
#
# Step 1: set SPOTIFY_REDIRECT_URI to any URI you registered in the
#         Spotify Developer Dashboard (e.g. http://localhost:8888/callback).
# Step 2: run `python spotify_auth.py` once to get your refresh token.
# Step 3: paste the printed refresh token into SPOTIFY_REFRESH_TOKEN below.
#
# If SPOTIFY_REFRESH_TOKEN is not set, the bot falls back to Client
# Credentials and only single Spotify track links will work.
SPOTIFY_REDIRECT_URI: str = os.getenv(
    "SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback"
)
SPOTIFY_REFRESH_TOKEN: str = os.getenv("SPOTIFY_REFRESH_TOKEN", "")


# ── Queue Limits ─────────────────────────────────────────────
MAX_QUEUE_SIZE: int = int(os.getenv("MAX_QUEUE_SIZE", "200"))

# ── Inactivity Auto-disconnect ───────────────────────────────
INACTIVITY_TIMEOUT: int = int(os.getenv("INACTIVITY_TIMEOUT", "300"))

# ── FFmpeg Audio Options ─────────────────────────────────────
# before_options: passed to ffmpeg BEFORE the input specifier
#   -reconnect            → reconnect on drop
#   -reconnect_streamed   → reconnect for live/streamed sources
#   -reconnect_delay_max  → max seconds to wait between retries
FFMPEG_BEFORE_OPTIONS: str = (
    "-reconnect 1 "
    "-reconnect_streamed 1 "
    "-reconnect_delay_max 5"
)

# options: passed AFTER the input specifier
#   -vn     → disable video (audio-only)
#   -b:a    → target audio bitrate
#   -bufsize → buffer size for smoother streaming
FFMPEG_OPTIONS: str = "-vn -b:a 128k -bufsize 256k"

# ── yt-dlp Extraction Options ────────────────────────────────
# format: prefer opus inside webm (lowest latency for Discord)
#   bestaudio: best available audio-only stream
#   [acodec=opus]: prefer Opus codec (native Discord codec)
#   [ext=webm]:    prefer WebM container (avoids re-mux overhead)
YTDL_FORMAT_OPTIONS: dict = {
    "format": "bestaudio[acodec=opus][ext=webm]/bestaudio/best",
    "outtmpl": "%(extractor)s-%(id)s-%(title)s.%(ext)s",
    "restrictfilenames": True,
    "noplaylist": True,          # single-video extraction (playlists handled manually)
    "nocheckcertificate": True,
    "ignoreerrors": False,
    "logtostderr": False,
    "quiet": True,
    "no_warnings": True,
    "default_search": "ytsearch",  # treat bare queries as YouTube searches
    "source_address": "0.0.0.0",   # bind to all interfaces (IPv4/IPv6 safe)
    "extract_flat": False,
    "skip_download": True,         # stream in-place; never download to disk
}

# If cookies.txt exists in the working directory, tell yt-dlp to use it
if os.path.exists("cookies.txt"):
    YTDL_FORMAT_OPTIONS["cookiefile"] = "cookies.txt"

# ── Embed Colours ─────────────────────────────────────────────
COLOR_PRIMARY = 0x1DB954   # Spotify green — used for "now playing"
COLOR_QUEUE   = 0x5865F2   # Discord blurple — used for queue list
COLOR_ERROR   = 0xED4245   # Discord red — used for errors
COLOR_SUCCESS = 0x57F287   # Discord green — used for success messages
COLOR_WARNING = 0xFEE75C   # Discord yellow — used for warnings

# ── Queue Display ─────────────────────────────────────────────
QUEUE_DISPLAY_LIMIT: int = 10   # max tracks shown in /queue embed
