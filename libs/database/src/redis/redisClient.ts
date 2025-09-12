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
  private redis: Redis;
  private isConnected = false;
  private retryCount = 0;
  private maxRetries = 3;
  private reconnectDelay = 1000;
  private readonly logger = createLogger("RedisClient");

  constructor(
    private metrics?: IMetricsCollector,
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

  private setupEventHandlers() {
    this.redis.on("connect", () => {
      this.logger.info("Redis connected");
      this.isConnected = true;
      this.retryCount = 0;
      this.metrics?.recordCounter("redis_connection_success");
    });
    this.redis.on("ready", () => {
      this.logger.info("Redis ready to accept commands");
      this.metrics?.recordCounter("redis_ready");
    });
    this.redis.on("error", (error) => {
      this.logger.error("Redis error", error);
      this.isConnected = false;
      this.metrics?.recordCounter("redis_connection_error");
    });
    this.redis.on("close", () => {
      this.logger.info("Redis connection closed");
      this.isConnected = false;
      this.metrics?.recordCounter("redis_connection_closed");
      this.scheduleReconnect();
    });
    this.redis.on("reconnecting", () => {
      this.logger.info("Redis reconnecting...");
      this.metrics?.recordCounter("redis_reconnecting");
    });
    this.redis.on("end", () => {
      this.logger.warn("Redis connection ended");
      this.isConnected = false;
      this.metrics?.recordCounter("redis_connection_ended");
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.retryCount >= this.maxRetries) {
      this.logger.error(
        `Max reconnection attempts (${this.maxRetries}) reached`
      );
      return;
    }
    const delay = this.reconnectDelay * Math.pow(2, this.retryCount);
    this.retryCount++;
    this.logger.info(
      `Scheduling Redis reconnection in ${delay}ms (attempt ${this.retryCount})`
    );
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error("Scheduled reconnection failed", error);
      }
    }, delay);
  }

  async connect(): Promise<void> {
    if (
      this.isConnected ||
      (this.redis && this.redis.status === "connecting")
    ) {
      return;
    }
    try {
      await this.redis.connect();
    } catch (error) {
      this.logger.error("Redis connect() failed", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis && this.isConnected) {
      try {
        await this.redis.quit();
        this.isConnected = false;
        this.logger.info("Redis disconnected");
      } catch (error) {
        this.logger.error("Redis disconnect() failed", error);
      }
    }
  }

  exists(...args: RedisKey[]): Promise<number> {
    return this.redis.exists(...args);
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
    try {
      await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => redis.setex(key, ttl, value),
        (error) => this.logger.warn(`Safe setex failed for key ${key}`, error),
        {
          operationName: "redis_setex",
          maxRetries: 3,
          enableCircuitBreaker: true, // Enable for command-level protection
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
    try {
      return await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => Promise.resolve(redis.keys(pattern)),
        (error) =>
          this.logger.warn(`Safe keys failed for pattern ${pattern}`, error),
        {
          operationName: "redis_keys",
          enableCircuitBreaker: true, // Enable for command-level protection
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe keys failed for pattern ${pattern}`, error);
      return [];
    }
  }

  async safeDel(...args: RedisKey[]): Promise<number> {
    return executeRedisWithRetry(
      this.redis,
      (redis: Redis) => Promise.resolve(redis.del(...args)),
      (error) =>
        this.logger.warn(`Safe del failed for keys ${args.join(", ")}`, error),
      {
        operationName: "redis_del",
        enableCircuitBreaker: true, // Enable for command-level protection
        enableMetrics: true,
      }
    );
  }

  getRedis(): Redis {
    return this.redis;
  }

  async safeMget(...args: RedisKey[]): Promise<(string | null)[]> {
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
          enableCircuitBreaker: true, // Enable for command-level protection
          enableMetrics: true,
        }
      );
    } catch (error) {
      this.logger.warn(`Safe mget failed for keys ${args.join(", ")}`, error);
      return new Array(args.length).fill(null);
    }
  }

  /**
   * Safe get operation with fallback
   */
  async safeGet(
    key: string,
    defaultValue: string | null = null
  ): Promise<string | null> {
    if (!key) return defaultValue;

    try {
      const result = await executeRedisWithRetry(
        this.redis,
        (redis: Redis) => redis.get(key),
        (error) => this.logger.warn(`Safe get failed for key ${key}`, error),
        {
          operationName: "redis_get",
          enableCircuitBreaker: true, // Enable for command-level protection
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
   * Safe set operation with fallback
   */
  async safeSet(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<boolean> {
    try {
      await executeRedisWithRetry(
        this.redis,
        async (redis: Redis) => {
          if (ttlSeconds) {
            return await redis.set(key, value, "EX", ttlSeconds);
          } else {
            return await redis.set(key, value);
          }
        },
        (error) => this.logger.warn(`Safe set failed for key ${key}`, error),
        {
          operationName: "redis_set",
          enableCircuitBreaker: true, // Enable for command-level protection
          enableMetrics: true,
        }
      );
      return true;
    } catch (error) {
      this.logger.warn(`Safe set failed for key ${key}`, error);
      return false;
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
      await this.ping();
      const latency = Date.now() - start;
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
   * Publish a message to a Redis channel
   */
  async safePublish(channel: string, message: string): Promise<number> {
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
      return result as number;
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
   * Force reconnection
   */
  async forceReconnect(): Promise<void> {
    try {
      if (this.redis) {
        this.redis.disconnect();
      }
      this.retryCount = 0;
      await this.connect();
    } catch (error) {
      this.logger.error("Force reconnection failed", error);
      throw error;
    }
  }
}
