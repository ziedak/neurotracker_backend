import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { getEnv, getBooleanEnv, getNumberEnv } from "@libs/config";
import { IMetricsCollector } from "@libs/monitoring";
import { createHash } from "crypto";
import { createLogger, executeWithRetry } from "@libs/utils";
import type { ICache } from "@libs/database/src/cache/interfaces/ICache";

/**
 * Custom error class for PostgreSQL operations.
 */
export class PostgreSQLError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "PostgreSQLError";
  }
}

/**
 * Health check result interface for consistent health reporting.
 */
export interface IPostgreSQLHealthResult {
  status: "healthy" | "unhealthy" | "degraded";
  latency?: number;
  version?: string;
  error?: string;
}

/**
 * Configuration for PostgreSQL resilience policies.
 */
export interface PostgreSQLResilienceConfig {
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  connectionTimeout: number;
}

/**
 * Performance metrics configuration for PostgreSQL operations.
 */
export interface PostgreSQLMetricsConfig {
  enabled: boolean;
  slowQueryThreshold: number; // milliseconds
  healthCheckInterval: number; // milliseconds
}

/**
 * Batch operation configuration for PostgreSQL bulk operations.
 */
export interface PostgreSQLBatchConfig {
  batchSize: number;
  concurrency: number;
  timeoutMs: number;
}

/**
 * Query caching configuration for PostgreSQL operations.
 */
export interface PostgreSQLQueryCacheConfig {
  enabled: boolean;
  defaultTTL: number; // seconds
  maxCacheSize: number; // maximum number of cached queries
  cacheKeyPrefix: string;
  excludePatterns: string[]; // regex patterns for queries to exclude from caching
}

/**
 * Cache-enabled query options for PostgreSQL.
 */
export interface PostgreSQLQueryCacheOptions {
  useCache?: boolean;
  ttl?: number; // override default TTL
  cacheKey?: string; // custom cache key
}

/**
 * PostgreSQLClient: Clean Prisma client with optional metrics
 * - Optional dependency injection for metrics
 * - Connection pooling, health checks, transactions, and raw queries
 * - Clean interface suitable for any framework
 */
export class PostgreSQLClient {
  private readonly prismaClient: PrismaClient;
  private isConnected = false;
  private isConnecting = false;
  private readonly resilienceConfig: PostgreSQLResilienceConfig;
  private readonly metricsConfig: PostgreSQLMetricsConfig;
  private readonly queryCache: PostgreSQLQueryCacheConfig;
  private readonly logger = createLogger("PostgreSQLClient");

  /**
   * Clean PostgreSQL client constructor with optional metrics and cache.
   */
  constructor(
    private readonly metricsCollector?: IMetricsCollector,
    private readonly cacheService?: ICache
  ) {
    this.resilienceConfig = this.createResilienceConfigFromEnv();
    this.metricsConfig = this.createMetricsConfigFromEnv();
    this.queryCache = this.createQueryCacheConfigFromEnv();

    // Initialize PrismaClient with Accelerate extension
    const client = new PrismaClient({
      datasources: {
        db: {
          url: getEnv(
            "DATABASE_URL",
            "postgresql://postgres:TEST@postgres:5432/neurotracker?schema=public"
          ),
        },
      },
      log: getBooleanEnv("DATABASE_LOGGING")
        ? ["query", "info", "warn", "error"]
        : ["error"],
      errorFormat: "pretty",
    });

    this.prismaClient = client.$extends(withAccelerate());
    this.isConnected = false;

    this.logger.info("PostgreSQL client initialized", {
      accelerateEnabled: true,
      strictMode: true,
      resilience: this.resilienceConfig,
      metrics: this.metricsConfig,
      queryCache: this.queryCache,
    });
  }

  static create(
    metricsCollector?: IMetricsCollector,
    cacheService?: ICache
  ): PostgreSQLClient {
    return new PostgreSQLClient(metricsCollector, cacheService);
  }

