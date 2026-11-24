const LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const SENSITIVE_KEYS = new Set([
    'token',
    'password',
    'pass',
    'secret',
    'jwt',
    'jwtsecret',
    'auth',
    'authorization',
    'spdc',
    'clientsecret',
    'refreshtoken',
    'endpoint',
    'cookie'
]);

function redactString(value) {
    if (typeof value !== 'string') return value;
    return value
        .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
        .replace(/([?&](?:token|auth|secret|password|key|sp_dc)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1[REDACTED]');
}

function sanitizeMeta(obj, depth = 0) {
    if (obj === null || obj === undefined) return obj;
    if (depth > 4) return '[MaxDepth]';
    if (typeof obj === 'string') return redactString(obj);
    if (typeof obj !== 'object') return obj;
    if (obj instanceof Error) {
        return {
            name: obj.name,
            message: redactString(obj.message),
            stack: obj.stack ? redactString(obj.stack) : undefined
        };
    }
    if (Array.isArray(obj)) {
        return obj.slice(0, 20).map(item => sanitizeMeta(item, depth + 1));
    }

    const out = {};
    for (const [key, val] of Object.entries(obj)) {
        const lower = key.toLowerCase().replace(/[_-]/g, '');
        if (SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('password') || lower.includes('token')) {
            out[key] = '[REDACTED]';
        } else {
            out[key] = sanitizeMeta(val, depth + 1);
        }
    }
    return out;
}

class Logger {
    constructor() {
        this.levelName = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'info')).toLowerCase();
        this.jsonFormat = process.env.LOG_FORMAT === 'json';
    }

    get level() {
        const configured = (process.env.LOG_LEVEL || this.levelName).toLowerCase();
        return LEVELS[configured] ?? LEVELS.info;
    }

    log(level, scope, message, meta = null) {
        const numLevel = LEVELS[level] ?? LEVELS.info;
        if (numLevel > this.level) return;

        const ts = new Date().toISOString();
        const safeMsg = redactString(String(message));
        const safeMeta = meta && Object.keys(meta).length ? sanitizeMeta(meta) : null;

        if (this.jsonFormat) {
            const payload = { ts, level, scope, msg: safeMsg, ...(safeMeta || {}) };
            const line = JSON.stringify(payload);
            if (level === 'error') console.error(line);
            else if (level === 'warn') console.warn(line);
            else console.log(line);
            return;
        }

        const metaStr = safeMeta ? ` ${JSON.stringify(safeMeta)}` : '';
        const formatted = `${ts} [${level.toUpperCase()}] [${scope}] ${safeMsg}${metaStr}`;
        if (level === 'error') console.error(formatted);
        else if (level === 'warn') console.warn(formatted);
        else console.log(formatted);
    }

    error(scope, message, meta) { this.log('error', scope, message, meta); }
    warn(scope, message, meta) { this.log('warn', scope, message, meta); }
    info(scope, message, meta) { this.log('info', scope, message, meta); }
    debug(scope, message, meta) { this.log('debug', scope, message, meta); }
}

module.exports = new Logger();
module.exports.Logger = Logger;
module.exports.sanitizeMeta = sanitizeMeta;
module.exports.redactString = redactString;
