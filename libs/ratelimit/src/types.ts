/**
 * Core types for rate limiting system
 */

/**
 * Rate limit result interface
 */
export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  remaining: number;
  resetTime: Date;
  retryAfter: number | undefined;
  algorithm: string;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Rate limit configuration interface
 */
export interface RateLimitConfig {
  algorithm:
    | "sliding-window"
    | "fixed-window"
    | "token-bucket"
    | "leaky-bucket";
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
  ttlBuffer?: number;
  keyStrategy?: "ip" | "user" | "apiKey" | "custom";
  customKeyGenerator?: (context: any) => string;
  standardHeaders?: boolean;
  message?: string;
  skipOnError?: boolean;
  skipSuccessfulRequests?: boolean;
  onLimitReached?: (result: RateLimitResult) => void;
}
