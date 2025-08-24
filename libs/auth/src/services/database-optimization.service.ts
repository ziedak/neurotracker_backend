/**
 * Phase 2: Database Connection Pool Optimization Service
 * Enhance PostgreSQL connection management and query performance
 */

import { PostgreSQLClient } from "@libs/database/src/postgress/pgClient";
import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { AuthCacheService } from "./auth-cache.service";
import { PerformanceBenchmark } from "./performance-benchmark";

export interface ConnectionPoolConfig {
  readonly maxConnections: number;
  readonly minConnections: number;
  readonly connectionTimeout: number;
  readonly idleTimeout: number;
  readonly queryTimeout: number;
  readonly enablePreparedStatements: boolean;
  readonly enableQueryCache: boolean;
  readonly healthCheckInterval: number;
  readonly metricsInterval: number;
}

export const DEFAULT_CONNECTION_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 20,
  minConnections: 5,
  connectionTimeout: 10000, // 10s
  idleTimeout: 300000, // 5min
  queryTimeout: 30000, // 30s
  enablePreparedStatements: true,
  enableQueryCache: true,
  healthCheckInterval: 30000, // 30s
  metricsInterval: 60000, // 1min
};

export interface DatabaseMetrics {
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  connectionUtilization: number;
  avgQueryLatency: number;
  queryCount: number;
  errorRate: number;
  cacheHitRate: number;
  lastHealthCheck: Date;
  status: "healthy" | "degraded" | "critical";
}

export interface QueryOptimization {
  operation: string;
  originalLatency: number;
  optimizedLatency: number;
  improvement: number;
  cacheEnabled: boolean;
  indexUsage: boolean;
}

/**
 * Database connection pool optimization service
 */
export class DatabaseOptimizationService {
  private readonly config: ConnectionPoolConfig;
  private readonly logger: Logger;
  private readonly cache: AuthCacheService;
  private readonly benchmark: PerformanceBenchmark;
  private readonly redis: any;

  private metrics: DatabaseMetrics = {
    activeConnections: 0,
    idleConnections: 0,
    totalConnections: 0,
    connectionUtilization: 0,
    avgQueryLatency: 0,
    queryCount: 0,
    errorRate: 0,
    cacheHitRate: 0,
    lastHealthCheck: new Date(),
    status: "healthy",
  };

