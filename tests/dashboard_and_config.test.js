const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const startDashboardServer = require('../src/web/server');
const { buildDashboardApp, hashPasswordScrypt, verifyPassword } = require('../src/web/server');
const config = require('../src/config');

/**
 * Invokes an Express app in-process without opening TCP sockets
 * (works cleanly in strict network-isolated sandboxes).
 */
function dispatchExpress(app, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new PassThrough();
        socket.remoteAddress = '127.0.0.1';
        socket.encrypted = false;

        const req = new http.IncomingMessage(socket);
        req.method = method;
        req.url = url;
        req.headers = { host: 'localhost:4000', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };

        const rawBody = body != null ? Buffer.from(body, 'utf8') : null;
        if (rawBody) {
            req.headers['content-length'] = String(rawBody.length);
        }

        const res = new http.ServerResponse(req);
        const chunks = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        res.assignSocket(socket);
        res.write = (chunk, encoding, cb) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            return origWrite(chunk, encoding, cb);
        };
        res.end = (chunk, encoding, cb) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            const out = origEnd(chunk, encoding, cb);
            const text = Buffer.concat(chunks).toString('utf8');
            const headerEnd = text.indexOf('\r\n\r\n');
            const responseBody = headerEnd >= 0 ? text.slice(headerEnd + 4) : text;
            resolve({
                status: res.statusCode,
                headers: res.getHeaders(),
                text: responseBody,
                json: () => JSON.parse(responseBody)
            });
            return out;
        };

        app.handle(req, res, (err) => {
            if (err) reject(err);
            else if (!res.writableEnded) {
                res.statusCode = 404;
                res.end('Not Found');
            }
        });

        if (rawBody) req.push(rawBody);
        req.push(null);
    });
}

