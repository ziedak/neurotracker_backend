import Redis, {
  RedisOptions,
  type Callback,
  type ChainableCommander,
} from "ioredis";
import { injectable, inject } from "@libs/utils";
import { MetricsCollector, type ILogger } from "@libs/monitoring";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
import { keys } from "lodash";

@injectable()
export class RedisClient {
  private redis: Redis;
  private isConnected = false;
  private retryCount = 0;
  private maxRetries = 3;
  private reconnectDelay = 1000;

  constructor(
    @inject("Logger") private logger: ILogger,
    @inject("MetricsCollector") private metrics: MetricsCollector,
    redisOptions?: RedisOptions
  ) {
    const options: RedisOptions = redisOptions || {
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
    this.redis = new Redis(options);
    this.setupEventHandlers();
    this.redis.connect().catch((err) => {
      this.logger.error("Redis initial connect failed", err);
    });
  }

  private setupEventHandlers() {
    this.redis.on("connect", () => {
      this.logger.info("Redis connected");
      this.isConnected = true;
      this.retryCount = 0;
      this.metrics.recordCounter("redis_connection_success");
    });
    this.redis.on("ready", () => {
      this.logger.info("Redis ready to accept commands");
      this.metrics.recordCounter("redis_ready");
    });
    this.redis.on("error", (error) => {
      this.logger.error("Redis error", error);
      this.isConnected = false;
      this.metrics.recordCounter("redis_connection_error");
    });
    this.redis.on("close", () => {
      this.logger.info("Redis connection closed");
      this.isConnected = false;
      this.metrics.recordCounter("redis_connection_closed");
      this.scheduleReconnect();
    });
    this.redis.on("reconnecting", () => {
      this.logger.info("Redis reconnecting...");
      this.metrics.recordCounter("redis_reconnecting");
    });
    this.redis.on("end", () => {
      this.logger.warn("Redis connection ended");
      this.isConnected = false;
      this.metrics.recordCounter("redis_connection_ended");
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

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      this.logger.error("Redis ping failed", error);
      return false;
    }
  }

  /**
   * Execute Redis operation with retry logic and metrics
   */
  async executeWithRetry<T>(
    operation: (redis: Redis) => Promise<T>,
    operationName = "redis_operation",
    maxRetries = 3
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation(this.redis);
        this.metrics.recordTimer(
          `${operationName}_duration`,
          Date.now() - startTime
        );
        this.metrics.recordCounter(`${operationName}_success`);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Redis operation ${operationName} failed (attempt ${attempt + 1})`,
          error
        );
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    this.metrics.recordTimer(
      `${operationName}_duration`,
      Date.now() - startTime
    );
    this.metrics.recordCounter(`${operationName}_failed`);
    throw lastError;
  }

  /**
   * Safe get operation with fallback
   */
  async safeGet(
    key: string,
    defaultValue: string | null = null
  ): Promise<string | null> {
    try {
      return await this.executeWithRetry(
        (redis) => redis.get(key),
        "redis_get"
      );
    } catch (error) {
      this.logger.warn(
        `Safe get failed for key ${key}, returning default`,
        error
      );
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
      await this.executeWithRetry(async (redis) => {
        if (ttlSeconds) {
          return await redis.set(key, value, "EX", ttlSeconds);
        } else {
          return await redis.set(key, value);
        }
      }, "redis_set");
      return true;
    } catch (error) {
      this.logger.warn(`Safe set failed for key ${key}`, error);
      return false;
    }
  }
  async safePipeline(): Promise<ChainableCommander> {
    try {
      return await this.executeWithRetry<ChainableCommander>(
        (redis) => Promise.resolve(redis.pipeline()),
        "redis_pipeline"
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
      return await this.executeWithRetry(
        (redis) =>
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
        "redis_scan"
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

  isHealthy(): boolean {
    return this.isConnected;
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
