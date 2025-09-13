import { createClient, ClickHouseClient as CHClient } from "@clickhouse/client";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
import { createLogger, executeWithRetry } from "@libs/utils";
import { IMetricsCollector } from "@libs/monitoring";
import { createHash } from "crypto";
import { ICache } from "../cache";

/**
 * Configuration interface for ClickHouse client.
 * Ensures type safet    try {
      // Try to get from cache first
      // TODO: Re-implement caching with proper DI
      // const cacheResult = await this.cacheService.get<T>(cacheKey);
      // if (cacheResult.data !== null) {
      //   await this.metricsCollector?.recordCounter("clickhouse.cache.hit", 1);
      //   this.logger.debug("Cache hit for ClickHouse query", { cacheKey });
      //   return cacheResult.data;
      // }idation for connection settings.
 */
export interface IClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  requestTimeout: number;
  maxOpenConnections: number;
  compression: {
    response: boolean;
    request: boolean;
  };
}

/**
 * Interface for ClickHouse client operations.
 * Follows ISP by separating concerns.
 */
export interface IClickHouseClient {
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  healthCheck(): Promise<IHealthCheckResult>;
  isHealthy(): boolean;
  execute<T = unknown>(
    query: string,
    values?: Record<string, unknown>
  ): Promise<T>;
  insert(
    table: string,
    data: Record<string, unknown>[],
    format?: string
  ): Promise<void>;

  /**
   * High-throughput batch insert with configurable concurrency and batching.
   * Ideal for large dataset insertions with progress tracking.
   */
  batchInsert(
    table: string,
    data: Record<string, unknown>[],
    options?: IBatchInsertOptions,
    format?: string
  ): Promise<IBatchInsertResult>;
}

/**
 * Configuration for ClickHouse resilience policies.
 */
export interface ClickHouseResilienceConfig {
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

/**
 * Query caching configuration.
 */
export interface ClickHouseQueryCacheConfig {
  enabled: boolean;
  defaultTTL: number; // seconds
  maxCacheSize: number; // maximum number of cached queries
  cacheKeyPrefix: string;
  excludePatterns: string[]; // regex patterns for queries to exclude from caching
}

/**
 * Cache-enabled query options.
 */
export interface QueryCacheOptions {
  useCache?: boolean;
  ttl?: number; // override default TTL
  cacheKey?: string; // custom cache key
}

/**
 * Result type for health checks.
 */
export interface IHealthCheckResult {
  status: HealthStatus;
  latency?: number;
  version?: string | undefined;
}

/**
 * Enum for health status to avoid magic strings.
 */
export enum HealthStatus {
  HEALTHY = "healthy",
  UNHEALTHY = "unhealthy",
}

/**
 * Simple interface for dependency injection container.
 * Only includes methods used by the registration function.
 */
interface IDependencyContainer {
  isRegistered(name: string): boolean;
  register(name: string, registration: unknown): void;
}

/**
 * Custom error class for ClickHouse operations.
 */
export class ClickHouseError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "ClickHouseError";
  }
}

/**
 * Optimized ClickHouse client with TSyringe dependency injection.
 * Uses singleton pattern for enterprise-wide database connection management.
 */
export class ClickHouseClient implements IClickHouseClient {
  private readonly client: CHClient;
  private isConnected = false;
  private connectionLock = false; // Prevent concurrent connection operations
  private cachedVersion?: string;
  private versionCacheTime = 0;
  private readonly versionCacheTTL = 300000; // 5 minutes
  private readonly config: IClickHouseConfig;
  private readonly resilienceConfig: ClickHouseResilienceConfig;
  private readonly queryCache: ClickHouseQueryCacheConfig;

