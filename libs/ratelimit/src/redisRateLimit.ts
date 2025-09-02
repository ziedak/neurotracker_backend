import { RedisClient } from "@libs/database";
import { ILogger } from "@libs/monitoring";
import { ConsecutiveBreaker } from "@libs/utils";
import * as crypto from "crypto";
import {
  CompleteRateLimitConfig,
  RateLimitConfigManager,
  Environment,
} from "./config/rateLimitConfig";

/**
 * Security-related error classes
 */
class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validated rate limit parameters
 */
interface ValidatedRateLimitParams {
  key: string;
  maxRequests: number;
  windowMs: number;
}

/**
 * Rate limit algorithms
 */
type RateLimitAlgorithm = "sliding-window" | "token-bucket" | "fixed-window";

/**
 * Redis configuration options
 */
interface RedisConfig {
  keyPrefix?: string;
  ttlBuffer?: number;
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  enabled?: boolean;
  failureThreshold?: number;
  recoveryTimeout?: number;
  monitoringPeriod?: number;
  name?: string;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  algorithm?: RateLimitAlgorithm;
  redis?: RedisConfig;
  circuitBreaker?: CircuitBreakerConfig;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number | undefined;
  algorithm: string;
  windowStart?: Date | undefined;
  windowEnd?: Date | undefined;
}

/**
 * SECURITY-HARDENED Redis Rate Limiter with EVALSHA
 *
 * This implementation addresses the security vulnerabilities of redis.eval()
 * by using pre-loaded scripts with EVALSHA and comprehensive input validation.
 *
 * Security measures:
 * - Uses EVALSHA instead of EVAL to prevent Lua injection
 * - Pre-validates and loads all scripts on initialization
 * - Comprehensive input sanitization and validation
 * - Cryptographically secure request IDs
 * - Strict type checking and error handling
 */
export class OptimizedRedisRateLimit {
  protected readonly keyPrefix: string;
  protected readonly ttlBuffer: number;
  protected readonly algorithm: RateLimitAlgorithm;
  protected readonly circuitBreaker?: any; // CircuitBreakerPolicy from cockatiel

  // Security: Script management for EVALSHA
  private readonly scriptShas = new Map<string, string>();
  private scriptsInitialized = false;

  // Pre-validated Lua scripts as immutable constants
  private readonly SCRIPTS = {
    SLIDING_WINDOW: `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])
      local request_id = ARGV[5]
      
      -- Remove expired entries
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
      
      -- Count current requests in window
      local current_requests = redis.call('ZCARD', key)
      
      local allowed = 0
      if current_requests < max_requests then
        -- Add this request
        redis.call('ZADD', key, now, request_id)
        allowed = 1
      end
      
      -- Set expiration
      redis.call('EXPIRE', key, expiry)
      
      -- Get final count
      local total_requests = redis.call('ZCARD', key)
      local remaining = math.max(0, max_requests - total_requests)
      
      -- Calculate reset time from oldest entry
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local reset_time = now + tonumber(ARGV[6])
      if #oldest >= 2 then
        reset_time = tonumber(oldest[2]) + tonumber(ARGV[6])
      end
      
      return {allowed, remaining, reset_time, total_requests}
    `,

    TOKEN_BUCKET: `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local refill_rate = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])
      
      -- Get current bucket state
      local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
      local tokens = tonumber(bucket[1]) or capacity
      local last_refill = tonumber(bucket[2]) or now
      
      -- Calculate tokens to add based on time elapsed
      local time_passed = (now - last_refill) / 1000
      local tokens_to_add = time_passed * refill_rate
      tokens = math.min(capacity, tokens + tokens_to_add)
      
      local allowed = 0
      if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
      end
      
      -- Update bucket state
      redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(now))
      redis.call('EXPIRE', key, expiry)
      
      local reset_time = now + ((capacity - tokens) / refill_rate) * 1000
      local remaining = math.floor(tokens)
      
      return {allowed, remaining, reset_time, capacity - remaining}
    `,

    FIXED_WINDOW: `
      local key = KEYS[1]
      local max_requests = tonumber(ARGV[1])
      local expiry = tonumber(ARGV[2])
      local reset_time = tonumber(ARGV[3])
      
      local current = redis.call('GET', key)
      local count = tonumber(current) or 0
      
      local allowed = 0
      if count < max_requests then
        count = redis.call('INCR', key)
        allowed = 1
        if count == 1 then
          redis.call('EXPIRE', key, expiry)
        end
      else
        count = tonumber(redis.call('GET', key)) or 0
      end
      
      local remaining = math.max(0, max_requests - count)
      
      return {allowed, remaining, reset_time, count}
    `,
  } as const;

