import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
import { createLogger } from "@libs/utils";
import { IMetricsCollector } from "@libs/monitoring";
import { ICache } from "../cache";
import {
  ClickHouseClient,
  IClickHouseClient,
  IClickHouseConfig,
} from "./clickhouseClient";

/**
 * Configuration for ClickHouse connection pool.
 */
export interface ClickHousePoolConfig {
  minConnections: number;
  maxConnections: number;
  connectionTimeout: number;
  idleTimeout: number;
  healthCheckInterval: number;
  acquireTimeout: number;
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  retryAttempts: number;
  retryDelay: number;
}

/**
 * Connection pool statistics.
 */
export interface ClickHousePoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  pendingAcquires: number;
  poolUtilization: number;
  averageWaitTime: number;
  connectionErrors: number;
  healthCheckFailures: number;
}

/**
 * Pooled ClickHouse connection wrapper that implements the IClickHouseClient interface.
 * This wrapper automatically manages connection lifecycle and returns connections to the pool.
 *
 * @example
 * ```typescript
 * const connection = await poolManager.acquireConnection();
 * try {
 *   const result = await connection.execute('SELECT * FROM events LIMIT 10');
 *   console.log(result);
 * } finally {
 *   connection.release(); // Automatically returns to pool
 * }
 * ```
 */
export class PooledClickHouseConnection implements IClickHouseClient {
  private lastUsed: number = Date.now();
  private connectionHealthy: boolean = true;
  private readonly logger = createLogger("PooledClickHouseConnection");

  /**
   * Creates a new pooled connection wrapper.
   * @param client - The underlying ClickHouse client instance
   * @param pool - The connection pool manager that owns this connection
   */
  constructor(
    private readonly client: ClickHouseClient,
    private readonly pool: ClickHouseConnectionPoolManager
  ) {}

  /**
   * Marks the connection as recently used for pool management.
   * @internal Used by the connection pool manager
   */
  markUsed(): void {
    this.lastUsed = Date.now();
  }

  /**
   * Marks the connection as unhealthy, preventing its reuse.
   * @internal Used by the connection pool manager during health checks
   */
  markUnhealthy(): void {
    this.connectionHealthy = false;
  }

  /**
   * Checks if the connection is currently healthy.
   * @returns true if the connection is healthy and can be reused
   * @internal Used by the connection pool manager
   */
  isConnectionHealthy(): boolean {
    return this.connectionHealthy;
  }

  /**
   * Gets the timestamp of when this connection was last used.
   * @returns Unix timestamp in milliseconds
   * @internal Used by the connection pool manager for idle timeout logic
   */
  getLastUsed(): number {
    return this.lastUsed;
  }

  /**
   * Disconnects the underlying ClickHouse client connection.
   * @returns Promise that resolves when the connection is closed
   */
  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  /**
   * Pings the ClickHouse server to check connectivity.
   * @returns Promise that resolves to true if the server responds
   */
  ping(): Promise<boolean> {
    return this.client.ping();
  }

  /**
   * Performs a comprehensive health check on the connection.
   * @returns Promise that resolves to health check results
   */
  healthCheck(): Promise<import("./clickhouseClient").IHealthCheckResult> {
    return this.client.healthCheck();
  }

  /**
   * Checks if the connection is currently healthy.
   * @returns true if the connection is healthy
   */
  isHealthy(): boolean {
    return this.client.isHealthy();
  }

  /**
   * Executes a SQL query and returns the results.
   * @param query - The SQL query to execute
   * @param values - Optional parameter values for parameterized queries
   * @returns Promise that resolves to query results
   * @template T - The expected return type of the query results
   */
  execute<T = unknown>(
    query: string,
    values?: Record<string, unknown>
  ): Promise<T> {
    return this.client.execute(query, values);
  }

