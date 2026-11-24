const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const { getTrackTitle, getTrackArtist, getTrackUri, getTrackSource } = require('../utils/trackUtils');

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hashPasswordScrypt(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt:${salt}:${derived}`;
}

function verifyPassword(inputPassword, storedPlain, storedHash) {
    const candidate = String(inputPassword || '');
    if (storedHash && storedHash.startsWith('scrypt:')) {
        const parts = storedHash.split(':');
        if (parts.length !== 3) return false;
        const [, salt, hexDigest] = parts;
        const expectedBuf = Buffer.from(hexDigest, 'hex');
        const actualBuf = crypto.scryptSync(candidate, salt, expectedBuf.length);
        if (actualBuf.length !== expectedBuf.length) return false;
        return crypto.timingSafeEqual(actualBuf, expectedBuf);
    }
    if (storedPlain) {
        const a = crypto.createHash('sha256').update(candidate).digest();
        const b = crypto.createHash('sha256').update(String(storedPlain)).digest();
        return crypto.timingSafeEqual(a, b);
    }
    return false;
}

function parseCookies(req) {
    const list = {};
    const rc = req.headers.cookie;
    if (!rc) return list;
    rc.split(';').forEach(cookie => {
        const idx = cookie.indexOf('=');
        if (idx <= 0) return;
        const key = cookie.slice(0, idx).trim();
        const val = cookie.slice(idx + 1).trim();
        try {
            list[key] = decodeURIComponent(val);
        } catch {
            list[key] = val;
        }
    });
    return list;
}

function createCsrfToken(secret, sessionMarker) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', secret).update(`${sessionMarker}:${nonce}`).digest('hex');
    return `${nonce}.${sig}`;
}

function verifyCsrfToken(token, secret, sessionMarker) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [nonce, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${sessionMarker}:${nonce}`).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildDashboardApp(client, dashCfg = config.dashboard) {
    const app = express();
    const jwtSecret = dashCfg.jwtSecret;
    const user = dashCfg.user;
    const pass = dashCfg.pass;
    const passHash = dashCfg.passHash;
    const hasHttps = Boolean(dashCfg.sslCrtPath && dashCfg.sslKeyPath && fs.existsSync(dashCfg.sslCrtPath) && fs.existsSync(dashCfg.sslKeyPath));

    if (dashCfg.trustProxy !== undefined && dashCfg.trustProxy !== false) {
        app.set('trust proxy', dashCfg.trustProxy);
    }

    app.use(express.urlencoded({ extended: false, limit: '16kb' }));
    app.use(express.json({ limit: '16kb' }));

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                fontSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        strictTransportSecurity: hasHttps ? { maxAge: 15552000, includeSubDomains: false } : false
    }));

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: 'Too many login attempts. Please wait 15 minutes and try again.'
    });

    const apiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false
    });

    const isSecureCookie = (req) => hasHttps || req.secure || req.headers['x-forwarded-proto'] === 'https';

    const cookieAttrs = (req, maxAgeSec) => {
        const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`];
        if (typeof maxAgeSec === 'number') parts.push(`Max-Age=${maxAgeSec}`);
        if (isSecureCookie(req)) parts.push('Secure');
        return parts.join('; ');
    };

    const checkAuth = (req, res, next) => {
        const cookies = parseCookies(req);
        const token = cookies.dashboard_token;
        if (!token) {
            if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
            return res.redirect('/login');
        }

        try {
            const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
            if (decoded && decoded.username === user) {
                req.dashboardUser = decoded;
                return next();
            }
        } catch (_) {}

        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Invalid or expired session' });
        return res.redirect('/login');
    };

    // Unauthenticated minimal Docker healthcheck endpoint (no secrets or guild details)
    app.get('/health', (req, res) => {
        const snap = client.manager?.getStatsSnapshot?.() || {};
        res.json({
            status: 'ok',
            discordReady: Boolean(client.isReady?.() ?? client.user),
            lavalinkConnected: Boolean(snap.lavalinkConnected)
        });
    });

    app.get('/logo.jpg', (req, res) => {
        const logoPath = path.join(__dirname, 'logo.jpg');
        if (fs.existsSync(logoPath)) {
            res.sendFile(logoPath);
        } else {
            res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        }
    });

    app.get('/style.css', (req, res) => {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.send(`
:root {
  --bg: #09090b; --card: #141418; --border: #27272a;
  --text: #f4f4f5; --muted: #a1a1aa; --accent: #10b981;
  --accent-hover: #059669; --danger: #ef4444; --warn: #f59e0b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 24px; }
.container { max-width: 1180px; margin: 0 auto; }
.login-wrap { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 48px); }
.login-card { background: var(--card); border: 1px solid var(--border); border-radius: 20px; width: 100%; max-width: 400px; padding: 36px 28px; display: flex; flex-direction: column; align-items: center; }
.logo-circle { width: 84px; height: 84px; border-radius: 50%; border: 2px solid var(--accent); overflow: hidden; margin-bottom: 16px; }
.logo-circle img { width: 100%; height: 100%; object-fit: cover; }
.brand-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 6px; }
.brand-sub { font-size: 0.85rem; color: var(--muted); margin-bottom: 24px; }
form.login-form { width: 100%; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }
.field input { background: #1c1c22; border: 1px solid var(--border); color: var(--text); padding: 12px 14px; border-radius: 10px; font-size: 0.95rem; }
.btn { background: var(--accent); color: #fff; border: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 0.85rem; }
.btn:hover { background: var(--accent-hover); }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
.btn-ghost:hover { border-color: var(--danger); color: #fff; background: rgba(239,68,68,0.1); }
.btn-sm { padding: 6px 10px; font-size: 0.78rem; border-radius: 8px; }
.btn-danger { background: var(--danger); }
.alert-err { width: 100%; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 10px 12px; border-radius: 10px; font-size: 0.85rem; margin-bottom: 16px; text-align: center; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
.brand-row { display: flex; align-items: center; gap: 14px; }
.brand-row .logo-circle { width: 46px; height: 46px; margin-bottom: 0; }
.header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--card); border: 1px solid var(--border); font-size: 0.82rem; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.dot.off { background: var(--danger); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
.card p { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
.card h2 { font-size: 1.45rem; font-weight: 700; }
.section { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.section-head { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
a.song-link { color: var(--text); text-decoration: none; font-weight: 600; }
a.song-link:hover { color: var(--accent); text-decoration: underline; }
.controls-cell { display: flex; gap: 6px; flex-wrap: wrap; }
`);
    });

    app.get('/script.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(`
document.addEventListener('DOMContentLoaded', () => {
  const display = document.getElementById('uptime-display');
  if (display) {
    const startTime = parseInt(display.getAttribute('data-start') || '0', 10);
    const updateUptime = () => {
      const diff = Math.max(0, Date.now() - startTime);
      const s = Math.floor((diff / 1000) % 60);
      const m = Math.floor((diff / 60000) % 60);
      const h = Math.floor((diff / 3600000) % 24);
      const d = Math.floor(diff / 86400000);
      const parts = [];
      if (d > 0) parts.push(d + 'd');
      if (h > 0) parts.push(h + 'h');
      if (m > 0) parts.push(m + 'm');
      parts.push(s + 's');
      display.textContent = parts.join(' ');
    };
    updateUptime();
    setInterval(updateUptime, 1000);
  }

  document.querySelectorAll('[data-control]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const guildId = btn.getAttribute('data-guild');
      const action = btn.getAttribute('data-control');
      const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
      btn.disabled = true;
      try {
        const resp = await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ guildId, action })
        });
        if (resp.ok) {
          window.location.reload();
        } else {
          const data = await resp.json().catch(() => ({}));
          alert(data.error || 'Action failed');
        }
      } finally {
        btn.disabled = false;
      }
    });
  });

  if (document.getElementById('streams-body')) {
    setInterval(() => { window.location.reload(); }, 15000);
  }
});
`);
    });

    app.get('/login', (req, res) => {
        const errorMsg = req.query.error ? String(req.query.error).slice(0, 120) : '';
        const errorAlert = errorMsg ? `<div class="alert-err">${escapeHtml(errorMsg)}</div>` : '';
        const csrfToken = createCsrfToken(jwtSecret, 'login');
        res.setHeader('Set-Cookie', `dashboard_login_csrf=${encodeURIComponent(csrfToken)}; ${cookieAttrs(req, 600)}`);

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VirusMusicPro — Login</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <div class="logo-circle"><img src="/logo.jpg" alt="Bot Logo"></div>
      <h1 class="brand-title">VirusMusicPro V3</h1>
      <p class="brand-sub">Sign in to control dashboard</p>
      ${errorAlert}
      <form class="login-form" method="POST" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required autocomplete="username">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
        </div>
        <button type="submit" class="btn">Sign In</button>
      </form>
    </div>
  </div>
</body>
</html>`);
    });

    app.post('/login', loginLimiter, (req, res) => {
        const cookies = parseCookies(req);
        const formCsrf = req.body?._csrf;
        const cookieCsrf = cookies.dashboard_login_csrf;

        if (!formCsrf || !cookieCsrf || formCsrf !== cookieCsrf || !verifyCsrfToken(formCsrf, jwtSecret, 'login')) {
            return res.redirect('/login?error=' + encodeURIComponent('Session expired. Please try again.'));
        }

        const username = String(req.body?.username || '');
        const password = String(req.body?.password || '');

        const userBufA = crypto.createHash('sha256').update(username).digest();
        const userBufB = crypto.createHash('sha256').update(String(user)).digest();
        const usernameOk = crypto.timingSafeEqual(userBufA, userBufB);
        const passwordOk = verifyPassword(password, pass, passHash);

        if (usernameOk && passwordOk) {
            const jti = crypto.randomBytes(12).toString('hex');
            const token = jwt.sign({ username, jti }, jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
            res.setHeader('Set-Cookie', [
                `dashboard_token=${encodeURIComponent(token)}; ${cookieAttrs(req, 7 * 24 * 3600)}`,
                `dashboard_login_csrf=; ${cookieAttrs(req, 0)}`
            ]);
            return res.redirect('/');
        }

        return res.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    });

    app.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', `dashboard_token=; ${cookieAttrs(req, 0)}`);
        res.redirect('/login');
    });

    function collectStats() {
        const totalServers = client.guilds?.cache?.size || 0;
        const botStartTime = Date.now() - (client.uptime || 0);
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const sysMemTotalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
        const sysMemFreeGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
        const loadAvg1m = os.loadavg()[0].toFixed(2);
        const snap = client.manager?.getStatsSnapshot?.() || {};

        const players = [];
        if (client.manager?.players) {
            client.manager.players.forEach(p => {
                if (!p.isDestroyed()) {
                    const guild = client.guilds?.cache?.get(p.guildId);
                    players.push({
                        guildId: p.guildId,
                        guildName: guild ? guild.name : p.guildId,
                        title: p.current ? getTrackTitle(p.current) : 'Idle',
                        artist: p.current ? getTrackArtist(p.current) : '-',
                        uri: p.current ? getTrackUri(p.current) : '',
                        source: p.current ? getTrackSource(p.current) : '-',
                        queueSize: p.queue.length,
                        paused: p.isPaused,
                        voicePing: p.voicePing,
                        volume: p.volume,
                        preset: p.preset
                    });
                }
            });
        }

        return {
            discordOnline: Boolean(client.user),
            totalServers,
            botStartTime,
            botMemoryMB: memMB,
            systemMemory: `${sysMemFreeGB} / ${sysMemTotalGB} GiB free`,
            cpuLoad1m: loadAvg1m,
            lavalinkConnected: Boolean(snap.lavalinkConnected),
            jvmMemory: snap.jvmMemory ? `${Math.round(snap.jvmMemory.used / 1024 / 1024)} / ${Math.round(snap.jvmMemory.allocated / 1024 / 1024)} MiB` : 'N/A',
            frameDeficits: snap.frameStats ? `${snap.frameStats.deficit} deficit / ${snap.frameStats.nulled} nulled` : '0',
            playbackFailures: snap.playbackFailures ?? 0,
            activeStreams: players.filter(p => p.title !== 'Idle').length,
            players
        };
    }

    app.get('/api/stats', apiLimiter, checkAuth, (req, res) => {
        res.json(collectStats());
    });

    app.post('/api/control', apiLimiter, checkAuth, async (req, res) => {
        const csrfHeader = req.headers['x-csrf-token'];
        if (!verifyCsrfToken(csrfHeader, jwtSecret, req.dashboardUser.jti)) {
            return res.status(403).json({ error: 'Invalid CSRF token' });
        }

        const { guildId, action } = req.body || {};
        if (!guildId || !/^\d{15,22}$/.test(String(guildId))) {
            return res.status(400).json({ error: 'Invalid guildId' });
        }

        const player = client.manager?.getPlayer(String(guildId));
        if (!player || player.isDestroyed()) {
            return res.status(404).json({ error: 'Active player not found for guild' });
        }

        try {
            switch (action) {
                case 'pause':
                    await player.setPaused(!player.isPaused);
                    client.manager.scheduleNowPlayingRefresh(player);
                    return res.json({ ok: true, paused: player.isPaused });
                case 'skip':
                    await player.skip();
                    return res.json({ ok: true });
                case 'stop':
                    await player.stop();
                    return res.json({ ok: true });
                default:
                    return res.status(400).json({ error: 'Unsupported control action' });
            }
        } catch (err) {
            logger.error('Dashboard', 'Control endpoint error', { guildId, action, err });
            return res.status(500).json({ error: 'Internal playback control error' });
        }
    });

    app.get('/', checkAuth, (req, res) => {
        const stats = collectStats();
        const csrfToken = createCsrfToken(jwtSecret, req.dashboardUser.jti);

        const rowsHtml = stats.players.length
            ? stats.players.map(p => {
                const safeUri = /^https?:\/\//i.test(p.uri) ? escapeHtml(p.uri) : '';
                const titleCell = safeUri
                    ? `<a class="song-link" href="${safeUri}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>`
                    : escapeHtml(p.title);
                return `<tr>
                    <td>${escapeHtml(p.guildName)}</td>
                    <td>${titleCell}</td>
                    <td>${escapeHtml(p.artist)}</td>
                    <td>${escapeHtml(p.source)}</td>
                    <td>${p.queueSize}</td>
                    <td>${p.voicePing >= 0 ? `${p.voicePing}ms` : 'N/A'}</td>
                    <td class="controls-cell">
                        <button class="btn btn-sm" data-control="pause" data-guild="${escapeHtml(p.guildId)}">${p.paused ? 'Resume' : 'Pause'}</button>
                        <button class="btn btn-sm" data-control="skip" data-guild="${escapeHtml(p.guildId)}">Skip</button>
                        <button class="btn btn-sm btn-danger" data-control="stop" data-guild="${escapeHtml(p.guildId)}">Stop</button>
                    </td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="7">No active players right now.</td></tr>`;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="${escapeHtml(csrfToken)}">
  <title>VirusMusicPro V3 — Dashboard</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/script.js" defer></script>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand-row">
        <div class="logo-circle"><img src="/logo.jpg" alt="Logo"></div>
        <div>
          <h1>VirusMusicPro V3</h1>
          <p style="color:var(--muted);font-size:0.85rem;">Operations &amp; Audio Telemetry</p>
        </div>
      </div>
      <div class="header-actions">
        <span class="pill"><span class="dot ${stats.discordOnline ? '' : 'off'}"></span>Discord ${stats.discordOnline ? 'Online' : 'Offline'}</span>
        <span class="pill"><span class="dot ${stats.lavalinkConnected ? '' : 'off'}"></span>Lavalink ${stats.lavalinkConnected ? 'Ready' : 'Down'}</span>
        <a href="/logout" class="btn btn-ghost">Log Out</a>
      </div>
    </header>

    <div class="grid">
      <div class="card"><p>Uptime</p><h2 id="uptime-display" data-start="${stats.botStartTime}">...</h2></div>
      <div class="card"><p>Servers</p><h2>${stats.totalServers}</h2></div>
      <div class="card"><p>Active Streams</p><h2>${stats.activeStreams}</h2></div>
      <div class="card"><p>Bot RSS RAM</p><h2>${stats.botMemoryMB} MiB</h2></div>
      <div class="card"><p>Lavalink JVM</p><h2>${escapeHtml(stats.jvmMemory)}</h2></div>
      <div class="card"><p>Frame Deficits</p><h2>${escapeHtml(stats.frameDeficits)}</h2></div>
      <div class="card"><p>Playback Failures</p><h2>${stats.playbackFailures}</h2></div>
      <div class="card"><p>Host Load (1m)</p><h2>${escapeHtml(stats.cpuLoad1m)}</h2></div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>🔊 Live Guild Players</h2>
        <span style="color:var(--muted);font-size:0.82rem;">Host RAM: ${escapeHtml(stats.systemMemory)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Server</th>
              <th>Track</th>
              <th>Artist</th>
              <th>Source</th>
              <th>Queue</th>
              <th>Voice Ping</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody id="streams-body">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`);
    });

    return app;
}

function startDashboardServer(client, dashCfg = config.dashboard) {
    if (!dashCfg.enabled) {
        logger.info('Dashboard', 'Web dashboard is disabled via DASHBOARD_ENABLED=false.');
        return null;
    }

    const hasCredentials = Boolean(dashCfg.user && (dashCfg.pass || dashCfg.passHash) && dashCfg.jwtSecret);
    if (!hasCredentials) {
        logger.warn('Dashboard', 'Dashboard skipped: DASHBOARD_USER, DASHBOARD_PASS/DASHBOARD_PASS_HASH, and DASHBOARD_JWT_SECRET must all be set to enable the web dashboard.');
        return null;
    }

    if (dashCfg.pass && dashCfg.jwtSecret === dashCfg.pass) {
        logger.error('Dashboard', 'Dashboard disabled for security: DASHBOARD_JWT_SECRET must not equal DASHBOARD_PASS.');
        return null;
    }

    if (dashCfg.jwtSecret && dashCfg.jwtSecret.length < 32) {
        logger.error('Dashboard', 'Dashboard disabled for security: DASHBOARD_JWT_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        return null;
    }

    const app = buildDashboardApp(client, dashCfg);
    const port = dashCfg.port || 4000;

    if (dashCfg.sslCrtPath && dashCfg.sslKeyPath && fs.existsSync(dashCfg.sslCrtPath) && fs.existsSync(dashCfg.sslKeyPath)) {
        try {
            const sslOptions = {
                key: fs.readFileSync(dashCfg.sslKeyPath),
                cert: fs.readFileSync(dashCfg.sslCrtPath)
            };
            return https.createServer(sslOptions, app).listen(port, () => {
                logger.info('Dashboard', `Secure dashboard (HTTPS) listening on port ${port}`);
            });
        } catch (err) {
            logger.error('Dashboard', 'HTTPS startup failed; falling back to HTTP', { err: err.message });
        }
    }

    return http.createServer(app).listen(port, () => {
        logger.info('Dashboard', `Dashboard (HTTP) listening on port ${port}`);
    });
}

module.exports = startDashboardServer;
module.exports.startDashboardServer = startDashboardServer;
module.exports.buildDashboardApp = buildDashboardApp;
module.exports.hashPasswordScrypt = hashPasswordScrypt;
module.exports.verifyPassword = verifyPassword;
module.exports.createCsrfToken = createCsrfToken;
module.exports.verifyCsrfToken = verifyCsrfToken;