  constructor(
    config: RateLimitConfig,
    protected redisClient: RedisClient,
    protected readonly logger: ILogger
  ) {
    this.logger = logger.child({ component: "OptimizedRedisRateLimit" });
    this.keyPrefix = config.redis?.keyPrefix || "rate_limit";
    this.ttlBuffer = config.redis?.ttlBuffer || 10;
    this.algorithm = config.algorithm || "sliding-window";

    // Initialize circuit breaker if enabled
    if (config.circuitBreaker?.enabled) {
      this.circuitBreaker = new ConsecutiveBreaker(
        config.circuitBreaker.failureThreshold || 5
      );

      this.logger.info("Circuit breaker enabled", {
        failureThreshold: config.circuitBreaker.failureThreshold,
        recoveryTimeout: config.circuitBreaker.recoveryTimeout,
        name: config.circuitBreaker.name || "rate-limiter",
      });
    }

    // Initialize scripts on construction
    this.initializeScripts().catch((error) => {
      this.logger.error("Failed to initialize Lua scripts", error);
    });
  }

  /**
   * Enhanced factory method for production environments
   * Uses comprehensive configuration management
   */
  static createFromEnvironment(
    environment: Environment | string,
    redisClient: RedisClient,
    logger: ILogger,
    customConfig?: Partial<CompleteRateLimitConfig>
  ): OptimizedRedisRateLimit {
    // Validate environment
    if (!RateLimitConfigManager.isValidEnvironment(environment)) {
      throw new Error(
        `Invalid environment: ${environment}. Must be one of: ${RateLimitConfigManager.getAvailableEnvironments().join(
          ", "
        )}`
      );
    }

    const completeConfig = customConfig
      ? RateLimitConfigManager.createCustomConfig({
          environment: environment as Environment,
          ...customConfig,
        })
      : RateLimitConfigManager.getConfig(environment as Environment);

    // Convert to legacy format for backward compatibility
    const legacyConfig: RateLimitConfig = {};

    // Add algorithm if present
    if (completeConfig.algorithm !== undefined) {
      legacyConfig.algorithm = completeConfig.algorithm;
    }

    // Add redis config if present
    if (completeConfig.redis) {
      legacyConfig.redis = {};
      if (completeConfig.redis.keyPrefix !== undefined) {
        legacyConfig.redis.keyPrefix = completeConfig.redis.keyPrefix;
      }
      if (completeConfig.redis.ttlBuffer !== undefined) {
        legacyConfig.redis.ttlBuffer = completeConfig.redis.ttlBuffer;
      }
    }

    // Add circuit breaker config if present
    if (completeConfig.circuitBreaker) {
      legacyConfig.circuitBreaker = {};
      if (completeConfig.circuitBreaker.enabled !== undefined) {
        legacyConfig.circuitBreaker.enabled =
          completeConfig.circuitBreaker.enabled;
      }
      if (completeConfig.circuitBreaker.failureThreshold !== undefined) {
        legacyConfig.circuitBreaker.failureThreshold =
          completeConfig.circuitBreaker.failureThreshold;
      }
      if (completeConfig.circuitBreaker.recoveryTimeout !== undefined) {
        legacyConfig.circuitBreaker.recoveryTimeout =
          completeConfig.circuitBreaker.recoveryTimeout;
      }
      if (completeConfig.circuitBreaker.monitoringPeriod !== undefined) {
        legacyConfig.circuitBreaker.monitoringPeriod =
          completeConfig.circuitBreaker.monitoringPeriod;
      }
      if (completeConfig.circuitBreaker.name !== undefined) {
        legacyConfig.circuitBreaker.name = completeConfig.circuitBreaker.name;
      }
    }

    const instance = new OptimizedRedisRateLimit(
      legacyConfig,
      redisClient,
      logger
    );

    // Store complete config for advanced features
    (instance as any)._completeConfig = completeConfig;

    return instance;
  }

  /**
   * Get complete configuration if available
   */
  getCompleteConfig(): CompleteRateLimitConfig | undefined {
    return (this as any)._completeConfig;
  }

