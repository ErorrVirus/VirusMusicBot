# ============================================================
#  VirusMusicPro — Spotify Resolver
#  Converts Spotify URLs into search queries for yt-dlp.
#
#  Auth strategy
#  ─────────────
#  Since late 2024 Spotify no longer permits the Client Credentials
#  (machine-to-machine) flow to access playlist or album track lists —
#  even for public playlists.  The API returns:
#      401 "Valid user authentication required"
#
#  Fix: if SPOTIFY_REFRESH_TOKEN is present in .env, we use the
#  Authorization Code flow (SpotifyOAuth) with the pre-stored refresh
#  token.  Spotipy will auto-refresh the access token silently forever.
#
#  If SPOTIFY_REFRESH_TOKEN is absent, the resolver falls back to the
#  Client Credentials flow; single track links will still work, but
#  playlists and albums will fail with a clear, actionable error message.
#
#  To get your refresh token, run:
#      python spotify_auth.py
# ============================================================

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import spotipy
from spotipy.cache_handler import MemoryCacheHandler
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyClientCredentials, SpotifyOAuth

from config import (
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI,
    SPOTIFY_REFRESH_TOKEN,
)

log = logging.getLogger(__name__)

# ── Scopes required for playlist / album access ───────────────
# playlist-read-private     → user's own private playlists
# playlist-read-collaborative → collaborative playlists the user follows
_OAUTH_SCOPES = "playlist-read-private playlist-read-collaborative"

# ── Spotify URL patterns ──────────────────────────────────────
_TRACK_RE    = re.compile(r"/track/([A-Za-z0-9]+)")
_PLAYLIST_RE = re.compile(r"/playlist/([A-Za-z0-9]+)")
_ALBUM_RE    = re.compile(r"/album/([A-Za-z0-9]+)")
_ARTIST_RE   = re.compile(r"/artist/([A-Za-z0-9]+)")


@dataclass
class SpotifyMeta:
    """Lightweight metadata returned by the Spotify resolver."""
    search_query: str   # e.g. "Blinding Lights The Weeknd" → passed to yt-dlp
    title: str          # human-readable track title
    artist: str         # primary artist name
    duration_ms: int = 0
    thumbnail: Optional[str] = None


def _build_spotify_client() -> spotipy.Spotify:
    """
    Build the best-available Spotipy client:

    1. If SPOTIFY_REFRESH_TOKEN is set → SpotifyOAuth with the stored
       refresh token.  Access token is obtained (and silently refreshed)
       automatically.  Supports playlists + albums.

    2. Otherwise → SpotifyClientCredentials.  Works for single tracks
       only; playlists will return 401 and a helpful error is shown.
    """
    if SPOTIFY_REFRESH_TOKEN:
        log.info("Spotify: using OAuth flow (full playlist/album support). Refresh token is present.")

        # Pre-populate the in-memory cache with the refresh token.
        # expires_at=0 forces Spotipy to immediately exchange it for a
        # fresh access token on the very first API call.
        token_info = {
            "access_token": "",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": SPOTIFY_REFRESH_TOKEN,
            "scope": _OAUTH_SCOPES,
            "expires_at": 0,  # expired → triggers an immediate refresh
        }
        cache = MemoryCacheHandler(token_info=token_info)

        auth = SpotifyOAuth(
            client_id=SPOTIFY_CLIENT_ID,
            client_secret=SPOTIFY_CLIENT_SECRET,
            redirect_uri=SPOTIFY_REDIRECT_URI,
            scope=_OAUTH_SCOPES,
            cache_handler=cache,
            open_browser=False,   # never pop a browser inside the bot process
        )
        return spotipy.Spotify(auth_manager=auth)

    else:
        log.warning(
            "Spotify: SPOTIFY_REFRESH_TOKEN not set — falling back to "
            "Client Credentials.  Playlists and albums will NOT work.  "
            "Run `python spotify_auth.py` to generate a refresh token."
        )
        auth = SpotifyClientCredentials(
            client_id=SPOTIFY_CLIENT_ID,
            client_secret=SPOTIFY_CLIENT_SECRET,
            cache_handler=MemoryCacheHandler(),
        )
        # Eagerly verify the credentials are valid
        auth.get_access_token(as_dict=False)
        return spotipy.Spotify(auth_manager=auth)