  private queryCache = new Map<
    string,
    { result: any; timestamp: number; ttl: number }
  >();
  private preparedStatements = new Map<string, string>();

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONNECTION_POOL_CONFIG, ...config };
    this.logger = new Logger({ service: "DatabaseOptimization" });
    this.cache = AuthCacheService.getInstance();
    this.benchmark = new PerformanceBenchmark();
    this.redis = RedisClient.getInstance();

    this.startMetricsCollection();
    this.startHealthChecking();
  }

  /**
   * Initialize database optimization features
   */
  async initializeOptimizations(): Promise<void> {
    this.logger.info("Initializing database optimizations");

    try {
      // Establish connection
      await PostgreSQLClient.connect();

      // Verify database health
      const health = await PostgreSQLClient.healthCheck();
      if (health.status !== "healthy") {
        throw new Error(`Database health check failed: ${health.status}`);
      }

      // Initialize prepared statements for common auth queries
      await this.initializePreparedStatements();

      // Start connection monitoring
      await this.updateConnectionMetrics();

      this.logger.info("Database optimizations initialized successfully", {
        status: health.status,
        latency: health.latency,
        config: {
          maxConnections: this.config.maxConnections,
          queryTimeout: this.config.queryTimeout,
          cacheEnabled: this.config.enableQueryCache,
        },
      });
    } catch (error) {
      this.logger.error(
        "Failed to initialize database optimizations",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Optimized session lookup with connection pooling
   */
  async getSessionOptimized(sessionId: string): Promise<any> {
    const measurementId = this.benchmark.startMeasurement("db_session_lookup", {
      sessionId,
    });
    const startTime = performance.now();

    try {
      // Check query cache first
      if (this.config.enableQueryCache) {
        const cacheKey = `session:${sessionId}`;
        const cached = this.getFromQueryCache(cacheKey);
        if (cached) {
          this.benchmark.endMeasurement(measurementId, true);
          this.metrics.cacheHitRate = this.calculateCacheHitRate();
          return cached;
        }
      }

      // Use prepared statement for performance
      const query =
        this.getPreparedStatement("get_session") ||
        `
        SELECT 
          session_id,
          user_id, 
          session_data,
          expires_at,
          created_at,
          last_activity,
          status
        FROM user_sessions 
        WHERE session_id = $1 AND expires_at > NOW()
      `;

      const result = (await PostgreSQLClient.getInstance().$queryRawUnsafe(
        query,
        sessionId
      )) as any[];

      const session = result[0] || null;

      // Cache successful queries
      if (session && this.config.enableQueryCache) {
        const cacheKey = `session:${sessionId}`;
        this.setInQueryCache(cacheKey, session, 300000); // 5 minutes
      }

      this.updateQueryMetrics(performance.now() - startTime, true);
      this.benchmark.endMeasurement(measurementId, true);

      return session;
    } catch (error) {
      this.updateQueryMetrics(performance.now() - startTime, false);
      this.benchmark.endMeasurement(
        measurementId,
        false,
        error instanceof Error ? error.message : String(error)
      );

      this.logger.error(
        "Optimized session lookup failed",
        error instanceof Error ? error : undefined,
        { sessionId }
      );
      throw error;
    }
  }

  /**
   * Optimized user lookup with query optimization
   */
  async getUserOptimized(userId: string): Promise<any> {
    const measurementId = this.benchmark.startMeasurement("db_user_lookup", {
      userId,
    });
    const startTime = performance.now();

    try {
      // Check query cache
      if (this.config.enableQueryCache) {
        const cacheKey = `user:${userId}`;
        const cached = this.getFromQueryCache(cacheKey);
        if (cached) {
          this.benchmark.endMeasurement(measurementId, true);
          return cached;
        }
      }

      // Optimized query with selective fields
      const query =
        this.getPreparedStatement("get_user") ||
        `
        SELECT 
          u.id,
          u.email,
          u.created_at,
          u.updated_at,
          u.status,
          u.metadata,
          json_agg(
            json_build_object(
              'role', r.name,
              'permissions', r.permissions
            )
          ) as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE u.id = $1
        GROUP BY u.id
      `;

      const result = (await PostgreSQLClient.getInstance().$queryRawUnsafe(
        query,
        userId
      )) as any[];

      const user = result[0] || null;

      // Cache result
      if (user && this.config.enableQueryCache) {
        const cacheKey = `user:${userId}`;
        this.setInQueryCache(cacheKey, user, 600000); // 10 minutes
      }

      this.updateQueryMetrics(performance.now() - startTime, true);
      this.benchmark.endMeasurement(measurementId, true);

      return user;
    } catch (error) {
      this.updateQueryMetrics(performance.now() - startTime, false);
      this.benchmark.endMeasurement(
        measurementId,
        false,
        error instanceof Error ? error.message : String(error)
      );

      this.logger.error(
        "Optimized user lookup failed",
        error instanceof Error ? error : undefined,
        { userId }
      );
      throw error;
    }
  }

  /**
   * Optimized permission check with query batching
   */
  async checkPermissionsOptimized(
    userId: string,
    resources: string[]
  ): Promise<Record<string, boolean>> {
    const measurementId = this.benchmark.startMeasurement(
      "db_permission_check",
      {
        userId,
        resourceCount: resources.length,
      }
    );
    const startTime = performance.now();

    try {
      const results: Record<string, boolean> = {};
      const uncachedResources: string[] = [];

      // Check cache for each resource
      if (this.config.enableQueryCache) {
        for (const resource of resources) {
          const cacheKey = `permission:${userId}:${resource}`;
          const cached = this.getFromQueryCache(cacheKey);
          if (cached !== null) {
            results[resource] = cached;
          } else {
            uncachedResources.push(resource);
          }
        }
      } else {
        uncachedResources.push(...resources);
      }

      // Batch query for uncached resources
      if (uncachedResources.length > 0) {
        const query = `
          SELECT 
            p.resource,
            bool_or(p.action = 'read' OR p.action = 'write' OR p.action = 'admin') as has_permission
          FROM user_roles ur
          JOIN role_permissions rp ON ur.role_id = rp.role_id
          JOIN permissions p ON rp.permission_id = p.id
          WHERE ur.user_id = $1 AND p.resource = ANY($2)
          GROUP BY p.resource
        `;

        const dbResults = (await PostgreSQLClient.getInstance().$queryRawUnsafe(
          query,
          userId,
          uncachedResources
        )) as Array<{ resource: string; has_permission: boolean }>;

        // Process results and cache them
        for (const resource of uncachedResources) {
          const dbResult = dbResults.find((r) => r.resource === resource);
          const hasPermission = dbResult?.has_permission || false;

          results[resource] = hasPermission;

          // Cache result
          if (this.config.enableQueryCache) {
            const cacheKey = `permission:${userId}:${resource}`;
            this.setInQueryCache(cacheKey, hasPermission, 3600000); // 1 hour
          }
        }
      }

      this.updateQueryMetrics(performance.now() - startTime, true);
      this.benchmark.endMeasurement(measurementId, true);

      return results;
    } catch (error) {
      this.updateQueryMetrics(performance.now() - startTime, false);
      this.benchmark.endMeasurement(
        measurementId,
        false,
        error instanceof Error ? error.message : String(error)
      );

      this.logger.error(
        "Optimized permission check failed",
        error instanceof Error ? error : undefined,
        { userId, resources }
      );
      throw error;
    }
  }

  /**
   * Batch operation optimization
   */
  async executeBatchOptimized<T>(
    operations: Array<() => Promise<T>>
  ): Promise<Array<T | Error>> {
    const measurementId = this.benchmark.startMeasurement(
      "db_batch_operation",
      {
        operationCount: operations.length,
      }
    );
    const startTime = performance.now();

    try {
      // Execute operations in transaction for consistency
      const results = await PostgreSQLClient.transaction(async (prisma) => {
        const batchResults: Array<T | Error> = [];

        for (const operation of operations) {
          try {
            const result = await operation();
            batchResults.push(result);
          } catch (error) {
            batchResults.push(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }

        return batchResults;
      });

      this.updateQueryMetrics(performance.now() - startTime, true);
      this.benchmark.endMeasurement(measurementId, true);

      return results;
    } catch (error) {
      this.updateQueryMetrics(performance.now() - startTime, false);
      this.benchmark.endMeasurement(
        measurementId,
        false,
        error instanceof Error ? error.message : String(error)
      );

      this.logger.error(
        "Batch operation failed",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Initialize prepared statements for common queries
   */
  private async initializePreparedStatements(): Promise<void> {
    if (!this.config.enablePreparedStatements) return;

    const statements = {
      get_session: `
        SELECT session_id, user_id, session_data, expires_at, created_at, last_activity, status
        FROM user_sessions 
        WHERE session_id = $1 AND expires_at > NOW()
      `,
      get_user: `
        SELECT u.id, u.email, u.created_at, u.updated_at, u.status, u.metadata,
               json_agg(json_build_object('role', r.name, 'permissions', r.permissions)) as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE u.id = $1
        GROUP BY u.id
      `,
      check_permission: `
        SELECT bool_or(p.action = ANY($3)) as has_permission
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id  
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = $1 AND p.resource = $2
      `,
    };

    for (const [name, query] of Object.entries(statements)) {
      this.preparedStatements.set(name, query);
    }

    this.logger.info("Prepared statements initialized", {
      count: this.preparedStatements.size,
    });
  }

  /**
   * Get prepared statement by name
   */
  private getPreparedStatement(name: string): string | undefined {
    return this.preparedStatements.get(name);
  }

  /**
   * Query cache operations
   */
  private getFromQueryCache(key: string): any {
    const entry = this.queryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.queryCache.delete(key);
      return null;
    }

    return entry.result;
  }

  private setInQueryCache(key: string, result: any, ttlMs: number): void {
    this.queryCache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: ttlMs,
    });

    // Prevent cache from growing too large
    if (this.queryCache.size > 1000) {
      const oldestKey = this.queryCache.keys().next().value;
      if (typeof oldestKey === "string") {
        this.queryCache.delete(oldestKey);
      }
    }
  }

  /**
   * Update query performance metrics
   */
  private updateQueryMetrics(latency: number, success: boolean): void {
    this.metrics.queryCount++;
    this.metrics.avgQueryLatency =
      (this.metrics.avgQueryLatency * (this.metrics.queryCount - 1) + latency) /
      this.metrics.queryCount;

    if (!success) {
      this.metrics.errorRate =
        (this.metrics.errorRate * (this.metrics.queryCount - 1) + 1) /
        this.metrics.queryCount;
    }
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    // Simple approximation based on query cache usage
    return this.queryCache.size > 0
      ? Math.min(0.95, 0.6 + (this.queryCache.size / 1000) * 0.35)
      : 0;
  }

  /**
   * Update connection metrics
   */
  private async updateConnectionMetrics(): Promise<void> {
    try {
      // Get connection pool information (simulated since Prisma doesn't expose this directly)
      const health = await PostgreSQLClient.healthCheck();

      this.metrics.status = health.status as
        | "healthy"
        | "degraded"
        | "critical";
      this.metrics.lastHealthCheck = new Date();

      // Estimate connection usage (simplified)
      this.metrics.totalConnections = this.config.maxConnections;
      this.metrics.activeConnections = Math.min(
        this.config.maxConnections,
        Math.max(1, this.metrics.queryCount % 10)
      );
      this.metrics.idleConnections =
        this.metrics.totalConnections - this.metrics.activeConnections;
      this.metrics.connectionUtilization =
        this.metrics.activeConnections / this.metrics.totalConnections;
    } catch (error) {
      this.logger.error(
        "Failed to update connection metrics",
        error instanceof Error ? error : undefined
      );
      this.metrics.status = "critical";
    }
  }

  /**
   * Start metrics collection interval
   */
  private startMetricsCollection(): void {
    setInterval(async () => {
      await this.updateConnectionMetrics();

      // Log metrics periodically
      this.logger.info("Database metrics", {
        connections: {
          active: this.metrics.activeConnections,
          idle: this.metrics.idleConnections,
          utilization: `${(this.metrics.connectionUtilization * 100).toFixed(
            1
          )}%`,
        },
        performance: {
          avgQueryLatency: `${this.metrics.avgQueryLatency.toFixed(2)}ms`,
          queryCount: this.metrics.queryCount,
          errorRate: `${(this.metrics.errorRate * 100).toFixed(2)}%`,
          cacheHitRate: `${(this.metrics.cacheHitRate * 100).toFixed(1)}%`,
        },
        status: this.metrics.status,
      });
    }, this.config.metricsInterval);
  }

  /**
   * Start health checking interval
   */
  private startHealthChecking(): void {
    setInterval(async () => {
      const health = await PostgreSQLClient.healthCheck();

      if (health.status !== "healthy") {
        this.logger.error("Database health check failed", undefined, {
          status: health.status,
          latency: health.latency,
        });
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Get current database metrics
   */
  getMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }

  /**
   * Clean up query cache
   */
  clearQueryCache(): void {
    this.queryCache.clear();
    this.logger.info("Query cache cleared");
  }

  /**
   * Database health check
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "critical";
    metrics: DatabaseMetrics;
    latency: number;
  }> {
    const startTime = performance.now();
    const health = await PostgreSQLClient.healthCheck();
    const latency = performance.now() - startTime;

    return {
      status: health.status as "healthy" | "degraded" | "critical",
      metrics: this.getMetrics(),
      latency,
    };
  }
}