  /**
   * Creates resilience configuration from environment variables.
   */
  private createResilienceConfigFromEnv(): PostgreSQLResilienceConfig {
    return {
      maxRetries: getNumberEnv("POSTGRESQL_MAX_RETRIES", 3),
      retryDelay: getNumberEnv("POSTGRESQL_RETRY_DELAY", 1000),
      circuitBreakerThreshold: getNumberEnv(
        "POSTGRESQL_CIRCUIT_BREAKER_THRESHOLD",
        5
      ),
      circuitBreakerTimeout: getNumberEnv(
        "POSTGRESQL_CIRCUIT_BREAKER_TIMEOUT",
        30000
      ),
      connectionTimeout: getNumberEnv("POSTGRESQL_CONNECTION_TIMEOUT", 10000),
    };
  }

  /**
   * Creates metrics configuration from environment variables.
   */
  private createMetricsConfigFromEnv(): PostgreSQLMetricsConfig {
    return {
      enabled: getBooleanEnv("POSTGRESQL_METRICS_ENABLED", true),
      slowQueryThreshold: getNumberEnv("POSTGRESQL_SLOW_QUERY_THRESHOLD", 1000),
      healthCheckInterval: getNumberEnv(
        "POSTGRESQL_HEALTH_CHECK_INTERVAL",
        30000
      ),
    };
  }

  /**
   * Creates query cache configuration from environment variables.
   */
  private createQueryCacheConfigFromEnv(): PostgreSQLQueryCacheConfig {
    return {
      enabled: getBooleanEnv("POSTGRESQL_QUERY_CACHE_ENABLED", true),
      defaultTTL: getNumberEnv("POSTGRESQL_QUERY_CACHE_DEFAULT_TTL", 300), // 5 minutes
      maxCacheSize: getNumberEnv("POSTGRESQL_QUERY_CACHE_MAX_SIZE", 1000),
      cacheKeyPrefix: getEnv(
        "POSTGRESQL_QUERY_CACHE_KEY_PREFIX",
        "postgresql:"
      ),
      excludePatterns: getEnv(
        "POSTGRESQL_QUERY_CACHE_EXCLUDE_PATTERNS",
        "INSERT,UPDATE,DELETE,CREATE,DROP,ALTER,TRUNCATE"
      ).split(","),
    };
  }

  /**
   * Generates a cache key for a query with parameters.
   */
  private generateCacheKey(query: string, params?: unknown[]): string {
    const paramString = params ? JSON.stringify(params) : "";
    const hash = createHash("md5")
      .update(query + paramString)
      .digest("hex");
    return `${this.queryCache.cacheKeyPrefix}query:${hash}`;
  }

  /**
   * Checks if a query should be cached based on exclude patterns.
   */
  private shouldCacheQuery(query: string): boolean {
    if (!this.queryCache.enabled) return false;

    const upperQuery = query.trim().toUpperCase();
    return !this.queryCache.excludePatterns.some((pattern) =>
      upperQuery.startsWith(pattern.toUpperCase())
    );
  }

  /**
   * Execute operations with resilience (circuit breaker).
   * Uses cockatiel for battle-tested resilience patterns.
   */
  // Circuit breaker implementation available for future use

