/**
 * Phase 2: PostgreSQL Connection Manager
 * Advanced connection lifecycle and monitoring with circuit breaker
 */

import { PrismaClient } from "@prisma/client";
import { PostgreSQLClient } from "./PostgreSQLClient";
import { PostgreSQLConnectionPool } from "./PostgreSQLConnectionPool";

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

export interface IConnectionManager {
  initialize(): Promise<void>;
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
 * Advanced PostgreSQL connection manager with real connection pooling and monitoring
 */
export class PostgreSQLConnectionManager implements IConnectionManager {
  private readonly config: ConnectionPoolConfig;
  private readonly logger = createLogger("PostgreSQLConnectionManager");
  private readonly realPool: PostgreSQLConnectionPool;

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

    // Create real connection pool instead of virtual pooling
    this.realPool = PostgreSQLConnectionPool.fromPostgreSQLClient(
      postgresClient,
      {
        enableCircuitBreaker: this.config.enableCircuitBreaker,
        circuitBreakerThreshold: this.config.circuitBreakerThreshold,
        max: this.config.maxConnections,
        min: this.config.minConnections,
        idleTimeoutMillis: this.config.idleTimeout,
        connectionTimeoutMillis: this.config.connectionTimeout,
      }
    );

    this.scheduler = Scheduler.create();
    this.circuitBreakerEnabled = this.config.enableCircuitBreaker || false;

    this.initializeStats();
    this.startHealthMonitoring();
    this.startStatsCollection();
    this.startIdleConnectionCleanup();
  }

  static create(
    postgresClient: PostgreSQLClient,
    config: Partial<ConnectionPoolConfig> = {}
  ): PostgreSQLConnectionManager {
    return new PostgreSQLConnectionManager(postgresClient, config);
  }

  /**
   * Initialize connection manager
   */
  async initialize(): Promise<void> {
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
   * Get connection for raw SQL queries ($queryRawUnsafe)
   */
  async getConnectionSqlRaw(): Promise<{
    execute: <T>(query: string, params?: any[]) => Promise<T[]>;
    release: () => void;
  }> {
    try {
      const client = await this.realPool.getClient();
      return {
        execute: async <T>(query: string, params?: any[]): Promise<T[]> => {
          const queryStart = performance.now();
          try {
            const result = await client.query(query, params);
            this.updateQueryTiming(performance.now() - queryStart);
            return result.rows as T[];
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
        release: () => client.release(),
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
    // For now, this manager focuses on raw SQL connections through the pool
    // Prisma connections should be handled directly through PostgreSQLClient
    throw new AppError(
      "Prisma connections not supported by ConnectionPoolManager. Use PostgreSQLClient directly.",
      501
    );
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
      const result = await this.realPool.transaction(async (client) => {
        const execute = async (
          query: string,
          params?: any[]
        ): Promise<any[]> => {
          const result = await client.query(query, params);
          return result.rows;
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
        await this.realPool.connect();
        // Update stats based on real pool
        const poolStats = this.realPool.getStats();
        this.stats.totalConnections = poolStats.totalCount;
        this.stats.idleConnections = poolStats.idleCount;
        this.stats.activeConnections =
          poolStats.totalCount - poolStats.idleCount;
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
      // Check database connectivity using real pool
      const healthy = await this.realPool.healthCheck();
      if (!healthy) {
        return {
          healthy: false,
          reason: "Database connectivity check failed",
        };
      }

      // Check connection pool utilization
      const poolStats = this.realPool.getStats();
      const utilization =
        poolStats.totalCount > 0
          ? (poolStats.totalCount - poolStats.idleCount) / poolStats.totalCount
          : 0;

      if (utilization > 0.9) {
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
    const poolStats = this.realPool.getStats();
    // Update our stats with real pool data
    this.stats.activeConnections = poolStats.totalCount - poolStats.idleCount;
    this.stats.idleConnections = poolStats.idleCount;
    this.stats.totalConnections = poolStats.totalCount;
    this.stats.connectionWaitQueue = poolStats.waitingCount;
    this.stats.poolUtilization =
      poolStats.totalCount > 0
        ? this.stats.activeConnections / poolStats.totalCount
        : 0;

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
    this.logger.info("Shutting down connection pool manager");

    try {
      this.scheduler.clearAll();
      await this.realPool.disconnect();

      this.logger.info("Connection pool manager shutdown completed");
    } catch (error) {
      this.logger.error("Error during connection pool manager shutdown", error);
      throw new AppError(
        `Shutdown failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        500
      );
    }
  }
  /**
   * Idle connection cleanup (monitoring only - real pool manages connections)
   */
  private startIdleConnectionCleanup(): void {
    this.scheduler.setInterval(
      "idleConnectionMonitoring",
      this.config.idleTimeout,
      () => {
        try {
          const poolStats = this.realPool.getStats();
          const idleCount = poolStats.idleCount;
          const totalCount = poolStats.totalCount;

          // Just monitor - pg.Pool handles idle connection cleanup automatically
          if (idleCount > this.config.minConnections) {
            this.logger.debug("Pool has idle connections above minimum", {
              idle: idleCount,
              min: this.config.minConnections,
              total: totalCount,
            });
          }
        } catch (error) {
          this.logger.error("Idle connection monitoring failed", error);
        }
      }
    );
  }
}
