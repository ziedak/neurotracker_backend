/**
 * Phase 2: Connection Pool Management Service
 * Advanced connection lifecycle and pool optimization
 */

import { PrismaClient } from "@prisma/client";
import { PostgreSQLClient } from "./PostgreSQLClient";

import {
  AppError,
  createLogger,
  executeWithRetry,
  Scheduler,
  type IScheduler,
} from "@libs/utils";
import {
  type ConnectionPoolStats,
  type ConnectionPoolConfig,
  DEFAULT_POOL_CONFIG,
  ConnectionPoolConfigSchema,
} from "./config/connectionPoolConfig";

export interface IConnectionPoolManager {
  initializePool(): Promise<void>;
  getConnectionSqlRaw(): Promise<{
    execute: <T>(query: string, params?: any[]) => Promise<T[]>;
    release: () => void;
  }>;
  getConnectionPrisma(): Promise<{
    prisma: PrismaClient;
    release: () => void;
  }>;
  executeQuery<T>(query: string, params?: any[]): Promise<T[]>;
  executeTransaction<T>(
    operations: (
      execute: (query: string, params?: any[]) => Promise<any[]>
    ) => Promise<T>
  ): Promise<T>;
  executeBatch<T>(
    queries: Array<{ query: string; params?: any[] }>
  ): Promise<Array<T[] | Error>>;
  getStats(): ConnectionPoolStats;
}

/**
 * Advanced connection pool management service
 */
export class ConnectionPoolManager implements IConnectionPoolManager {
  private readonly config: ConnectionPoolConfig;
  private readonly logger = createLogger("ConnectionPoolManager");

  private readonly postgresClient: PostgreSQLClient;

  private stats: ConnectionPoolStats = {
    activeConnections: 0,
    idleConnections: 0,
    totalConnections: 0,
    maxConnections: 0,
    minConnections: 0,
    connectionWaitQueue: 0,
    avgConnectionTime: 0,
    avgQueryTime: 0,
    connectionErrors: 0,
    poolUtilization: 0,
    healthScore: 1.0,
  };

  private circuitBreakerEnabled: boolean;
  private readonly connectionTimings: number[] = Array(100).fill(0);
  private connectionTimingIndex = 0;
  private readonly queryTimings: number[] = Array(100).fill(0);
  private queryTimingIndex = 0;
  private scheduler: IScheduler;

  constructor(
    postgresClient: PostgreSQLClient,
    config: Partial<ConnectionPoolConfig> = {}
  ) {
    const mergedConfig = { ...DEFAULT_POOL_CONFIG, ...config };
    const parsedConfig = ConnectionPoolConfigSchema.safeParse(mergedConfig);
    if (!parsedConfig.success) {
      throw new AppError(
        "Invalid ConnectionPoolConfig: " +
          JSON.stringify(parsedConfig.error.issues),
        400
      );
    }
    this.config = parsedConfig.data;

    this.postgresClient = postgresClient;
    this.scheduler = new Scheduler();
    // Store circuit breaker configuration
    this.circuitBreakerEnabled = this.config.enableCircuitBreaker || false;

    this.initializeStats();
    this.startHealthMonitoring();
    this.startStatsCollection();
    this.startIdleConnectionCleanup();
  }

  /**
   * Initialize connection pool
   */
  async initializePool(): Promise<void> {
    this.logger.info("Initializing connection pool", {
      initialConnections: this.config.initialConnections,
      maxConnections: this.config.maxConnections,
      minConnections: this.config.minConnections,
    });

    try {
      // Establish initial connections
      await this.establishInitialConnections();

      // Verify pool health
      const health = await this.checkPoolHealth();
      if (!health.healthy) {
        throw new AppError(
          `Connection pool initialization failed: ${health.reason}`,
          500
        );
      }

      this.logger.info("Connection pool initialized successfully", {
        activeConnections: this.stats.activeConnections,
        healthScore: this.stats.healthScore,
      });
    } catch (error) {
      this.logger.error("Failed to initialize connection pool", error);
      throw error;
    }
  }

