/**
 * @fileoverview RateLimitManager - Enterprise rate limiting service
 * @module services/auth/RateLimitManager
 * @version 1.0.0
 * @author Enterprise Development Team
 * @description Sophisticated rate limiting system for authentication attempts
 */

import type { ICacheService } from "../../contracts/services";
import { RateLimitError } from "../../errors/core";

/**
 * Authentication method types for rate limiting
 */
type AuthenticationMethod = "password" | "apikey" | "session" | "jwt";

/**
 * Rate limiting configuration per method
 */
interface IRateLimitConfig {
  readonly maxAttempts: number;
  readonly windowMinutes: number;
  readonly blockDurationMinutes: number;
  readonly progressive: boolean; // Enable progressive penalties
}

/**
 * Rate limit attempt tracking
 */
interface IRateLimitAttempt {
  readonly timestamp: number;
  readonly success: boolean;
  readonly method: AuthenticationMethod;
  readonly identifier: string;
}

/**
 * Rate limit status
 */
interface IRateLimitStatus {
  readonly isAllowed: boolean;
  readonly remainingAttempts: number;
  readonly resetTime: number;
  readonly retryAfter?: number;
}

/**
 * Rate limit violation details
 */
interface IRateLimitViolation {
  readonly identifier: string;
  readonly method: AuthenticationMethod;
  readonly attemptCount: number;
  readonly windowStart: number;
  readonly blockUntil: number;
  readonly progressiveMultiplier: number;
}

/**
 * Default rate limiting configurations for different auth methods
 */
const DEFAULT_RATE_LIMITS: Record<AuthenticationMethod, IRateLimitConfig> = {
  password: {
    maxAttempts: 5,
    windowMinutes: 15,
    blockDurationMinutes: 30,
    progressive: true,
  },
  apikey: {
    maxAttempts: 10,
    windowMinutes: 5,
    blockDurationMinutes: 15,
    progressive: false,
  },
  session: {
    maxAttempts: 20,
    windowMinutes: 5,
    blockDurationMinutes: 5,
    progressive: false,
  },
  jwt: {
    maxAttempts: 30,
    windowMinutes: 5,
    blockDurationMinutes: 5,
    progressive: false,
  },
};

/**
 * Cache key prefixes for different rate limit types
 */
const CACHE_PREFIXES = {
  ATTEMPTS: "rate_limit:attempts:",
  VIOLATIONS: "rate_limit:violations:",
  BLOCKS: "rate_limit:blocks:",
  PROGRESSIVE: "rate_limit:progressive:",
} as const;

/**
 * Enterprise rate limiting manager
 *
 * Provides sophisticated rate limiting capabilities:
 * - Method-specific rate limits (password, API key, session, JWT)
 * - Progressive penalties for repeated violations
 * - Distributed rate limiting via cache service
 * - Detailed violation tracking and analytics
 * - Automatic cleanup of expired limits
 */
export class RateLimitManager {
  private readonly cacheService: ICacheService;
  private readonly rateLimits: Record<AuthenticationMethod, IRateLimitConfig>;

  constructor(
    cacheService: ICacheService,
    customRateLimits?: Partial<Record<AuthenticationMethod, IRateLimitConfig>>
  ) {
    this.cacheService = cacheService;
    this.rateLimits = {
      ...DEFAULT_RATE_LIMITS,
      ...customRateLimits,
    };
  }

  /**
   * Check if authentication attempt is allowed under rate limiting
   */
  async checkRateLimit(
    identifier: string,
    method: AuthenticationMethod
  ): Promise<IRateLimitStatus> {
    const config = this.rateLimits[method];
    const now = Date.now();

    // Check if currently blocked
    const blockKey = `${CACHE_PREFIXES.BLOCKS}${method}:${identifier}`;
    const blockUntil = await this.cacheService.get<number>(blockKey);

    if (blockUntil && now < blockUntil) {
      return {
        isAllowed: false,
        remainingAttempts: 0,
        resetTime: blockUntil,
        retryAfter: Math.ceil((blockUntil - now) / 1000),
      };
    }

    // Get recent attempts within the time window
    const attemptsKey = `${CACHE_PREFIXES.ATTEMPTS}${method}:${identifier}`;
    const attempts =
      (await this.cacheService.get<IRateLimitAttempt[]>(attemptsKey)) || [];

    // Filter attempts within the current window
    const windowStart = now - config.windowMinutes * 60 * 1000;
    const recentAttempts = attempts.filter(
      (attempt) => attempt.timestamp > windowStart
    );

    const remainingAttempts = Math.max(
      0,
      config.maxAttempts - recentAttempts.length
    );

    return {
      isAllowed: remainingAttempts > 0,
      remainingAttempts,
      resetTime: windowStart + config.windowMinutes * 60 * 1000,
    };
  }

