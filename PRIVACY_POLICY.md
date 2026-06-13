# Privacy Policy for VirusMusicBot

Last updated: June 13, 2026

This Privacy Policy explains how VirusMusicBot ("the Bot", "we", "our", or "us") handles data when you use the Bot within your Discord servers.

## 1. Data We Collect
VirusMusicBot is designed to be privacy-friendly. The Bot **does not** collect, store, or log any personally identifiable information (PII) or permanent user data in any database. 

The Bot only temporarily processes the following data in memory to function:
- **Discord User IDs & Usernames**: Processed temporarily to attribute song requests to the user who invoked the command.
- **Discord Server (Guild) IDs & Voice Channel IDs**: Processed temporarily to join the correct voice channels and manage the active music queue.
- **Message/Command Content**: Processed temporarily to search for and play the requested audio tracks.

## 2. Data Storage
**We do not use any databases.** All music queues, active connections, and temporary user associations are stored strictly in volatile system memory (RAM). When the Bot restarts or leaves a voice channel, this temporary data is permanently destroyed.

## 3. Third-Party Services
The Bot uses Lavalink to search and stream audio. When you request a song, the search query or URL is sent to the Lavalink node, which interacts with third-party platforms (like YouTube or Spotify) to retrieve the audio stream. 

## 4. Data Sharing
We do not sell, share, or distribute any user or server data to third parties.

## 5. Contact
If you have any questions or concerns about this Privacy Policy, please contact the bot developer or open an issue in the GitHub repository.
