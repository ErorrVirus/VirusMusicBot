const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

module.exports = (client) => {
    const app = express();
    const port = 4000;

    // Body parsing middleware for login form POST submissions
    app.use(express.urlencoded({ extended: false }));

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc:  ["'self'"],
                fontSrc:    ["'self'", "https://fonts.gstatic.com"],
                styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                imgSrc:     ["'self'", "data:"],
            },
        },
        strictTransportSecurity: false,
    }));

    // Rate limiter: restrict brute-force attacks on the /login endpoint only
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 mins
        max: 15, // Max 15 attempts to prevent blocking regular page updates
        message: 'Too many login attempts from this IP, please try again after 15 minutes.'
    });
    app.use('/login', loginLimiter);

    const user = process.env.DASHBOARD_USER;
    const pass = process.env.DASHBOARD_PASS;

    if (!user || !pass) {
        console.error('[Dashboard] ❌ CRITICAL: DASHBOARD_USER and DASHBOARD_PASS environment variables MUST be set!');
        process.exit(1);
    }

    // Generate a secure HMAC key from the password to sign cookies
    const cookieSecret = crypto.createHash('sha256').update(pass).digest('hex');

    // Helper: Parse auth token cookie
    const getAuthToken = (req) => {
        const list = {};
        const rc = req.headers.cookie;
        if (rc) {
            rc.split(';').forEach(cookie => {
                const parts = cookie.split('=');
                list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
            });
        }
        return list.dashboard_token;
    };

    // Helper: Middleware to verify cookie authentication
    const checkAuth = (req, res, next) => {
        const token = getAuthToken(req);
        if (!token) return res.redirect('/login');

        try {
            const [username, signature, exp] = token.split('.');
            if (Date.now() > parseInt(exp, 10)) return res.redirect('/login?error=' + encodeURIComponent('Session expired.'));

            const expectedSignature = crypto.createHmac('sha256', cookieSecret).update(`${username}.${exp}`).digest('hex');
            
            if (username === user && signature === expectedSignature) {
                return next();
            }
        } catch (err) {}

        res.redirect('/login');
    };

    // Public Asset Route: Serve bot logo
    app.get('/logo.jpg', (req, res) => {
        const logoPath = path.join(__dirname, 'logo.jpg');
        if (fs.existsSync(logoPath)) {
            res.sendFile(logoPath);
        } else {
            // Fallback to pixel if not found
            res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        }
    });

    // Public Client Script Route (updates Uptime counter every second in real-time)
    app.get('/script.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.send(`
            document.addEventListener('DOMContentLoaded', () => {
                const display = document.getElementById('uptime-display');
                if (!display) return;
                
                const startTime = parseInt(display.getAttribute('data-start'));
                
                const updateUptime = () => {
                    const diff = Date.now() - startTime;
                    
                    const seconds = Math.floor((diff / 1000) % 60);
                    const minutes = Math.floor((diff / (1000 * 60)) % 60);
                    const hours   = Math.floor((diff / (1000 * 60 * 60)) % 24);
                    const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
                    
                    const parts = [];
                    if (days > 0) parts.push(days + 'd');
                    if (hours > 0) parts.push(hours + 'h');
                    if (minutes > 0) parts.push(minutes + 'm');
                    parts.push(seconds + 's');
                    
                    display.textContent = parts.join(' ');
                };
                
                updateUptime();
                setInterval(updateUptime, 1000);
            });
        `);
    });

    // Custom Login GET Route
    app.get('/login', (req, res) => {
        const errorMsg = req.query.error ? decodeURIComponent(req.query.error) : '';
        const errorAlert = errorMsg ? `<div class="error-alert">${escapeHtml(errorMsg)}</div>` : '';

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VirusMusicPro — Login</title>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-dark: #09090b;
                    --card-bg: #141416;
                    --border-color: #27272a;
                    --text-primary: #f4f4f5;
                    --text-secondary: #a1a1aa;
                    --accent-color: #10b981;
                    --accent-hover: #059669;
                    --error-color: #ef4444;
                }

                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }

                body {
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    background-color: var(--bg-dark);
                    background-image: radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.12) 0%, transparent 60%);
                    color: var(--text-primary);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }

                .login-card {
                    background-color: var(--card-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 24px;
                    width: 100%;
                    max-width: 400px;
                    padding: 40px 32px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                .logo-wrapper {
                    width: 96px;
                    height: 96px;
                    border-radius: 50%;
                    border: 2px solid var(--accent-color);
                    box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
                    overflow: hidden;
                    margin-bottom: 24px;
                }

                .logo-wrapper img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .brand-title {
                    font-size: 1.5rem;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                    margin-bottom: 8px;
                    text-align: center;
                }

                .brand-desc {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    margin-bottom: 32px;
                    text-align: center;
                }

                form {
                    width: 100%;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .input-group label {
                    font-size: 0.8rem;
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .input-group input {
                    width: 100%;
                    background-color: rgba(24, 24, 27, 0.6);
                    border: 1px solid var(--border-color);
                    color: var(--text-primary);
                    padding: 14px 16px;
                    border-radius: 12px;
                    font-family: inherit;
                    font-size: 0.95rem;
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }

                .input-group input:focus {
                    outline: none;
                    border-color: var(--accent-color);
                    box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
                }

                .error-alert {
                    width: 100%;
                    background-color: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    color: var(--error-color);
                    padding: 12px 16px;
                    border-radius: 12px;
                    font-size: 0.85rem;
                    font-weight: 500;
                    margin-bottom: 24px;
                    text-align: center;
                }

                .btn-submit {
                    background-color: var(--accent-color);
                    color: #fff;
                    border: none;
                    padding: 14px;
                    border-radius: 12px;
                    font-size: 1rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                    margin-top: 8px;
                }

                .btn-submit:hover {
                    background-color: var(--accent-hover);
                }
            </style>
        </head>
        <body>
            <div class="login-card">
                <div class="logo-wrapper">
                    <img src="/logo.jpg" alt="Bot Logo">
                </div>
                <h1 class="brand-title">VirusMusicPro</h1>
                <p class="brand-desc">Sign in to control dashboard</p>

                ${errorAlert}

                <form method="POST" action="/login">
                    <div class="input-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" placeholder="Enter username" required autocomplete="username">
                    </div>
                    <div class="input-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" placeholder="Enter password" required autocomplete="current-password">
                    </div>
                    <button type="submit" class="btn-submit">Sign In</button>
                </form>
            </div>
        </body>
        </html>
        `;
        res.send(html);
    });

    // Custom Login POST Route
    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (username === user && password === pass) {
            const exp = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
            const signature = crypto.createHmac('sha256', cookieSecret).update(`${username}.${exp}`).digest('hex');
            const token = `${username}.${signature}.${exp}`;
            
            res.setHeader('Set-Cookie', `dashboard_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
            return res.redirect('/');
        }
        res.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    });

    // Custom Logout Route
    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', 'dashboard_token=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        res.redirect('/login');
    });

    // Dashboard GET Route (Protected)
    app.get('/', checkAuth, (req, res) => {
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const botStartTime = Date.now() - client.uptime;
        
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
            <script src="/script.js" defer></script>
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
                    --error-color: #ef4444;
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
                    border-radius: 50%;
                    border: 2px solid var(--accent-color);
                    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.25);
                    overflow: hidden;
                }

                .brand-avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
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

                .header-right {
                    display: flex;
                    align-items: center;
                    gap: 16px;
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

                .btn-logout {
                    background-color: transparent;
                    border: 1px solid var(--border-color);
                    color: var(--text-secondary);
                    padding: 8px 16px;
                    border-radius: 9999px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    text-decoration: none;
                    transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
                }

                .btn-logout:hover {
                    border-color: var(--error-color);
                    color: #fff;
                    background-color: rgba(239, 68, 68, 0.1);
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
                    .header-right {
                        width: 100%;
                        justify-content: space-between;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <header>
                    <div class="brand-section">
                        <div class="brand-avatar">
                            <img src="/logo.jpg" alt="Virus Logo">
                        </div>
                        <div class="brand-text">
                            <h1>VirusMusicPro</h1>
                            <p>Developer Control Dashboard</p>
                        </div>
                    </div>
                    <div class="header-right">
                        <div class="status-badge">
                            <div class="status-dot"></div>
                            <span>Active Connection</span>
                        </div>
                        <a href="/logout" class="btn-logout">Log Out</a>
                    </div>
                </header>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <p>Uptime</p>
                        <h2 id="uptime-display" data-start="${botStartTime}">Calculating...</h2>
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
