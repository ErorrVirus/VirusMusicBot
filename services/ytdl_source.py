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
    
    # Fast instance for flat extraction (playlists)
    _flat_opts = {**YTDL_FORMAT_OPTIONS, "extract_flat": "in_playlist", "quiet": True}
    _flat_ytdl = yt_dlp.YoutubeDL(_flat_opts)

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
        return Track.from_ytdl_info(
            info, 
            requester=requester, 
            source=source_label,
            original_query=query,
        )

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
        """
        loop = loop or asyncio.get_event_loop()

        partial = functools.partial(cls._flat_ytdl.extract_info, url, download=False)
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
                    original_query=video_url,
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
        Direct YouTube stream resolution. Fallback to SoundCloud only when necessary.
        """
        log.info("Extracting query: %s", query)
        
        # 1. If it's a direct URL, extract it normally using our shared instance.
        if query.startswith("http"):
            partial = functools.partial(cls._ytdl.extract_info, query, download=False)
            try:
                data = await loop.run_in_executor(None, partial)
                if data:
                    log.info("Successfully extracted direct URL: %s", query)
                    return data
            except yt_dlp.utils.DownloadError as exc:
                log.warning("yt-dlp extraction failed for URL %s: %s", query, exc)
                # If YouTube extraction completely fails (e.g. 403, geoblock), we attempt a search fallback
                # Try to use the URL itself as the search term, or fallback gracefully
                pass

        # 2. Text Search - Prioritize YouTube Search
        search_query = query.replace("ytsearch:", "").replace("scsearch:", "").strip()
        is_remix_query = "remix" in search_query.lower()
        is_cover_query = "cover" in search_query.lower()
        
        # Try YouTube search first
        yt_search_str = f"ytsearch1:{search_query}"
        partial_yt = functools.partial(cls._ytdl.extract_info, yt_search_str, download=False)
        try:
            yt_data = await loop.run_in_executor(None, partial_yt)
            if yt_data and "entries" in yt_data and yt_data["entries"]:
                entry = yt_data["entries"][0]
                if entry:
                    log.info("Successfully extracted via YouTube search: %s", search_query)
                    return entry
        except Exception as e:
            log.warning("YouTube search failed for %s: %s", search_query, e)

        # 3. Fallback to SoundCloud
        log.info("Falling back to SoundCloud search for: %s", search_query)
        sc_search_str = f"scsearch5:{search_query}"
        partial_sc_flat = functools.partial(cls._flat_ytdl.extract_info, sc_search_str, download=False)
        
        try:
            sc_data = await loop.run_in_executor(None, partial_sc_flat)
        except Exception as e:
            raise ValueError(f"Failed to search SoundCloud fallback: {e}") from e

        if not sc_data or "entries" not in sc_data:
            raise ValueError("No fallback results found.")

        entries = [e for e in sc_data["entries"] if e]
        if not entries:
            raise ValueError("No fallback results found.")

        # Iterate through the top 5 results and filter aggressively
        last_exc = None
        for entry in entries:
            track_url = entry.get("url")
            if not track_url:
                continue

            duration = entry.get("duration") or 0
            title = entry.get("title", "").lower()
            
            # Reject previews/snippets
            if "preview" in title or "snippet" in title:
                log.debug("Skipping %s: is a preview", track_url)
                continue
                
            # Reject tracks under 60 seconds
            if duration > 0 and duration < 60:
                log.debug("Skipping %s: duration under 60s", track_url)
                continue
                
            # Reject remixes/covers if not in original query
            if not is_remix_query and "remix" in title:
                log.debug("Skipping %s: unwanted remix", track_url)
                continue
            if not is_cover_query and "cover" in title:
                log.debug("Skipping %s: unwanted cover", track_url)
                continue

            # Try to extract streams
            partial_sc = functools.partial(cls._ytdl.extract_info, track_url, download=False)
            try:
                data = await loop.run_in_executor(None, partial_sc)
                if data:
                    log.info("Successfully extracted SoundCloud fallback: %s", track_url)
                    return data
            except yt_dlp.utils.DownloadError as exc:
                log.debug("Skipping track %s due to extraction error (likely DRM): %s", track_url, exc)
                last_exc = exc
                continue

        raise ValueError(f"Failed to extract any playable streams. Last error: {last_exc}")