  /**
   * TSyringe-managed ClickHouse client constructor with proper dependency injection.
   * All dependencies are automatically resolved by the container.
   */
  private readonly cacheService?: ICache;
  private readonly logger = createLogger("ClickHouseClient");
  constructor(
    cacheService?: ICache,
    private readonly metricsCollector?: IMetricsCollector
  ) {
    this.config = this.createConfigFromEnv();
    this.resilienceConfig = this.createResilienceConfigFromEnv();
    this.queryCache = this.createQueryCacheConfigFromEnv();
    this.client = createClient(this.config);

    // Use injected cache service
    if (cacheService) {
      this.cacheService = cacheService;
    }

    this.logger.info("ClickHouse client initialized", {
      url: this.config.url,
      database: this.config.database,
      resilience: this.resilienceConfig,
      queryCache: this.queryCache,
      hasCache: !!this.cacheService,
    });
  }

  static create(
    cacheService?: ICache,
    metricsCollector?: IMetricsCollector
  ): ClickHouseClient {
    return new ClickHouseClient(cacheService, metricsCollector);
  }
  /**
   * Creates configuration from environment variables.
   * Includes validation for required configs.
   */
  private createConfigFromEnv(): IClickHouseConfig {
    const config: IClickHouseConfig = {
      url: getEnv("CLICKHOUSE_URL", "http://localhost:8123"),
      username: getEnv("CLICKHOUSE_USERNAME", "default"),
      password: getEnv("CLICKHOUSE_PASSWORD", ""),
      database: getEnv("CLICKHOUSE_DATABASE", "cart_recovery"),
      requestTimeout: getNumberEnv("CLICKHOUSE_REQUEST_TIMEOUT", 30000),
      maxOpenConnections: getNumberEnv("CLICKHOUSE_MAX_CONNECTIONS", 10),
      compression: {
        response: getBooleanEnv("CLICKHOUSE_COMPRESSION", true),
        request: getBooleanEnv("CLICKHOUSE_REQUEST_COMPRESSION", false),
      },
    };

    // Validate required fields
    if (!config.url || !config.database) {
      throw new ClickHouseError("Missing required ClickHouse configuration");
    }

    return config;
  }

  /**
   * Creates resilience configuration from environment variables.
   */
  private createResilienceConfigFromEnv(): ClickHouseResilienceConfig {
    return {
      maxRetries: getNumberEnv("CLICKHOUSE_MAX_RETRIES", 3),
      retryDelay: getNumberEnv("CLICKHOUSE_RETRY_DELAY", 1000),
      circuitBreakerThreshold: getNumberEnv(
        "CLICKHOUSE_CIRCUIT_BREAKER_THRESHOLD",
        5
      ),
      circuitBreakerTimeout: getNumberEnv(
        "CLICKHOUSE_CIRCUIT_BREAKER_TIMEOUT",
        30000
      ),
    };
  }

  /**
   * Creates query cache configuration from environment variables.
   */
  private createQueryCacheConfigFromEnv(): ClickHouseQueryCacheConfig {
    return {
      enabled: getBooleanEnv("CLICKHOUSE_QUERY_CACHE_ENABLED", true),
      defaultTTL: getNumberEnv("CLICKHOUSE_QUERY_CACHE_TTL", 300), // 5 minutes
      maxCacheSize: getNumberEnv("CLICKHOUSE_QUERY_CACHE_MAX_SIZE", 1000),
      cacheKeyPrefix: getEnv("CLICKHOUSE_QUERY_CACHE_PREFIX", "clickhouse:"),
      excludePatterns: getEnv(
        "CLICKHOUSE_QUERY_CACHE_EXCLUDE_PATTERNS",
        "INSERT,UPDATE,DELETE,CREATE,DROP,ALTER"
      ).split(","),
    };
  }