  /**
   * Record an authentication attempt and enforce rate limiting
   */
  async enforceRateLimit(
    identifier: string,
    method: AuthenticationMethod,
    success: boolean = false
  ): Promise<void> {
    const status = await this.checkRateLimit(identifier, method);

    if (!status.isAllowed && !success) {
      const retryAfter = status.retryAfter || 0;
      throw new RateLimitError(
        retryAfter,
        this.rateLimits[method].maxAttempts,
        status.remainingAttempts,
        new Date(status.resetTime),
        {
          method,
          windowMinutes: this.rateLimits[method].windowMinutes,
          identifier: identifier.substring(0, 4) + "****", // Partially mask for security
        }
      );
    }

    // Record the attempt
    await this.recordAttempt(identifier, method, success);

    // If this was a failed attempt and we're at the limit, enforce blocking
    if (!success && status.remainingAttempts <= 1) {
      await this.enforceBlock(identifier, method);
    }
  }

  /**
   * Record an authentication attempt
   */
  private async recordAttempt(
    identifier: string,
    method: AuthenticationMethod,
    success: boolean
  ): Promise<void> {
    const config = this.rateLimits[method];
    const now = Date.now();
    const windowStart = now - config.windowMinutes * 60 * 1000;

    const attemptsKey = `${CACHE_PREFIXES.ATTEMPTS}${method}:${identifier}`;
    const attempts =
      (await this.cacheService.get<IRateLimitAttempt[]>(attemptsKey)) || [];

    // Add new attempt
    const newAttempt: IRateLimitAttempt = {
      timestamp: now,
      success,
      method,
      identifier,
    };

    // Keep only attempts within the window and add the new one
    const updatedAttempts = attempts
      .filter((attempt) => attempt.timestamp > windowStart)
      .concat(newAttempt)
      .slice(-config.maxAttempts); // Keep only the most recent attempts

    // Store attempts with TTL slightly longer than the window
    const ttlSeconds = (config.windowMinutes + 5) * 60;
    await this.cacheService.set(attemptsKey, updatedAttempts, ttlSeconds);
  }

  /**
   * Enforce rate limit block with progressive penalties
   */
  private async enforceBlock(
    identifier: string,
    method: AuthenticationMethod
  ): Promise<void> {
    const config = this.rateLimits[method];
    let blockDuration = config.blockDurationMinutes;

    // Apply progressive penalties if enabled
    if (config.progressive) {
      const progressiveMultiplier = await this.getProgressiveMultiplier(
        identifier,
        method
      );
      blockDuration = Math.min(blockDuration * progressiveMultiplier, 24 * 60); // Cap at 24 hours
      await this.incrementProgressiveMultiplier(identifier, method);
    }

    const blockUntil = Date.now() + blockDuration * 60 * 1000;
    const blockKey = `${CACHE_PREFIXES.BLOCKS}${method}:${identifier}`;

    // Store block with TTL
    await this.cacheService.set(blockKey, blockUntil, blockDuration * 60);

    // Record violation for analytics
    await this.recordViolation(identifier, method, blockDuration);
  }

  /**
   * Get progressive penalty multiplier for repeat offenders
   */
  private async getProgressiveMultiplier(
    identifier: string,
    method: AuthenticationMethod
  ): Promise<number> {
    const key = `${CACHE_PREFIXES.PROGRESSIVE}${method}:${identifier}`;
    const multiplier = (await this.cacheService.get<number>(key)) || 1;
    return Math.min(multiplier, 8); // Cap at 8x penalty
  }

  /**
   * Increment progressive penalty multiplier
   */
  private async incrementProgressiveMultiplier(
    identifier: string,
    method: AuthenticationMethod
  ): Promise<void> {
    const key = `${CACHE_PREFIXES.PROGRESSIVE}${method}:${identifier}`;
    const currentMultiplier = (await this.cacheService.get<number>(key)) || 1;
    const newMultiplier = Math.min(currentMultiplier * 2, 8);

    // Store with 24 hour TTL - progressive penalties reset daily
    await this.cacheService.set(key, newMultiplier, 24 * 60 * 60);
  }