  /**
   * Inserts data into a ClickHouse table.
   * @param table - The name of the table to insert into
   * @param data - Array of records to insert
   * @param format - Optional data format (defaults to JSONEachRow)
   * @returns Promise that resolves when the insert is complete
   */
  insert(
    table: string,
    data: Record<string, unknown>[],
    format?: string
  ): Promise<void> {
    return this.client.insert(table, data, format);
  }

  /**
   * Performs a batch insert operation with advanced options.
   * @param table - The name of the table to insert into
   * @param data - Array of records to insert
   * @param options - Batch insert configuration options
   * @param format - Optional data format (defaults to JSONEachRow)
   * @returns Promise that resolves to batch insert results
   */
  batchInsert(
    table: string,
    data: Record<string, unknown>[],
    options?: import("./clickhouseClient").IBatchInsertOptions,
    format?: string
  ): Promise<import("./clickhouseClient").IBatchInsertResult> {
    return this.client.batchInsert(table, data, options, format);
  }

  /**
   * Releases the connection back to the pool.
   * This method should be called when the connection is no longer needed.
   * The connection will be returned to the pool for reuse or closed if unhealthy.
   */
  public release(): void {
    this.pool.releaseConnection(this).catch((error) => {
      this.logger.error("Failed to release connection back to pool", {
        error: error.message,
      });
    });
  }
}

/**
 * ClickHouse Connection Pool Manager for high-throughput analytics systems.
 * Provides connection pooling, health monitoring, load balancing, and metrics collection.
 *
 * @example
 * ```typescript
 * // Basic usage with default configuration
 * const poolManager = ClickHouseConnectionPoolManager.create();
 * await poolManager.initialize();
 *
 * // Acquire and use a connection
 * const connection = await poolManager.acquireConnection();
 * try {
 *   const result = await connection.execute('SELECT * FROM events LIMIT 10');
 *   console.log(result);
 * } finally {
 *   connection.release(); // Return to pool
 * }
 *
 * // Shutdown when done
 * await poolManager.shutdown();
 * ```
 *
 * @example
 * ```typescript
 * // Advanced configuration
 * const poolManager = new ClickHouseConnectionPoolManager({
 *   minConnections: 10,
 *   maxConnections: 100,
 *   healthCheckInterval: 15000,
 *   acquireTimeout: 30000
 * }, metricsCollector, cacheService);
 *
 * await poolManager.initialize();
 *
 * // Monitor pool health
 * setInterval(() => {
 *   const stats = poolManager.getPoolStats();
 *   console.log(`Pool utilization: ${stats.poolUtilization}%`);
 * }, 5000);
 * ```
 */