  /**
   * Generates a cache key for a query.
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

  async disconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.warn("Connection operation already in progress");
      return;
    }

    this.connectionLock = true;
    try {
      if (this.isConnected) {
        await this.client.close();
        this.isConnected = false;
        delete this.cachedVersion;
        this.versionCacheTime = 0;
      }
    } finally {
      this.connectionLock = false;
    }
  }

  async ping(): Promise<boolean> {
    const startTime = Date.now();
    try {
      const result = await this.client.ping();
      await this.metricsCollector?.recordTimer(
        "clickhouse.ping.duration",
        Date.now() - startTime
      );
      await this.metricsCollector?.recordCounter("clickhouse.ping.success", 1);
      return result.success;
    } catch (error) {
      await this.metricsCollector?.recordCounter("clickhouse.ping.error", 1);
      this.logger.error("ClickHouse ping failed", error);
      throw new ClickHouseError("Ping failed", error);
    }
  }

  async healthCheck(): Promise<IHealthCheckResult> {
    const startTime = Date.now();
    try {
      const pingResult = await this.client.ping();
      const latency = Date.now() - startTime;

      await this.metricsCollector?.recordTimer(
        "clickhouse.healthcheck.duration",
        latency
      );

      if (pingResult.success) {
        // Use cached version if available and not expired
        let version: string | undefined;
        const now = Date.now();

        if (
          this.cachedVersion &&
          now - this.versionCacheTime < this.versionCacheTTL
        ) {
          version = this.cachedVersion;
          await this.metricsCollector?.recordCounter(
            "clickhouse.version.cache_hit",
            1
          );
        } else {
          // Fetch version from database
          const versionResult = await this.client.query({
            query: "SELECT version() as version",
            format: "JSONEachRow",
          });
          const versionData: { version: string }[] = await versionResult.json<{
            version: string;
          }>();
          version = versionData[0]?.version;

          // Cache the version
          if (typeof version === "string") {
            this.cachedVersion = version;
            this.versionCacheTime = now;
            await this.metricsCollector?.recordCounter(
              "clickhouse.version.cache_miss",
              1
            );
          }
        }

        await this.metricsCollector?.recordCounter(
          "clickhouse.healthcheck.success",
          1
        );
        return {
          status: HealthStatus.HEALTHY,
          latency,
          version,
        };
      }

      await this.metricsCollector?.recordCounter(
        "clickhouse.healthcheck.unhealthy",
        1
      );
      return { status: HealthStatus.UNHEALTHY };
    } catch (error) {
      await this.metricsCollector?.recordCounter(
        "clickhouse.healthcheck.error",
        1
      );
      this.logger.error("ClickHouse health check failed", error);
      return { status: HealthStatus.UNHEALTHY };
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  async execute<T = unknown>(
    query: string,
    values?: Record<string, unknown>
  ): Promise<T> {
    if (!query.trim()) {
      throw new ClickHouseError("Query cannot be empty");
    }

    const operationName = `ClickHouse Query: ${query.substring(0, 50)}...`;
    const startTime = Date.now();

    try {
      // Execute query with resilience and metrics tracking
      const result = await executeWithRetry(
        async () => {
          const queryResult = await this.client.query({
            query,
            query_params: values ?? {},
            format: "JSONEachRow",
          });
          return queryResult.json() as T;
        },
        (error: unknown) => {
          this.logger.error("ClickHouse query failed", error);
          throw new ClickHouseError("Query execution failed", error);
        },
        {
          operationName,
          maxRetries: this.resilienceConfig.maxRetries,
          retryDelay: this.resilienceConfig.retryDelay,
          enableCircuitBreaker: true,
        }
      );

      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.query.duration",
        duration
      );
      await this.metricsCollector?.recordCounter("clickhouse.query.success", 1);

      this.logger.debug(`ClickHouse query executed successfully`, {
        query: operationName,
        duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.query.error_duration",
        duration
      );
      await this.metricsCollector?.recordCounter("clickhouse.query.error", 1);

      this.logger.error("ClickHouse query failed", error, {
        query: operationName,
        duration,
      });
      throw new ClickHouseError("Query execution failed", error);
    }
  }

  /**
   * Execute a query with optional caching support.
   * Automatically caches SELECT queries while excluding write operations.
   */
  async executeWithCache<T = unknown>(
    query: string,
    values?: Record<string, unknown>,
    options?: QueryCacheOptions
  ): Promise<T> {
    const cacheOptions = {
      useCache: this.shouldCacheQuery(query),
      ttl: this.queryCache.defaultTTL,
      ...options,
    };

    // If caching is disabled, execute directly
    if (cacheOptions.useCache === false) {
      return this.execute(query, values);
    }

    // Generate cache key
    const cacheKey =
      cacheOptions.cacheKey ??
      this.generateCacheKey(query, values ? Object.values(values) : undefined);

    try {
      // Check cache if available
      if (this.cacheService && this.shouldCacheQuery(query)) {
        const cacheResult = await this.cacheService.get<T>(cacheKey);
        if (cacheResult.data !== null) {
          await this.metricsCollector?.recordCounter("clickhouse.cache.hit", 1);
          this.logger.debug("Cache hit for ClickHouse query", { cacheKey });
          return cacheResult.data;
        }
      }

      // Execute query if not in cache
      await this.metricsCollector?.recordCounter("clickhouse.cache.miss", 1);
      const result = await this.execute<T>(query, values);

      // Store in cache if available
      if (this.cacheService) {
        await this.cacheService.set(cacheKey, result, cacheOptions.ttl);
        this.logger.debug("Cached ClickHouse query result", {
          cacheKey,
          ttl: cacheOptions.ttl,
        });
      }

      return result;
    } catch (error) {
      await this.metricsCollector?.recordCounter("clickhouse.cache.error", 1);
      this.logger.warn(
        "Cache operation failed, executing query directly",
        error
      );
      return this.execute<T>(query, values);
    }
  }