class SpotifyResolver:
    """
    Resolves Spotify track / playlist / album URLs into yt-dlp search
    queries.  No Spotify audio is ever streamed — metadata only.
    """

    def __init__(self) -> None:
        self._sp = _build_spotify_client()
        # Track whether we have full OAuth (playlist support) or fallback only
        self._has_oauth: bool = bool(SPOTIFY_REFRESH_TOKEN)

    # ── URL type detection ────────────────────────────────────

    @staticmethod
    def is_spotify_url(url: str) -> bool:
        """Return True if the string looks like any Spotify URL."""
        return "open.spotify.com" in url

    @staticmethod
    def _url_type(url: str) -> str:
        """Return 'track', 'playlist', 'album', or 'unknown'."""
        if _TRACK_RE.search(url):
            return "track"
        if _PLAYLIST_RE.search(url):
            return "playlist"
        if _ALBUM_RE.search(url):
            return "album"
        if _ARTIST_RE.search(url):
            return "artist"
        return "unknown"

    # ── Public API ────────────────────────────────────────────

    def resolve(self, url: str) -> list[SpotifyMeta]:
        """
        Resolve a Spotify URL to a list of SpotifyMeta objects.

        A single track returns a one-element list.
        Playlists and albums return one element per track.

        Raises
        ------
        ValueError
            On 401/403 auth errors, invalid URLs, or empty results.
            Includes a clear hint to run ``spotify_auth.py`` when
            the resolver is in fallback (Client Credentials) mode.
        """
        url_type = self._url_type(url)
        log.info("Resolving Spotify URL of type: %s", url_type)

        # Guard: playlists and albums require OAuth
        if url_type in ("playlist", "album") and not self._has_oauth:
            log.warning("Spotify playlist/album request failed because OAuth is missing.")
            raise ValueError(
                "Spotify playlists and albums require user authentication.\n"
                "**Run `python spotify_auth.py` once** to generate a refresh token,\n"
                "then add `SPOTIFY_REFRESH_TOKEN=<token>` to your `.env` file and restart the bot."
            )

        try:
            if url_type == "track":
                log.info("Fetching Spotify track metadata: %s", url)
                return [self._resolve_track(url)]
            elif url_type == "playlist":
                try:
                    log.info("Fetching Spotify playlist: %s", url)
                    return self._resolve_playlist(url)
                except SpotifyException as exc:
                    if exc.http_status in (403, 404):
                        log.warning("Spotify API returned %s for playlist. Falling back to Embed Scraper...", exc.http_status)
                        return self._resolve_playlist_fallback(url)
                    raise
            elif url_type == "album":
                try:
                    log.info("Fetching Spotify album: %s", url)
                    return self._resolve_album(url)
                except SpotifyException as exc:
                    if exc.http_status in (403, 404):
                        log.warning("Spotify API returned %s for album. Falling back to Embed Scraper...", exc.http_status)
                        return self._resolve_album_fallback(url)
                    raise
            elif url_type == "artist":
                log.info("Fetching Spotify artist top tracks: %s", url)
                return self._resolve_artist(url)
            else:
                raise ValueError(
                    "Could not determine Spotify URL type. "
                    "Please provide a valid track, playlist, or album URL."
                )
        except SpotifyException as exc:
            log.error("Spotify API Exception: HTTP %s - %s", exc.http_status, exc.msg)
            # 401 after OAuth usually means the refresh token is revoked/expired.
            if exc.http_status == 401:
                raise ValueError(
                    "Spotify OAuth token is invalid or expired.\n"
                    "Please re-run `python spotify_auth.py` to get a new refresh token."
                ) from exc
            if exc.http_status == 403:
                raise ValueError(
                    "Spotify blocked access to this playlist (HTTP 403).\n"
                    "**Why?** The playlist is likely **Private**, and your bot's token lacks permission to read it.\n"
                    "**Fix 1:** Right-click the playlist in Spotify and select **'Make Public'**.\n"
                    "**Fix 2:** If you want to play Private playlists, you must re-run `python spotify_auth.py` in your terminal to generate a new token with the correct permissions, then update `.env`."
                ) from exc
            if exc.http_status == 404:
                raise ValueError("Spotify could not find this link. It might be private, deleted, or invalid.") from exc
            raise ValueError(
                f"Spotify API error (HTTP {exc.http_status}): {exc.msg}"
            ) from exc

    # ── Track ─────────────────────────────────────────────────

    def _resolve_track(self, url: str) -> SpotifyMeta:
        """Fetch metadata for a single Spotify track."""
        track = self._sp.track(url)
        return self._track_to_meta(track)

    # ── Playlist ──────────────────────────────────────────────

    def _resolve_playlist(self, url: str) -> list[SpotifyMeta]:
        """
        Fetch all tracks from a Spotify playlist.
        Handles pagination automatically (playlists can exceed 100 items).
        """
        results = self._sp.playlist_tracks(url, limit=100)
        items: list[dict] = results.get("items", [])

        # Paginate through all pages
        while results.get("next"):
            results = self._sp.next(results)
            items.extend(results.get("items", []))

        metas: list[SpotifyMeta] = []
        for item in items:
            track = item.get("track")
            if not track:      # None for local Spotify files / unavailable tracks
                continue
            try:
                metas.append(self._track_to_meta(track))
            except Exception as exc:  # noqa: BLE001
                log.warning("Skipping Spotify track due to error: %s", exc)
        return metas

    def _resolve_playlist_fallback(self, url: str) -> list[SpotifyMeta]:
        """Fallback to scraping the Spotify Embed page if API is blocked."""
        import requests
        import json

        match = _PLAYLIST_RE.search(url)
        if not match:
            raise ValueError("Invalid Spotify playlist URL.")
        playlist_id = match.group(1)

        embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
        r = requests.get(embed_url, timeout=30)
        
        script_match = re.search(r'<script id=.__NEXT_DATA__.*?>(.*?)</script>', r.text)
        if not script_match:
            raise ValueError("Could not extract playlist data from Spotify embed.")
            
        data = json.loads(script_match.group(1))
        entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
        
        if not entity or "trackList" not in entity:
            raise ValueError("No track list found in Spotify embed data.")
            
        metas = []
        for item in entity["trackList"]:
            title = item.get("title")
            if not title:
                continue
            artist = item.get("subtitle", "Unknown Artist")
            # We don't have accurate duration from embed easily, but we have title and artist
            metas.append(SpotifyMeta(
                title=title,
                artist=artist,
                search_query=f"{title} {artist}"
            ))
            
        if not metas:
            raise ValueError("Playlist embed had no valid tracks.")
        log.info("Successfully extracted %d tracks from Spotify Embed playlist.", len(metas))
        return metas

    # ── Album ─────────────────────────────────────────────────

    def _resolve_album(self, url: str) -> list[SpotifyMeta]:
        """Fetch all tracks from a Spotify album."""
        album = self._sp.album(url)
        album_thumbnail = (
            album["images"][0]["url"] if album.get("images") else None
        )
        results = self._sp.album_tracks(url, limit=50)
        items: list[dict] = results.get("items", [])

        # Paginate
        while results.get("next"):
            results = self._sp.next(results)
            items.extend(results.get("items", []))

        metas: list[SpotifyMeta] = []
        for track in items:
            if not track:
                continue
            try:
                meta = self._track_to_meta(track)
                # Album track stubs don't embed images; use the album cover
                if not meta.thumbnail:
                    meta.thumbnail = album_thumbnail
                metas.append(meta)
            except Exception as exc:  # noqa: BLE001
                log.warning("Skipping Spotify album track due to error: %s", exc)
        return metas

    def _resolve_album_fallback(self, url: str) -> list[SpotifyMeta]:
        """Fallback to scraping the Spotify Embed page if API is blocked."""
        import requests
        import json

        match = _ALBUM_RE.search(url)
        if not match:
            raise ValueError("Invalid Spotify album URL.")
        album_id = match.group(1)

        embed_url = f"https://open.spotify.com/embed/album/{album_id}"
        r = requests.get(embed_url, timeout=30)
        
        script_match = re.search(r'<script id=.__NEXT_DATA__.*?>(.*?)</script>', r.text)
        if not script_match:
            raise ValueError("Could not extract album data from Spotify embed.")
            
        data = json.loads(script_match.group(1))
        entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
        
        if not entity or "trackList" not in entity:
            raise ValueError("No track list found in Spotify embed data.")
            
        metas = []
        for item in entity["trackList"]:
            title = item.get("title")
            if not title:
                continue
            artist = item.get("subtitle", "Unknown Artist")
            metas.append(SpotifyMeta(
                title=title,
                artist=artist,
                search_query=f"{title} {artist}"
            ))
            
        if not metas:
            raise ValueError("Album embed had no valid tracks.")
        log.info("Successfully extracted %d tracks from Spotify Embed album.", len(metas))
        return metas

    # ── Artist ────────────────────────────────────────────────

    def _resolve_artist(self, url: str) -> list[SpotifyMeta]:
        """Fetch the top tracks for a Spotify artist."""
        results = self._sp.artist_top_tracks(url, country="US")
        tracks: list[dict] = results.get("tracks", [])

        metas: list[SpotifyMeta] = []
        for track in tracks:
            if not track:
                continue
            try:
                metas.append(self._track_to_meta(track))
            except Exception as exc:  # noqa: BLE001
                log.warning("Skipping Spotify artist track due to error: %s", exc)
        
        if not metas:
            raise ValueError("Could not find any top tracks for this artist.")
            
        return metas

    # ── Shared helper ─────────────────────────────────────────

    @staticmethod
    def _track_to_meta(track: dict) -> SpotifyMeta:
        """
        Convert a Spotify API track dict into a SpotifyMeta instance.
        The ``search_query`` is formatted as "Title Artist" which gives
        yt-dlp the best chance of finding the matching YouTube audio.
        """
        title   = track.get("name", "Unknown")
        artists = track.get("artists", [])
        artist  = artists[0]["name"] if artists else "Unknown Artist"

        # Thumbnail: present on full track objects; absent on album track stubs
        images    = track.get("album", {}).get("images") or []
        thumbnail = images[0]["url"] if images else None

        duration_ms = int(track.get("duration_ms") or 0)

        return SpotifyMeta(
            search_query=f"{title} {artist}",
            title=title,
            artist=artist,
            duration_ms=duration_ms,
            thumbnail=thumbnail,
        )
