const express = require('express');
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// S-1: Escape all characters that are meaningful in HTML to prevent XSS from
// Discord guild names, track titles, or artist names being injected into the page.
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = (client) => {
    const app = express();
    const port = 4000;

    // Security: Protect HTTP Headers.
    // S-3: 'unsafe-inline' removed — auto-refresh is now done via <meta http-equiv="refresh">
    // so no inline scripts are needed at all.
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc:  ["'self'"],
            },
        },
        // Disable HSTS so browsers don't force HTTPS on local IP/HTTP access
        strictTransportSecurity: false,
    }));

    // Security: Prevent brute-force password guessing
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 50, // Limit each IP to 50 requests per window
        message: 'Too many login attempts from this IP, please try again after 15 minutes.'
    });
    app.use(limiter);

    const user = process.env.DASHBOARD_USER || 'admin';
    const pass = process.env.DASHBOARD_PASS || 'admin123';

    // S-2: Warn loudly if the operator is using the default credentials so it
    // cannot be missed in logs. The dashboard still starts — a hard crash would
    // break deployments that intentionally run behind a private network.
    if (!process.env.DASHBOARD_USER || !process.env.DASHBOARD_PASS) {
        console.warn('[Dashboard] ⚠️  WARNING: DASHBOARD_USER and/or DASHBOARD_PASS are not set.');
        console.warn('[Dashboard] ⚠️  Falling back to default credentials (admin/admin123).');
        console.warn('[Dashboard] ⚠️  Set DASHBOARD_USER and DASHBOARD_PASS in your .env to secure the dashboard.');
    }

    // Basic Authentication
    app.use(basicAuth({
        users: { [user]: pass },
        challenge: true,
        realm: 'Developer Dashboard'
    }));

    app.get('/', (req, res) => {
        // Collect metrics
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        
        let activeStreamsHTML = '';
        let activeCount = 0;

        if (client.manager && client.manager.players) {
            client.manager.players.forEach(player => {
                if (player.current) {
                    activeCount++;
                    const guild = client.guilds.cache.get(player.guildId);
                    const guildName = guild ? guild.name : 'Unknown Server';
                    // S-1: escape every user-controlled field before injection into HTML
                    activeStreamsHTML += `
                        <tr>
                            <td>${escapeHtml(guildName)}</td>
                            <td><a href="${escapeHtml(player.current.info.uri)}" target="_blank">${escapeHtml(player.current.info.title)}</a></td>
                            <td>${escapeHtml(player.current.info.author)}</td>
                            <td>${player.queue.length} in queue</td>
                        </tr>
                    `;
                }
            });
        }

        if (activeCount === 0) {
            activeStreamsHTML = `<tr><td colspan="4" style="text-align: center;">No active streams right now.</td></tr>`;
        }

        // Dashboard HTML
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <!-- S-3: meta refresh replaces the <script>setTimeout</script> block so
                 the Content-Security-Policy no longer needs 'unsafe-inline' -->
            <meta http-equiv="refresh" content="15">
            <title>Bot Developer Dashboard</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: #121212;
                    color: #ffffff;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    max-width: 1000px;
                    margin: 0 auto;
                }
                h1 {
                    color: #1DB954;
                    border-bottom: 2px solid #333;
                    padding-bottom: 10px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background-color: #1e1e1e;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    border: 1px solid #333;
                }
                .stat-card h2 {
                    margin: 0;
                    font-size: 2.5em;
                    color: #1DB954;
                }
                .stat-card p {
                    margin: 5px 0 0;
                    color: #aaa;
                    text-transform: uppercase;
                    font-size: 0.9em;
                    letter-spacing: 1px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    background-color: #1e1e1e;
                    border-radius: 8px;
                    overflow: hidden;
                }
                th, td {
                    padding: 15px;
                    text-align: left;
                    border-bottom: 1px solid #333;
                }
                th {
                    background-color: #2a2a2a;
                    color: #aaa;
                    text-transform: uppercase;
                    font-size: 0.85em;
                }
                tr:hover {
                    background-color: #252525;
                }
                a {
                    color: #1DB954;
                    text-decoration: none;
                }
                a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎵 Developer Dashboard</h1>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h2>${totalServers}</h2>
                        <p>Total Servers</p>
                    </div>
                    <div class="stat-card">
                        <h2>${totalUsers}</h2>
                        <p>Total Users</p>
                    </div>
                    <div class="stat-card">
                        <h2>${activeCount}</h2>
                        <p>Active Streams</p>
                    </div>
                </div>

                <h2>🔴 Live Streams</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Server Name</th>
                            <th>Playing Song</th>
                            <th>Artist</th>
                            <th>Queue</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${activeStreamsHTML}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
        `;
        
        res.send(html);
    });

    app.listen(port, () => {
        console.log(`[Dashboard] Developer dashboard is running on port ${port}`);
    });
};
