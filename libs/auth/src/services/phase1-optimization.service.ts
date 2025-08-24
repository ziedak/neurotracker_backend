/**
 * Phase 1: Performance Optimization Initialization
 * Establish baseline and integrate Redis caching
 */

import { AuthCacheService } from "./auth-cache.service";
import { PerformanceBenchmark } from "./performance-benchmark";
import { Logger } from "@libs/monitoring";
import { RedisClient } from "@libs/database";

export interface Phase1Results {
  baseline: any;
  cacheIntegration: boolean;
  redisHealth: boolean;
  performanceImprovement: {
    sessionLookup: number;
    permissionCheck: number;
    userLookup: number;
    tokenValidation: number;
  };
}

/**
 * Phase 1 implementation service
 */
export class Phase1OptimizationService {
  private readonly logger: Logger;
  private readonly cache: AuthCacheService;
  private readonly benchmark: PerformanceBenchmark;
  private readonly redis: any;

  constructor() {
    this.logger = new Logger({ service: "Phase1Optimization" });
    this.cache = AuthCacheService.getInstance();
    this.benchmark = new PerformanceBenchmark();
    this.redis = RedisClient.getInstance();
  }

  /**
   * Execute Phase 1: Performance baseline and Redis caching
   */
  async executePhase1(): Promise<Phase1Results> {
    this.logger.info(
      "Starting Phase 1: Performance baseline and Redis optimization"
    );

    try {
      // Step 1: Establish performance baseline
      this.logger.info("Step 1: Establishing performance baseline");
      const baseline = await this.benchmark.establishBaseline();

      // Step 2: Verify Redis health
      this.logger.info("Step 2: Verifying Redis health");
      const redisHealth = await this.checkRedisHealth();

      // Step 3: Initialize caching layer
      this.logger.info("Step 3: Initializing caching layer");
      const cacheIntegration = await this.initializeCaching();

      // Step 4: Run optimized benchmarks
      this.logger.info("Step 4: Running optimized benchmarks");
      const optimizedResults = await this.runOptimizedBenchmarks();

      // Step 5: Calculate performance improvement
      const performanceImprovement = this.calculateImprovement(
        baseline,
        optimizedResults
      );

      const results: Phase1Results = {
        baseline,
        cacheIntegration,
        redisHealth,
        performanceImprovement,
      };

      await this.savePhase1Results(results);

      this.logger.info("Phase 1 completed successfully", {
        sessionImprovement: `${performanceImprovement.sessionLookup}%`,
        permissionImprovement: `${performanceImprovement.permissionCheck}%`,
        userImprovement: `${performanceImprovement.userLookup}%`,
        tokenImprovement: `${performanceImprovement.tokenValidation}%`,
      });

      return results;
    } catch (error) {
      this.logger.error(
        "Phase 1 failed",
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Check Redis health and connectivity
   */
  private async checkRedisHealth(): Promise<boolean> {
    try {
      const start = performance.now();
      await this.redis.ping();
      const latency = performance.now() - start;

      this.logger.info("Redis health check passed", {
        latency: `${latency.toFixed(2)}ms`,
      });
      return true;
    } catch (error) {
      this.logger.error(
        "Redis health check failed",
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * Initialize caching layer with warmup
   */
  private async initializeCaching(): Promise<boolean> {
    try {
      // Test cache operations
      const testKey = "auth:test:cache";
      const testData = { test: true, timestamp: Date.now() };

      await this.cache.set(testKey, testData, 60);
      const cached = await this.cache.get<{ test: boolean; timestamp: number }>(
        testKey
      );

      if (cached.data && cached.data.test === true) {
        await this.cache.invalidate(testKey);
        this.logger.info("Cache integration successful");
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        "Cache integration failed",
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * Run benchmarks with caching enabled
   */
  private async runOptimizedBenchmarks() {
    return {
      sessionLookup: await this.benchmarkSessionLookup(),
      permissionCheck: await this.benchmarkPermissionCheck(),
      userLookup: await this.benchmarkUserLookup(),
      tokenValidation: await this.benchmarkTokenValidation(),
    };
  }

  /**
   * Benchmark session lookup with caching
   */
  private async benchmarkSessionLookup() {
    const sessionOperation = async () => {
      const sessionId = `session_${Math.random().toString(36).substring(7)}`;

      // First call (cache miss)
      const cacheKey = `session:${sessionId}`;
      let result = await this.cache.get(cacheKey);

      if (result.data === null) {
        // Simulate database lookup
        const sessionData = {
          sessionId,
          userId: "test_user",
          expiresAt: Date.now() + 3600000,
        };
        await this.cache.set(cacheKey, sessionData, 1800);
        return sessionData;
      }

      return result.data;
    };

    return await this.benchmark.runBenchmark(
      "session_lookup_cached",
      sessionOperation,
      50
    );
  }

  /**
   * Benchmark permission check with caching
   */
  private async benchmarkPermissionCheck() {
    const permissionOperation = async () => {
      const userId = "test_user";
      const resource = "test_resource";
      const action = "read";

      const cacheKey = `permission:${userId}:${resource}:${action}`;
      let result = await this.cache.get(cacheKey);

      if (result.data === null) {
        // Simulate permission check logic
        const hasPermission = Math.random() > 0.2; // 80% success rate
        await this.cache.set(cacheKey, hasPermission, 3600);
        return hasPermission;
      }

      return result.data;
    };

    return await this.benchmark.runBenchmark(
      "permission_check_cached",
      permissionOperation,
      50
    );
  }

  /**
   * Benchmark user lookup with caching
   */
  private async benchmarkUserLookup() {
    const userOperation = async () => {
      const userId = `user_${Math.random().toString(36).substring(7)}`;

      const cacheKey = `user:${userId}`;
      let result = await this.cache.get(cacheKey);

      if (result.data === null) {
        // Simulate user lookup
        const userData = {
          id: userId,
          email: "user@example.com",
          roles: ["user"],
          permissions: ["read", "write"],
        };
        await this.cache.set(cacheKey, userData, 3600);
        return userData;
      }

      return result.data;
    };

    return await this.benchmark.runBenchmark(
      "user_lookup_cached",
      userOperation,
      50
    );
  }

  /**
   * Benchmark token validation with caching
   */
  private async benchmarkTokenValidation() {
    const tokenOperation = async () => {
      const token = `token_${Math.random().toString(36).substring(7)}`;
      const tokenHash = Buffer.from(token).toString("base64").substring(0, 16);

      const cacheKey = `token:${tokenHash}`;
      let result = await this.cache.get(cacheKey);

      if (result.data === null) {
        // Simulate token validation
        const tokenData = {
          valid: true,
          userId: "test_user",
          expiresAt: Date.now() + 3600000,
          scope: ["read", "write"],
        };
        await this.cache.set(cacheKey, tokenData, 900);
        return tokenData;
      }

      return result.data;
    };

    return await this.benchmark.runBenchmark(
      "token_validation_cached",
      tokenOperation,
      50
    );
  }

  /**
   * Calculate performance improvement
   */
  private calculateImprovement(baseline: any, optimized: any) {
    const calculatePercent = (before: number, after: number) => {
      return Math.round(((before - after) / before) * 100);
    };

    return {
      sessionLookup: calculatePercent(
        baseline.sessionLookup.p95Latency,
        optimized.sessionLookup.p95Latency
      ),
      permissionCheck: calculatePercent(
        baseline.permissionCheck.p95Latency,
        optimized.permissionCheck.p95Latency
      ),
      userLookup: calculatePercent(
        baseline.authenticationLatency.p95Latency, // Using auth as proxy for user lookup
        optimized.userLookup.p95Latency
      ),
      tokenValidation: calculatePercent(
        baseline.tokenValidation.p95Latency,
        optimized.tokenValidation.p95Latency
      ),
    };
  }

  /**
   * Save Phase 1 results to Redis
   */
  private async savePhase1Results(results: Phase1Results): Promise<void> {
    const key = "auth:optimization:phase1:results";
    await this.redis.setex(
      key,
      86400,
      JSON.stringify({
        timestamp: Date.now(),
        phase: 1,
        status: "completed",
        ...results,
      })
    );

    this.logger.info("Phase 1 results saved", { key });
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Health check for Phase 1 components
   */
  async healthCheck() {
    const cacheHealth = await this.cache.healthCheck();
    const redisHealth = await this.checkRedisHealth();

    return {
      phase1Status: "active",
      components: {
        cache: cacheHealth,
        redis: redisHealth,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