  /**
   * Invalidate cached queries matching a pattern.
   * Useful for cache invalidation after data modifications.
   */
  async invalidateCache(pattern?: string): Promise<void> {
    if (!this.cacheService) {
      this.logger.warn("Cache service not available for invalidation");
      return;
    }

    try {
      const searchPattern = pattern ?? `${this.queryCache.cacheKeyPrefix}*`;
      const invalidatedCount =
        await this.cacheService.invalidatePattern(searchPattern);
      await this.metricsCollector?.recordCounter(
        "clickhouse.cache.invalidated",
        invalidatedCount
      );
      this.logger.info("Cache invalidated", {
        pattern: searchPattern,
        invalidatedCount,
      });
    } catch (error) {
      await this.metricsCollector?.recordCounter(
        "clickhouse.cache.invalidation_error",
        1
      );
      this.logger.error("Cache invalidation failed", error);
      throw new ClickHouseError("Cache invalidation failed", error);
    }
  }

  async insert(
    table: string,
    data: Record<string, unknown>[],
    format = "JSONEachRow"
  ): Promise<void> {
    if (!table.trim() || !data.length) {
      throw new ClickHouseError("Table name and data are required");
    }

    const operationName = `ClickHouse Insert: ${table}`;
    const startTime = Date.now();

    try {
      // Execute insert with resilience and metrics tracking
      await executeWithRetry(
        async () => {
          await this.client.insert({
            table,
            values: data,
            format: format as "JSONEachRow" | "TabSeparated", // Type-safe format
          });
        },
        (error: unknown) =>
          this.logger.error("ClickHouse insert failed", error),
        { operationName, enableCircuitBreaker: true }
      );

      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.insert.duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.insert.success",
        1
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.insert.rows",
        data.length
      );

      this.logger.debug(`ClickHouse insert completed successfully`, {
        table,
        rowCount: data.length,
        duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.insert.error_duration",
        duration
      );
      await this.metricsCollector?.recordCounter("clickhouse.insert.error", 1);

      this.logger.error("ClickHouse insert failed", error, {
        table,
        rowCount: data.length,
        duration,
      });
      throw new ClickHouseError("Insert failed", error);
    }
  }

