const buckets = new Map();

/**
 * Simple in-memory rate limiter.
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} windowMs
 * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
 */
export function checkRateLimit(key, maxRequests = 10, windowMs = 60_000) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
    }
    return { allowed: true, remaining: maxRequests - 1, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, retryAfterSec: 0 };
}

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