  /**
   * Initialize and cache Lua scripts using EVALSHA for security
   */
  private async initializeScripts(): Promise<void> {
    if (this.scriptsInitialized || !this.redisClient) {
      return;
    }

    try {
      const redis = this.redisClient.getRedis();

      for (const [name, script] of Object.entries(this.SCRIPTS)) {
        const sha = (await redis.script("LOAD", script)) as string;
        this.scriptShas.set(name, sha);
      }

      this.scriptsInitialized = true;
      this.logger.debug("Lua scripts initialized successfully", {
        scripts: Object.keys(this.SCRIPTS).length,
      });
    } catch (error) {
      this.logger.error("Failed to initialize Lua scripts", error);
      throw new SecurityError("Script initialization failed");
    }
  }

  /**
   * Execute Lua script securely using EVALSHA with circuit breaker protection
   */
  private async executeScript(
    scriptName: keyof typeof this.SCRIPTS,
    keys: string[],
    args: string[]
  ): Promise<number[]> {
    if (!this.scriptsInitialized) {
      await this.initializeScripts();
    }

    const sha = this.scriptShas.get(scriptName);
    if (!sha) {
      throw new SecurityError(`Script ${scriptName} not loaded`);
    }

    // Wrap Redis operation with circuit breaker if enabled
    const redisOperation = async () => {
      const redis = this.redisClient.getRedis();
      const result = (await redis.evalsha(
        sha,
        keys.length,
        ...keys,
        ...args
      )) as number[];

      if (!Array.isArray(result) || result.length !== 4) {
        throw new SecurityError("Invalid script response");
      }

      return result;
    };

    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.execute(redisOperation);
      } else {
        return await redisOperation();
      }
    } catch (error: any) {
      if (error.message?.includes("NOSCRIPT")) {
        // Script not cached in Redis, reinitialize
        this.scriptsInitialized = false;
        await this.initializeScripts();
        const newSha = this.scriptShas.get(scriptName);
        if (!newSha) {
          throw new SecurityError(`Script ${scriptName} reload failed`);
        }

        const redisOperationRetry = async () => {
          const redis = this.redisClient.getRedis();
          return (await redis.evalsha(
            newSha,
            keys.length,
            ...keys,
            ...args
          )) as number[];
        };

        if (this.circuitBreaker) {
          return await this.circuitBreaker.execute(redisOperationRetry);
        } else {
          return await redisOperationRetry();
        }
      }

      this.logger.error(`Script execution failed: ${scriptName}`, error);
      throw new SecurityError("Script execution failed");
    }
  }

  /**
   * Validate and sanitize input parameters
   */
  private validateParams(
    key: string,
    maxRequests: number,
    windowMs: number
  ): ValidatedRateLimitParams {
    // Sanitize key
    if (!key || typeof key !== "string") {
      throw new ValidationError("Key must be a non-empty string");
    }

    // Only allow alphanumeric, hyphens, underscores, colons, and dots
    if (!/^[a-zA-Z0-9_:\-.]+$/.test(key)) {
      throw new ValidationError("Key contains invalid characters");
    }

    if (key.length > 250) {
      throw new ValidationError("Key too long (max 250 characters)");
    }

    // Validate numeric parameters
    const validMaxRequests = Number(maxRequests);
    if (!Number.isInteger(validMaxRequests) || validMaxRequests <= 0) {
      throw new ValidationError("maxRequests must be a positive integer");
    }

    if (validMaxRequests > 10000) {
      throw new ValidationError("maxRequests too high (DoS risk)");
    }

    const validWindowMs = Number(windowMs);
    if (!Number.isInteger(validWindowMs) || validWindowMs <= 0) {
      throw new ValidationError("windowMs must be a positive integer");
    }

    if (validWindowMs > 86400000) {
      // 24 hours
      throw new ValidationError("windowMs too large (max 24 hours)");
    }

    return {
      key: key.trim(),
      maxRequests: validMaxRequests,
      windowMs: validWindowMs,
    };
  }

  /**
   * Generate cryptographically secure request ID
   */
  private generateSecureRequestId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Check rate limit for a key
   */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const requestId = this.generateSecureRequestId();

    try {
      // Validate and sanitize inputs
      const validatedParams = this.validateParams(key, maxRequests, windowMs);
      const redisKey = `${this.keyPrefix}:${validatedParams.key}`;

      const startTime = Date.now();
      const result = await this.executeRateLimitCheck(
        redisKey,
        validatedParams.maxRequests,
        validatedParams.windowMs,
        requestId
      );
      const executionTime = Date.now() - startTime;

      this.logger.debug("Rate limit check completed", {
        key: validatedParams.key,
        algorithm: this.algorithm,
        requestId,
        executionTime,
        result,
      });

      return result;
    } catch (error) {
      this.logger.error("Rate limit check failed", {
        key,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute rate limit check using the configured algorithm
   */
  private async executeRateLimitCheck(
    key: string,
    maxRequests: number,
    windowMs: number,
    requestId: string
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const expiry = Math.ceil((now + windowMs + this.ttlBuffer * 1000) / 1000);

    try {
      const scriptName = this.getScriptForAlgorithm();
      let args: string[];

      if (this.algorithm === "sliding-window") {
        args = [
          String(now),
          String(windowStart),
          String(maxRequests),
          String(expiry),
          requestId,
          String(windowMs),
        ];
      } else if (this.algorithm === "token-bucket") {
        const refillRate = maxRequests / (windowMs / 1000);
        args = [
          String(now),
          String(maxRequests),
          String(refillRate),
          String(expiry),
        ];
      } else {
        // fixed-window
        const window = Math.floor(now / windowMs);
        const windowEnd = (window + 1) * windowMs;
        const windowExpiry = Math.ceil(
          (windowEnd + this.ttlBuffer * 1000) / 1000
        );
        args = [String(maxRequests), String(windowExpiry), String(windowEnd)];
        // Update key for fixed window
        key = `${key}:${window}`;
      }

      const result = await this.executeScript(scriptName, [key], args);
      const [allowed, remaining, resetTime, totalRequests] = result;

      // Validate script response
      if (
        typeof allowed !== "number" ||
        typeof remaining !== "number" ||
        typeof resetTime !== "number" ||
        typeof totalRequests !== "number"
      ) {
        throw new SecurityError("Invalid script response format");
      }

      const resetDate = new Date(resetTime);

      return {
        allowed: allowed === 1,
        totalHits: totalRequests,
        remaining: Math.max(0, remaining),
        resetTime: resetDate,
        retryAfter:
          allowed === 0 ? Math.ceil((resetTime - now) / 1000) : undefined,
        algorithm: this.algorithm,
        windowStart: new Date(windowStart),
        windowEnd: new Date(now + windowMs),
      };
    } catch (error) {
      this.logger.error("Rate limit execution failed", {
        key,
        algorithm: this.algorithm,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get script name for current algorithm
   */
  private getScriptForAlgorithm(): keyof typeof this.SCRIPTS {
    switch (this.algorithm) {
      case "sliding-window":
        return "SLIDING_WINDOW";
      case "token-bucket":
        return "TOKEN_BUCKET";
      case "fixed-window":
        return "FIXED_WINDOW";
      default:
        return "SLIDING_WINDOW";
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): { enabled: boolean; state?: string } {
    if (!this.circuitBreaker) {
      return { enabled: false };
    }

    return {
      enabled: true,
      state: String(this.circuitBreaker.state),
    };
  }

  /**
   * Get health status including circuit breaker
   */
  async getHealth(): Promise<any> {
    const circuitBreakerStatus = this.getCircuitBreakerStatus();

    return {
      redis: {
        available: !!this.redisClient,
        scriptsInitialized: this.scriptsInitialized,
      },
      circuitBreaker: circuitBreakerStatus,
      algorithm: this.algorithm,
      config: {
        keyPrefix: this.keyPrefix,
        ttlBuffer: this.ttlBuffer,
      },
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    const validatedParams = this.validateParams(key, 1, 1000); // Minimal validation for key only
    const redisKey = `${this.keyPrefix}:${validatedParams.key}`;

    try {
      const redis = this.redisClient.getRedis();

      if (this.algorithm === "fixed-window") {
        // For fixed window, clean multiple potential keys
        const now = Date.now();
        const windowMs = 60000; // Default window, should be configurable
        const currentWindow = Math.floor(now / windowMs);

        const keysToDelete = [];
        for (let i = -2; i <= 2; i++) {
          keysToDelete.push(`${redisKey}:${currentWindow + i}`);
        }

        await redis.del(...keysToDelete);
      } else {
        await redis.del(redisKey);
      }

      this.logger.debug("Rate limit reset", { key: validatedParams.key });
    } catch (error) {
      this.logger.error("Rate limit reset failed", {
        key: validatedParams.key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