describe('Dashboard Security, Auth, Config Validation & Healthcheck', () => {
    it('verifies scrypt password hashing and rejects bad credentials', () => {
        const hashed = hashPasswordScrypt('SuperSecretPass!99');
        assert.ok(hashed.startsWith('scrypt:'));
        assert.equal(verifyPassword('SuperSecretPass!99', '', hashed), true);
        assert.equal(verifyPassword('WrongPass', '', hashed), false);
    });

    it('rejects dashboard startup cleanly without crashing when credentials missing or JWT equals password', () => {
        const fakeClient = { guilds: { cache: new Map() } };
        const res1 = startDashboardServer(fakeClient, { enabled: false });
        assert.equal(res1, null);

        const res2 = startDashboardServer(fakeClient, {
            enabled: true,
            user: 'admin',
            pass: 'same_secret',
            jwtSecret: 'same_secret'
        });
        assert.equal(res2, null);
    });

    it('enforces auth, separate JWT secret, CSRF protection, and authorized playback controls', async () => {
        const controlCalls = [];
        const fakePlayer = {
            guildId: '947366386127237131',
            current: { info: { title: 'Test Song', author: 'Tester', uri: 'https://youtube.com/watch?v=1', sourceName: 'youtube' } },
            queue: [],
            isPaused: false,
            voicePing: 15,
            volume: 100,
            preset: 'flat',
            isDestroyed: () => false,
            setPaused: async (p) => { fakePlayer.isPaused = p; controlCalls.push('pause'); },
            skip: async () => { controlCalls.push('skip'); return { ok: true }; },
            stop: async () => { controlCalls.push('stop'); }
        };

        const fakeClient = {
            user: { id: 'bot_1', displayAvatarURL: () => '' },
            uptime: 12000,
            isReady: () => true,
            guilds: { cache: new Map([['947366386127237131', { name: 'Main Guild' }]]) },
            manager: {
                players: new Map([['947366386127237131', fakePlayer]]),
                getPlayer: (id) => (id === '947366386127237131' ? fakePlayer : undefined),
                scheduleNowPlayingRefresh: () => {},
                getStatsSnapshot: () => ({
                    lavalinkConnected: true,
                    playbackFailures: 0,
                    jvmMemory: { used: 50e6, allocated: 256e6 },
                    frameStats: { sent: 100, deficit: 0, nulled: 0 }
                })
            }
        };

        const dashCfg = {
            enabled: true,
            port: 4000,
            user: 'admin',
            pass: '',
            passHash: hashPasswordScrypt('MyStrongPass!123'),
            jwtSecret: 'independent_jwt_secret_64_chars_long_abcdef1234567890',
            trustProxy: false
        };

        const app = buildDashboardApp(fakeClient, dashCfg);

        // 1. Health endpoint works without auth and leaks no secrets
        const healthRes = await dispatchExpress(app, { url: '/health' });
        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.json().status, 'ok');
        assert.equal(healthRes.json().lavalinkConnected, true);

        // 2. Unauthorized API request is rejected with 401
        const unauthApi = await dispatchExpress(app, { url: '/api/stats' });
        assert.equal(unauthApi.status, 401);

        // 3. JWT signed with wrong secret is rejected
        const forgedToken = jwt.sign({ username: 'admin', jti: '1' }, 'MyStrongPass!123');
        const forgedRes = await dispatchExpress(app, {
            url: '/api/stats',
            headers: { cookie: `dashboard_token=${encodeURIComponent(forgedToken)}` }
        });
        assert.equal(forgedRes.status, 401);

        // 4. GET /login issues CSRF token + cookie, POST /login succeeds with valid credentials
        const loginPage = await dispatchExpress(app, { url: '/login' });
        assert.equal(loginPage.status, 200);
        const csrfMatch = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/);
        assert.ok(csrfMatch, 'Login form must contain CSRF token');
        const rawSetCookie = loginPage.headers['set-cookie'];
        const csrfCookie = (Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie).split(';')[0];

        const loginPost = await dispatchExpress(app, {
            method: 'POST',
            url: '/login',
            headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
            body: new URLSearchParams({ username: 'admin', password: 'MyStrongPass!123', _csrf: csrfMatch[1] }).toString()
        });
        assert.equal(loginPost.status, 302);
        assert.equal(loginPost.headers.location, '/');

        const loginCookies = Array.isArray(loginPost.headers['set-cookie']) ? loginPost.headers['set-cookie'] : [loginPost.headers['set-cookie']];
        const authCookie = loginCookies.find(c => c.startsWith('dashboard_token=')).split(';')[0];

        // 5. Authenticated dashboard page renders & provides CSRF token for /api/control
        const dashRes = await dispatchExpress(app, { url: '/', headers: { cookie: authCookie } });
        assert.equal(dashRes.status, 200);
        const pageCsrf = dashRes.text.match(/name="csrf-token"\s+content="([^"]+)"/)[1];

        // 6. Control POST without CSRF is rejected with 403
        const noCsrfCtrl = await dispatchExpress(app, {
            method: 'POST',
            url: '/api/control',
            headers: { 'content-type': 'application/json', cookie: authCookie },
            body: JSON.stringify({ guildId: '947366386127237131', action: 'pause' })
        });
        assert.equal(noCsrfCtrl.status, 403);

        // 7. Control POST with valid CSRF succeeds
        const okCtrl = await dispatchExpress(app, {
            method: 'POST',
            url: '/api/control',
            headers: { 'content-type': 'application/json', cookie: authCookie, 'x-csrf-token': pageCsrf },
            body: JSON.stringify({ guildId: '947366386127237131', action: 'pause' })
        });
        assert.equal(okCtrl.status, 200);
        assert.deepEqual(controlCalls, ['pause']);
    });

    it('config.validate fails when mandatory Discord or Lavalink env vars are missing', () => {
        const origToken = config.discord.token;
        config.discord.token = '';
        assert.throws(() => config.validate(), /DISCORD_TOKEN/);
        config.discord.token = origToken;
    });
});
