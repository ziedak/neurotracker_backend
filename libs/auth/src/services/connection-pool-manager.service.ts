/**
 * Phase 2: Connection Pool Management Service
 * Advanced connection lifecycle and pool optimization
 */

import { PostgreSQLClient } from "@libs/database/src/postgress/pgClient";
import { Logger } from "@libs/monitoring";

export interface ConnectionPoolStats {
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  readonly maxConnections: number;
  readonly minConnections: number;
  connectionWaitQueue: number;
  avgConnectionTime: number;
  avgQueryTime: number;
  connectionErrors: number;
  poolUtilization: number;
  healthScore: number;
}

export interface ConnectionPoolConfig {
  readonly initialConnections: number;
  readonly maxConnections: number;
  readonly minConnections: number;
  readonly connectionTimeout: number;
  readonly idleTimeout: number;
  readonly maxIdleTime: number;
  readonly healthCheckInterval: number;
  readonly reconnectAttempts: number;
  readonly reconnectDelay: number;
  readonly enableCircuitBreaker: boolean;
  readonly circuitBreakerThreshold: number;
  readonly enableLoadBalancing: boolean;
}

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  initialConnections: 5,
  maxConnections: 20,
  minConnections: 2,
  connectionTimeout: 30000, // 30s
  idleTimeout: 300000, // 5min
  maxIdleTime: 600000, // 10min
  healthCheckInterval: 30000, // 30s
  reconnectAttempts: 3,
  reconnectDelay: 5000, // 5s
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 0.8,
  enableLoadBalancing: true,
};

/**
 * Advanced connection pool management service
 */
export class ConnectionPoolManager {
  private readonly config: ConnectionPoolConfig;
  private readonly logger: Logger;

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

  private circuitBreakerOpen = false;
  private lastCircuitBreakerCheck = Date.now();
  private connectionAttempts = 0;
  private successfulConnections = 0;
  private readonly connectionTimings: number[] = [];
  private readonly queryTimings: number[] = [];

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.logger = new Logger({ service: "ConnectionPoolManager" });