  /**
   * Connect to database (idempotent and thread-safe)
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return; // Already connected
    }

    if (this.isConnecting) {
      // Wait for ongoing connection attempt
      while (this.isConnecting) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return; // Connection attempt completed
    }

    this.isConnecting = true;
    try {
      await this.prismaClient.$connect();
      this.isConnected = true;
      this.logger.info("Database connection established");
    } catch (error) {
      this.logger.error("Failed to connect to database", error);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from database (idempotent and thread-safe)
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return; // Already disconnected
    }

    // Wait for any ongoing connection attempts to complete
    while (this.isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (!this.isConnected) {
      return; // Connection was aborted during wait
    }

    try {
      await this.prismaClient.$disconnect();
      this.isConnected = false;
      this.logger.info("Database connection closed");
    } catch (error) {
      this.logger.error("Error during database disconnection", error);
      // Don't throw - disconnection errors shouldn't crash the application
    }
  }

  /**
   * Ping database for connectivity with performance tracking and resilience
   */
  async ping(): Promise<boolean> {
    return executeWithRetry(
      async () => {
        const start = performance.now();
        await this.prismaClient.$queryRaw`SELECT 1`;
        const duration = performance.now() - start;

        this.logger.debug("PostgreSQL ping successful", {
          duration: `${duration.toFixed(2)}ms`,
        });

        await this.metricsCollector?.recordTimer(
          "postgresql.ping.duration",
          duration
        );
        await this.metricsCollector?.recordCounter("postgresql.ping.success");

        if (
          this.metricsConfig.enabled &&
          duration > this.metricsConfig.slowQueryThreshold
        ) {
          this.logger.warn("PostgreSQL ping slow query detected", {
            duration: `${duration.toFixed(2)}ms`,
            threshold: `${this.metricsConfig.slowQueryThreshold}ms`,
          });
        }

        return true;
      },
      (error) =>
        this.logger.error("PostgreSQL ping failed after retries", error),
      {
        operationName: "PostgreSQL ping",
        enableCircuitBreaker: true,
      }
    ).catch(async (error: unknown) => {
      this.logger.error("PostgreSQL ping failed after retries", error);
      await this.metricsCollector?.recordCounter("postgresql.ping.failure");
      throw new PostgreSQLError("Database ping failed", error);
    });
  }

