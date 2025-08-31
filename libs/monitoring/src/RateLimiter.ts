import { RedisClient } from "@libs/database";

// Rate limiter
export class RateLimiter {
  constructor() {
    // No need to store redis instance
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const redisKey = `ratelimit:${key}:${window}`;

    try {
      const redis = RedisClient.getInstance();
      const current = await redis.incr(redisKey);

      if (current === 1) {
        await redis.expire(redisKey, Math.ceil(windowMs / 1000));
      }

      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);
      const resetTime = (window + 1) * windowMs;

      return { allowed, remaining, resetTime };
    } catch (error) {
      // If Redis fails, allow the request but log the error
      console.error("Rate limiting failed:", error);
      return { allowed: true, remaining: limit, resetTime: now + windowMs };
    }
  }
}
