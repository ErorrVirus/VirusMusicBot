# ============================================================
#  VirusMusicPro — Guild Music Player
#  One instance per Discord guild (server).
#  Manages the voice connection, queue, and playback lifecycle.
# ============================================================

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import discord

from config import (
    FFMPEG_BEFORE_OPTIONS,
    FFMPEG_OPTIONS,
    INACTIVITY_TIMEOUT,
    MAX_QUEUE_SIZE,
    COLOR_PRIMARY,
    COLOR_ERROR,
)
from models import Track
from services import YTDLSource

log = logging.getLogger(__name__)


class GuildPlayer:
    """
    Encapsulates all music playback state for a single Discord guild.

    Responsibilities
    ----------------
    - Maintains an ``asyncio.Queue`` of upcoming Tracks.
    - Holds the ``discord.VoiceClient`` for this guild.
    - Drives the playback loop — dequeues the next track and feeds it
      to FFmpeg when the previous track ends.
    - Implements inactivity auto-disconnect after ``INACTIVITY_TIMEOUT`` seconds.

    Lifecycle
    ---------
    Created by ``MusicCog`` on first play command; destroyed when the bot
    disconnects or an unrecoverable error occurs.
    """

    def __init__(
        self,
        guild: discord.Guild,
        voice_client: discord.VoiceClient,
        text_channel: discord.TextChannel,
    ) -> None:
        self.guild          = guild
        self.voice_client   = voice_client
        self.text_channel   = text_channel

        # Capture the running event loop NOW (we are on the main async thread).
        # discord.py calls _after_callback from a dedicated audio worker thread
        # that has no event loop of its own; Python 3.10+ raises RuntimeError
        # if you call asyncio.get_event_loop() from such a thread.
        # Storing the loop here lets _after_callback safely call
        # loop.call_soon_threadsafe() without touching thread-local state.
        self._loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()

        # Async queue bounded by MAX_QUEUE_SIZE
        self.queue: asyncio.Queue[Track] = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)

        # Currently playing track (None when idle)
        self.current: Optional[Track] = None

        # Event fired by the "after" callback when a track finishes
        self._track_finished = asyncio.Event()

        # Background task driving the playback loop
        self._loop_task: Optional[asyncio.Task] = None

        # Inactivity watcher task
        self._inactivity_task: Optional[asyncio.Task] = None

        # Flag set when skip() is called
        self._skip_flag: bool = False

    # ── Lifecycle ────────────────────────────────────────────

    def start(self) -> None:
        """Kick off the background playback loop."""
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = self._loop.create_task(
                self._playback_loop(), name=f"playback-{self.guild.id}"
            )

    async def stop(self) -> None:
        """
        Immediately halt playback, drain the queue, and cancel all tasks.
        Called when the bot disconnects or the cog is unloaded.
        """
        # Cancel the playback loop first
        if self._loop_task and not self._loop_task.done():
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

        # Cancel inactivity watcher
        self._cancel_inactivity_watcher()

        # Stop the voice client if it is still playing
        if self.voice_client.is_playing() or self.voice_client.is_paused():
            self.voice_client.stop()

        # Drain the queue
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
                self.queue.task_done()
            except asyncio.QueueEmpty:
                break

        self.current = None

    # ── Queue control ─────────────────────────────────────────

    def enqueue(self, track: Track) -> None:
        """
        Add a track to the queue.

        Raises
        ------
        asyncio.QueueFull
            If the guild queue has reached MAX_QUEUE_SIZE.
        """
        self.queue.put_nowait(track)  # non-blocking; raises QueueFull if full

    def skip(self) -> bool:
        """
        Skip the currently playing track.

        Returns True if a track was skipped, False if nothing was playing.
        """
        if self.voice_client.is_playing() or self.voice_client.is_paused():
            self._skip_flag = True
            self.voice_client.stop()  # triggers the "after" callback → event fired
            return True
        return False

    # ── Queue snapshot (for /queue command) ──────────────────

    def queue_snapshot(self) -> list[Track]:
        """Return an ordered list of upcoming tracks without consuming them."""
        return list(self.queue._queue)  # type: ignore[attr-defined]

    # ── Playback loop ─────────────────────────────────────────

    async def _playback_loop(self) -> None:
        """
        Core playback loop.

        1. Waits for the next Track in the queue.
        2. If the Track URL is a placeholder (from flat playlist extraction),
           resolves it to a real stream URL via yt-dlp.
        3. Creates an FFmpegPCMAudio source and plays it.
        4. Waits for the track to finish (via the async event).
        5. Repeats until the queue is empty, then starts the inactivity watcher.
        """
        while True:
            self._cancel_inactivity_watcher()

            try:
                # Block until a track arrives (no timeout — inactivity handled below)
                track: Track = await self.queue.get()
            except asyncio.CancelledError:
                return

            # ── Resolve placeholder tracks ────────────────
            # Tracks added from flat-playlist extraction have their
            # webpage_url as the 'url' field.  Detect and re-resolve them.
            if self._is_placeholder(track):
                try:
                    track = await YTDLSource.resolve_query(
                        track.url,
                        requester=track.requester,
                        source_label=track.source,
                    )
                except Exception as exc:  # noqa: BLE001
                    log.exception("Failed to resolve track '%s'", track.title)
                    await self._send_error(
                        f"⚠️ Could not resolve **{track.title}** — skipping."
                    )
                    self.queue.task_done()
                    continue

            self.current = track
            self._skip_flag = False
            self._track_finished.clear()

            # ── Build FFmpeg audio source ─────────────────
            audio_source = discord.FFmpegPCMAudio(
                track.url,
                before_options=FFMPEG_BEFORE_OPTIONS,
                options=FFMPEG_OPTIONS,
            )
            # Volume transformer (default 100 %)
            audio_source = discord.PCMVolumeTransformer(audio_source, volume=1.0)

            # ── Start playback ────────────────────────────
            self.voice_client.play(
                audio_source,
                after=self._after_callback,
            )

            # Announce the now-playing track
            await self._send_now_playing(track)

            # Update bot presence
            try:
                bot = self.voice_client.client
                await bot.change_presence(
                    activity=discord.Activity(
                        type=discord.ActivityType.listening,
                        name=f"{track.title}"
                    )
                )
            except discord.DiscordException:
                pass

            # ── Wait for track to end ─────────────────────
            try:
                await self._track_finished.wait()
            except asyncio.CancelledError:
                self.voice_client.stop()
                return

            self.current = None
            self.queue.task_done()

            # ── If queue is now empty, start idle watcher ─
            if self.queue.empty():
                self._start_inactivity_watcher()
                
                # Reset bot presence
                try:
                    bot = self.voice_client.client
                    await bot.change_presence(
                        activity=discord.Activity(
                            type=discord.ActivityType.listening,
                            name="/play — VirusMusicPro",
                        )
                    )
                except discord.DiscordException:
                    pass

    def _after_callback(self, error: Optional[Exception]) -> None:
        """
        Called by discord.py in a dedicated audio worker thread after a track
        finishes.  We must NOT call asyncio.get_event_loop() here — Python 3.10+
        raises RuntimeError when that is called from a non-main thread that has
        no current loop.  Instead we use self._loop, captured at construction
        time from the main async thread, to safely schedule the event.
        """
        if error and not self._skip_flag:
            log.error("Playback error in guild %s: %s", self.guild.id, error)
        # Wake up the playback loop coroutine (thread-safe)
        self._loop.call_soon_threadsafe(self._track_finished.set)

    # ── Inactivity watcher ────────────────────────────────────

    def _start_inactivity_watcher(self) -> None:
        """
        Launch a background coroutine that disconnects the bot after
        INACTIVITY_TIMEOUT seconds if nothing new is queued.
        """
        self._inactivity_task = self._loop.create_task(
            self._inactivity_watcher(), name=f"inactivity-{self.guild.id}"
        )

    def _cancel_inactivity_watcher(self) -> None:
        if self._inactivity_task and not self._inactivity_task.done():
            self._inactivity_task.cancel()

    async def _inactivity_watcher(self) -> None:
        """Disconnect after INACTIVITY_TIMEOUT seconds of silence."""
        await asyncio.sleep(INACTIVITY_TIMEOUT)
        if not self.voice_client.is_playing() and self.queue.empty():
            log.info(
                "Guild %s idle for %ds — auto-disconnecting.",
                self.guild.id,
                INACTIVITY_TIMEOUT,
            )
            await self.text_channel.send(
                embed=discord.Embed(
                    description=(
                        f"👋 Left the voice channel after "
                        f"{INACTIVITY_TIMEOUT // 60} minutes of inactivity."
                    ),
                    color=COLOR_ERROR,
                )
            )
            await self.voice_client.disconnect()

    # ── Embed helpers ─────────────────────────────────────────

    async def _send_now_playing(self, track: Track) -> None:
        """Send a rich 'Now Playing' embed to the bound text channel."""
        embed = discord.Embed(
            title="🎵 Now Playing",
            description=f"**[{track.title}]({track.webpage_url})**",
            color=COLOR_PRIMARY,
        )
        embed.add_field(name="Duration",   value=track.duration_str, inline=True)
        embed.add_field(name="Requested by", value=track.requester,  inline=True)
        embed.add_field(
            name="Source",
            value=track.source.capitalize(),
            inline=True,
        )
        if track.thumbnail:
            embed.set_thumbnail(url=track.thumbnail)
        embed.set_footer(text="VirusMusicPro")
        try:
            await self.text_channel.send(embed=embed)
        except discord.DiscordException as exc:
            log.warning("Could not send now-playing embed: %s", exc)

    async def _send_error(self, message: str) -> None:
        """Send a plain error embed to the bound text channel."""
        embed = discord.Embed(description=message, color=COLOR_ERROR)
        try:
            await self.text_channel.send(embed=embed)
        except discord.DiscordException as exc:
            log.warning("Could not send error embed: %s", exc)

    # ── Utilities ─────────────────────────────────────────────

    @staticmethod
    def _is_placeholder(track: Track) -> bool:
        """
        Detect tracks that haven't been resolved to a real stream URL yet.
        Placeholder tracks have their 'url' set to a YouTube watch URL
        (added during flat-playlist extraction).
        """
        url = track.url
        if url.startswith("ytsearch:"):
            return True
        return (
            "youtube.com/watch" in url
            or "youtu.be/" in url
            or url.startswith("https://www.youtube.com/")
        ) and not any(
            cdn in url
            for cdn in ("googlevideo.com", "youtube-nocookie.com", "manifest.googlevideo")
        )