  /**
   * Health check: returns status, latency, and version with comprehensive metrics and resilience
   */
  async healthCheck(): Promise<IPostgreSQLHealthResult> {
    try {
      return await executeWithRetry(
        async () => {
          const start = performance.now();
          const versionResult = await this.prismaClient.$queryRaw<
            { version: string }[]
          >`SELECT version() as version`;

          const version =
            typeof versionResult[0]?.version === "string"
              ? versionResult[0].version
              : undefined;

          const latency = performance.now() - start;

          this.logger.info("PostgreSQL health check successful", {
            latency: `${latency.toFixed(2)}ms`,
            version: `${version?.substring(0, 50)}...`,
          });

          await this.metricsCollector?.recordTimer(
            "postgresql.healthcheck.duration",
            latency
          );
          await this.metricsCollector?.recordCounter(
            "postgresql.healthcheck.success"
          );

          const status =
            this.metricsConfig.enabled &&
            latency > this.metricsConfig.slowQueryThreshold
              ? "degraded"
              : "healthy";

          if (status === "degraded") {
            this.logger.warn("PostgreSQL health check performance degraded", {
              latency: `${latency.toFixed(2)}ms`,
              threshold: `${this.metricsConfig.slowQueryThreshold}ms`,
            });
          }

          return version !== undefined
            ? { status, latency, version }
            : { status, latency };
        },

        (error: unknown) =>
          this.logger.error(
            "PostgreSQL health check failed after retries",
            error
          ),
        {
          operationName: "PostgreSQL health check",
          enableCircuitBreaker: true,
        }
      );
    } catch (error) {
      this.logger.error("PostgreSQL health check failed after retries", error);
      await this.metricsCollector?.recordCounter(
        "postgresql.healthcheck.failure"
      );

      return {
        status: "unhealthy",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Returns connection health status
   */
  isHealthy(): boolean {
    return this.isConnected;
  }

  /**
   * Execute raw SQL query with performance tracking, structured error handling, and resilience
   */
  async executeRaw(query: string, ...params: unknown[]): Promise<unknown> {
    return executeWithRetry(
      async () => {
        const start = performance.now();
        const result = await this.prismaClient.$queryRawUnsafe(
          query,
          ...params
        );

        const duration = performance.now() - start;

        this.logger.debug("PostgreSQL raw query executed successfully", {
          query: `${query.substring(0, 100)}...`,
          paramCount: params.length,
          duration: `${duration.toFixed(2)}ms`,
        });

        await this.metricsCollector?.recordTimer(
          "postgresql.raw_query.duration",
          duration
        );
        await this.metricsCollector?.recordCounter(
          "postgresql.raw_query.success"
        );

        if (
          this.metricsConfig.enabled &&
          duration > this.metricsConfig.slowQueryThreshold
        ) {
          this.logger.warn("PostgreSQL slow query detected", {
            query: `${query.substring(0, 100)}...`,
            duration: `${duration.toFixed(2)}ms`,
            threshold: `${this.metricsConfig.slowQueryThreshold}ms`,
            paramCount: params.length,
          });

          await this.metricsCollector?.recordCounter("postgresql.slow_query");
        }

        return result;
      },
      (error: unknown) =>
        this.logger.error("PostgreSQL raw query failed after retries", error),
      {
        operationName: "PostgreSQL raw query",
        enableCircuitBreaker: true,
      }
    ).catch(async (error: unknown) => {
      this.logger.error("PostgreSQL raw query failed after retries", error, {
        query: `${query.substring(0, 100)}...`,
        paramCount: params.length,
      });
      await this.metricsCollector?.recordCounter(
        "postgresql.raw_query.failure"
      );
      throw new PostgreSQLError("Raw query execution failed", error);
    });
  }

  /**
   * Execute raw SQL query with caching, performance tracking, and resilience.
   */
  async executeRawWithCache<T = unknown>(
    query: string,
    params: unknown[] = [],
    options?: PostgreSQLQueryCacheOptions
  ): Promise<T> {
    const cacheOptions = {
      useCache: this.shouldCacheQuery(query),
      ttl: this.queryCache.defaultTTL,
      ...options,
    };

    if (!cacheOptions.useCache) {
      return this.executeRaw(query, ...params) as Promise<T>;
    }

    const cacheKey =
      cacheOptions.cacheKey ?? this.generateCacheKey(query, params);

    try {
      // Check cache first if available
      if (this.cacheService) {
        const cacheResult = await this.cacheService.get<T>(cacheKey);
        if (cacheResult.data !== null) {
          await this.metricsCollector?.recordCounter("postgresql.cache.hit");
          this.logger.debug("Cache hit for PostgreSQL query", {
            cacheKey,
            query: `${query.substring(0, 100)}...`,
          });
          return cacheResult.data;
        }
      }

      await this.metricsCollector?.recordCounter("postgresql.cache.miss");
      const result = (await this.executeRaw(query, ...params)) as T;

      // Cache the result if cache service is available
      if (this.cacheService) {
        await this.cacheService.set(cacheKey, result, cacheOptions.ttl);
        this.logger.debug("Cached PostgreSQL query result", {
          cacheKey,
          ttl: cacheOptions.ttl,
          query: `${query.substring(0, 100)}...`,
        });
      }

      return result;
    } catch (error) {
      await this.metricsCollector?.recordCounter("postgresql.cache.error");
      this.logger.warn(
        "Cache operation failed, executing query directly",
        error
      );
      return this.executeRaw(query, ...params) as Promise<T>;
    }
  }

  /**
   * Invalidate cached queries matching a pattern.
   */
  async invalidateCache(pattern?: string): Promise<void> {
    try {
      if (!this.cacheService) {
        this.logger.debug("Cache service not available, skipping invalidation");
        return;
      }

      const searchPattern = pattern ?? `${this.queryCache.cacheKeyPrefix}*`;
      const invalidatedCount =
        await this.cacheService.invalidatePattern(searchPattern);

      this.logger.info("PostgreSQL cache invalidated", {
        pattern: searchPattern,
        invalidatedCount,
      });
      await this.metricsCollector?.recordCounter(
        "postgresql.cache.invalidated",
        invalidatedCount
      );
    } catch (error) {
      this.logger.error("PostgreSQL cache invalidation failed", error);
      throw new PostgreSQLError("Cache invalidation failed", error);
    }
  }

  /**
   * Get cache statistics for monitoring and optimization.
   */
  async getCacheStats(): Promise<{
    enabled: boolean;
    config: PostgreSQLQueryCacheConfig;
    metrics: {
      hits: number;
      misses: number;
      errors: number;
      hitRate: number;
    };
  }> {
    if (!this.cacheService) {
      return {
        enabled: false,
        config: this.queryCache,
        metrics: {
          hits: 0,
          misses: 0,
          errors: 0,
          hitRate: 0,
        },
      };
    }

    const cacheStats = this.cacheService.getStats();
    const cacheHealth = await this.cacheService.healthCheck();

    return {
      enabled: this.queryCache.enabled && (await this.cacheService.isEnabled()),
      config: this.queryCache,
      metrics: {
        hits: cacheStats.Hits,
        misses: cacheStats.Misses,
        errors: 0, // TODO: Track cache errors separately
        hitRate: cacheHealth.hitRate,
      },
    };
  }

  /**
   * Execute a cached SELECT query with automatic cache management.
   */
  async cachedQuery<T = unknown>(
    query: string,
    params: unknown[] = [],
    cacheTTL: number = 300
  ): Promise<T> {
    const upperQuery = query.trim().toUpperCase();
    if (!upperQuery.startsWith("SELECT")) {
      throw new PostgreSQLError("cachedQuery only supports SELECT operations");
    }

    return this.executeRawWithCache<T>(query, params, {
      useCache: true,
      ttl: cacheTTL,
    });
  }

  /**
   * Execute a write operation and invalidate related cached queries.
   */
  async writeWithCacheInvalidation(
    query: string,
    params: unknown[] = [],
    invalidationPatterns: string[] = []
  ): Promise<unknown> {
    const result = await this.executeRaw(query, ...params);

    for (const pattern of invalidationPatterns) {
      try {
        await this.invalidateCache(pattern);
      } catch (error) {
        this.logger.warn("Cache invalidation failed for pattern", {
          pattern,
          error,
        });
      }
    }

    return result;
  }

  /**
   * Execute multiple operations in batches with controlled concurrency and resilience.
   */
  async batchExecute<T>(
    operations: (() => Promise<T>)[],
    config?: Partial<PostgreSQLBatchConfig>
  ): Promise<{
    results: T[];
    errors: Error[];
    stats: { processed: number; failed: number; duration: number };
  }> {
    const batchConfig = {
      batchSize: config?.batchSize ?? 10,
      concurrency: config?.concurrency ?? 3,
      timeoutMs: config?.timeoutMs ?? 30000,
    };

    const start = performance.now();
    const results: T[] = [];
    const errors: Error[] = [];
    let processed = 0;

    this.logger.info("PostgreSQL batch execution started", {
      totalOperations: operations.length,
      batchSize: batchConfig.batchSize,
      concurrency: batchConfig.concurrency,
      timeout: `${batchConfig.timeoutMs}ms`,
    });

    try {
      for (let i = 0; i < operations.length; i += batchConfig.batchSize) {
        const batch = operations.slice(i, i + batchConfig.batchSize);

        const batchPromises = batch.map(async (operation, index) => {
          try {
            return await executeWithRetry(
              operation,
              (error: unknown) =>
                this.logger.error(
                  `Batch operation ${i + index + 1} failed after retries`,
                  error
                ),
              {
                operationName: `Batch operation ${i + index + 1}`,
                enableCircuitBreaker: true,
              }
            );
          } catch (error) {
            errors.push(
              error instanceof Error ? error : new Error(String(error))
            );
            return null;
          }
        });

        const timeoutIds: NodeJS.Timeout[] = [];

        const batchResults = await Promise.allSettled(
          batchPromises.map((promise) => {
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
              const id = setTimeout(() => {
                reject(new Error("Operation timeout"));
              }, batchConfig.timeoutMs);
              timeoutId = id;
              timeoutIds.push(id);
            });

            return Promise.race([
              promise.finally(() => {
                if (timeoutId) {
                  clearTimeout(timeoutId);
                  const index = timeoutIds.indexOf(timeoutId);
                  if (index > -1) timeoutIds.splice(index, 1);
                }
              }),
              timeoutPromise,
            ]);
          })
        );

        // Clean up any remaining timeouts
        timeoutIds.forEach((id) => clearTimeout(id));

        batchResults.forEach((result) => {
          processed++;
          if (result.status === "fulfilled" && result.value !== null) {
            results.push(result.value as T);
          } else if (result.status === "rejected") {
            errors.push(
              result.reason instanceof Error
                ? result.reason
                : new Error(String(result.reason))
            );
          }
        });

        this.logger.debug("PostgreSQL batch progress", {
          processed,
          total: operations.length,
          currentBatch: Math.floor(i / batchConfig.batchSize) + 1,
          errors: errors.length,
        });
      }

      const duration = performance.now() - start;
      const stats = { processed, failed: errors.length, duration };

      await this.metricsCollector?.recordTimer(
        "postgresql.batch.duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "postgresql.batch.operations",
        processed
      );
      await this.metricsCollector?.recordCounter(
        "postgresql.batch.errors",
        errors.length
      );

      this.logger.info("PostgreSQL batch execution completed", {
        ...stats,
        duration: `${duration.toFixed(2)}ms`,
        successRate: `${(
          ((stats.processed - stats.failed) / stats.processed) *
          100
        ).toFixed(1)}%`,
      });

      return { results, errors, stats };
    } catch (error) {
      const duration = performance.now() - start;
      this.logger.error("PostgreSQL batch execution failed", error, {
        processed,
        duration: `${duration.toFixed(2)}ms`,
      });
      throw new PostgreSQLError("Batch execution failed", error);
    }
  }

  /**
   * Run a transaction with type-safe Prisma client
   */
  transaction<T>(
    callback: (
      prisma: Omit<
        PrismaClient,
        | "$connect"
        | "$disconnect"
        | "$on"
        | "$transaction"
        | "$use"
        | "$extends"
      >
    ) => Promise<T>
  ): Promise<T> {
    return this.prismaClient.$transaction(callback);
  }

  /**
   * Enhanced connection management with monitoring and health tracking
   */
  async getConnectionInfo(): Promise<{
    isConnected: boolean;
    connectionPool: {
      active: number;
      idle: number;
      total: number;
    };
    performance: {
      avgQueryTime: number;
      slowQueries: number;
      errorRate: number;
    };
    uptime: number;
  }> {
    try {
      const start = performance.now();

      const poolInfo = (await this.executeRaw(`
        SELECT 
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections,
          count(*) as total_connections
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `)) as Array<{
        active_connections: bigint;
        idle_connections: bigint;
        total_connections: bigint;
      }>;

      const uptimeInfo = (await this.executeRaw(`
        SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time())) as uptime
      `)) as Array<{ uptime: number }>;

      const queryDuration = performance.now() - start;

      const connectionInfo = {
        isConnected: this.isConnected,
        connectionPool: {
          active: Number(poolInfo[0]?.active_connections ?? 0),
          idle: Number(poolInfo[0]?.idle_connections ?? 0),
          total: Number(poolInfo[0]?.total_connections ?? 0),
        },
        performance: {
          avgQueryTime: queryDuration,
          slowQueries: 0,
          errorRate: 0,
        },
        uptime: Number(uptimeInfo[0]?.uptime ?? 0),
      };

      this.logger.debug("PostgreSQL connection info retrieved", connectionInfo);

      return connectionInfo;
    } catch (error) {
      this.logger.error("Failed to get PostgreSQL connection info", error);
      throw new PostgreSQLError("Connection info retrieval failed", error);
    }
  }
}