  async batchInsert(
    table: string,
    data: Record<string, unknown>[],
    options?: IBatchInsertOptions,
    format = "JSONEachRow"
  ): Promise<IBatchInsertResult> {
    if (!table.trim() || !data.length) {
      throw new ClickHouseError("Table name and data are required");
    }

    // Default options for batch processing
    const opts: IBatchInsertOptions = {
      batchSize: options?.batchSize ?? 1000,
      maxConcurrency: options?.maxConcurrency ?? 3,
      delayBetweenBatches: options?.delayBetweenBatches ?? 100,
    };

    const startTime = Date.now();
    const totalRows = data.length;
    let successfulBatches = 0;
    let failedBatches = 0;
    const errors: string[] = [];

    this.logger.info(`Starting batch insert for table ${table}`, {
      totalRows,
      batchSize: opts.batchSize,
      maxConcurrency: opts.maxConcurrency,
    });

    try {
      // Split data into batches
      const batches: Record<string, unknown>[][] = [];
      for (let i = 0; i < data.length; i += opts.batchSize) {
        batches.push(data.slice(i, i + opts.batchSize));
      }

      // Process batches with controlled concurrency
      const semaphore = new Array(opts.maxConcurrency).fill(null);
      let batchIndex = 0;

      const processBatch = async (
        batch: Record<string, unknown>[],
        index: number
      ): Promise<void> => {
        try {
          await this.insert(table, batch, format);
          successfulBatches++;

          this.logger.debug(`Batch ${index + 1}/${batches.length} completed`, {
            batchSize: batch.length,
            progress: `${(((index + 1) / batches.length) * 100).toFixed(1)}%`,
          });

          // Add delay between batches to prevent overwhelming the server
          if (opts.delayBetweenBatches > 0 && index < batches.length - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, opts.delayBetweenBatches)
            );
          }
        } catch (error) {
          failedBatches++;
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(`Batch ${index + 1}: ${errorMsg}`);

          this.logger.warn(`Batch ${index + 1} failed`, { error: errorMsg });
        }
      };

      // Execute batches with concurrency control
      const workers = semaphore.map(async () => {
        while (batchIndex < batches.length) {
          const currentIndex = batchIndex++;
          const batch = batches[currentIndex];
          if (batch) {
            await processBatch(batch, currentIndex);
          }
        }
      });

      await Promise.all(workers);

      const duration = Date.now() - startTime;
      const result: IBatchInsertResult = {
        totalRows,
        batchesProcessed: batches.length,
        duration,
        successfulBatches,
        failedBatches,
        ...(errors.length > 0 && { errors }),
      };

      // Record comprehensive metrics
      await this.metricsCollector?.recordTimer(
        "clickhouse.batch_insert.duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.total_rows",
        totalRows
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.batches_processed",
        batches.length
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.successful_batches",
        successfulBatches
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.failed_batches",
        failedBatches
      );

      this.logger.info(`Batch insert completed for table ${table}`, result);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.batch_insert.error_duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.error",
        1
      );

      this.logger.error("Batch insert failed", error, {
        table,
        totalRows,
        duration,
      });
      throw new ClickHouseError("Batch insert failed", error);
    }
  }
}

/**
 * Batch insert interface for high-throughput scenarios (Phase 3).
 */
export interface IBatchInsertOptions {
  batchSize: number;
  maxConcurrency: number;
  delayBetweenBatches: number;
}

/**
 * Result interface for batch insert operations.
 */
export interface IBatchInsertResult {
  totalRows: number;
  batchesProcessed: number;
  duration: number;
  successfulBatches: number;
  failedBatches: number;
  errors?: string[];
}

/**
 * TSyringe container registration helper.
 * Call this during application initialization to register dependencies.
 */
export const registerClickHouseDependencies = (
  container: IDependencyContainer
): void => {
  const { MetricsCollector } = require("@libs/monitoring");

  if (!container.isRegistered("IMetricsCollector")) {
    container.register("IMetricsCollector", {
      useFactory: () =>
        MetricsCollector.getInstance
          ? MetricsCollector.getInstance()
          : new MetricsCollector(),
    });
  }
};

// Pure TSyringe usage example:
// import { container } from "tsyringe";
// registerClickHouseDependencies(container);
// const client = container.resolve(ClickHouseClient);
