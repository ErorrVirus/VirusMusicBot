# ============================================================
#  VirusMusicPro — Track Data Model
#  Represents a single audio track in the queue.
# ============================================================

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Track:
    """
    Immutable-ish value object representing a single playable audio track.

    Attributes
    ----------
    title          : Human-readable song title.
    url            : Direct audio stream URL (obtained from yt-dlp).
    webpage_url    : Public web page for the track (YouTube/Spotify link shown to users).
    duration       : Track duration in seconds (0 if unknown / live stream).
    thumbnail      : URL of the album art / video thumbnail.
    requester      : Discord display name of the user who queued this track.
    source         : Where the track was requested from ('youtube' | 'spotify' | 'search').
    original_query : The raw URL or search query used to find this track.
    """

    title: str
    url: str                          # resolved audio-stream URL
    webpage_url: str                  # user-facing page URL
    duration: int = 0                 # seconds; 0 = live / unknown
    thumbnail: Optional[str] = None
    requester: str = "Unknown"
    source: str = "youtube"           # 'youtube' | 'spotify' | 'search'
    original_query: str = ""          # used to re-resolve expired streams

    # ── Computed helpers ─────────────────────────────────────

    @property
    def duration_str(self) -> str:
        """Return a human-readable HH:MM:SS / MM:SS string."""
        if self.duration <= 0:
            return "LIVE"
        hours, remainder = divmod(self.duration, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"

    @property
    def is_live(self) -> bool:
        """True when the source is a live stream."""
        return self.duration <= 0

    def __str__(self) -> str:
        return f"[{self.duration_str}] {self.title}"

    # ── Factory from yt-dlp info dict ────────────────────────

    @classmethod
    def from_ytdl_info(
        cls,
        info: dict,
        *,
        requester: str = "Unknown",
        source: str = "youtube",
        original_query: str = "",
    ) -> "Track":
        """
        Build a Track from the raw dictionary returned by yt-dlp's
        ``extract_info`` method.

        Parameters
        ----------
        info           : Raw yt-dlp info dict (must contain 'url' or 'formats').
        requester      : Discord display name of the requesting user.
        source         : Origin label ('youtube', 'spotify', 'search').
        original_query : The raw URL or search query.
        """
        # yt-dlp may nest the actual stream URL under 'url' directly,
        # or inside the best-matching format entry.
        stream_url: str = info.get("url") or cls._best_format_url(info)

        return cls(
            title=info.get("title", "Unknown Title"),
            url=stream_url,
            webpage_url=info.get("webpage_url") or info.get("original_url", stream_url),
            duration=int(info.get("duration") or 0),
            thumbnail=info.get("thumbnail"),
            requester=requester,
            source=source,
            original_query=original_query,
        )

    @staticmethod
    def _best_format_url(info: dict) -> str:
        """
        Fallback: pick the audio URL from the 'formats' list when the
        top-level 'url' key is absent (e.g. some yt-dlp extractors).
        """
        formats: list[dict] = info.get("formats", [])
        # Filter to audio-only formats
        audio_formats = [f for f in formats if f.get("vcodec") == "none" and f.get("url")]
        if audio_formats:
            # Prefer highest bitrate
            best = max(audio_formats, key=lambda f: f.get("abr") or 0)
            return best["url"]
        # Final fallback: just use whatever URL we can find
        for fmt in reversed(formats):
            if fmt.get("url"):
                return fmt["url"]
        raise ValueError("yt-dlp returned no playable URL for this track.")
