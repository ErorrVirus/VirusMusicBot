# VirusMusicPro (Node.js + Lavalink v4)

A complete, production-ready Discord Music Bot built with `discord.js` v14, `Lavalink v4`, and `Kazagumo`. 
This project is fully structured to be deployed easily on **Render.com's Free Tier** using Docker.

## Features
- **YouTube Playback**: Search and play YouTube via the Lavalink v4 YouTube Plugin.
- **Spotify Support**: Extracts metadata from Spotify links and plays audio via YouTube fallback seamlessly.
- **Queue System**: Robust song queue management.
- **Modern Commands**: Uses Discord.js v14 Slash Commands.
- **Render Ready**: Includes a Dockerfile that starts both Java (Lavalink) and Node.js on a single Render Web Service, bound to a dummy port to keep Render happy.

## 🚀 Setup & Deployment

### 1. GitHub Setup
1. Upload this exact folder structure to a new GitHub repository.

### 2. Render.com Deployment
1. Go to [Render.com](https://render.com) and create a new **Web Service**.
2. Connect your GitHub repository.
3. **Environment Settings**:
   - Environment: `Docker`
   - Branch: `main`
4. **Environment Variables**:
   Under the "Environment" section in Render, add the following variables:
   - `DISCORD_TOKEN`: Your bot token from Discord Developer Portal.
   - `SPOTIFY_CLIENT_ID`: (Optional) For Spotify link support.
   - `SPOTIFY_CLIENT_SECRET`: (Optional) For Spotify link support.
   - `LAVALINK_HOST`: `127.0.0.1`
   - `LAVALINK_PORT`: `2333`
   - `LAVALINK_PASSWORD`: `youshallnotpass`
5. Click **Deploy**. Render will automatically build the Dockerfile, install Java & Node.js, and boot up both the Lavalink Server and your Discord Bot!

## Local Development
If you want to run this locally:
1. Ensure you have **Node.js 20+** and **Java 17+** installed.
2. Download `Lavalink.jar` (v4.0.5) and place it in the root folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and fill in your keys.
5. In one terminal, run: `java -jar Lavalink.jar`
6. In another terminal, run: `npm start`

## Architecture
- **Discord Bot (Node.js)**: Receives slash commands and manages voice channel state using `discord.js` + `shoukaku`.
- **Lavalink Manager (Kazagumo)**: Handles queue logic, Spotify parsing, and track resolution.
- **Lavalink Server (Java)**: The heavy lifter that downloads audio streams from YouTube/SoundCloud and sends them via WebSocket to the Discord voice channels.
