# VirusMusicPro

A robust, production-ready Discord Music Bot utilizing Discord.js v14, Shoukaku, Kazagumo, and Lavalink v4. 
Designed specifically for deployment on TrueNAS SCALE (25.04) and Docker environments.

## Features
- **YouTube Support:** High quality playback via the latest Lavalink YouTube plugin.
- **Spotify Integration:** Convert Spotify Tracks, Albums, and Playlists directly into playback streams without requiring a premium Spotify account.
- **SoundCloud Fallback:** Native support for SoundCloud bypassing strict YouTube IP blocks.
- **Slash Commands Only:** Modern Discord interface.
- **Auto-Reconnect:** Rock solid stability with auto-resume functionality.
- **Docker Ready:** Built to run cleanly in Docker Compose with zero manual installations.

## Requirements
- A server capable of running Docker Compose (e.g. TrueNAS SCALE, Ubuntu, etc.)
- At least 1GB of RAM for the Java Lavalink server.

## Installation Guide (TrueNAS SCALE & Docker)

### 1. Discord Developer Portal Setup
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name.
3. Go to the **Bot** tab, click **Reset Token**, and copy your `DISCORD_TOKEN`.
4. Scroll down and enable **Message Content Intent**, **Server Members Intent**, and **Presence Intent**.
5. Go to the **OAuth2 > General** tab, copy your `CLIENT_ID`.
6. Go to **OAuth2 > URL Generator**.
7. Select scopes: `bot` and `applications.commands`.
8. Select bot permissions: `Send Messages`, `Embed Links`, `Connect`, `Speak`, `Use Voice Activity`.
9. Copy the generated URL and paste it in your browser to invite the bot to your server.

### 2. Spotify API Setup (Required)
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/).
2. Log in and click **Create app**.
3. Name it "Discord Bot", set a description, and put `http://localhost` as the Redirect URI.
4. Go to the app's settings.
5. Copy your **Client ID** and **Client Secret**.

### 3. Server Deployment
1. Clone this repository to your TrueNAS dataset.
```bash
git clone https://github.com/ErorrVirus/VirusMusicBot.git
cd VirusMusicBot
```

2. Create your `.env` file from the example:
```bash
cp .env.example .env
```

3. Edit the `.env` file with your preferred text editor (e.g., `nano .env`) and fill in the variables using the tokens you gathered above.

4. Start the stack:
```bash
docker compose up -d
```

5. The first startup will take a moment as Docker pulls the Node.js and Lavalink images. You can monitor the logs using:
```bash
docker compose logs -f
```

## Troubleshooting & Common Errors

### Lavalink Not Connecting
Ensure `LAVALINK_HOST` in your `.env` is set to `lavalink` (which resolves to the Docker Compose service name), and that `LAVALINK_PASSWORD` matches exactly what is in the `.env` file. 

### Bot Online but No Audio / YouTube Blocks
YouTube aggressively blocks Datacenter IPs. This project is configured to completely bypass YouTube by default, routing all queries and Spotify lookups through **SoundCloud** instead. Do not change the `lavasrc` configuration in `application.yml` unless you have a dedicated residential proxy.

### Spotify Links Not Working
If Spotify links fail instantly, double check your `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in your `.env` file. Lavalink requires these to fetch the metadata.

### Slash Commands Not Appearing
Slash commands can take up to an hour to cache globally. If you want them instantly, set `GUILD_ID` in your `.env` file to your specific Discord Server ID.

### Docker Startup Failures
If the `lavalink` container crashes on TrueNAS, ensure your server has enough RAM available. Java requires at least 1GB of memory. You can adjust the memory limit by changing `-Xmx1G` in `docker-compose.yml` to `-Xmx512m` if you are on a severely constrained system.
