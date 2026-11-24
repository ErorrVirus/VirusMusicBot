const dns = require('node:dns').promises;
const net = require('node:net');

const KNOWN_SAFE_MEDIA_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'open.spotify.com',
    'spotify.link',
    'soundcloud.com',
    'm.soundcloud.com',
    'on.soundcloud.com',
    'music.apple.com',
    'deezer.com',
    'www.deezer.com',
    'deezer.page.link',
    'tidal.com',
    'listen.tidal.com',
    'bandcamp.com',
    'twitch.tv',
    'www.twitch.tv',
    'vimeo.com'
]);

function isPrivateOrReservedIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true;    // 198.18.0.0/15 benchmark
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    if (a >= 224) return true;                         // Multicast + Reserved
    return false;
}

function isPrivateOrReservedIPv6(ip) {
    const norm = ip.toLowerCase();
    if (norm === '::' || norm === '::1') return true;
    if (norm.startsWith('::ffff:')) {
        const v4 = norm.slice(7);
        if (net.isIPv4(v4)) return isPrivateOrReservedIPv4(v4);
    }
    if (norm.startsWith('fe80:')) return true; // Link-local
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // Unique local fc00::/7
    if (norm.startsWith('ff')) return true; // Multicast
    return false;
}

function isPrivateIP(ip) {
    const kind = net.isIP(ip);
    if (kind === 4) return isPrivateOrReservedIPv4(ip);
    if (kind === 6) return isPrivateOrReservedIPv6(ip);
    return true;
}

function isKnownSafeMediaHost(hostname) {
    const h = hostname.toLowerCase();
    if (KNOWN_SAFE_MEDIA_HOSTS.has(h)) return true;
    if (h.endsWith('.bandcamp.com')) return true;
    return false;
}

/**
 * Validates an arbitrary HTTP/HTTPS URL against SSRF (blocks local/private IPs,
 * credentials in URLs, unsafe schemes, and private redirect targets).
 */
async function validateExternalUrl(rawUrl, options = {}) {
    const {
        resolveDns = dns.lookup,
        checkRedirects = true,
        maxRedirects = 3,
        fetchFn = globalThis.fetch
    } = options;

    let currentUrl = rawUrl;
    const visited = new Set();

    for (let step = 0; step <= maxRedirects; step++) {
        let parsed;
        try {
            parsed = new URL(currentUrl);
        } catch {
            return { safe: false, reason: 'Invalid URL syntax.' };
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { safe: false, reason: 'Only HTTP and HTTPS URLs are allowed.' };
        }

        if (parsed.username || parsed.password) {
            return { safe: false, reason: 'URLs with embedded credentials are not allowed.' };
        }

        const hostname = parsed.hostname.toLowerCase();
        if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
            return { safe: false, reason: 'Local and internal hostnames are blocked.' };
        }

        if (net.isIP(hostname)) {
            if (isPrivateIP(hostname)) {
                return { safe: false, reason: 'Private or reserved IP addresses are blocked.' };
            }
        } else {
            let records;
            try {
                records = await resolveDns(hostname, { all: true });
            } catch {
                return { safe: false, reason: 'Could not resolve target hostname.' };
            }
            if (!records || !records.length) {
                return { safe: false, reason: 'Hostname resolved to no addresses.' };
            }
            for (const rec of records) {
                if (isPrivateIP(rec.address)) {
                    return { safe: false, reason: 'Target resolves to a private or reserved network address.' };
                }
            }
        }

        // Known music platform hosts can go directly to Lavalink plugins without probing redirects
        if (isKnownSafeMediaHost(hostname) || !checkRedirects || typeof fetchFn !== 'function') {
            return { safe: true, url: parsed.toString() };
        }

        if (visited.has(parsed.toString())) {
            return { safe: false, reason: 'Redirect loop detected.' };
        }
        visited.add(parsed.toString());

        try {
            const resp = await fetchFn(parsed.toString(), {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(4000)
            });

            if (resp.status >= 300 && resp.status < 400) {
                const location = resp.headers.get('location');
                if (!location) return { safe: false, reason: 'Redirect missing location header.' };
                currentUrl = new URL(location, parsed).toString();
                continue;
            }
            return { safe: true, url: parsed.toString() };
        } catch {
            // If HEAD fails on a stream server (e.g. Icecast blocks HEAD), DNS check already passed
            return { safe: true, url: parsed.toString() };
        }
    }

    return { safe: false, reason: 'Too many redirects.' };
}

module.exports = {
    isPrivateIP,
    isPrivateOrReservedIPv4,
    isPrivateOrReservedIPv6,
    isKnownSafeMediaHost,
    validateExternalUrl
};
