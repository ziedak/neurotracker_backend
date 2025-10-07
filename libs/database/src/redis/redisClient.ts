import Redis, {
  RedisOptions,
  type Callback,
  type ChainableCommander,
  type RedisKey,
} from "ioredis";
import { type IMetricsCollector } from "@libs/monitoring";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
import { createLogger, executeRedisWithRetry } from "@libs/utils";

export interface RedisConfig extends Partial<RedisOptions> {
  // Additional Redis-specific configuration
}

export class RedisClient {
  private readonly redis: Redis;
  private isConnected = false;
  private connectionLock = false; // Prevent concurrent connection operations
  private eventHandlersAttached = false;
  private retryCount = 0;
  private readonly maxRetries = 3;
  private readonly reconnectDelay = 1000;
  private reconnectTimeout?: NodeJS.Timeout;
  private readonly logger = createLogger("RedisClient");

  constructor(
    private readonly metrics?: IMetricsCollector,
    redisOptions: RedisConfig = {}
  ) {
    let options: RedisOptions = {
      host: getEnv("REDIS_HOST", "localhost"),
      port: getNumberEnv("REDIS_PORT", 6379),
      password: getEnv("REDIS_PASSWORD"),
      db: getNumberEnv("REDIS_DB", 0),
      username: getEnv("REDIS_USERNAME"),
      maxRetriesPerRequest: getNumberEnv("REDIS_MAX_RETRIES", 3),
      connectTimeout: getNumberEnv("REDIS_CONNECT_TIMEOUT", 10000),
      commandTimeout: getNumberEnv("REDIS_COMMAND_TIMEOUT", 5000),
      lazyConnect: false,
      keepAlive: getNumberEnv("REDIS_KEEP_ALIVE", 30000),
      enableReadyCheck: true,
      enableOfflineQueue: false,
      family: 4,
    };
    if (getBooleanEnv("REDIS_TLS")) {
      options.tls = {
        rejectUnauthorized: getBooleanEnv(
          "REDIS_TLS_REJECT_UNAUTHORIZED",
          true
        ),
      };
    }

    options = { ...options, ...redisOptions };
    this.redis = new Redis(options);
    this.setupEventHandlers();
    this.redis.connect().catch((err) => {
      this.logger.error("Redis initial connect failed", err);
    });
  }

  static create(
    config: RedisConfig = {},
    metrics?: IMetricsCollector
  ): RedisClient {
    return new RedisClient(metrics, config);
  }

  private setupEventHandlers(): void {
    if (this.eventHandlersAttached) {
      return; // Prevent duplicate event handler attachment
    }

    this.redis.on("connect", async () => {
      this.logger.info("Redis connected");
      this.isConnected = true;
      this.retryCount = 0;
      await this.metrics?.recordCounter?.("redis_connection_success");
    });

    this.redis.on("ready", async () => {
      this.logger.info("Redis ready to accept commands");
      await this.metrics?.recordCounter?.("redis_ready");
    });

    this.redis.on("error", async (error) => {
      this.logger.error("Redis error", error);
      this.isConnected = false;
      await this.metrics?.recordCounter?.("redis_connection_error");
    });

    this.redis.on("close", async () => {
      this.logger.info("Redis connection closed");
      this.isConnected = false;
      await this.metrics?.recordCounter?.("redis_connection_closed");
      this.scheduleReconnect();
    });

    this.redis.on("reconnecting", async () => {
      this.logger.info("Redis reconnecting...");
      await this.metrics?.recordCounter?.("redis_reconnecting");
    });

    this.redis.on("end", async () => {
      this.logger.warn("Redis connection ended");
      this.isConnected = false;
      await this.metrics?.recordCounter?.("redis_connection_ended");
    });

    this.eventHandlersAttached = true;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      delete this.reconnectTimeout;
    }

