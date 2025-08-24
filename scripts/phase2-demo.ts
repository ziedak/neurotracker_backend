#!/usr/bin/env bun

/**
 * Phase 2 Database Optimization Demo Script
 * Demonstrates connection pooling and database query optimization
 */

import { Phase2OptimizationService } from "../libs/auth/src/services/phase2-optimization.service";

// Simple logger for demo
const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : "");
  },
  error: (message: string, error?: Error) => {
    console.error(`[ERROR] ${message}`, error ? error.message : "");
  },
};

async function runPhase2Demo(): Promise<void> {
  logger.info("🚀 Starting Phase 2 Database Optimization Demo");

  try {
    // Initialize Phase 2 optimization service
    const phase2Service = new Phase2OptimizationService({
      enableConnectionPooling: true,
      enableQueryOptimization: true,
      enablePreparedStatements: true,
      enableQueryCache: true,
      maxConnections: 15,
      connectionTimeout: 20000,
      benchmarkDuration: 45000, // 45 seconds
    });

    logger.info("📊 Phase 2 Configuration:", {
      connectionPooling: "enabled",
      queryOptimization: "enabled",
      preparedStatements: "enabled",
      queryCache: "enabled",
      maxConnections: 15,
      benchmarkDuration: "45 seconds",
    });

    // Execute Phase 2 optimization
    logger.info("⚡ Executing Phase 2 database optimization...");
    const results = await phase2Service.executePhase2();

    // Display results
    logger.info("✅ Phase 2 Optimization Results:", {
      status: results.status,
      duration: `${results.duration}ms`,

      baseline: {
        queryLatency: `${results.initialMetrics.avgQueryLatency.toFixed(2)}ms`,
        connectionOverhead: `${results.initialMetrics.connectionOverhead.toFixed(
          2
        )}ms`,
        throughput: `${results.initialMetrics.throughput.toFixed(1)} ops/sec`,
      },

      optimized: {
        queryLatency: `${results.optimizedMetrics.avgQueryLatency.toFixed(
          2
        )}ms`,
        connectionOverhead: `${results.optimizedMetrics.connectionOverhead.toFixed(
          2
        )}ms`,
        throughput: `${results.optimizedMetrics.throughput.toFixed(1)} ops/sec`,
      },

      improvements: {
        queryLatencyReduction: `${results.improvements.queryLatencyReduction.toFixed(
          1
        )}%`,
        connectionOverheadReduction: `${results.improvements.connectionOverheadReduction.toFixed(
          1
        )}%`,
        throughputIncrease: `${results.improvements.throughputIncrease.toFixed(
          1
        )}%`,
      },

      connectionPool: {
        activeConnections: results.poolStats.activeConnections,
        utilization: `${(results.poolStats.poolUtilization * 100).toFixed(1)}%`,
        healthScore: results.poolStats.healthScore,
      },
    });

    // Perform health check
    logger.info("🏥 Performing health check...");
    const health = await phase2Service.healthCheck();

    logger.info("🏥 Phase 2 Health Status:", {
      overallStatus: health.status,
      services: health.services,
      databaseOptimizerMetrics: health.metrics.databaseOptimizer
        ? "available"
        : "unavailable",
      connectionPoolMetrics: health.metrics.connectionPool
        ? "available"
        : "unavailable",
    });

    // Test individual services
    const dbOptimizer = phase2Service.getDatabaseOptimizer();
    const poolManager = phase2Service.getConnectionPoolManager();

    if (dbOptimizer) {
      logger.info("🔍 Testing database optimizer services...");

      // Test optimized session lookup
      let sessionStart = performance.now();
      try {
        await dbOptimizer.getSessionOptimized("test-session-123");
      } catch (error) {
        // Expected for non-existent session
        const sessionTime = performance.now() - sessionStart;
        logger.info(
          `📊 Session lookup test: ${sessionTime.toFixed(2)}ms (cached failure)`
        );
      }

      // Test optimized user lookup
      let userStart = performance.now();
      try {
        await dbOptimizer.getUserOptimized("test-user-456");
      } catch (error) {
        // Expected for non-existent user
        const userTime = performance.now() - userStart;
        logger.info(
          `📊 User lookup test: ${userTime.toFixed(2)}ms (cached failure)`
        );
      }

      // Test optimized permission check
      let permissionStart = performance.now();
      try {
        await dbOptimizer.checkPermissionsOptimized("test-user-456", [
          "read_posts",
          "write_comments",
        ]);
      } catch (error) {
        // Expected for non-existent user
        const permissionTime = performance.now() - permissionStart;
        logger.info(
          `📊 Permission check test: ${permissionTime.toFixed(
            2
          )}ms (cached failure)`
        );
      }

      // Test batch operations
      logger.info("🔄 Testing batch operations...");
      const batchStart = performance.now();
      const batchOps = Array.from(
        { length: 5 },
        (_, i) => () => dbOptimizer.getSessionOptimized(`batch-session-${i}`)
      );

      try {
        await dbOptimizer.executeBatchOptimized(batchOps);
        const batchTime = performance.now() - batchStart;
        logger.info(
          `📊 Batch operation (5 queries): ${batchTime.toFixed(2)}ms`
        );
      } catch (error) {
        logger.info(
          "📊 Batch operation completed with expected failures (no test data)"
        );
      }
    }

    if (poolManager) {
      logger.info("🔗 Testing connection pool manager...");

      const poolStats = poolManager.getStats();
      logger.info("📊 Connection Pool Statistics:", {
        connections: {
          active: poolStats.activeConnections,
          idle: poolStats.idleConnections,
          total: poolStats.totalConnections,
          utilization: `${(poolStats.poolUtilization * 100).toFixed(1)}%`,
        },
        performance: {
          avgConnectionTime: `${poolStats.avgConnectionTime.toFixed(2)}ms`,
          avgQueryTime: `${poolStats.avgQueryTime.toFixed(2)}ms`,
          waitQueue: poolStats.connectionWaitQueue,
          errors: poolStats.connectionErrors,
        },
        health: {
          score: poolStats.healthScore,
          status: poolStats.healthScore > 0.8 ? "healthy" : "degraded",
        },
      });

      // Test connection acquisition
      try {
        logger.info("🔗 Testing connection acquisition...");
        const connStart = performance.now();
        const connection = await poolManager.getConnection();
        const connTime = performance.now() - connStart;

        logger.info(`📊 Connection acquired in ${connTime.toFixed(2)}ms`);

        // Test query execution
        try {
          const queryStart = performance.now();
          await connection.execute("SELECT 1 as test");
          const queryTime = performance.now() - queryStart;
          logger.info(`📊 Test query executed in ${queryTime.toFixed(2)}ms`);
        } catch (error) {
          logger.info("📊 Test query failed (expected without real database)");
        }

        connection.release();
        logger.info("🔗 Connection released successfully");
      } catch (error) {
        logger.info(
          "📊 Connection test completed (expected without real database)"
        );
      }
    }

    // Calculate overall Phase 2 impact
    const phase2Impact = {
      queryPerformance: results.improvements.queryLatencyReduction,
      connectionEfficiency: results.improvements.connectionOverheadReduction,
      systemThroughput: results.improvements.throughputIncrease,
      overallImprovement:
        (results.improvements.queryLatencyReduction +
          results.improvements.connectionOverheadReduction +
          results.improvements.throughputIncrease) /
        3,
    };

    logger.info("🎯 Phase 2 Overall Impact Assessment:", {
      queryPerformanceGain: `${phase2Impact.queryPerformance.toFixed(1)}%`,
      connectionEfficiencyGain: `${phase2Impact.connectionEfficiency.toFixed(
        1
      )}%`,
      throughputGain: `${phase2Impact.systemThroughput.toFixed(1)}%`,
      combinedImprovementScore: `${phase2Impact.overallImprovement.toFixed(
        1
      )}%`,
      recommendedForProduction:
        phase2Impact.overallImprovement > 20 ? "✅ YES" : "⚠️  REVIEW NEEDED",
    });

    // Cleanup
    logger.info("🧹 Performing cleanup...");
    await phase2Service.shutdown();

    logger.info(
      "🎉 Phase 2 Database Optimization Demo completed successfully!"
    );

    if (results.status === "success" && phase2Impact.overallImprovement > 15) {
      logger.info(
        "✅ Phase 2 achieved significant performance improvements and is ready for production deployment"
      );
    } else if (results.status === "success") {
      logger.info(
        "⚠️  Phase 2 completed successfully but improvements are modest - consider additional optimizations"
      );
    } else {
      logger.info(
        "❌ Phase 2 encountered issues - review configuration and database connectivity"
      );
    }
  } catch (error) {
    logger.error(
      "❌ Phase 2 demo failed",
      error instanceof Error ? error : undefined
    );
    process.exit(1);
  }
}

// Execute demo
runPhase2Demo()
  .then(() => {
    logger.info("Demo execution completed");
    process.exit(0);
  })
  .catch((error) => {
    logger.error("Demo execution failed", error);
    process.exit(1);
  });
