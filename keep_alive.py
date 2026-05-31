import os
import logging
from aiohttp import web

log = logging.getLogger(__name__)

async def handle_ping(request: web.Request) -> web.Response:
    """Respond to UptimeRobot pings to keep the server alive."""
    return web.Response(text="Bot is alive!")

async def start_web_server():
    """Start the aiohttp web server in the background."""
    app = web.Application()
    app.router.add_get('/', handle_ping)
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    # Render provides the PORT environment variable.
    # We default to 8080 for local testing if it's not set.
    port = int(os.environ.get("PORT", 8080))
    
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    log.info(f"Keep-alive web server started on port {port}")
