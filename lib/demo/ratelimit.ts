export interface Limiter {
  check(key: string, now?: number): { ok: boolean; retryAfterSec: number };
}

/** Sliding-window limiter, in memory: `limit` hits per `windowMs` per key. */
export function createLimiter(limit: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

// Shared across route files and hot reloads.
const g = globalThis as unknown as { __tensraLimits?: { start: Limiter; action: Limiter } };
export const limits = (g.__tensraLimits ??= {
  start: createLimiter(10, 60_000), // demo runs per visitor per minute
  action: createLimiter(30, 60_000), // button actions per visitor per minute
});
