const express = require('express');
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const fs = require('fs');

// S-1: Escape all characters that are meaningful in HTML to prevent XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const formatDuration = (ms) => {
    if (!ms) return '0s';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours   = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days    = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.join(' ') || '0s';
};

module.exports = (client) => {
    const app = express();
    const port = 4000;

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc:  ["'self'"],
                fontSrc:    ["'self'", "https://fonts.gstatic.com"],
                styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            },
        },
        strictTransportSecurity: false,
    }));

    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 50,
        message: 'Too many login attempts from this IP, please try again after 15 minutes.'
    });
    app.use(limiter);

    const user = process.env.DASHBOARD_USER || 'admin';
    const pass = process.env.DASHBOARD_PASS || 'admin123';

    if (!process.env.DASHBOARD_USER || !process.env.DASHBOARD_PASS) {
        console.warn('[Dashboard] ⚠️  WARNING: DASHBOARD_USER and/or DASHBOARD_PASS are not set.');
        console.warn('[Dashboard] ⚠️  Falling back to default credentials (admin/admin123).');
    }

    app.use(basicAuth({
        users: { [user]: pass },
        challenge: true,
        realm: 'Developer Dashboard'
    }));

    app.get('/', (req, res) => {
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const uptimeStr = formatDuration(client.uptime);
        
        let activeStreamsHTML = '';
        let activeCount = 0;

        if (client.manager && client.manager.players) {
            client.manager.players.forEach(player => {
                if (player.current) {
                    activeCount++;
                    const guild = client.guilds.cache.get(player.guildId);
                    const guildName = guild ? guild.name : 'Unknown Server';
                    activeStreamsHTML += `
                        <tr>
                            <td>
                                <div class="guild-info">
                                    <div class="status-pulse active"></div>
                                    <span>${escapeHtml(guildName)}</span>
                                </div>
                            </td>
                            <td><a class="song-link" href="${escapeHtml(player.current.info.uri)}" target="_blank">${escapeHtml(player.current.info.title)}</a></td>
                            <td><span class="artist-badge">${escapeHtml(player.current.info.author)}</span></td>
                            <td><span class="queue-badge">${player.queue.length} track(s)</span></td>
                        </tr>
                    `;
                }
            });
        }

        if (activeCount === 0) {
            activeStreamsHTML = `<tr><td colspan="4" style="text-align: center; color: #71717a; padding: 30px;">No active music streams right now.</td></tr>`;
        }

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="15">
            <title>VirusMusicPro — Developer Dashboard</title>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-dark: #09090b;
                    --card-bg: #141416;
                    --border-color: #27272a;
                    --text-primary: #f4f4f5;
                    --text-secondary: #a1a1aa;
                    --accent-color: #10b981;
                    --accent-hover: #059669;
                    --accent-light: rgba(16, 185, 129, 0.1);
                    --pulse-color: #10b981;
                }

                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }

                body {
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    background-color: var(--bg-dark);
                    background-image: radial-gradient(circle at 50% -20%, rgba(16, 185, 129, 0.15) 0%, transparent 50%);
                    color: var(--text-primary);
                    min-height: 100vh;
                    padding: 40px 20px;
                    line-height: 1.5;
                }

                .container {
                    max-width: 1100px;
                    margin: 0 auto;
                }

                header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 40px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid var(--border-color);
                }

                .brand-section {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .brand-avatar {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, var(--accent-color), #3b82f6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.25);
                }

                .brand-text h1 {
                    font-size: 1.5rem;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                }

                .brand-text p {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                }

                .status-badge {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background-color: rgba(24, 24, 27, 0.5);
                    border: 1px solid var(--border-color);
                    padding: 8px 16px;
                    border-radius: 9999px;
                    font-size: 0.85rem;
                    font-weight: 500;
                }

                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--accent-color);
                    box-shadow: 0 0 12px var(--accent-color);
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 20px;
                    margin-bottom: 40px;
                }

                .stat-card {
                    background-color: var(--card-bg);
                    border: 1px solid var(--border-color);
                    padding: 24px;
                    border-radius: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    transition: transform 0.2s ease, border-color 0.2s ease;
                }

                .stat-card:hover {
                    transform: translateY(-2px);
                    border-color: rgba(16, 185, 129, 0.3);
                }

                .stat-card p {
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary);
                    font-weight: 600;
                }

                .stat-card h2 {
                    font-size: 2.25rem;
                    font-weight: 700;
                    letter-spacing: -1px;
                }

                .stat-card.accent h2 {
                    color: var(--accent-color);
                }

                .dashboard-section {
                    background-color: var(--card-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 16px;
                    overflow: hidden;
                }

                .section-header {
                    padding: 24px;
                    border-bottom: 1px solid var(--border-color);
                }

                .section-header h2 {
                    font-size: 1.2rem;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .table-container {
                    overflow-x: auto;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                }

                th, td {
                    padding: 16px 24px;
                    text-align: left;
                }

                th {
                    background-color: rgba(24, 24, 27, 0.3);
                    color: var(--text-secondary);
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                }

                tr {
                    border-bottom: 1px solid var(--border-color);
                }

                tr:last-child {
                    border-bottom: none;
                }

                tr:hover td {
                    background-color: rgba(24, 24, 27, 0.2);
                }

                .guild-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 500;
                }

                .status-pulse {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--accent-color);
                    position: relative;
                }

                .status-pulse.active::after {
                    content: '';
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background-color: var(--accent-color);
                    animation: pulse 1.5s infinite ease-in-out;
                    left: 0;
                    top: 0;
                }

                .song-link {
                    color: var(--text-primary);
                    text-decoration: none;
                    font-weight: 600;
                    transition: color 0.15s ease;
                }

                .song-link:hover {
                    color: var(--accent-color);
                    text-decoration: underline;
                }

                .artist-badge {
                    background-color: rgba(255, 255, 255, 0.05);
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    border: 1px solid rgba(255, 255, 255, 0.02);
                }

                .queue-badge {
                    background-color: var(--accent-light);
                    color: var(--accent-color);
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    border: 1px solid rgba(16, 185, 129, 0.15);
                }

                @keyframes pulse {
                    0% {
                        transform: scale(1);
                        opacity: 1;
                    }
                    100% {
                        transform: scale(2.5);
                        opacity: 0;
                    }
                }

                @media (max-width: 768px) {
                    body {
                        padding: 20px 10px;
                    }
                    header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 16px;
                    }
                    .status-badge {
                        align-self: flex-start;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <header>
                    <div class="brand-section">
                        <div class="brand-avatar">🎵</div>
                        <div class="brand-text">
                            <h1>VirusMusicPro</h1>
                            <p>Developer Control Dashboard</p>
                        </div>
                    </div>
                    <div class="status-badge">
                        <div class="status-dot"></div>
                        <span>Active Connection</span>
                    </div>
                </header>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <p>Uptime</p>
                        <h2>${uptimeStr}</h2>
                    </div>
                    <div class="stat-card">
                        <p>Total Servers</p>
                        <h2>${totalServers}</h2>
                    </div>
                    <div class="stat-card">
                        <p>Total Users</p>
                        <h2>${totalUsers}</h2>
                    </div>
                    <div class="stat-card accent">
                        <p>Active Streams</p>
                        <h2>${activeCount}</h2>
                    </div>
                </div>

                <div class="dashboard-section">
                    <div class="section-header">
                        <h2>🔊 Live Playback Streams</h2>
                    </div>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Guild/Server</th>
                                    <th>Song Title</th>
                                    <th>Artist</th>
                                    <th>Queue Size</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${activeStreamsHTML}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;
        
        res.send(html);
    });

    const sslCrt = process.env.SSL_CRT_PATH;
    const sslKey = process.env.SSL_KEY_PATH;

    if (sslCrt && sslKey && fs.existsSync(sslCrt) && fs.existsSync(sslKey)) {
        try {
            const options = {
                key: fs.readFileSync(sslKey),
                cert: fs.readFileSync(sslCrt)
            };
            https.createServer(options, app).listen(port, () => {
                console.log(`[Dashboard] 🔒 Secure dashboard (HTTPS) running on port ${port}`);
            });
        } catch (err) {
            console.error('[Dashboard] ❌ Failed to start HTTPS server, falling back to HTTP:', err.message);
            startHttp(app, port);
        }
    } else {
        if (sslCrt || sslKey) {
            console.warn('[Dashboard] ⚠️  SSL certificate paths configured but files not found or unreadable.');
        }
        startHttp(app, port);
    }
};

function startHttp(app, port) {
    app.listen(port, () => {
        console.log(`[Dashboard] 🔓 Dashboard (HTTP) running on port ${port}`);
        console.log('[Dashboard] 💡 For HTTPS, configure SSL_CRT_PATH and SSL_KEY_PATH in your .env');
    });
}
