# VirusMusicBot V2 🎶

A completely new, robust, pure Shoukaku Discord Music Bot designed specifically to run perfectly on TrueNAS SCALE via Dockge/Docker Compose.

## Features
- **Raw Shoukaku**: No middleman queue bugs. Direct handling of Lavalink events.
- **Robust Queue System**: Autoplay, Loop (Track/Queue), Skip, Previous, Shuffle, Move, Remove.
- **Zero-Dependency Queue**: Stores queues in memory to save RAM. No PostgreSQL/Redis needed!
- **Spotify & YouTube**: Automatically resolves Spotify tracks/playlists/albums directly to YouTube.
- **Instant Deployment**: `docker-compose.yml` configures everything instantly via environment variables.

## Deployment Instructions (TrueNAS / Dockge)

1. Open your Dockge or TrueNAS terminal in this directory.
2. Edit your `.env` file with your Discord and Spotify credentials. Ensure you have the `SPOTIFY_SPDC` cookie if you want 100% stable Spotify support.
3. Start the bot by clicking **Deploy** in Dockge, or by running:
```bash
docker compose up -d --build
```
*(Note: Because we removed Postgres and Redis to save you RAM, it will deploy extremely fast!)*

## Required Environment Variables
See the `.env.example` file for a list of all required environment variables.

## Support
Built by Antigravity for ErorrVirus. 🚀
