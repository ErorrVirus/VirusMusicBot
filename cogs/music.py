# ============================================================
#  VirusMusicPro — Music Cog
#  All slash commands (/play, /skip, /queue) live here.
# ============================================================

from __future__ import annotations

import asyncio
import logging
import math
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from config import (
    COLOR_ERROR,
    COLOR_PRIMARY,
    COLOR_QUEUE,
    COLOR_SUCCESS,
    COLOR_WARNING,
    MAX_QUEUE_SIZE,
    QUEUE_DISPLAY_LIMIT,
)
from core import GuildPlayer, PlayerRegistry
from models import Track
from services import SpotifyResolver, YTDLSource

log = logging.getLogger(__name__)


class MusicCog(commands.Cog, name="Music"):
    """
    Discord slash-command cog providing music playback functionality.

    Registered commands
    -------------------
    /play  — queue a track or playlist from YouTube/Spotify/search.
    /skip  — skip the current track.
    /queue — display the upcoming tracklist.
    /stop  — stop playback and disconnect the bot.
    /np    — show what's currently playing.
    """

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.registry = PlayerRegistry()
        # Initialise Spotify resolver once; it authenticates lazily
        self._spotify = SpotifyResolver()

    # ── Cog event hooks ───────────────────────────────────────

    async def cog_unload(self) -> None:
        """Gracefully stop all players when the cog is unloaded."""
        await self.registry.shutdown_all()

    @commands.Cog.listener()
    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ) -> None:
        """
        Auto-cleanup: if the bot itself is disconnected from a voice channel
        (e.g. kicked by an admin), stop and remove its player.
        """
        if member.id != self.bot.user.id:
            return
        # Bot left a channel
        if before.channel is not None and after.channel is None:
            guild_id = member.guild.id
            if guild_id in self.registry:
                await self.registry.remove(guild_id)
                log.info(
                    "Bot disconnected from guild %d — player removed.", guild_id
                )

    # ════════════════════════════════════════════════════════
    #  /play
    # ════════════════════════════════════════════════════════

    @app_commands.command(
        name="play",
        description="▶️ Play a song or playlist. Supports YouTube URLs, Spotify URLs, and search queries.",
    )
    @app_commands.describe(
        query="YouTube URL / Spotify URL / search terms (e.g. 'Bohemian Rhapsody Queen')"
    )
    async def play(self, interaction: discord.Interaction, query: str) -> None:
        """
        Handle /play.

        Flow
        ----
        1. Validate that the user is in a voice channel.
        2. Join the voice channel (or reuse existing connection).
        3. Determine whether the query is a Spotify URL, YouTube URL, or search.
        4. Resolve track(s) and enqueue them.
        5. Start the player if not already running.
        """
        # Defer immediately — Discord requires acknowledgement within 3 seconds.
        # If the window has already passed (e.g. high load / network spike)
        # defer() raises NotFound (10062).  We catch it and bail out silently
        # rather than letting it become an unhandled CommandInvokeError.
        try:
            await interaction.response.defer(thinking=True)
        except (discord.NotFound, discord.HTTPException):
            # Interaction expired before we could acknowledge it; nothing to do.
            log.warning("/play interaction expired before defer() could complete.")
            return

        # ── Guard: user must be in a voice channel ────────
        voice_state: Optional[discord.VoiceState] = interaction.user.voice  # type: ignore[union-attr]
        if not voice_state or not voice_state.channel:
            await self._followup_error(
                interaction,
                "🎙️ You need to be in a voice channel to use this command.",
            )
            return

        voice_channel: discord.VoiceChannel = voice_state.channel  # type: ignore[assignment]

        # ── Check bot permissions ─────────────────────────
        perms: discord.Permissions = voice_channel.permissions_for(interaction.guild.me)  # type: ignore[arg-type]
        if not perms.connect:
            await self._followup_error(
                interaction,
                f"🔒 I don't have permission to join **{voice_channel.name}**.",
            )
            return
        if not perms.speak:
            await self._followup_error(
                interaction,
                f"🔇 I don't have permission to speak in **{voice_channel.name}**.",
            )
            return

        # ── Connect / move to voice channel ───────────────
        voice_client = await self._ensure_voice(interaction, voice_channel)
        if voice_client is None:
            return  # error already sent

        # ── Get or create a GuildPlayer ───────────────────
        player: GuildPlayer = self.registry.get_or_create(
            guild=interaction.guild,  # type: ignore[arg-type]
            voice_client=voice_client,
            text_channel=interaction.channel,  # type: ignore[arg-type]
        )

        # ── Route the query ───────────────────────────────
        try:
            await self._route_query(interaction, player, query)
        except asyncio.QueueFull:
            await self._followup_error(
                interaction,
                f"📭 The queue is full ({MAX_QUEUE_SIZE} tracks maximum). "
                "Please wait for some tracks to finish before adding more.",
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("Error in /play for guild %d", interaction.guild_id)
            await self._followup_error(
                interaction,
                f"❌ Something went wrong: `{exc}`",
            )

    # ── Query router ─────────────────────────────────────────

    async def _route_query(
        self,
        interaction: discord.Interaction,
        player: GuildPlayer,
        query: str,
    ) -> None:
        """
        Inspect the query and dispatch to the appropriate handler:
        - Spotify URL   → _handle_spotify()
        - YouTube playlist URL → _handle_yt_playlist()
        - YouTube video URL or search → _handle_yt_single()
        """
        query = query.strip()

        if SpotifyResolver.is_spotify_url(query):
            await self._handle_spotify(interaction, player, query)
        elif self._is_yt_playlist_url(query):
            await self._handle_yt_playlist(interaction, player, query)
        else:
            await self._handle_yt_single(interaction, player, query)

    # ── Spotify handler ───────────────────────────────────────

    async def _handle_spotify(
        self,
        interaction: discord.Interaction,
        player: GuildPlayer,
        url: str,
    ) -> None:
        """
        Resolve a Spotify URL to metadata, then search YouTube for each track.

        For playlists/albums we enqueue all tracks immediately using their
        Spotify metadata (title + artist) as placeholders and resolve each
        audio URL lazily just before playback starts.
        """
        loop = asyncio.get_running_loop()
        requester = interaction.user.display_name  # type: ignore[union-attr]

        # Spotify resolution is synchronous — run in executor
        try:
            metas = await loop.run_in_executor(
                None, self._spotify.resolve, url
            )
        except ValueError as exc:
            await self._followup_error(interaction, f"🎵 Spotify error: {exc}")
            return

        if not metas:
            await self._followup_error(
                interaction, "❓ No tracks found at that Spotify URL."
            )
            return

        if len(metas) == 1:
            # Single track: resolve the YouTube audio URL right now
            meta = metas[0]
            track = await YTDLSource.resolve_query(
                meta.search_query,
                requester=requester,
                source_label="spotify",
            )
            # Prefer Spotify's richer thumbnail if yt-dlp didn't find one
            if not track.thumbnail and meta.thumbnail:
                track = Track(
                    title=track.title,
                    url=track.url,
                    webpage_url=track.webpage_url,
                    duration=track.duration or (meta.duration_ms // 1000),
                    thumbnail=meta.thumbnail,
                    requester=track.requester,
                    source=track.source,
                )
            player.enqueue(track)
            await self._followup_queued(interaction, track)
        else:
            # Playlist / album — enqueue lightweight placeholder tracks
            # and resolve audio URLs lazily during playback.
            added = 0
            for meta in metas:
                placeholder = Track(
                    title=f"{meta.title} — {meta.artist}",
                    url=f"ytsearch:{meta.search_query}",   # signal to resolver
                    webpage_url=f"https://open.spotify.com/",
                    duration=meta.duration_ms // 1000,
                    thumbnail=meta.thumbnail,
                    requester=requester,
                    source="spotify",
                )
                try:
                    player.enqueue(placeholder)
                    added += 1
                except asyncio.QueueFull:
                    break

            embed = discord.Embed(
                description=f"Added **{added}** tracks from Spotify to the queue.",
                color=COLOR_SUCCESS,
            )
            try:
                await interaction.followup.send(embed=embed)
            except discord.DiscordException:
                pass  # interaction expired between defer and followup

    # ── YouTube playlist handler ──────────────────────────────

    async def _handle_yt_playlist(
        self,
        interaction: discord.Interaction,
        player: GuildPlayer,
        url: str,
    ) -> None:
        """
        Resolve a YouTube playlist and enqueue all tracks as placeholders.
        Audio URLs are resolved lazily just before each track plays.
        """
        requester = interaction.user.display_name  # type: ignore[union-attr]
        loop = asyncio.get_running_loop()

        try:
            tracks = await YTDLSource.resolve_playlist(url, loop=loop, requester=requester)
        except ValueError as exc:
            await self._followup_error(interaction, f"❌ Could not load playlist: {exc}")
            return

        if not tracks:
            await self._followup_error(
                interaction, "❓ The playlist appears to be empty or private."
            )
            return

        added = 0
        for track in tracks:
            try:
                player.enqueue(track)
                added += 1
            except asyncio.QueueFull:
                break

        embed = discord.Embed(
            description=f"Added **{added}** tracks from the YouTube playlist.",
            color=COLOR_SUCCESS,
        )
        if added < len(tracks):
            embed.set_footer(text=f"Queue full -- {len(tracks) - added} tracks were not added.")
        try:
            await interaction.followup.send(embed=embed)
        except discord.DiscordException:
            pass  # interaction expired between defer and followup

    # ── Single YouTube / search handler ──────────────────────

    async def _handle_yt_single(
        self,
        interaction: discord.Interaction,
        player: GuildPlayer,
        query: str,
    ) -> None:
        """Resolve a single YouTube video URL or search query and enqueue it."""
        requester = interaction.user.display_name  # type: ignore[union-attr]
        loop = asyncio.get_running_loop()

        source_label = "youtube" if query.startswith("http") else "search"

        track = await YTDLSource.resolve_query(
            query,
            loop=loop,
            requester=requester,
            source_label=source_label,
        )
        player.enqueue(track)
        await self._followup_queued(interaction, track)

    # ════════════════════════════════════════════════════════
    #  /skip
    # ════════════════════════════════════════════════════════

    @app_commands.command(name="skip", description="⏭️ Skip the currently playing track.")
    async def skip(self, interaction: discord.Interaction) -> None:
        """
        Skip the current track and move to the next one in the queue.
        """
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None or not player.voice_client.is_playing():
            await self._safe_respond(
                interaction,
                embed=discord.Embed(
                    description="Nothing is currently playing.",
                    color=COLOR_WARNING,
                ),
                ephemeral=True,
            )
            return

        # Verify the user is in the same voice channel as the bot
        if not self._user_in_bot_channel(interaction):
            await self._safe_respond(
                interaction,
                embed=discord.Embed(
                    description="You must be in the same voice channel as the bot to skip.",
                    color=COLOR_ERROR,
                ),
                ephemeral=True,
            )
            return

        skipped_title = player.current.title if player.current else "Unknown"
        player.skip()

        await self._safe_respond(
            interaction,
            embed=discord.Embed(
                description=f"Skipped **{skipped_title}**.",
                color=COLOR_SUCCESS,
            ),
        )

    # ════════════════════════════════════════════════════════
    #  /queue
    # ════════════════════════════════════════════════════════

    @app_commands.command(
        name="queue",
        description="📋 Show the upcoming tracklist.",
    )
    @app_commands.describe(page="Page number to display (default: 1)")
    async def queue(
        self,
        interaction: discord.Interaction,
        page: Optional[int] = 1,
    ) -> None:
        """
        Display the current queue as a paginated Discord embed.

        Each page shows up to QUEUE_DISPLAY_LIMIT tracks.
        """
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None or (not player.current and player.queue.empty()):
            await self._safe_respond(
                interaction,
                embed=discord.Embed(
                    description="The queue is empty. Use **/play** to add some tracks!",
                    color=COLOR_WARNING,
                ),
                ephemeral=True,
            )
            return

        upcoming: list[Track] = player.queue_snapshot()
        total_tracks = len(upcoming)
        total_pages  = max(1, math.ceil(total_tracks / QUEUE_DISPLAY_LIMIT))
        page = max(1, min(page or 1, total_pages))  # clamp to valid range

        start = (page - 1) * QUEUE_DISPLAY_LIMIT
        end   = start + QUEUE_DISPLAY_LIMIT
        page_tracks = upcoming[start:end]

        # ── Build embed ───────────────────────────────────
        embed = discord.Embed(
            title="📋 Music Queue",
            color=COLOR_QUEUE,
        )

        # Now Playing section
        if player.current:
            embed.add_field(
                name="🎵 Now Playing",
                value=(
                    f"**[{player.current.title}]({player.current.webpage_url})**\n"
                    f"⏱ `{player.current.duration_str}` — Requested by {player.current.requester}"
                ),
                inline=False,
            )

        # Upcoming tracks
        if page_tracks:
            lines = []
            for i, track in enumerate(page_tracks, start=start + 1):
                lines.append(
                    f"`{i}.` **[{track.title}]({track.webpage_url})** "
                    f"[`{track.duration_str}`] — {track.requester}"
                )
            embed.add_field(
                name=f"📥 Up Next  (page {page}/{total_pages})",
                value="\n".join(lines),
                inline=False,
            )
        else:
            embed.add_field(
                name="📥 Up Next",
                value="_(no more tracks in queue)_",
                inline=False,
            )

        embed.set_footer(
            text=(
                f"{total_tracks} track{'s' if total_tracks != 1 else ''} in queue • "
                f"Page {page}/{total_pages}"
            )
        )
        await interaction.response.send_message(embed=embed)

    # ════════════════════════════════════════════════════════
    #  /stop
    # ════════════════════════════════════════════════════════

    @app_commands.command(name="pause", description="Pause the currently playing track.")
    async def pause(self, interaction: discord.Interaction) -> None:
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None or not player.voice_client.is_playing():
            await self._safe_respond(
                interaction,
                embed=discord.Embed(description="⚠️ Nothing is currently playing.", color=COLOR_ERROR),
                ephemeral=True,
            )
            return

        player.voice_client.pause()
        await self._safe_respond(
            interaction,
            embed=discord.Embed(description="⏸️ **Paused playback.**", color=COLOR_PRIMARY)
        )

    @app_commands.command(name="resume", description="Resume paused playback.")
    async def resume(self, interaction: discord.Interaction) -> None:
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None or not player.voice_client.is_paused():
            await self._safe_respond(
                interaction,
                embed=discord.Embed(description="⚠️ Playback is not paused.", color=COLOR_ERROR),
                ephemeral=True,
            )
            return

        player.voice_client.resume()
        await self._safe_respond(
            interaction,
            embed=discord.Embed(description="▶️ **Resumed playback.**", color=COLOR_PRIMARY)
        )

    @app_commands.command(
        name="stop",
        description="⏹️ Stop playback, clear the queue, and disconnect the bot.",
    )
    async def stop(self, interaction: discord.Interaction) -> None:
        """Stop playback, clear queue, and disconnect."""
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None:
            await self._safe_respond(
                interaction,
                embed=discord.Embed(
                    description="The bot is not connected to any voice channel.",
                    color=COLOR_WARNING,
                ),
                ephemeral=True,
            )
            return

        bot_vc = interaction.guild.voice_client  # type: ignore[union-attr]
        user_vs = interaction.user.voice  # type: ignore[union-attr]

        if bot_vc and getattr(bot_vc, "channel", None) and user_vs and getattr(user_vs, "channel", None):
            if bot_vc.channel.id != user_vs.channel.id:
                await self._safe_respond(
                    interaction,
                    embed=discord.Embed(
                        description="You must be in the same voice channel as the bot to stop it.",
                        color=COLOR_ERROR,
                    ),
                    ephemeral=True,
                )
                return

        await self.registry.remove(interaction.guild_id)  # type: ignore[arg-type]
        try:
            if interaction.guild.voice_client:  # type: ignore[union-attr]
                await interaction.guild.voice_client.disconnect(force=True)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass  # already disconnected

        await self._safe_respond(
            interaction,
            embed=discord.Embed(
                description="Stopped playback and cleared the queue. Goodbye!",
                color=COLOR_SUCCESS,
            ),
        )

    # ════════════════════════════════════════════════════════
    #  /np  (Now Playing)
    # ════════════════════════════════════════════════════════

    @app_commands.command(
        name="np",
        description="🎵 Show what's currently playing.",
    )
    async def now_playing(self, interaction: discord.Interaction) -> None:
        """Display information about the currently playing track."""
        player = self.registry.get(interaction.guild_id)  # type: ignore[arg-type]

        if player is None or player.current is None:
            await self._safe_respond(
                interaction,
                embed=discord.Embed(
                    description="Nothing is currently playing.",
                    color=COLOR_WARNING,
                ),
                ephemeral=True,
            )
            return

        track = player.current
        embed = discord.Embed(
            title="🎵 Now Playing",
            description=f"**[{track.title}]({track.webpage_url})**",
            color=COLOR_PRIMARY,
        )
        embed.add_field(name="Duration",     value=track.duration_str, inline=True)
        embed.add_field(name="Requested by", value=track.requester,    inline=True)
        embed.add_field(name="Source",       value=track.source.capitalize(), inline=True)
        if track.thumbnail:
            embed.set_thumbnail(url=track.thumbnail)
        embed.set_footer(text="VirusMusicPro")
        await interaction.response.send_message(embed=embed)

    # ════════════════════════════════════════════════════════
    #  Shared private helpers
    # ════════════════════════════════════════════════════════

    async def _ensure_voice(
        self,
        interaction: discord.Interaction,
        channel: discord.VoiceChannel,
    ) -> Optional[discord.VoiceClient]:
        """
        Ensure the bot is connected to the specified voice channel.

        - If already connected to the same channel: return the existing client.
        - If connected to a different channel: move to the new one.
        - If not connected at all: join the channel.

        Returns the VoiceClient on success, or None if an error occurred
        (in which case an error message has already been sent).
        """
        vc: Optional[discord.VoiceClient] = interaction.guild.voice_client  # type: ignore[union-attr]

        try:
            if vc is None:
                # Bot is not in any voice channel → join
                vc = await channel.connect(timeout=60.0, reconnect=True)
            elif vc.channel.id != channel.id:
                # Bot is in a different channel → move
                await vc.move_to(channel)
        except asyncio.TimeoutError:
            await self._followup_error(
                interaction,
                "⌛ Timed out while trying to connect to the voice channel.",
            )
            return None
        except discord.ClientException as exc:
            await self._followup_error(
                interaction,
                f"❌ Could not connect to the voice channel: `{exc}`",
            )
            return None

        return vc

    @staticmethod
    def _is_yt_playlist_url(url: str) -> bool:
        """Return True if the URL points to a YouTube playlist."""
        return (
            "youtube.com/playlist" in url
            or ("youtube.com/watch" in url and "list=" in url)
        )

    @staticmethod
    def _user_in_bot_channel(interaction: discord.Interaction) -> bool:
        """
        Return True if the command user is in the same voice channel as the bot.
        """
        bot_vc: Optional[discord.VoiceClient] = interaction.guild.voice_client  # type: ignore[union-attr]
        user_vs: Optional[discord.VoiceState] = interaction.user.voice  # type: ignore[union-attr]
        if bot_vc is None or user_vs is None or user_vs.channel is None:
            return False
        return bot_vc.channel.id == user_vs.channel.id

    @staticmethod
    async def _followup_error(interaction: discord.Interaction, message: str) -> None:
        """Send a deferred ephemeral error embed."""
        embed = discord.Embed(description=message, color=COLOR_ERROR)
        try:
            await interaction.followup.send(embed=embed, ephemeral=True)
        except discord.DiscordException:
            pass  # interaction may have already expired

    @staticmethod
    async def _safe_respond(
        interaction: discord.Interaction,
        *,
        embed: discord.Embed,
        ephemeral: bool = False,
    ) -> None:
        """
        Safely send an INITIAL interaction response (send_message).

        Catches NotFound (10062 — 3-second window expired) and
        HTTPException (40060 — already acknowledged) so they never
        surface as CommandInvokeError in the logs.
        """
        try:
            await interaction.response.send_message(embed=embed, ephemeral=ephemeral)
        except (discord.NotFound, discord.HTTPException):
            # Interaction expired or already responded to — nothing we can do.
            pass

    @staticmethod
    async def _followup_queued(
        interaction: discord.Interaction, track: Track
    ) -> None:
        """Send a deferred 'track added to queue' confirmation embed."""
        embed = discord.Embed(
            description=f"✅ Added to queue: **[{track.title}]({track.webpage_url})**",
            color=COLOR_SUCCESS,
        )
        embed.add_field(name="Duration",     value=track.duration_str, inline=True)
        embed.add_field(name="Requested by", value=track.requester,    inline=True)
        if track.thumbnail:
            embed.set_thumbnail(url=track.thumbnail)
        try:
            await interaction.followup.send(embed=embed)
        except discord.DiscordException:
            pass


# ── Cog setup function (called by bot.load_extension) ────────

async def setup(bot: commands.Bot) -> None:
    """Entry point for discord.py extension loader."""
    await bot.add_cog(MusicCog(bot))