  /**
   * Record rate limit violation for analytics
   */
  private async recordViolation(
    identifier: string,
    method: AuthenticationMethod,
    blockDuration: number
  ): Promise<void> {
    const violation: IRateLimitViolation = {
      identifier: identifier.substring(0, 8) + "****", // Partially mask for privacy
      method,
      attemptCount: this.rateLimits[method].maxAttempts,
      windowStart:
        Date.now() - this.rateLimits[method].windowMinutes * 60 * 1000,
      blockUntil: Date.now() + blockDuration * 60 * 1000,
      progressiveMultiplier: await this.getProgressiveMultiplier(
        identifier,
        method
      ),
    };

    const violationsKey = `${CACHE_PREFIXES.VIOLATIONS}${method}:daily:${
      new Date().toISOString().split("T")[0]
    }`;
    const violations =
      (await this.cacheService.get<IRateLimitViolation[]>(violationsKey)) || [];

    violations.push(violation);

    // Store violations with 7 day TTL for analytics
    await this.cacheService.set(violationsKey, violations, 7 * 24 * 60 * 60);
  }

  /**
   * Clear rate limits for a specific identifier (admin function)
   */
  async clearRateLimits(
    identifier: string,
    method?: AuthenticationMethod
  ): Promise<void> {
    const methods = method
      ? [method]
      : (Object.keys(this.rateLimits) as AuthenticationMethod[]);

    for (const authMethod of methods) {
      const keys = [
        `${CACHE_PREFIXES.ATTEMPTS}${authMethod}:${identifier}`,
        `${CACHE_PREFIXES.BLOCKS}${authMethod}:${identifier}`,
        `${CACHE_PREFIXES.PROGRESSIVE}${authMethod}:${identifier}`,
      ];

      for (const key of keys) {
        await this.cacheService.delete(key);
      }
    }
  }

  /**
   * Get rate limit statistics for monitoring
   */
  async getRateLimitStats(
    method: AuthenticationMethod,
    date?: string
  ): Promise<{
    totalViolations: number;
    uniqueIdentifiers: number;
    averageBlockDuration: number;
    progressivePenalties: number;
    violations: IRateLimitViolation[];
  }> {
    const dateStr = date || new Date().toISOString().split("T")[0];
    const violationsKey = `${CACHE_PREFIXES.VIOLATIONS}${method}:daily:${dateStr}`;
    const violations =
      (await this.cacheService.get<IRateLimitViolation[]>(violationsKey)) || [];

    const uniqueIdentifiers = new Set(violations.map((v) => v.identifier)).size;
    const totalDuration = violations.reduce(
      (sum, v) => sum + (v.blockUntil - v.windowStart),
      0
    );
    const averageBlockDuration =
      violations.length > 0
        ? totalDuration / violations.length / (60 * 1000)
        : 0;
    const progressivePenalties = violations.filter(
      (v) => v.progressiveMultiplier > 1
    ).length;

    return {
      totalViolations: violations.length,
      uniqueIdentifiers,
      averageBlockDuration: Math.round(averageBlockDuration),
      progressivePenalties,
      violations,
    };
  }

  /**
   * Check if identifier is currently blocked for any method
   */
  async isBlocked(identifier: string): Promise<{
    blocked: boolean;
    methods: AuthenticationMethod[];
    earliestUnblock: number | null;
  }> {
    const now = Date.now();
    const blockedMethods: AuthenticationMethod[] = [];
    let earliestUnblock: number | null = null;

    for (const method of Object.keys(
      this.rateLimits
    ) as AuthenticationMethod[]) {
      const blockKey = `${CACHE_PREFIXES.BLOCKS}${method}:${identifier}`;
      const blockUntil = await this.cacheService.get<number>(blockKey);

      if (blockUntil && now < blockUntil) {
        blockedMethods.push(method);
        if (!earliestUnblock || blockUntil < earliestUnblock) {
          earliestUnblock = blockUntil;
        }
      }
    }

    return {
      blocked: blockedMethods.length > 0,
      methods: blockedMethods,
      earliestUnblock,
    };
  }

  /**
   * Get current rate limit configuration
   */
  getRateLimitConfig(): Record<AuthenticationMethod, IRateLimitConfig> {
    return { ...this.rateLimits };
  }

  /**
   * Update rate limit configuration for a method
   */
  updateRateLimitConfig(
    method: AuthenticationMethod,
    config: Partial<IRateLimitConfig>
  ): void {
    this.rateLimits[method] = {
      ...this.rateLimits[method],
      ...config,
    };
  }
}
