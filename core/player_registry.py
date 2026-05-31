# ============================================================
#  VirusMusicPro — Player Registry
#  Manages the mapping of guild_id → GuildPlayer instances.
# ============================================================

from __future__ import annotations

import logging
from typing import Optional

import discord

from core.guild_player import GuildPlayer

log = logging.getLogger(__name__)


class PlayerRegistry:
    """
    A simple registry that maps Discord guild IDs to active GuildPlayer
    instances.

    This is the single source of truth for all active music sessions.
    The Music cog holds one shared PlayerRegistry so all commands can
    look up or create the correct player for the current guild.
    """

    def __init__(self) -> None:
        self._players: dict[int, GuildPlayer] = {}

    # ── Retrieval ─────────────────────────────────────────────

    def get(self, guild_id: int) -> Optional[GuildPlayer]:
        """Return the player for the given guild, or None if none exists."""
        return self._players.get(guild_id)

    def get_or_create(
        self,
        guild: discord.Guild,
        voice_client: discord.VoiceClient,
        text_channel: discord.TextChannel,
    ) -> GuildPlayer:
        """
        Return the existing player for the guild, or create (and start) a
        new one if this is the first play command in this session.

        If the guild already has a player but the voice client changed
        (e.g. bot was moved between channels), the voice client reference
        is updated in-place.
        """
        player = self._players.get(guild.id)
        if player is None:
            player = GuildPlayer(guild, voice_client, text_channel)
            player.start()
            self._players[guild.id] = player
            log.info("Created new GuildPlayer for guild '%s' (%d)", guild.name, guild.id)
        else:
            # Update voice client in case the bot was moved
            player.voice_client = voice_client
            player.text_channel = text_channel
        return player

    # ── Cleanup ───────────────────────────────────────────────

    async def remove(self, guild_id: int) -> None:
        """Stop and remove the player for the given guild."""
        player = self._players.pop(guild_id, None)
        if player:
            await player.stop()
            log.info("Removed GuildPlayer for guild %d", guild_id)

    async def shutdown_all(self) -> None:
        """Stop all active players (called on bot shutdown)."""
        for guild_id, player in list(self._players.items()):
            await player.stop()
            log.info("Shutdown GuildPlayer for guild %d", guild_id)
        self._players.clear()

    # ── State queries ─────────────────────────────────────────

    def __contains__(self, guild_id: int) -> bool:
        return guild_id in self._players

    def __len__(self) -> int:
        return len(self._players)
