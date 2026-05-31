# ============================================================
#  VirusMusicPro — Bot Entry Point
#  Initialises the Discord client, loads cogs, and starts the bot.
# ============================================================

from __future__ import annotations

import asyncio
import logging
import sys
import os

import discord
from discord.ext import commands
import keep_alive

from config import DISCORD_TOKEN

# ── Write YouTube Cookies to File ──────────────────────────────
# If we provided YouTube cookies via an environment variable (for Render),
# write them out to a cookies.txt file so yt-dlp can read them.
if os.environ.get("YOUTUBE_COOKIES"):
    with open("cookies.txt", "w", encoding="utf-8") as f:
        f.write(os.environ["YOUTUBE_COOKIES"])

# ── Logging Setup ─────────────────────────────────────────────
# Format: [LEVEL] YYYY-MM-DD HH:MM:SS | module_name | message
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(asctime)s | %(name)-24s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
# Quieten noisy third-party loggers
logging.getLogger("discord").setLevel(logging.WARNING)
logging.getLogger("discord.http").setLevel(logging.WARNING)
logging.getLogger("yt_dlp").setLevel(logging.WARNING)
logging.getLogger("spotipy").setLevel(logging.WARNING)
# This bot uses slash commands only — the message_content privileged intent
# is intentionally omitted.  Silence the misleading startup warning.
logging.getLogger("discord.ext.commands.bot").setLevel(logging.ERROR)

log = logging.getLogger("VirusMusicPro")

# ── Discord Intents ───────────────────────────────────────────
# We need:
#  - guilds     → server / channel access
#  - voice_states → join/leave voice channels, track bot placement
intents = discord.Intents.default()
intents.guilds      = True
intents.voice_states = True
# NOTE: message_content intent is NOT required because we use slash commands only.


class VirusMusicBot(commands.Bot):
    """
    Custom Bot subclass.

    Overriding ``setup_hook`` lets us load extensions and sync the
    command tree before the bot comes online.
    """

    def __init__(self) -> None:
        super().__init__(
            command_prefix="!",   # prefix commands are disabled; this is a placeholder
            intents=intents,
            help_command=None,    # we don't expose a legacy !help command
        )

    async def setup_hook(self) -> None:
        """
        Called by discord.py BEFORE the WebSocket connection is established.
        Load extensions and sync the global application command tree.
        """
        # Load the music cog
        await self.load_extension("cogs.music")
        log.info("Loaded cog: cogs.music")

        # Sync slash commands globally.
        # On first launch this can take up to 1 hour for Discord to propagate.
        # During development you may pass a guild= object to sync instantly.
        synced = await self.tree.sync()
        log.info("Synced %d application command(s) globally.", len(synced))

        # Start the keep-alive web server for UptimeRobot
        self.loop.create_task(keep_alive.start_web_server())

    async def on_ready(self) -> None:
        """Fired once the bot has successfully connected to Discord."""
        log.info(
            "Logged in as %s (ID: %d) -- latency %.0fms",
            self.user,
            self.user.id,
            self.latency * 1000,
        )
        # Set a nice activity status
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="/play — VirusMusicPro",
            )
        )

    async def on_app_command_error(
        self,
        interaction: discord.Interaction,
        error: app_commands.AppCommandError,
    ) -> None:
        """
        Global slash-command error handler.
        Catches anything not already handled inside a command.
        """
        log.error("Unhandled app command error: %s", error, exc_info=True)
        message = "❌ An unexpected error occurred. Please try again later."

        embed = discord.Embed(description=message, color=0xED4245)
        try:
            if interaction.response.is_done():
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message(embed=embed, ephemeral=True)
        except discord.DiscordException:
            pass  # interaction already expired


# Import needed for type hint in on_app_command_error
from discord import app_commands   # noqa: E402


# ── Entry point ───────────────────────────────────────────────

async def main() -> None:
    bot = VirusMusicBot()
    async with bot:
        await bot.start(DISCORD_TOKEN)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Bot stopped by user (KeyboardInterrupt).")