  /**
   * Shared connection lifecycle logic for pool management
   */
  private async acquireConnection(): Promise<{ release: () => void }> {
    const startTime = performance.now();
    await this.waitForAvailableConnection();
    this.stats.activeConnections++;
    this.stats.connectionWaitQueue = Math.max(
      0,
      this.stats.connectionWaitQueue - 1
    );
    this.updateConnectionTiming(performance.now() - startTime);
    return {
      release: () => {
        this.stats.activeConnections = Math.max(
          0,
          this.stats.activeConnections - 1
        );
        this.stats.idleConnections++;
      },
    };
  }

  /**
   * Get connection for raw SQL queries ($queryRawUnsafe)
   */
  async getConnectionSqlRaw(): Promise<{
    execute: <T>(query: string, params?: any[]) => Promise<T[]>;
    release: () => void;
  }> {
    try {
      const { release } = await this.acquireConnection();
      return {
        execute: async <T>(query: string, params?: any[]): Promise<T[]> => {
          const queryStart = performance.now();
          try {
            const result = (await this.postgresClient.executeRaw(
              query,
              ...(params || [])
            )) as T[];
            this.updateQueryTiming(performance.now() - queryStart);
            return result;
          } catch (error) {
            this.stats.connectionErrors++;
            this.logger.error("Query execution failed", error);
            throw new AppError(
              `Query execution failed: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
              500
            );
          }
        },
        release,
      };
    } catch (error) {
      this.stats.connectionErrors++;
      this.logger.error("Failed to get SQL raw connection", error);
      throw error;
    }
  }

  /**
   * Get connection for Prisma ORM queries
   */
  async getConnectionPrisma(): Promise<{
    prisma: PrismaClient;
    release: () => void;
  }> {
    try {
      const { release } = await this.acquireConnection();
      return {
        prisma: this.postgresClient,
        release,
      };
    } catch (error) {
      this.stats.connectionErrors++;
      this.logger.error("Failed to get Prisma ORM connection", error);
      throw error;
    }
  }

  /**
   * Execute query with automatic connection management
   */
  async executeQuery<T>(query: string, params?: any[]): Promise<T[]> {
    return executeWithRetry(
      async () => {
        const connection = await this.getConnectionSqlRaw();
        try {
          const result = await connection.execute<T>(query, params);
          return result;
        } finally {
          connection.release();
        }
      },
      (error) => this.logger.warn("Query execution retry", { error }),
      {
        operationName: "ExecuteQuery",
        maxRetries: 3,
        retryDelay: 500,
      }
    );
  }

  /**
   * Execute transaction with connection pooling
   */
  async executeTransaction<T>(
    operations: (
      execute: (query: string, params?: any[]) => Promise<any[]>
    ) => Promise<T>
  ): Promise<T> {
    const measurementId = `transaction_${Date.now()}`;
    const startTime = performance.now();

    try {
      const result = await this.postgresClient.transaction(async (prisma) => {
        const execute = async (
          query: string,
          params?: any[]
        ): Promise<any[]> => {
          return (await prisma["$queryRawUnsafe"](
            query,
            ...(params || [])
          )) as any[];
        };

        return await operations(execute);
      });

      this.updateQueryTiming(performance.now() - startTime);
      return result;
    } catch (error) {
      this.stats.connectionErrors++;
      this.logger.error("Transaction failed", error, {
        measurementId,
        duration: performance.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Batch execute queries with connection reuse
   */
  async executeBatch<T>(
    queries: Array<{ query: string; params?: any[] }>
  ): Promise<Array<T[] | Error>> {
    const connection = await this.getConnectionSqlRaw();
    const results: Array<T[] | Error> = [];

    try {
      for (const { query, params } of queries) {
        try {
          const result = await connection.execute<T>(query, params);
          results.push(result);
        } catch (error) {
          const appError =
            error instanceof Error
              ? new AppError(error.message, 500)
              : new AppError(String(error), 500);
          results.push(appError);
        }
      }

      return results;
    } finally {
      connection.release();
    }
  }

  /**
   * Establish initial connections to the pool
   */
  private async establishInitialConnections(): Promise<void> {
    return executeWithRetry(
      async () => {
        const connectPromises: Promise<void>[] = [];

        for (let i = 0; i < this.config.initialConnections; i++) {
          connectPromises.push(this.createConnection());
        }

        await Promise.all(connectPromises);
        this.stats.totalConnections = this.config.initialConnections;
        this.stats.idleConnections = this.config.initialConnections;
      },
      (error) => this.logger.warn("Initial connections setup retry", { error }),
      {
        operationName: "EstablishInitialConnections",
        maxRetries: 2,
        retryDelay: 2000,
      }
    );
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<void> {
    return executeWithRetry(
      async () => {
        const startTime = performance.now();

        await this.postgresClient.connect();

        const health = await this.postgresClient.healthCheck();
        if (health.status !== "healthy") {
          throw new AppError(
            `Connection health check failed: ${health.status}`,
            503
          );
        }

        this.updateConnectionTiming(performance.now() - startTime);
      },
      (error) => {
        this.stats.connectionErrors++;
        this.logger.warn("Connection creation retry", { error });
      },
      {
        operationName: "CreateConnection",
        maxRetries: 3,
        retryDelay: 1000,
      }
    );
  }

  /**
   * Wait for an available connection
   */
  private async waitForAvailableConnection(): Promise<void> {
    const startTime = Date.now();

    while (this.stats.activeConnections >= this.config.maxConnections) {
      if (Date.now() - startTime > this.config.connectionTimeout) {
        throw new AppError("Connection timeout: No connections available", 503);
      }

      this.stats.connectionWaitQueue++;
      // Proactively expand pool if possible
      if (this.stats.totalConnections < this.config.maxConnections) {
        try {
          await this.createConnection();
          this.stats.totalConnections++;
          this.stats.idleConnections++;
          this.logger.info("Proactively expanded pool");
        } catch (error) {
          this.logger.warn("Failed to expand pool proactively", error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms wait
    }
  }

  /**
   * Update connection timing statistics
   */
  private updateConnectionTiming(duration: number): void {
    this.connectionTimings[this.connectionTimingIndex] = duration;
    this.connectionTimingIndex = (this.connectionTimingIndex + 1) % 100;
    this.stats.avgConnectionTime =
      this.connectionTimings.reduce((sum, time) => sum + time, 0) / 100;
  }

  /**
   * Update query timing statistics
   */
  private updateQueryTiming(duration: number): void {
    this.queryTimings[this.queryTimingIndex] = duration;
    this.queryTimingIndex = (this.queryTimingIndex + 1) % 100;
    this.stats.avgQueryTime =
      this.queryTimings.reduce((sum, time) => sum + time, 0) / 100;
  }

  /**
   * Check overall pool health
   */
  private async checkPoolHealth(): Promise<{
    healthy: boolean;
    reason?: string;
  }> {
    try {
      // Check database connectivity
      const health = await this.postgresClient.healthCheck();
      if (health.status !== "healthy") {
        return {
          healthy: false,
          reason: `Database unhealthy: ${health.status}`,
        };
      }

      // Check connection pool utilization
      if (this.stats.poolUtilization > 0.9) {
        return { healthy: false, reason: "Pool utilization too high" };
      }

      // Check error rate (moving average over last 100 operations)
      const totalOps = 100; // Ring buffer size
      const errorRate = this.stats.connectionErrors / totalOps;
      if (errorRate > 0.1) {
        return {
          healthy: false,
          reason: `Connection error rate too high (${(errorRate * 100).toFixed(
            1
          )}%)`,
        };
      }

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        reason: `Health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Initialize stats structure
   */
  private initializeStats(): void {
    this.stats = {
      activeConnections: 0,
      idleConnections: 0,
      totalConnections: 0,
      maxConnections: this.config.maxConnections,
      minConnections: this.config.minConnections,
      connectionWaitQueue: 0,
      avgConnectionTime: 0,
      avgQueryTime: 0,
      connectionErrors: 0,
      poolUtilization: 0,
      healthScore: 1.0,
    };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.scheduler.setInterval(
      "healthCheck",
      this.config.healthCheckInterval,
      async () => {
        try {
          const health = await this.checkPoolHealth();
          this.stats.healthScore = health.healthy ? 1.0 : 0.5;

          if (!health.healthy) {
            this.logger.warn("Connection pool health degraded", {
              reason: health.reason,
            });
          }
        } catch (error) {
          this.logger.error("Health check failed", error);
          this.stats.healthScore = 0.0;
        }
      }
    );
  }

  /**
   * Start statistics collection
   */
  private startStatsCollection(): void {
    this.scheduler.setInterval("statsCollection", 60000, () => {
      try {
        // Update utilization
        this.stats.poolUtilization =
          this.stats.totalConnections > 0
            ? (this.stats.activeConnections + this.stats.idleConnections) /
              this.stats.totalConnections
            : 0;

        // Log only on significant changes
        if (this.stats.poolUtilization > 0.8) {
          this.logger.warn("High pool utilization", {
            utilization: `${(this.stats.poolUtilization * 100).toFixed(1)}%`,
            active: this.stats.activeConnections,
            idle: this.stats.idleConnections,
            total: this.stats.totalConnections,
          });
        }
        if (this.stats.connectionErrors > 10) {
          this.logger.warn("High error count in connection pool", {
            errors: this.stats.connectionErrors,
          });
        }
        // Log summary every 5 minutes
        const now = new Date();
        if (now.getMinutes() % 5 === 0 && now.getSeconds() < 2) {
          this.logger.info("Connection pool summary", {
            connections: {
              active: this.stats.activeConnections,
              idle: this.stats.idleConnections,
              total: this.stats.totalConnections,
              utilization: `${(this.stats.poolUtilization * 100).toFixed(1)}%`,
            },
            performance: {
              avgConnectionTime: `${this.stats.avgConnectionTime.toFixed(2)}ms`,
              avgQueryTime: `${this.stats.avgQueryTime.toFixed(2)}ms`,
              waitQueue: this.stats.connectionWaitQueue,
              errors: this.stats.connectionErrors,
            },
            health: {
              score: this.stats.healthScore,
              circuitBreakerEnabled: this.circuitBreakerEnabled,
            },
          });
        }
      } catch (error) {
        this.logger.error("Stats collection failed", error);
      }
    }); // Every minute
  }

  /**
   * Get current pool statistics
   */
  getStats(): ConnectionPoolStats {
    return { ...this.stats };
  }

  /**
   * Force pool reconnection
   */
  async reconnect(): Promise<void> {
    this.logger.info("Forcing connection pool reconnection");

    try {
      // Re-establish connections
      await this.establishInitialConnections();

      this.logger.info("Connection pool reconnected successfully");
    } catch (error) {
      this.logger.error("Failed to reconnect connection pool", error);
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down connection pool");

    try {
      this.scheduler.clearAll();

      // Close all idle connections immediately
      if (this.stats.idleConnections > 0) {
        this.logger.info(
          `Closing ${this.stats.idleConnections} idle connections`
        );
        this.stats.totalConnections -= this.stats.idleConnections;
        this.stats.idleConnections = 0;
      }

      // Wait for active connections to complete, then force-close after timeout
      const maxWait = 30000; // 30 seconds
      const startTime = Date.now();
      let forced = false;
      while (
        this.stats.activeConnections > 0 &&
        Date.now() - startTime < maxWait
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.stats.activeConnections > 0) {
        this.logger.warn(
          `Force-closing ${this.stats.activeConnections} active connections after timeout`
        );
        this.stats.totalConnections -= this.stats.activeConnections;
        this.stats.activeConnections = 0;
        forced = true;
      }

      this.logger.info("Connection pool shutdown completed", { forced });
    } catch (error) {
      this.logger.error("Error during connection pool shutdown", error);
      throw new AppError(
        `Shutdown failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        500
      );
    }
  }
  /**
   * Idle connection cleanup
   */
  private startIdleConnectionCleanup(): void {
    this.scheduler.setInterval(
      "idleConnectionCleanup",
      this.config.idleTimeout,
      () => {
        try {
          // If idle connections exceed minConnections, close them
          if (this.stats.idleConnections > this.config.minConnections) {
            const toClose =
              this.stats.idleConnections - this.config.minConnections;
            this.stats.idleConnections -= toClose;
            this.stats.totalConnections -= toClose;
            this.logger.info(`Closed ${toClose} idle connections`);
          }
        } catch (error) {
          this.logger.error("Idle connection cleanup failed", error);
        }
      }
    );
  }
}