export class ClickHouseConnectionPoolManager {
  private pool: PooledClickHouseConnection[] = [];
  private activeConnections = 0;
  private pendingAcquires: Array<{
    resolve: (connection: PooledClickHouseConnection) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private isShuttingDown = false;
  private healthCheckTimer?: NodeJS.Timeout;
  private connectionErrors = 0;
  private healthCheckFailures = 0;
  private totalWaitTime = 0;
  private totalWaits = 0;

  private readonly config: ClickHousePoolConfig;
  private readonly baseConfig: IClickHouseConfig;
  private readonly logger = createLogger("ClickHouseConnectionPool");
  private readonly metricsCollector?: IMetricsCollector;

  /**
   * Creates a new ClickHouse Connection Pool Manager.
   *
   * @param config - Optional partial configuration. Missing values will use environment variables or defaults
   * @param metricsCollector - Optional metrics collector for monitoring pool performance
   * @param cacheService - Optional cache service for query result caching
   *
   * @example
   * ```typescript
   * // Using environment variables (recommended for production)
   * const poolManager = new ClickHouseConnectionPoolManager();
   *
   * // Custom configuration
   * const poolManager = new ClickHouseConnectionPoolManager({
   *   minConnections: 10,
   *   maxConnections: 100,
   *   acquireTimeout: 30000
   * });
   * ```
   */
  constructor(
    config?: Partial<ClickHousePoolConfig>,
    metricsCollector?: IMetricsCollector,
    private readonly cacheService?: ICache
  ) {
    this.config = this.createPoolConfig(config);
    this.baseConfig = this.createBaseConfig();
    if (metricsCollector) {
      this.metricsCollector = metricsCollector;
    }

    this.logger.info("ClickHouse Connection Pool Manager initialized", {
      config: this.config,
      baseConfig: {
        url: this.baseConfig.url,
        database: this.baseConfig.database,
        maxOpenConnections: this.baseConfig.maxOpenConnections,
      },
    });
  }

  /**
   * Create pool configuration from environment variables and provided config.
   */
  private createPoolConfig(
    config?: Partial<ClickHousePoolConfig>
  ): ClickHousePoolConfig {
    return {
      minConnections:
        config?.minConnections ??
        getNumberEnv("CLICKHOUSE_POOL_MIN_CONNECTIONS", 5),
      maxConnections:
        config?.maxConnections ??
        getNumberEnv("CLICKHOUSE_POOL_MAX_CONNECTIONS", 50),
      connectionTimeout:
        config?.connectionTimeout ??
        getNumberEnv("CLICKHOUSE_POOL_CONNECTION_TIMEOUT", 30000),
      idleTimeout:
        config?.idleTimeout ??
        getNumberEnv("CLICKHOUSE_POOL_IDLE_TIMEOUT", 300000), // 5 minutes
      healthCheckInterval:
        config?.healthCheckInterval ??
        getNumberEnv("CLICKHOUSE_POOL_HEALTH_CHECK_INTERVAL", 30000),
      acquireTimeout:
        config?.acquireTimeout ??
        getNumberEnv("CLICKHOUSE_POOL_ACQUIRE_TIMEOUT", 60000),
      enableCircuitBreaker:
        config?.enableCircuitBreaker ??
        getBooleanEnv("CLICKHOUSE_POOL_CIRCUIT_BREAKER", true),
      circuitBreakerThreshold:
        config?.circuitBreakerThreshold ??
        getNumberEnv("CLICKHOUSE_POOL_CIRCUIT_BREAKER_THRESHOLD", 10),
      retryAttempts:
        config?.retryAttempts ??
        getNumberEnv("CLICKHOUSE_POOL_RETRY_ATTEMPTS", 3),
      retryDelay:
        config?.retryDelay ?? getNumberEnv("CLICKHOUSE_POOL_RETRY_DELAY", 1000),
    };
  }

  /**
   * Create base ClickHouse configuration.
   */
  private createBaseConfig(): IClickHouseConfig {
    return {
      url: getEnv("CLICKHOUSE_URL", "http://localhost:8123"),
      username: getEnv("CLICKHOUSE_USERNAME", "default"),
      password: getEnv("CLICKHOUSE_PASSWORD", ""),
      database: getEnv("CLICKHOUSE_DATABASE", "analytics"),
      requestTimeout: getNumberEnv("CLICKHOUSE_REQUEST_TIMEOUT", 30000),
      maxOpenConnections: this.config.maxConnections,
      compression: {
        response: getBooleanEnv("CLICKHOUSE_COMPRESSION", true),
        request: getBooleanEnv("CLICKHOUSE_REQUEST_COMPRESSION", false),
      },
    };
  }

  /**
   * Initializes the connection pool by creating minimum connections and starting health checks.
   * This method must be called before using the pool.
   *
   * @throws Error if the pool is shutting down
   * @returns Promise that resolves when the pool is ready for use
   *
   * @example
   * ```typescript
   * const poolManager = ClickHouseConnectionPoolManager.create();
   * await poolManager.initialize(); // Must call this first
   *
   * // Now you can acquire connections
   * const connection = await poolManager.acquireConnection();
   * ```
   */
  async initialize(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error("Pool is shutting down");
    }

    this.logger.info("Initializing ClickHouse connection pool", {
      minConnections: this.config.minConnections,
      maxConnections: this.config.maxConnections,
    });

    // Create minimum connections
    const initialConnections = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      try {
        const connection = await this.createConnection();
        initialConnections.push(connection);
      } catch (error) {
        this.logger.error(
          `Failed to create initial connection ${i + 1}`,
          error
        );
        this.connectionErrors++;
      }
    }

