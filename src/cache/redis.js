const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => console.error('[Redis] Client Error', err));
redisClient.on('connect', () => console.log('[Redis] Connected'));

// Auto-connect
(async () => {
    try {
        await redisClient.connect();
    } catch (e) {
        console.error('[Redis] Connection Failed', e);
    }
})();

module.exports = redisClient;
