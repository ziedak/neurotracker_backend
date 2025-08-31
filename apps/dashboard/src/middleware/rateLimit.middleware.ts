import { Logger } from "@libs/monitoring";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (request: any) => string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
  windowStart: Date;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
  windowStart: number;
}

/**
 * Rate Limit Middleware for Dashboard
 * Provides configurable rate limiting with in-memory storage
 */
export class RateLimitMiddleware {
  private readonly logger: ILogger;
  private readonly store: Map<string, RateLimitRecord> = new Map();
  private readonly defaultConfig: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  };

  constructor(logger: ILogger) {
    this.logger = logger;

    // Clean up expired entries every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }

  /**
   * Apply rate limiting to a request
   */
  async rateLimit(
    request: any,
    config?: Partial<RateLimitConfig>
  ): Promise<any> {
    try {
      const finalConfig = { ...this.defaultConfig, ...config };
      const key = this.generateKey(request, finalConfig);

      this.logger.debug("Checking rate limit", { key, config: finalConfig });

      const rateLimitInfo = this.checkRateLimit(key, finalConfig);

      if (rateLimitInfo.remaining < 0) {
        this.logger.warn("Rate limit exceeded", {
          key,
          limit: rateLimitInfo.limit,
          resetTime: rateLimitInfo.resetTime,
        });

        throw new RateLimitError("Rate limit exceeded", rateLimitInfo);
      }

      // Add rate limit info to request
      request.rateLimit = rateLimitInfo;

      this.logger.debug("Rate limit check passed", {
        key,
        remaining: rateLimitInfo.remaining,
      });

      return request;
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }

      this.logger.error("Rate limit middleware error", error as Error);
      // In case of error, allow request to proceed
      return request;
    }
  }

  /**
   * Check rate limit for a key
   */
  private checkRateLimit(key: string, config: RateLimitConfig): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let record = this.store.get(key);

    // Create new record or reset if window expired
    if (!record || record.windowStart < windowStart) {
      record = {
        count: 1,
        resetTime: now + config.windowMs,
        windowStart: now,
      };
      this.store.set(key, record);
    } else {
      // Increment count for existing record
      record.count++;
      this.store.set(key, record);
    }

    return {
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - record.count),
      resetTime: new Date(record.resetTime),
      windowStart: new Date(record.windowStart),
    };
  }

  /**
   * Generate rate limit key from request
   */
  private generateKey(request: any, config: RateLimitConfig): string {
    if (config.keyGenerator) {
      return config.keyGenerator(request);
    }

    // Default key generation
    const ip = this.extractIP(request);
    const userAgent = request.headers?.["user-agent"] || "unknown";

    // Create a simple hash of IP + user agent for basic fingerprinting
    return `${ip}:${this.simpleHash(userAgent)}`;
  }

  /**
   * Extract IP address from request
   */
  private extractIP(request: any): string {
    // Try various headers for IP extraction
    const forwardedFor = request.headers?.["x-forwarded-for"];
    if (forwardedFor) {
      return forwardedFor.split(",")[0].trim();
    }

    const realIP = request.headers?.["x-real-ip"];
    if (realIP) {
      return realIP;
    }

    // Fallback to connection remote address or default
    return request.ip || request.connection?.remoteAddress || "127.0.0.1";
  }

  /**
   * Simple hash function for key generation
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clean up expired rate limit records
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, record] of this.store.entries()) {
      if (record.resetTime < now) {
        this.store.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug("Cleaned up expired rate limit records", {
        cleanedCount,
        remainingRecords: this.store.size,
      });
    }
  }

  /**
   * Get current rate limit status for a key
   */
  async getRateLimitStatus(
    request: any,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitInfo> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const key = this.generateKey(request, finalConfig);

    const record = this.store.get(key);

    if (!record) {
      return {
        limit: finalConfig.maxRequests,
        remaining: finalConfig.maxRequests,
        resetTime: new Date(Date.now() + finalConfig.windowMs),
        windowStart: new Date(),
      };
    }

    return {
      limit: finalConfig.maxRequests,
      remaining: Math.max(0, finalConfig.maxRequests - record.count),
      resetTime: new Date(record.resetTime),
      windowStart: new Date(record.windowStart),
    };
  }

  /**
   * Reset rate limit for a key
   */
  async resetRateLimit(
    request: any,
    config?: Partial<RateLimitConfig>
  ): Promise<void> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const key = this.generateKey(request, finalConfig);

    this.store.delete(key);
    this.logger.info("Rate limit reset", { key });
  }

  /**
   * Get rate limit statistics
   */
  async getStatistics(): Promise<{
    totalKeys: number;
    averageUsage: number;
    topConsumers: Array<{ key: string; count: number; resetTime: Date }>;
  }> {
    const keys = Array.from(this.store.entries());
    const totalKeys = keys.length;

    if (totalKeys === 0) {
      return {
        totalKeys: 0,
        averageUsage: 0,
        topConsumers: [],
      };
    }

    const totalCount = keys.reduce((sum, [, record]) => sum + record.count, 0);
    const averageUsage = totalCount / totalKeys;

    const topConsumers = keys
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([key, record]) => ({
        key: this.maskKey(key),
        count: record.count,
        resetTime: new Date(record.resetTime),
      }));

    return {
      totalKeys,
      averageUsage,
      topConsumers,
    };
  }

  /**
   * Mask sensitive parts of the key for logging
   */
  private maskKey(key: string): string {
    const parts = key.split(":");
    if (parts.length >= 1) {
      // Mask IP address
      const ip = parts[0];
      const ipParts = ip.split(".");
      if (ipParts.length === 4) {
        parts[0] = `${ipParts[0]}.${ipParts[1]}.xxx.xxx`;
      }
    }
    return parts.join(":");
  }

  /**
   * Create preset configurations
   */
  static createStrictConfig(): RateLimitConfig {
    return {
      maxRequests: 10,
      windowMs: 1 * 60 * 1000, // 1 minute
    };
  }

  static createAPIConfig(): RateLimitConfig {
    return {
      maxRequests: 1000,
      windowMs: 60 * 60 * 1000, // 1 hour
    };
  }

  static createLoginConfig(): RateLimitConfig {
    return {
      maxRequests: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      keyGenerator: (request) => {
        // Rate limit by IP + username for login attempts
        const ip = request.ip || "unknown";
        const username =
          request.body?.username || request.body?.email || "anonymous";
        return `login:${ip}:${username}`;
      },
    };
  }
}

/**
 * Custom RateLimitError class
 */
export class RateLimitError extends Error {
  public readonly rateLimitInfo: RateLimitInfo;

  constructor(message: string, rateLimitInfo: RateLimitInfo) {
    super(message);
    this.name = "RateLimitError";
    this.rateLimitInfo = rateLimitInfo;
  }
}
