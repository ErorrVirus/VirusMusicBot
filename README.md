# VirusMusicPro - TrueNAS Discord Music Bot

A production-ready Discord Music Bot completely optimized for **TrueNAS SCALE** and **Dockge**. It uses **Discord.js v14**, **Kazagumo/Shoukaku**, and **Lavalink v4** to deliver perfectly stable, crystal-clear audio.

## Features
- Complete queue management (`/play`, `/skip`, `/stop`, `/pause`, `/resume`, `/shuffle`, `/move`, `/remove`, `/loop`, `/previous`, `/nowplaying`, `/disconnect`)
- Rich embeds and interactive Now Playing UI
- Spotify Playlist & Album Auto-Resolution
- Robust PostgreSQL Database for Queue Auto-Resume (survives container restarts)
- Pure `network_mode: host` to eliminate TrueNAS UDP NAT Hole-Punching issues
- Extremely low memory footprint via Alpine Docker images

---

## TrueNAS / Dockge Deployment Guide

### 1. Prerequisites
- TrueNAS SCALE
- Dockge (or standard Docker Compose)
- A Discord Bot Token (from the [Discord Developer Portal](https://discord.com/developers/applications))
- A Spotify Client ID and Secret (from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard))

### 2. Prepare the Environment
1. In your TrueNAS `appdata` or `docker` dataset, create a folder named `virusmusic`.
2. Inside that folder, create a file named `.env` and copy the contents of `.env.example` into it.
3. Fill out the `.env` file with your Discord and Spotify credentials.

### 3. Deploy via Dockge
1. Open Dockge and click **+ Compose**.
2. Name the stack `virusmusic`.
3. Copy the entire contents of the provided `docker-compose.yml` into the text editor.
4. Click **Deploy**.

The stack will automatically spin up PostgreSQL, Redis, Lavalink, and the Node.js Bot. Because the stack uses `network_mode: "host"`, Lavalink's UDP streams will natively punch through the TrueNAS firewall directly to Discord's Voice Servers, completely eliminating the "Connected but No Sound" bug.

---

## Troubleshooting

- **Bot Joins but No Sound:** Ensure your TrueNAS isn't using a custom firewall blocking outbound UDP traffic on ports `50000-65535`. The `network_mode: "host"` implementation natively solves the TrueNAS symmetric NAT issue.
- **Port Conflicts:** The stack runs on `network_mode: "host"`. If your TrueNAS server is already running a local Postgres database on port `5432` or Redis on `6379`, you must change the internal ports or revert Postgres/Redis to bridge mode while keeping Lavalink and the Bot on host mode.

---
*Created using Node.js and Lavalink.*