    if (this.retryCount >= this.maxRetries) {
      this.logger.error(
        `Max reconnection attempts (${this.maxRetries}) reached`
      );
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.retryCount),
      30000
    ); // Cap at 30 seconds
    this.retryCount++;
    this.logger.info(
      `Scheduling Redis reconnection in ${delay}ms (attempt ${this.retryCount})`
    );

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error("Scheduled reconnection failed", error);
      } finally {
        delete this.reconnectTimeout;
      }
    }, delay);
  }

  async connect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug("Connection operation already in progress, waiting...");
      return;
    }

    if (
      this.isConnected ||
      (this.redis && this.redis.status === "connecting")
    ) {
      return;
    }

    this.connectionLock = true;
    try {
      await this.redis.connect();
    } catch (error) {
      this.logger.error("Redis connect() failed", error);
      throw error;
    } finally {
      this.connectionLock = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug("Connection operation already in progress");
      return;
    }

    this.connectionLock = true;
    try {
      // Clear any pending reconnection
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        delete this.reconnectTimeout;
      }

      if (this.redis) {
        await this.redis.quit();
        this.isConnected = false;
        this.logger.info("Redis disconnected");
      }
    } catch (error) {
      this.logger.error("Redis disconnect() failed", error);
    } finally {
      this.connectionLock = false;
    }
  }

  async exists(...args: RedisKey[]): Promise<number> {
    if (!args.length) {
      this.logger.warn("No keys provided to exists");
      return 0;
    }

    // Validate key count to prevent abuse
    if (args.length > 100) {
      this.logger.warn("Too many keys provided to exists", {
        keyCount: args.length,
      });
      return 0;
    }

    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.exists(...args)),
        (error) => this.logger.warn("Exists operation failed", error),
        {
          operationName: "redis_exists",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn("Exists operation failed", error);
      return 0;
    }
  }
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      this.logger.error("Redis ping failed", error);
      return false;
    }
  }

  async safeSetEx(key: string, ttl: number, value: string): Promise<boolean> {
    if (!key || typeof key !== "string") {
      this.logger.warn("Invalid key provided to safeSetEx", { key });
      return false;
    }

    if (typeof value !== "string") {
      this.logger.warn("Invalid value provided to safeSetEx", {
        valueType: typeof value,
      });
      return false;
    }

    if (!Number.isInteger(ttl) || ttl < 0 || ttl > 365 * 24 * 60 * 60) {
      this.logger.warn("Invalid TTL provided to safeSetEx", { ttl });
      return false;
    }

    // Basic validation
    if (key.length > 512) {
      this.logger.warn("Key too long for safeSetEx", { keyLength: key.length });
      return false;
    }

    if (value.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn("Value too large for safeSetEx", {
        valueLength: value.length,
      });
      return false;
    }

    try {
      await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => redis.setex(key, ttl, value),
        (error) => this.logger.warn(`Safe setex failed for key ${key}`, error),
        {
          operationName: "redis_setex",
          maxRetries: 3,
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
      return true;
    } catch (error) {
      this.logger.warn(`Safe setex failed for key ${key}`, error);
      return false;
    }
  }

  async safeKeys(pattern: string): Promise<string[]> {
    if (!pattern || typeof pattern !== "string") {
      this.logger.warn("Invalid pattern provided to safeKeys", { pattern });
      return [];
    }

    // Prevent dangerous patterns that could scan all keys
    if (pattern === "*" || pattern === "*:*" || pattern.length < 2) {
      this.logger.warn("Dangerous pattern provided to safeKeys, blocking", {
        pattern,
      });
      return [];
    }

    // Limit pattern length
    if (pattern.length > 256) {
      this.logger.warn("Pattern too long for safeKeys", {
        patternLength: pattern.length,
      });
      return [];
    }

    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.keys(pattern)),
        (error) =>
          this.logger.warn(`Safe keys failed for pattern ${pattern}`, error),
        {
          operationName: "redis_keys",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe keys failed for pattern ${pattern}`, error);
      return [];
    }
  }

  async safeDel(...args: RedisKey[]): Promise<number> {
    if (!args.length) {
      this.logger.warn("No keys provided to safeDel");
      return 0;
    }

    // Validate key count to prevent abuse
    if (args.length > 1000) {
      this.logger.warn("Too many keys provided to safeDel", {
        keyCount: args.length,
      });
      return 0;
    }

    // Validate each key
    for (const key of args) {
      if (!key || typeof key !== "string" || key.length > 512) {
        this.logger.warn("Invalid key provided to safeDel", { key });
        return 0;
      }
    }

    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.del(...args)),
        (error) =>
          this.logger.warn(
            `Safe del failed for keys ${args.join(", ")}`,
            error
          ),
        {
          operationName: "redis_del",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe del failed for keys ${args.join(", ")}`, error);
      return 0;
    }
  }

  getRedis(): Redis {
    return this.redis;
  }

  async safeMget(...args: RedisKey[]): Promise<(string | null)[]> {
    if (!args.length) {
      this.logger.warn("No keys provided to safeMget");
      return [];
    }

    // Validate key count to prevent abuse
    if (args.length > 1000) {
      this.logger.warn("Too many keys provided to safeMget", {
        keyCount: args.length,
      });
      return new Array(args.length).fill(null);
    }

    // Validate each key
    for (const key of args) {
      if (!key || typeof key !== "string" || key.length > 512) {
        this.logger.warn("Invalid key provided to safeMget", { key });
        return new Array(args.length).fill(null);
      }
    }

    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.mget(...args)),
        (error) =>
          this.logger.warn(
            `Safe mget failed for keys ${args.join(", ")}`,
            error
          ),
        {
          operationName: "redis_mget",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe mget failed for keys ${args.join(", ")}`, error);
      return new Array(args.length).fill(null);
    }
  }

  /**
   * Safe get operation with fallback and input validation
   */
  async safeGet(
    key: string,
    defaultValue: string | null = null
  ): Promise<string | null> {
    if (!key || typeof key !== "string") {
      this.logger.warn("Invalid key provided to safeGet", { key });
      return defaultValue;
    }

    // Basic key validation - prevent extremely long keys
    if (key.length > 512) {
      this.logger.warn("Key too long for safeGet", { keyLength: key.length });
      return defaultValue;
    }

    try {
      const result = await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => redis.get(key),
        (error) => this.logger.warn(`Safe get failed for key ${key}`, error),
        {
          operationName: "redis_get",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
      return result ?? defaultValue;
    } catch (error) {
      this.logger.warn(`Safe get failed for key ${key}`, error);
      return defaultValue;
    }
  }

  /**
   * Safe set operation with fallback and input validation
   */
  async safeSet(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<boolean> {
    if (!key || typeof key !== "string") {
      this.logger.warn("Invalid key provided to safeSet", { key });
      return false;
    }

    if (typeof value !== "string") {
      this.logger.warn("Invalid value provided to safeSet", {
        valueType: typeof value,
      });
      return false;
    }

    // Basic validation
    if (key.length > 512) {
      this.logger.warn("Key too long for safeSet", { keyLength: key.length });
      return false;
    }

    if (value.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn("Value too large for safeSet", {
        valueLength: value.length,
      });
      return false;
    }

    if (
      ttlSeconds !== undefined &&
      (ttlSeconds < 0 || ttlSeconds > 365 * 24 * 60 * 60)
    ) {
      // Max 1 year
      this.logger.warn("Invalid TTL provided to safeSet", { ttlSeconds });
      return false;
    }

    try {
      await executeRedisWithRetry(
        this.redis,
        async (redis: Redis) => {
          if (ttlSeconds) {
            return redis.set(key, value, "EX", ttlSeconds);
          } else {
            return redis.set(key, value);
          }
        },
        (error) => this.logger.warn(`Safe set failed for key ${key}`, error),
        {
          operationName: "redis_set",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
      return true;
    } catch (error) {
      this.logger.warn(`Safe set failed for key ${key}`, error);
      return false;
    }
  }

  async safeZadd(
    key: RedisKey,
    ...scoreMembers: (string | number | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.zadd(key, ...scoreMembers)),
        (error) => this.logger.warn(`Safe ZADD failed for key ${key}`, error),
        {
          operationName: "redis_zadd",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe ZADD failed for key ${key}`, error);
      return 0;
    }
  }

  async safeRpush(
    key: RedisKey,
    ...values: (string | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.rpush(key, ...values)),
        (error) => this.logger.warn(`Safe RPUSH failed for key ${key}`, error),
        {
          operationName: "redis_rpush",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe RPUSH failed for key ${key}`, error);
      return 0;
    }
  }

  async safeZpopmax(key: RedisKey, count?: number): Promise<string[]> {
    try {
      return await executeRedisWithRetry<string[]>(
        this.redis,
        (redis: Redis) =>
          Promise.resolve(
            count !== undefined ? redis.zpopmax(key, count) : redis.zpopmax(key)
          ),
        (error) => this.logger.warn(`Safe ZPOPMAX failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe ZPOPMAX failed for key ${key}`, error);
      return [];
    }
  }

  async safeLpop(key: RedisKey): Promise<string | null> {
    try {
      return await executeRedisWithRetry<string | null>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.lpop(key)),
        (error) => this.logger.warn(`Safe LPOP failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe LPOP failed for key ${key}`, error);
      return null;
    }
  }

  async safeRpop(key: RedisKey): Promise<string | null> {
    try {
      return await executeRedisWithRetry<string | null>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.rpop(key)),
        (error) => this.logger.warn(`Safe RPOP failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe RPOP failed for key ${key}`, error);
      return null;
    }
  }
  async safeExpire(key: RedisKey, seconds: number): Promise<boolean> {
    try {
      const result = await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.expire(key, seconds)),
        (error) => this.logger.warn(`Safe EXPIRE failed for key ${key}`, error),
        {
          operationName: "redis_expire",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
      return result === 1;
    } catch (error) {
      this.logger.warn(`Safe EXPIRE failed for key ${key}`, error);
      return false;
    }
  }

  async safeHset(
    key: RedisKey,
    ...fieldValues: (string | number | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.hset(key, ...fieldValues)),
        (error) => this.logger.warn(`Safe HSET failed for key ${key}`, error),
        {
          operationName: "redis_hset",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe HSET failed for key ${key}`, error);
      return 0;
    }
  }

  async safeHincrby(
    key: RedisKey,
    field: string,
    increment: number
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.hincrby(key, field, increment)),
        (error) =>
          this.logger.warn(`Safe HINCRBY failed for key ${key}`, error),
        {
          operationName: "redis_hincrby",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe HINCRBY failed for key ${key}`, error);
      return 0;
    }
  }

  async safePipeline(): Promise<ChainableCommander> {
    try {
      return await executeRedisWithRetry<ChainableCommander>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.pipeline()),
        (error) => this.logger.warn("Safe pipeline failed", error),
        {
          operationName: "redis_pipeline",
          enableCircuitBreaker: true, // Enable for command-level protection
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn("Safe pipeline failed, returning default", error);
      // Return an empty pipeline as fallback
      return this.redis.pipeline();
    }
  }
  async safeSadd(
    key: RedisKey,
    ...members: (string | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.sadd(key, ...members)),
        (error) => this.logger.warn(`Safe SADD failed for key ${key}`, error),
        {
          operationName: "redis_sadd",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe SADD failed for key ${key}`, error);
      return 0;
    }
  }
  async safeZrem(
    key: string | Buffer,
    ...members: (string | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.zrem(key, ...members)),
        (error) => this.logger.warn(`Safe ZREM failed for key ${key}`, error),
        {
          operationName: "redis_zrem",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe ZREM failed for key ${key}`, error);
      return 0;
    }
  }
  async safeSrem(
    key: string | Buffer,
    ...members: (string | Buffer)[]
  ): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.srem(key, ...members)),
        (error) => this.logger.warn(`Safe SREM failed for key ${key}`, error),
        {
          operationName: "redis_srem",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe SREM failed for key ${key}`, error);
      return 0;
    }
  }
  async safeScard(key: string | Buffer): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.scard(key)),
        (error) => this.logger.warn(`Safe SCARD failed for key ${key}`, error),
        {
          operationName: "redis_scard",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe SCARD failed for key ${key}`, error);
      return 0;
    }
  }
  async safeLrange(
    key: string | Buffer,
    start: number,
    stop: number
  ): Promise<string[]> {
    try {
      return await executeRedisWithRetry<string[]>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.lrange(key, start, stop)),
        (error) => this.logger.warn(`Safe LRANGE failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe LRANGE failed for key ${key}`, error);
      return [];
    }
  }

  async safeZcard(key: string | Buffer): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.zcard(key)),
        (error) => this.logger.warn(`Safe ZCARD failed for key ${key}`, error),
        {
          operationName: "redis_zcard",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe ZCARD failed for key ${key}`, error);
      return 0;
    }
  }

  async safeLlen(key: string | Buffer): Promise<number> {
    try {
      return await executeRedisWithRetry<number>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.llen(key)),
        (error) => this.logger.warn(`Safe LLEN failed for key ${key}`, error),
        {
          operationName: "redis_llen",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe LLEN failed for key ${key}`, error);
      return 0;
    }
  }
  async safeHgetall(key: string | Buffer): Promise<Record<string, string>> {
    try {
      return await executeRedisWithRetry<Record<string, string>>(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.hgetall(key)),
        (error) =>
          this.logger.warn(`Safe HGETALL failed for key ${key}`, error),
        {
          operationName: "redis_hgetall",
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe HGETALL failed for key ${key}`, error);
      return {};
    }
  }

  async safeZrange(
    key: string | Buffer,
    start: number,
    stop: number,
    pattern: "WITHSCORES"
  ): Promise<string[]> {
    try {
      return await executeRedisWithRetry<string[]>(
        this.redis,
        (redis: Redis) =>
          Promise.resolve(redis.zrange(key, start, stop, pattern)),
        (error) => this.logger.warn(`Safe ZRANGE failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe ZRANGE failed for key ${key}`, error);
      return [];
    }
  }
  async safeZrangebyscore(
    key: string | Buffer,
    min: string | number,
    max: string | number,
    callback?:
      | ((err?: Error | null, result?: string[] | undefined) => void)
      | undefined
  ): Promise<string[]> {
    try {
      return await executeRedisWithRetry<string[]>(
        this.redis,
        (redis: Redis) =>
          Promise.resolve(redis.zrangebyscore(key, min, max, callback)),
        (error) =>
          this.logger.warn(`Safe ZRANGEBYSCORE failed for key ${key}`, error)
      );
    } catch (error) {
      this.logger.warn(`Safe ZRANGEBYSCORE failed for key ${key}`, error);
      return [];
    }
  }
  async safeScan(
    cursor: string | number,
    patternToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: string | number,
    callback?: Callback<[cursor: string, elements: string[]]>
  ): Promise<[cursor: string, elements: string[]]> {
    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) =>
          Promise.resolve(
            redis.scan(
              cursor,
              patternToken,
              pattern,
              countToken,
              count,
              callback
            )
          ),
        (error) => this.logger.warn("Safe scan failed", error),
        {
          operationName: "redis_scan",
          enableCircuitBreaker: true, // Enable for command-level protection
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn("Safe scan failed, returning default", error);
      // Return an empty scan as fallback
      return this.redis.scan(cursor, callback);
    }
  }

  async healthCheck(): Promise<{
    status: string;
    latency?: number;
    connectionState?: string;
    retryCount?: number;
  }> {
    try {
      const start = Date.now();
      const isHealthy = await this.ping();
      const latency = Date.now() - start;

      if (!isHealthy) {
        return {
          status: "unhealthy",
          connectionState: this.redis?.status || "unknown",
          retryCount: this.retryCount,
        };
      }

      return {
        status: "healthy",
        latency,
        connectionState: this.redis?.status || "unknown",
        retryCount: this.retryCount,
      };
    } catch (error) {
      this.logger.error("Redis healthCheck failed", error);
      return {
        status: "unhealthy",
        connectionState: this.redis?.status || "unknown",
        retryCount: this.retryCount,
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.redis) {
      return false;
    }
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    isConnected: boolean;
    retryCount: number;
    connectionStatus: string;
  } {
    return {
      isConnected: this.isConnected,
      retryCount: this.retryCount,
      connectionStatus: this.redis?.status || "not_initialized",
    };
  }

  /**
   * Publish a message to a Redis channel with validation
   */
  async safePublish(channel: string, message: string): Promise<number> {
    if (!channel || typeof channel !== "string") {
      this.logger.warn("Invalid channel provided to safePublish", { channel });
      return 0;
    }

    if (typeof message !== "string") {
      this.logger.warn("Invalid message provided to safePublish", {
        messageType: typeof message,
      });
      return 0;
    }

    // Basic validation
    if (channel.length > 256) {
      this.logger.warn("Channel name too long for safePublish", {
        channelLength: channel.length,
      });
      return 0;
    }

    if (message.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn("Message too large for safePublish", {
        messageLength: message.length,
      });
      return 0;
    }

    try {
      const result = await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => redis.publish(channel, message),
        (error) =>
          this.logger.warn(`Safe publish failed for channel ${channel}`, error),
        {
          operationName: "redis_publish",
          maxRetries: 3,
          enableCircuitBreaker: true,
          enableMetrics: true,
        }
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to publish to channel ${channel}`, error);
      return 0;
    }
  }

  /**
   * Subscribe to Redis channels
   * Returns a new Redis client for subscription (pub/sub requires separate connection)
   */
  createSubscriber(): Redis {
    const subscriberOptions: RedisOptions = {
      host: getEnv("REDIS_HOST", "localhost"),
      port: getNumberEnv("REDIS_PORT", 6379),
      password: getEnv("REDIS_PASSWORD"),
      db: getNumberEnv("REDIS_DB", 0),
      username: getEnv("REDIS_USERNAME"),
      maxRetriesPerRequest: getNumberEnv("REDIS_MAX_RETRIES", 3),
      connectTimeout: getNumberEnv("REDIS_CONNECT_TIMEOUT", 10000),
      enableReadyCheck: getBooleanEnv("REDIS_READY_CHECK", false),
      lazyConnect: true,
    };

    return new Redis(subscriberOptions);
  }

  /**
   * Force reconnection with thread safety
   */
  async forceReconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug("Connection operation already in progress");
      return;
    }

    this.connectionLock = true;
    try {
      // Clear any pending reconnection
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        delete this.reconnectTimeout;
      }

      if (this.redis) {
        this.redis.disconnect();
      }
      this.retryCount = 0;
      await this.connect();
    } catch (error) {
      this.logger.error("Force reconnection failed", error);
      throw error;
    } finally {
      this.connectionLock = false;
    }
  }
}
