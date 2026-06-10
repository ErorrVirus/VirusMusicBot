const express = require('express');
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

module.exports = (client) => {
    const app = express();
    const port = 4000;

    // Security: Protect HTTP Headers (but allow inline scripts for our autorefresh)
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
            },
        },
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
                    activeStreamsHTML += `
                        <tr>
                            <td>${guildName}</td>
                            <td><a href="${player.current.info.uri}" target="_blank">${player.current.info.title}</a></td>
                            <td>${player.current.info.author}</td>
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
            <script>
                // Refresh the page every 15 seconds automatically
                setTimeout(() => window.location.reload(), 15000);
            </script>
        </body>
        </html>
        `;
        
        res.send(html);
    });

    app.listen(port, () => {
        console.log(`[Dashboard] Developer dashboard is running on port ${port}`);
    });
};
