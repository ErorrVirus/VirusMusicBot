/**
 * Per-key FIFO asynchronous mutex lock with timeout protection.
 * Prevents concurrent mutations on per-guild playback and queue state.
 * Note: Never call acquire/runExclusive for the same key from inside an already held lock.
 */
class AsyncLock {
    constructor(defaultTimeoutMs = 15000) {
        this.queues = new Map();
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    async runExclusive(key, fn, timeoutMs = this.defaultTimeoutMs) {
        const k = String(key);
        const previous = this.queues.get(k) || Promise.resolve();

        let releaseCurrent;
        const current = new Promise(resolve => {
            releaseCurrent = resolve;
        });

        const tail = previous.then(() => current, () => current);
        this.queues.set(k, tail);

        // Wait for our turn with timeout protection against deadlocked upstream promises
        let timer = null;
        try {
            await Promise.race([
                previous,
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`AsyncLock acquire timeout after ${timeoutMs}ms for key "${k}"`));
                    }, timeoutMs);
                    if (timer.unref) timer.unref();
                })
            ]);
        } catch (err) {
            // Release our slot in the chain so subsequent callers don't stall
            releaseCurrent();
            if (this.queues.get(k) === tail) {
                this.queues.delete(k);
            }
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }

        try {
            return await fn();
        } finally {
            releaseCurrent();
            if (this.queues.get(k) === tail) {
                this.queues.delete(k);
            }
        }
    }

    isLocked(key) {
        return this.queues.has(String(key));
    }
}

module.exports = AsyncLock;
