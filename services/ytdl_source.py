# ============================================================
#  VirusMusicPro — YouTube / yt-dlp Audio Resolver
#  Responsible for converting queries/URLs into Track objects.
# ============================================================

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Optional

import yt_dlp

from config import YTDL_FORMAT_OPTIONS
from models import Track

log = logging.getLogger(__name__)


class YTDLSource:
    """
    Thin async wrapper around yt-dlp.

    All blocking yt-dlp calls are offloaded to a thread-pool executor
    so they never stall the Discord event loop.
    """

    # Shared yt-dlp instance (thread-safe for extraction; not for download)
    _ytdl = yt_dlp.YoutubeDL(YTDL_FORMAT_OPTIONS)

    # ── Public helpers ───────────────────────────────────────

    @classmethod
    async def resolve_query(
        cls,
        query: str,
        *,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        requester: str = "Unknown",
        source_label: str = "search",
    ) -> Track:
        """
        Resolve a YouTube search query or video URL to a single Track.

        Parameters
        ----------
        query        : A YouTube URL, ytsearch query, or bare song title.
        loop         : Running event loop (defaults to current loop).
        requester    : Discord display name to attach to the Track.
        source_label : 'youtube' | 'search' | 'spotify'
        """
        loop = loop or asyncio.get_event_loop()
        info = await cls._extract(query, loop=loop)
        return Track.from_ytdl_info(info, requester=requester, source=source_label)

    @classmethod
    async def resolve_playlist(
        cls,
        url: str,
        *,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        requester: str = "Unknown",
    ) -> list[Track]:
        """
        Resolve a YouTube playlist URL to a list of Tracks.

        yt-dlp is called with extract_flat=True first to get just the
        video IDs, then each entry is resolved lazily during playback.
        Returns Track objects with 'url' set to the individual video
        webpage URL (not a stream URL yet).  The player will call
        ``resolve_query`` again just before playing each track.
        """
        loop = loop or asyncio.get_event_loop()

        # Use a custom options dict with flat extraction for speed
        flat_opts = {**YTDL_FORMAT_OPTIONS, "extract_flat": "in_playlist", "quiet": True}
        flat_ytdl = yt_dlp.YoutubeDL(flat_opts)

        partial = functools.partial(flat_ytdl.extract_info, url, download=False)
        try:
            data = await loop.run_in_executor(None, partial)
        except yt_dlp.utils.DownloadError as exc:
            raise ValueError(f"yt-dlp could not resolve playlist: {exc}") from exc

        entries: list[dict] = data.get("entries") or []
        tracks: list[Track] = []
        for entry in entries:
            if not entry:
                continue
            video_url = entry.get("url") or entry.get("webpage_url") or entry.get("id")
            if not video_url:
                continue
            # Normalise bare IDs to full URLs
            if not video_url.startswith("http"):
                video_url = f"https://www.youtube.com/watch?v={video_url}"
            tracks.append(
                Track(
                    title=entry.get("title", "Unknown Title"),
                    url=video_url,       # placeholder — resolved just before playback
                    webpage_url=video_url,
                    duration=int(entry.get("duration") or 0),
                    thumbnail=entry.get("thumbnail"),
                    requester=requester,
                    source="youtube",
                )
            )
        return tracks

    # ── Internal helpers ─────────────────────────────────────

    @classmethod
    async def _extract(
        cls,
        query: str,
        *,
        loop: asyncio.AbstractEventLoop,
    ) -> dict:
        """
        Run yt-dlp extraction in a thread executor and return the info dict.
        Handles the 'ytsearch:' prefix automatically for bare queries.
        """
        # 1. If it's a YouTube URL, extract the title first using a flat extractor to bypass Datacenter bans
        if "youtube.com/" in query or "youtu.be/" in query:
            flat_ytdl = yt_dlp.YoutubeDL({"extract_flat": True, "quiet": True, "no_warnings": True})
            partial_flat = functools.partial(flat_ytdl.extract_info, query, download=False)
            try:
                flat_data = await loop.run_in_executor(None, partial_flat)
                if flat_data and "title" in flat_data:
                    query = flat_data["title"]  # Replace the URL with the video title
            except Exception as e:
                log.warning("Failed to extract flat title from YouTube URL %s: %s", query, e)

        # 2. If it's a direct URL (not YouTube), try to extract it normally
        if query.startswith("http"):
            partial = functools.partial(cls._ytdl.extract_info, query, download=False)
            try:
                data = await loop.run_in_executor(None, partial)
                return data
            except yt_dlp.utils.DownloadError as exc:
                log.exception("yt-dlp extraction failed for URL: %s", query)
                raise ValueError(f"yt-dlp extraction failed: {exc}") from exc

        # 3. It's a text search (or became one). Use SoundCloud search and get top 5 results
        search_query = query.replace("scsearch:", "") if query.startswith("scsearch:") else query
        search_query = search_query.replace("ytsearch:", "") if query.startswith("ytsearch:") else search_query
        
        flat_ytdl = yt_dlp.YoutubeDL({"extract_flat": True, "quiet": True, "no_warnings": True})
        partial_search = functools.partial(flat_ytdl.extract_info, f"scsearch5:{search_query}", download=False)
        
        try:
            search_data = await loop.run_in_executor(None, partial_search)
        except Exception as e:
            raise ValueError(f"Failed to search SoundCloud: {e}") from e

        if not search_data or "entries" not in search_data:
            raise ValueError("No results found for the given query.")

        entries = [e for e in search_data["entries"] if e]
        if not entries:
            raise ValueError("No results found for the given query.")

        # 4. Iterate through the top 5 results and try to extract streams. 
        # This bypasses SoundCloud Go+ DRM tracks by skipping them and trying the next result!
        last_exc = None
        for entry in entries:
            track_url = entry.get("url")
            if not track_url:
                continue
                
            partial = functools.partial(cls._ytdl.extract_info, track_url, download=False)
            try:
                data = await loop.run_in_executor(None, partial)
                return data  # Success! Found a track without DRM that has streams.
            except yt_dlp.utils.DownloadError as exc:
                # Log it as debug and try the next one
                log.debug("Skipping track %s due to extraction error (likely DRM): %s", track_url, exc)
                last_exc = exc
                continue
        
        # If we exhausted all 5 results and all failed
        raise ValueError(f"Failed to extract any playable streams from the top 5 results. Last error: {last_exc}")