    this.pool.push(...initialConnections);
    this.activeConnections = initialConnections.length;

    this.logger.info(
      `Created ${initialConnections.length} initial connections`
    );

    // Start health check timer
    this.startHealthChecks();

    // Record initial metrics
    this.recordPoolMetrics();
  }

  /**
   * Create a new ClickHouse connection.
   */
  private async createConnection(): Promise<PooledClickHouseConnection> {
    const client = ClickHouseClient.create(
      this.cacheService,
      this.metricsCollector
    );
    const pooledConnection = new PooledClickHouseConnection(client, this);

    // Test the connection
    try {
      const isHealthy = await client.ping();
      if (!isHealthy) {
        throw new Error("Connection ping failed");
      }
    } catch (error) {
      this.connectionErrors++;
      throw new Error(`Failed to create connection: ${error}`);
    }

    return pooledConnection;
  }

  /**
   * Acquires a connection from the pool. If no connections are available and the pool
   * hasn't reached maxConnections, a new connection will be created. If all connections
   * are in use, the request will wait until one becomes available or acquireTimeout is reached.
   *
   * @throws Error if the pool is shutting down or acquire timeout is exceeded
   * @returns Promise that resolves to a pooled connection ready for use
   *
   * @example
   * ```typescript
   * const connection = await poolManager.acquireConnection();
   * try {
   *   const result = await connection.execute('SELECT * FROM events LIMIT 100');
   *   console.log('Query result:', result);
   * } finally {
   *   connection.release(); // Always release back to pool
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Using with async/await and proper error handling
   * async function queryAnalytics() {
   *   let connection: PooledClickHouseConnection | undefined;
   *   try {
   *     connection = await poolManager.acquireConnection();
   *     return await connection.execute('SELECT COUNT(*) FROM user_events');
   *   } catch (error) {
   *     console.error('Query failed:', error);
   *     throw error;
   *   } finally {
   *     connection?.release();
   *   }
   * }
   * ```
   */
  async acquireConnection(): Promise<PooledClickHouseConnection> {
    if (this.isShuttingDown) {
      throw new Error("Pool is shutting down");
    }

    const startTime = Date.now();

    // Try to get an idle connection first
    const idleConnection = this.pool.find((conn) => conn.isConnectionHealthy());
    if (idleConnection) {
      idleConnection.markUsed();
      this.recordWaitTime(Date.now() - startTime);
      this.recordPoolMetrics();
      return idleConnection;
    }

    // Check if we can create a new connection
    if (this.activeConnections < this.config.maxConnections) {
      try {
        const newConnection = await this.createConnection();
        this.pool.push(newConnection);
        this.activeConnections++;
        newConnection.markUsed();
        this.recordWaitTime(Date.now() - startTime);
        this.recordPoolMetrics();
        return newConnection;
      } catch (error) {
        this.logger.error("Failed to create new connection", error);
        this.connectionErrors++;
      }
    }

    // Wait for an available connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from pending queue
        const index = this.pendingAcquires.findIndex(
          (p) => p.timeout === timeout
        );
        if (index !== -1) {
          this.pendingAcquires.splice(index, 1);
        }
        reject(
          new Error(
            `Connection acquire timeout after ${this.config.acquireTimeout}ms`
          )
        );
      }, this.config.acquireTimeout);

      this.pendingAcquires.push({ resolve, reject, timeout });
    });
  }

  /**
   * Releases a connection back to the pool for reuse by other requests.
   * The connection will be kept alive for future use unless the pool is over capacity
   * or the connection has been idle too long.
   *
   * @param connection - The pooled connection to release back to the pool
   * @returns Promise that resolves when the connection is returned to the pool
   *
   * @example
   * ```typescript
   * const connection = await poolManager.acquireConnection();
   * try {
   *   await connection.execute('INSERT INTO events VALUES (...)');
   * } finally {
   *   await poolManager.releaseConnection(connection);
   *   // Or use connection.release() which does the same thing
   * }
   * ```
   */
  async releaseConnection(
    connection: PooledClickHouseConnection
  ): Promise<void> {
    if (this.isShuttingDown) {
      // Close the connection if shutting down
      await connection.disconnect();
      this.activeConnections--;
      this.recordPoolMetrics();
      return;
    }

    // Check if there are pending acquires
    const pending = this.pendingAcquires.shift();
    if (pending) {
      connection.markUsed();
      pending.resolve(connection);
      return;
    }

    // Return to pool if under minimum connections or recently used
    const timeSinceLastUse = Date.now() - connection.getLastUsed();
    if (
      this.pool.length < this.config.minConnections ||
      timeSinceLastUse < this.config.idleTimeout
    ) {
      // Keep in pool
      return;
    }

    // Close excess connection
    await connection.disconnect();
    this.activeConnections--;
    this.recordPoolMetrics();
  }

  /**
   * Gets current statistics about the connection pool's state and performance.
   * Useful for monitoring pool health, utilization, and debugging performance issues.
   *
   * @returns Current pool statistics including connection counts, utilization, and error metrics
   *
   * @example
   * ```typescript
   * const stats = poolManager.getPoolStats();
   * console.log(`Pool utilization: ${stats.poolUtilization}%`);
   * console.log(`Active connections: ${stats.activeConnections}`);
   * console.log(`Pending requests: ${stats.pendingAcquires}`);
   *
   * if (stats.poolUtilization > 90) {
   *   console.warn('Pool is heavily utilized, consider increasing maxConnections');
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Monitor pool health in a dashboard
   * setInterval(() => {
   *   const stats = poolManager.getPoolStats();
   *   metrics.gauge('clickhouse.pool.utilization', stats.poolUtilization);
   *   metrics.gauge('clickhouse.pool.active', stats.activeConnections);
   *   metrics.gauge('clickhouse.pool.errors', stats.connectionErrors);
   * }, 30000);
   * ```
   */
  getPoolStats(): ClickHousePoolStats {
    const idleConnections = this.pool.length;
    const utilization =
      this.activeConnections > 0
        ? (this.activeConnections /
            (this.activeConnections + idleConnections)) *
          100
        : 0;

    return {
      totalConnections: this.activeConnections,
      activeConnections: this.activeConnections - idleConnections,
      idleConnections,
      pendingAcquires: this.pendingAcquires.length,
      poolUtilization: utilization,
      averageWaitTime:
        this.totalWaits > 0 ? this.totalWaitTime / this.totalWaits : 0,
      connectionErrors: this.connectionErrors,
      healthCheckFailures: this.healthCheckFailures,
    };
  }

  /**
   * Start periodic health checks.
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health checks on all connections.
   */
  private async performHealthChecks(): Promise<void> {
    const unhealthyConnections: PooledClickHouseConnection[] = [];

    for (const connection of this.pool) {
      try {
        const isHealthy = await connection.ping();
        if (!isHealthy) {
          connection.markUnhealthy();
          unhealthyConnections.push(connection);
        }
      } catch (error) {
        this.logger.warn("Connection health check failed", error);
        connection.markUnhealthy();
        unhealthyConnections.push(connection);
        this.healthCheckFailures++;
      }
    }

    // Remove unhealthy connections
    for (const unhealthy of unhealthyConnections) {
      const index = this.pool.indexOf(unhealthy);
      if (index !== -1) {
        this.pool.splice(index, 1);
        await unhealthy.disconnect();
        this.activeConnections--;
      }
    }

    // Create replacement connections if needed
    const connectionsToCreate = Math.min(
      unhealthyConnections.length,
      this.config.maxConnections - this.activeConnections
    );

    for (let i = 0; i < connectionsToCreate; i++) {
      try {
        const newConnection = await this.createConnection();
        this.pool.push(newConnection);
        this.activeConnections++;
      } catch (error) {
        this.logger.error("Failed to create replacement connection", error);
        this.connectionErrors++;
      }
    }

    this.recordPoolMetrics();
  }

  /**
   * Record wait time for metrics.
   */
  private recordWaitTime(waitTime: number): void {
    this.totalWaitTime += waitTime;
    this.totalWaits++;
  }

  /**
   * Record pool metrics.
   */
  private recordPoolMetrics(): void {
    if (!this.metricsCollector) return;

    const stats = this.getPoolStats();

    this.metricsCollector.recordGauge(
      "clickhouse.pool.total_connections",
      stats.totalConnections
    );
    this.metricsCollector.recordGauge(
      "clickhouse.pool.active_connections",
      stats.activeConnections
    );
    this.metricsCollector.recordGauge(
      "clickhouse.pool.idle_connections",
      stats.idleConnections
    );
    this.metricsCollector.recordGauge(
      "clickhouse.pool.pending_acquires",
      stats.pendingAcquires
    );
    this.metricsCollector.recordGauge(
      "clickhouse.pool.utilization",
      stats.poolUtilization
    );
    this.metricsCollector.recordGauge(
      "clickhouse.pool.average_wait_time",
      stats.averageWaitTime
    );
    this.metricsCollector.recordCounter(
      "clickhouse.pool.connection_errors",
      stats.connectionErrors
    );
    this.metricsCollector.recordCounter(
      "clickhouse.pool.health_check_failures",
      stats.healthCheckFailures
    );
  }

  /**
   * Gracefully shuts down the connection pool, closing all connections and stopping health checks.
   * Any pending acquire requests will be rejected with an error.
   *
   * This method should be called when your application is shutting down to ensure
   * proper cleanup of database connections.
   *
   * @returns Promise that resolves when all connections are closed and cleanup is complete
   *
   * @example
   * ```typescript
   * // Graceful shutdown in an Express app
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down gracefully...');
   *   await poolManager.shutdown();
   *   process.exit(0);
   * });
   *
   * // Or in a cleanup function
   * async function cleanup() {
   *   await poolManager.shutdown();
   *   console.log('Connection pool shut down');
   * }
   * ```
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down ClickHouse connection pool");
    this.isShuttingDown = true;

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Reject all pending acquires
    for (const pending of this.pendingAcquires) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Pool is shutting down"));
    }
    this.pendingAcquires = [];

    // Close all connections
    const closePromises = this.pool.map((connection) =>
      connection.disconnect()
    );
    await Promise.allSettled(closePromises);

    this.pool = [];
    this.activeConnections = 0;

    this.logger.info("ClickHouse connection pool shutdown complete");
  }

  /**
   * Factory method to create a new ClickHouse Connection Pool Manager instance.
   * This is the recommended way to create pool managers as it provides a clean API.
   *
   * @param config - Optional partial configuration for the pool
   * @param metricsCollector - Optional metrics collector for monitoring
   * @param cacheService - Optional cache service for query caching
   * @returns A new configured ClickHouseConnectionPoolManager instance
   *
   * @example
   * ```typescript
   * // Simple creation with defaults
   * const poolManager = ClickHouseConnectionPoolManager.create();
   *
   * // With custom configuration
   * const poolManager = ClickHouseConnectionPoolManager.create({
   *   minConnections: 5,
   *   maxConnections: 50,
   *   healthCheckInterval: 30000
   * });
   *
   * // With metrics and caching
   * const poolManager = ClickHouseConnectionPoolManager.create(
   *   { minConnections: 10 },
   *   prometheusMetrics,
   *   redisCache
   * );
   * ```
   */
  static create(
    config?: Partial<ClickHousePoolConfig>,
    metricsCollector?: IMetricsCollector,
    cacheService?: ICache
  ): ClickHouseConnectionPoolManager {
    return new ClickHouseConnectionPoolManager(
      config,
      metricsCollector,
      cacheService
    );
  }
}
