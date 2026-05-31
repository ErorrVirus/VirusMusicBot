#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================
#  VirusMusicPro -- Spotify One-Time OAuth Helper  (v2)
#
#  This script starts a tiny local HTTP server on port 8888,
#  opens your browser to the Spotify login page, and captures
#  the authorization code automatically when Spotify redirects
#  back.  No copy-pasting URLs required.
#
#  Usage:
#      python spotify_auth.py
#
#  Prerequisites:
#   1. In the Spotify Developer Dashboard -> your app -> Settings
#      -> Redirect URIs, add ONE of these (try in order):
#          http://localhost:8888/callback       <- try first
#          http://127.0.0.1:8888/callback       <- if localhost is rejected
#   2. Click Save.
#   3. Run this script.  A browser window will open.
#   4. Log in and click "Agree".
#   5. The script auto-captures the token and prints it.
#   6. Paste SPOTIFY_REFRESH_TOKEN=<value> into your .env file.
# ============================================================

import io
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

# Force UTF-8 output on Windows so emoji in HTML responses work
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from dotenv import load_dotenv

load_dotenv()

# ── Read credentials ──────────────────────────────────────────
CLIENT_ID     = os.environ.get("SPOTIFY_CLIENT_ID",     "").strip()
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
PORT          = 8888

if not CLIENT_ID or not CLIENT_SECRET:
    print(
        "\n[!]  SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing from .env.\n"
        "     Fill those in and re-run this script.\n"
    )
    sys.exit(1)

try:
    import spotipy
    from spotipy.oauth2 import SpotifyOAuth
except ImportError:
    print("\n[!]  spotipy is not installed.  Run:  pip install spotipy\n")
    sys.exit(1)

SCOPES       = "playlist-read-private playlist-read-collaborative"
REDIRECT_URI = f"http://127.0.0.1:{PORT}/callback"

# ── Shared state between HTTP handler and main thread ─────────
_auth_code:  str | None = None
_auth_error: str | None = None
_done = threading.Event()


class _CallbackHandler(BaseHTTPRequestHandler):
    """
    Minimal HTTP handler that captures ?code= or ?error= from
    the Spotify OAuth redirect and then signals the main thread.
    """

    def do_GET(self) -> None:
        global _auth_code, _auth_error

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if "code" in params:
            _auth_code = params["code"][0]
            body = (
                b"<html><body style='font-family:sans-serif;text-align:center;"
                b"padding:60px'>"
                b"<h2>&#x2705; Authorization successful!</h2>"
                b"<p>You can close this tab and return to the terminal.</p>"
                b"</body></html>"
            )
            self._respond(200, body)
        elif "error" in params:
            _auth_error = params.get("error", ["unknown"])[0]
            body = (
                f"<html><body style='font-family:sans-serif;text-align:center;"
                f"padding:60px'>"
                f"<h2>&#x274C; Authorization failed: {_auth_error}</h2>"
                f"<p>You can close this tab and check the terminal.</p>"
                f"</body></html>"
            ).encode()
            self._respond(400, body)
        else:
            self._respond(200, b"Waiting for Spotify callback...")
            return  # don't fire _done yet

        _done.set()

    def _respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # Silence the default request log lines
    def log_message(self, fmt: str, *args: object) -> None:  # type: ignore[override]
        pass


def _start_server() -> HTTPServer:
    """Start the callback server in a daemon thread."""
    try:
        server = HTTPServer(("127.0.0.1", PORT), _CallbackHandler)
    except OSError:
        print(
            f"\n[!]  Port {PORT} is already in use.  Stop whatever is using it"
            f" and try again, or change PORT at the top of this script.\n"
        )
        sys.exit(1)

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


# ── Main ──────────────────────────────────────────────────────

def main() -> None:
    print("\n" + "=" * 60)
    print("  VirusMusicPro — Spotify OAuth Setup")
    print("=" * 60)
    print(f"\n  Client ID    : {CLIENT_ID[:8]}{'*' * (len(CLIENT_ID) - 8)}")
    print(f"  Redirect URI : {REDIRECT_URI}")
    print(f"  Scopes       : {SCOPES}")
    print()

    # ── Verify the redirect URI is registered ────────────────
    print("  [!]  Make sure this URI is added in your Spotify Dashboard:")
    print(f"       {REDIRECT_URI}")
    print("       (Dashboard -> your app -> Settings -> Redirect URIs -> Add -> Save)")
    print()
    print("  If Spotify rejects 'localhost', try '127.0.0.1:8888/callback'")
    print("  and update REDIRECT_URI at the top of this file.")

    input("  Press ENTER when the redirect URI is saved in the Dashboard... ")
    print()

    # ── Start local callback server ───────────────────────────
    server = _start_server()
    print(f"  [OK] Local callback server started on port {PORT}")

    # ── Build OAuth handler ───────────────────────────────────
    auth = SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPES,
        open_browser=False,   # we open it manually for better control
        cache_handler=None,   # don't write any cache file
    )

    auth_url = auth.get_authorize_url()

    # ── Open browser ──────────────────────────────────────────
    print("  Opening your browser to the Spotify login page...")
    opened = webbrowser.open(auth_url)
    if not opened:
        print("\n  Could not open browser automatically.")
        print(f"  Please open this URL manually:\n\n    {auth_url}\n")

    print("\n  Log in and click 'Agree' in the browser.")
    print("  Waiting for Spotify to redirect back... (timeout: 2 min)\n")

    # ── Wait for callback ─────────────────────────────────────
    timed_out = not _done.wait(timeout=120)
    server.shutdown()

    if timed_out:
        print("[!]  Timed out waiting for the Spotify callback.")
        print("     Make sure the redirect URI in the Dashboard exactly matches:")
        print(f"     {REDIRECT_URI}\n")
        sys.exit(1)

    if _auth_error:
        print(f"[!]  Spotify returned an error: {_auth_error}\n")
        sys.exit(1)

    if not _auth_code:
        print("[!]  No authorization code received.\n")
        sys.exit(1)

    # ── Exchange code for tokens ──────────────────────────────
    print("  [OK] Authorization code received! Exchanging for tokens...")
    try:
        token_info = auth.get_access_token(
            _auth_code, as_dict=True, check_cache=False
        )
    except Exception as exc:
        print(f"\n[!]  Token exchange failed: {exc}\n")
        sys.exit(1)

    refresh_token = token_info.get("refresh_token", "")
    if not refresh_token:
        print("[!]  No refresh token in response.  Try revoking app access in")
        print("     Spotify Account Settings and running this script again.\n")
        sys.exit(1)

    # ── Print result ──────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  SUCCESS!  Add this line to your .env file:")
    print("=" * 60)
    print(f"\n  SPOTIFY_REFRESH_TOKEN={refresh_token}\n")
    print("  Then restart the bot:  python bot.py")
    print("  Spotify playlists and albums will work immediately.")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