    this.initializeStats();
    this.startHealthMonitoring();
    this.startStatsCollection();
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
        throw new Error(
          `Connection pool initialization failed: ${health.reason}`
        );
      }

      this.logger.info("Connection pool initialized successfully", {
        activeConnections: this.stats.activeConnections,
        healthScore: this.stats.healthScore,
      });
    } catch (error) {
      this.logger.error(
        "Failed to initialize connection pool",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Get connection with optimized pool management
   */
  async getConnection(): Promise<{
    execute: <T>(query: string, params?: any[]) => Promise<T[]>;
    release: () => void;
  }> {
    const startTime = performance.now();

    try {
      // Check circuit breaker
      if (this.circuitBreakerOpen && this.config.enableCircuitBreaker) {
        throw new Error("Connection pool circuit breaker is open");
      }

      // Wait for available connection or timeout
      await this.waitForAvailableConnection();

      this.stats.activeConnections++;
      this.stats.connectionWaitQueue = Math.max(
        0,
        this.stats.connectionWaitQueue - 1
      );
      this.updateConnectionTiming(performance.now() - startTime);

      // Return connection interface
      return {
        execute: async <T>(query: string, params?: any[]): Promise<T[]> => {
          const queryStart = performance.now();

          try {
            const result =
              (await PostgreSQLClient.getInstance().$queryRawUnsafe(
                query,
                ...(params || [])
              )) as T[];
            this.updateQueryTiming(performance.now() - queryStart);
            return result;
          } catch (error) {
            this.stats.connectionErrors++;
            this.updateCircuitBreaker(false);
            throw error;
          }
        },
        release: () => {
          this.stats.activeConnections = Math.max(
            0,
            this.stats.activeConnections - 1
          );
          this.stats.idleConnections++;
          this.updateCircuitBreaker(true);
        },
      };
    } catch (error) {
      this.stats.connectionErrors++;
      this.updateCircuitBreaker(false);
      this.logger.error(
        "Failed to get connection",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Execute query with automatic connection management
   */
  async executeQuery<T>(query: string, params?: any[]): Promise<T[]> {
    const connection = await this.getConnection();

    try {
      const result = await connection.execute<T>(query, params);
      return result;
    } finally {
      connection.release();
    }
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
      const result = await PostgreSQLClient.transaction(async (prisma) => {
        const execute = async (
          query: string,
          params?: any[]
        ): Promise<any[]> => {
          return (await prisma.$queryRawUnsafe(
            query,
            ...(params || [])
          )) as any[];
        };

        return await operations(execute);
      });

      this.updateQueryTiming(performance.now() - startTime);
      this.updateCircuitBreaker(true);

      return result;
    } catch (error) {
      this.stats.connectionErrors++;
      this.updateCircuitBreaker(false);

      this.logger.error(
        "Transaction failed",
        error instanceof Error ? error : undefined,
        {
          measurementId,
          duration: performance.now() - startTime,
        }
      );

      throw error;
    }
  }

  /**
   * Batch execute queries with connection reuse
   */
  async executeBatch<T>(
    queries: Array<{ query: string; params?: any[] }>
  ): Promise<Array<T[] | Error>> {
    const connection = await this.getConnection();
    const results: Array<T[] | Error> = [];

    try {
      for (const { query, params } of queries) {
        try {
          const result = await connection.execute<T>(query, params);
          results.push(result);
        } catch (error) {
          results.push(
            error instanceof Error ? error : new Error(String(error))
          );
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
    const connectPromises: Promise<void>[] = [];

    for (let i = 0; i < this.config.initialConnections; i++) {
      connectPromises.push(this.createConnection());
    }

    try {
      await Promise.all(connectPromises);
      this.stats.totalConnections = this.config.initialConnections;
      this.stats.idleConnections = this.config.initialConnections;
    } catch (error) {
      this.logger.error(
        "Failed to establish initial connections",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<void> {
    const startTime = performance.now();
    this.connectionAttempts++;

    try {
      await PostgreSQLClient.connect();

      const health = await PostgreSQLClient.healthCheck();
      if (health.status !== "healthy") {
        throw new Error(`Connection health check failed: ${health.status}`);
      }

      this.successfulConnections++;
      this.updateConnectionTiming(performance.now() - startTime);
    } catch (error) {
      this.stats.connectionErrors++;
      this.logger.error(
        "Failed to create connection",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Wait for an available connection
   */
  private async waitForAvailableConnection(): Promise<void> {
    const startTime = Date.now();

    while (this.stats.activeConnections >= this.config.maxConnections) {
      if (Date.now() - startTime > this.config.connectionTimeout) {
        throw new Error("Connection timeout: No connections available");
      }

      this.stats.connectionWaitQueue++;
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms wait
    }
  }

  /**
   * Update connection timing statistics
   */
  private updateConnectionTiming(duration: number): void {
    this.connectionTimings.push(duration);
    if (this.connectionTimings.length > 100) {
      this.connectionTimings.shift(); // Keep only last 100 timings
    }

    this.stats.avgConnectionTime =
      this.connectionTimings.reduce((sum, time) => sum + time, 0) /
      this.connectionTimings.length;
  }

  /**
   * Update query timing statistics
   */
  private updateQueryTiming(duration: number): void {
    this.queryTimings.push(duration);
    if (this.queryTimings.length > 100) {
      this.queryTimings.shift(); // Keep only last 100 timings
    }

    this.stats.avgQueryTime =
      this.queryTimings.reduce((sum, time) => sum + time, 0) /
      this.queryTimings.length;
  }

  /**
   * Update circuit breaker status
   */
  private updateCircuitBreaker(_success: boolean): void {
    if (!this.config.enableCircuitBreaker) return;

    const now = Date.now();

    // Check circuit breaker every 10 seconds
    if (now - this.lastCircuitBreakerCheck > 10000) {
      const successRate =
        this.connectionAttempts > 0
          ? this.successfulConnections / this.connectionAttempts
          : 1;

      this.circuitBreakerOpen =
        successRate < this.config.circuitBreakerThreshold;
      this.lastCircuitBreakerCheck = now;

      if (this.circuitBreakerOpen) {
        this.logger.warn("Circuit breaker opened", {
          successRate,
          threshold: this.config.circuitBreakerThreshold,
        });
      }
    }

    // Reset counters periodically
    if (now - this.lastCircuitBreakerCheck > 60000) {
      // Every minute
      this.connectionAttempts = 0;
      this.successfulConnections = 0;
    }
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
      const health = await PostgreSQLClient.healthCheck();
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

      // Check error rate
      const errorRate =
        this.connectionAttempts > 0
          ? this.stats.connectionErrors / this.connectionAttempts
          : 0;

      if (errorRate > 0.1) {
        return { healthy: false, reason: "Connection error rate too high" };
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
    setInterval(async () => {
      const health = await this.checkPoolHealth();
      this.stats.healthScore = health.healthy ? 1.0 : 0.5;

      if (!health.healthy) {
        this.logger.warn("Connection pool health degraded", {
          reason: health.reason,
        });
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Start statistics collection
   */
  private startStatsCollection(): void {
    setInterval(() => {
      // Update utilization
      this.stats.poolUtilization =
        this.stats.totalConnections > 0
          ? this.stats.activeConnections / this.stats.totalConnections
          : 0;

      // Log periodic stats
      this.logger.info("Connection pool statistics", {
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
          circuitBreakerOpen: this.circuitBreakerOpen,
        },
      });
    }, 60000); // Every minute
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
      // Reset circuit breaker
      this.circuitBreakerOpen = false;
      this.connectionAttempts = 0;
      this.successfulConnections = 0;

      // Re-establish connections
      await this.establishInitialConnections();

      this.logger.info("Connection pool reconnected successfully");
    } catch (error) {
      this.logger.error(
        "Failed to reconnect connection pool",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down connection pool");

    try {
      // Wait for active connections to complete
      const maxWait = 30000; // 30 seconds
      const startTime = Date.now();

      while (
        this.stats.activeConnections > 0 &&
        Date.now() - startTime < maxWait
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      this.stats.totalConnections = 0;
      this.stats.activeConnections = 0;
      this.stats.idleConnections = 0;

      this.logger.info("Connection pool shutdown completed");
    } catch (error) {
      this.logger.error(
        "Error during connection pool shutdown",
        error instanceof Error ? error : undefined
      );
    }
  }
}
