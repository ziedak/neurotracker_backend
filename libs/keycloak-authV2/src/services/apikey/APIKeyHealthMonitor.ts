/**
 * APIKeyHealthMonitor - Comprehensive health monitoring and diagnostics
 *
 * Responsibilities:
 * - Aggregate health checks from all API key components
 * - Monitor system performance and reliability metrics
 * - Entropy source testing and validation
 * - Component dependency health checks
 * - System diagnostics and troubleshooting information
 * - Health status reporting and alerting
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles health monitoring and diagnostics
 * - Open/Closed: Extensible for new health checks
 * - Liskov Substitution: Implements standard health monitor interface
 * - Interface Segregation: Clean separation of monitoring concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { performance } from "perf_hooks";
import crypto from "crypto";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
import type { APIKeyGenerator } from "./APIKeyGenerator";
import type { APIKeyRepository } from "./APIKeyRepository";
import type { APIKeyCacheManager } from "./APIKeyCacheManager";
import type { APIKeyValidator } from "./APIKeyValidator";
import type { APIKeyUsageTracker } from "./APIKeyUsageTracker";
import type { APIKeySecurityManager } from "./APIKeySecurityManager";

export interface ComponentHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  available: boolean;
  responseTime: number; // milliseconds
  error?: string | undefined;
  details?: Record<string, any> | undefined;
  lastCheck: Date;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy" | "critical";
  components: ComponentHealth[];
  dependencies: {
    database: ComponentHealth;
    cache: ComponentHealth;
    entropy: ComponentHealth;
  };
  metrics: {
    totalValidations: number;
    successRate: number;
    avgResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
  };
  recommendations: string[];
  lastCheck: Date;
}

export interface EntropyTest {
  status: "healthy" | "degraded" | "failed";
  testRuns: number;
  successfulRuns: number;
  qualityScore: number;
  avgGenerationTime: number;
  details: {
    attempts: Array<{
      success: boolean;
      quality: boolean;
      duration: number;
      error?: string;
    }>;
  };
  recommendations: string[];
}

export interface PerformanceDiagnostics {
  database: {
    connectionPool: {
      active: number;
      idle: number;
      waiting: number;
    };
    queryPerformance: {
      avgQueryTime: number;
      slowQueries: number;
      failedQueries: number;
    };
  };
  cache: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
    memoryUsage: number;
  };
  validation: {
    throughput: number;
    latency: {
      p50: number;
      p95: number;
      p99: number;
    };
    errorRate: number;
  };
}

export interface APIKeyHealthMonitorConfig {
  readonly healthCheckInterval: number; // milliseconds
  readonly enableContinuousMonitoring: boolean;
  readonly performanceThresholds: {
    readonly maxResponseTime: number; // milliseconds
    readonly minSuccessRate: number; // percentage (0-100)
    readonly maxErrorRate: number; // percentage (0-100)
    readonly minCacheHitRate: number; // percentage (0-100)
  };
  readonly entropyTestConfig: {
    readonly testCount: number;
    readonly minQualityThreshold: number; // percentage (0-100)
    readonly maxGenerationTime: number; // milliseconds
  };
}

const DEFAULT_HEALTH_CONFIG: APIKeyHealthMonitorConfig = {
  healthCheckInterval: 30000, // 30 seconds
  enableContinuousMonitoring: true,
  performanceThresholds: {
    maxResponseTime: 1000, // 1 second
    minSuccessRate: 95, // 95%
    maxErrorRate: 5, // 5%
    minCacheHitRate: 80, // 80%
  },
  entropyTestConfig: {
    testCount: 5,
    minQualityThreshold: 80, // 80%
    maxGenerationTime: 100, // 100ms
  },
};

/**
 * Comprehensive health monitoring system for API key management
 */
export class APIKeyHealthMonitor {
  private readonly config: APIKeyHealthMonitorConfig;
  private healthCheckTimer?: NodeJS.Timeout | undefined;
  private lastHealthCheck?: SystemHealth | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector,
    private readonly dbClient: PostgreSQLClient,
    private readonly components: {
      generator?: APIKeyGenerator;
      repository?: APIKeyRepository;
      cacheManager?: APIKeyCacheManager;
      validator?: APIKeyValidator;
      usageTracker?: APIKeyUsageTracker;
      securityManager?: APIKeySecurityManager;
    } = {},
    config: Partial<APIKeyHealthMonitorConfig> = {}
  ) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };

    this.logger.info("APIKeyHealthMonitor initialized", {
      continuousMonitoring: this.config.enableContinuousMonitoring,
      interval: this.config.healthCheckInterval,
      thresholds: this.config.performanceThresholds,
    });

    // Start continuous monitoring if enabled
    if (this.config.enableContinuousMonitoring) {
      this.startContinuousMonitoring();
    }

    // Setup cleanup on process exit
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  /**
   * Perform comprehensive system health check
   */
  async performHealthCheck(): Promise<SystemHealth> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Starting comprehensive health check", { operationId });

      // Check all components in parallel
      const [
        generatorHealth,
        repositoryHealth,
        cacheHealth,
        validatorHealth,
        usageTrackerHealth,
        securityHealth,
        databaseHealth,
        entropyHealth,
      ] = await Promise.allSettled([
        this.checkComponentHealth(
          "generator",
          this.components.generator
            ? () => Promise.resolve({ available: true })
            : undefined
        ),
        this.checkComponentHealth(
          "repository",
          this.components.repository
            ? () => this.components.repository!.healthCheck()
            : undefined
        ),
        this.checkComponentHealth(
          "cache",
          this.components.cacheManager
            ? () => this.components.cacheManager!.healthCheck()
            : undefined
        ),
        this.checkComponentHealth(
          "validator",
          this.components.validator
            ? () => this.components.validator!.healthCheck()
            : undefined
        ),
        this.checkComponentHealth(
          "usage-tracker",
          this.components.usageTracker
            ? () => this.components.usageTracker!.healthCheck()
            : undefined
        ),
        this.checkComponentHealth(
          "security",
          this.components.securityManager
            ? () => this.components.securityManager!.healthCheck()
            : undefined
        ),
        this.checkDatabaseHealth(),
        this.checkEntropyHealth(),
      ]);

      // Collect all component health results
      const components: ComponentHealth[] = [];
      const resolvedResults = [
        generatorHealth,
        repositoryHealth,
        cacheHealth,
        validatorHealth,
        usageTrackerHealth,
        securityHealth,
      ];

      resolvedResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          components.push(result.value);
        } else {
          const componentNames = [
            "generator",
            "repository",
            "cache",
            "validator",
            "usage-tracker",
            "security",
          ];
          const componentName = componentNames[index] || `component-${index}`;
          components.push({
            name: componentName,
            status: "unhealthy",
            available: false,
            responseTime: 0,
            error: result.reason?.message || "Component check failed",
            lastCheck: new Date(),
          });
        }
      });

      // Process dependency health checks
      const databaseResult =
        databaseHealth.status === "fulfilled"
          ? databaseHealth.value
          : {
              name: "database",
              status: "unhealthy" as const,
              available: false,
              responseTime: 0,
              error: "Database health check failed",
              lastCheck: new Date(),
            };

      const cacheResult = components.find((c) => c.name === "cache") || {
        name: "cache",
        status: "unhealthy" as const,
        available: false,
        responseTime: 0,
        error: "Cache not available",
        lastCheck: new Date(),
      };

      const entropyResult =
        entropyHealth.status === "fulfilled"
          ? entropyHealth.value
          : {
              name: "entropy",
              status: "unhealthy" as const,
              available: false,
              responseTime: 0,
              error: "Entropy health check failed",
              lastCheck: new Date(),
            };

      // Calculate system metrics
      const metrics = await this.calculateSystemMetrics(components);

      // Determine overall system status
      const systemStatus = this.determineSystemStatus(
        components,
        databaseResult,
        entropyResult
      );

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        components,
        metrics,
        databaseResult,
        entropyResult
      );

      const systemHealth: SystemHealth = {
        status: systemStatus,
        components,
        dependencies: {
          database: databaseResult,
          cache: cacheResult,
          entropy: entropyResult,
        },
        metrics,
        recommendations,
        lastCheck: new Date(),
      };

      // Cache the result
      this.lastHealthCheck = systemHealth;

      // Record metrics
      this.metrics.recordTimer(
        "apikey.health.check_duration",
        performance.now() - startTime
      );
      this.metrics.recordCounter("apikey.health.check_completed", 1);
      this.metrics.recordCounter(`apikey.health.status.${systemStatus}`, 1);

      this.logger.info("Health check completed", {
        operationId,
        status: systemStatus,
        componentCount: components.length,
        healthyComponents: components.filter((c) => c.status === "healthy")
          .length,
        duration: performance.now() - startTime,
      });

      return systemHealth;
    } catch (error) {
      this.logger.error("Health check failed", { operationId, error });
      this.metrics.recordCounter("apikey.health.check_error", 1);

      // Return degraded health status
      return {
        status: "critical",
        components: [],
        dependencies: {
          database: {
            name: "database",
            status: "unhealthy",
            available: false,
            responseTime: 0,
            error: "Health check system failure",
            lastCheck: new Date(),
          },
          cache: {
            name: "cache",
            status: "unhealthy",
            available: false,
            responseTime: 0,
            error: "Health check system failure",
            lastCheck: new Date(),
          },
          entropy: {
            name: "entropy",
            status: "unhealthy",
            available: false,
            responseTime: 0,
            error: "Health check system failure",
            lastCheck: new Date(),
          },
        },
        metrics: {
          totalValidations: 0,
          successRate: 0,
          avgResponseTime: 0,
          cacheHitRate: 0,
          errorRate: 100,
        },
        recommendations: [
          "System requires immediate attention - health monitoring failed",
        ],
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Test entropy source quality and performance
   */
  async testEntropySource(): Promise<EntropyTest> {
    const startTime = performance.now();

    try {
      this.logger.debug("Starting entropy source test");

      const testResults = [];
      let totalGenerationTime = 0;

      // Perform multiple entropy generation tests
      for (let i = 0; i < this.config.entropyTestConfig.testCount; i++) {
        const testStartTime = performance.now();

        try {
          // Generate test entropy
          const testBytes = crypto.randomBytes(32);
          const testDuration = performance.now() - testStartTime;
          totalGenerationTime += testDuration;

          // Validate entropy quality
          const quality = this.validateEntropyQuality(testBytes);

          testResults.push({
            success: true,
            quality,
            duration: testDuration,
          });

          this.logger.debug("Entropy test attempt completed", {
            attempt: i + 1,
            quality,
            duration: testDuration,
          });
        } catch (error) {
          const testDuration = performance.now() - testStartTime;
          totalGenerationTime += testDuration;

          testResults.push({
            success: false,
            quality: false,
            duration: testDuration,
            error:
              error instanceof Error ? error.message : "Unknown entropy error",
          });

          this.logger.warn("Entropy test attempt failed", {
            attempt: i + 1,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      // Calculate results
      const successfulRuns = testResults.filter((r) => r.success).length;
      const qualityRuns = testResults.filter(
        (r) => r.success && r.quality
      ).length;
      const qualityScore =
        successfulRuns > 0 ? (qualityRuns / successfulRuns) * 100 : 0;
      const avgGenerationTime = totalGenerationTime / testResults.length;

      // Determine status
      let status: "healthy" | "degraded" | "failed";
      const recommendations: string[] = [];

      if (successfulRuns === 0) {
        status = "failed";
        recommendations.push(
          "Entropy source completely failed - immediate system attention required"
        );
        recommendations.push(
          "Check system entropy pools and hardware random number generators"
        );
      } else if (
        qualityScore < this.config.entropyTestConfig.minQualityThreshold
      ) {
        status = "degraded";
        recommendations.push(
          `Entropy quality below threshold (${qualityScore.toFixed(1)}% < ${
            this.config.entropyTestConfig.minQualityThreshold
          }%)`
        );
        recommendations.push(
          "Monitor system entropy and investigate potential issues"
        );
      } else if (
        avgGenerationTime > this.config.entropyTestConfig.maxGenerationTime
      ) {
        status = "degraded";
        recommendations.push(
          `Entropy generation slower than expected (${avgGenerationTime.toFixed(
            1
          )}ms > ${this.config.entropyTestConfig.maxGenerationTime}ms)`
        );
        recommendations.push("Check system load and entropy pool availability");
      } else {
        status = "healthy";
        recommendations.push(
          "Entropy source operating within normal parameters"
        );
      }

      const entropyTest: EntropyTest = {
        status,
        testRuns: testResults.length,
        successfulRuns,
        qualityScore,
        avgGenerationTime,
        details: { attempts: testResults },
        recommendations,
      };

      // Record metrics
      this.metrics.recordTimer(
        "apikey.health.entropy_test_duration",
        performance.now() - startTime
      );
      this.metrics.recordCounter("apikey.health.entropy_test_completed", 1);
      this.metrics.recordCounter(`apikey.health.entropy_status.${status}`, 1);
      this.metrics.recordGauge(
        "apikey.health.entropy_quality_score",
        qualityScore
      );
      this.metrics.recordGauge(
        "apikey.health.entropy_generation_time",
        avgGenerationTime
      );

      this.logger.info("Entropy source test completed", {
        status,
        successfulRuns,
        qualityScore: qualityScore.toFixed(1),
        avgGenerationTime: avgGenerationTime.toFixed(1),
        duration: performance.now() - startTime,
      });

      return entropyTest;
    } catch (error) {
      this.logger.error("Entropy source test failed", { error });
      this.metrics.recordCounter("apikey.health.entropy_test_error", 1);

      return {
        status: "failed",
        testRuns: 0,
        successfulRuns: 0,
        qualityScore: 0,
        avgGenerationTime: 0,
        details: { attempts: [] },
        recommendations: [
          "Entropy testing system failed - requires investigation",
        ],
      };
    }
  }

  /**
   * Get the last health check result
   */
  getLastHealthCheck(): SystemHealth | null {
    return this.lastHealthCheck || null;
  }

  /**
   * Start continuous health monitoring
   */
  private startContinuousMonitoring(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.warn("Continuous health check error", { error });
      }
    }, this.config.healthCheckInterval);

    this.logger.info("Continuous health monitoring started", {
      interval: this.config.healthCheckInterval,
    });
  }

  /**
   * Check individual component health
   */
  private async checkComponentHealth(
    name: string,
    healthCheckFn?: () => Promise<any>
  ): Promise<ComponentHealth> {
    const startTime = performance.now();

    if (!healthCheckFn) {
      return {
        name,
        status: "unhealthy",
        available: false,
        responseTime: 0,
        error: "Component not available",
        lastCheck: new Date(),
      };
    }

    try {
      const result = await healthCheckFn();
      const responseTime = performance.now() - startTime;

      const status: "healthy" | "degraded" | "unhealthy" =
        responseTime > this.config.performanceThresholds.maxResponseTime
          ? "degraded"
          : result?.available === false
          ? "unhealthy"
          : "healthy";

      return {
        name,
        status,
        available: result?.available !== false,
        responseTime,
        error: result?.error,
        details: result,
        lastCheck: new Date(),
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      return {
        name,
        status: "unhealthy",
        available: false,
        responseTime,
        error:
          error instanceof Error
            ? error.message
            : "Component health check failed",
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      await this.dbClient.executeRaw("SELECT 1");
      const responseTime = performance.now() - startTime;

      const status: "healthy" | "degraded" | "unhealthy" =
        responseTime > this.config.performanceThresholds.maxResponseTime
          ? "degraded"
          : "healthy";

      return {
        name: "database",
        status,
        available: true,
        responseTime,
        details: { connectionTest: "passed" },
        lastCheck: new Date(),
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      return {
        name: "database",
        status: "unhealthy",
        available: false,
        responseTime,
        error:
          error instanceof Error ? error.message : "Database connection failed",
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check entropy health
   */
  private async checkEntropyHealth(): Promise<ComponentHealth> {
    try {
      const entropyTest = await this.testEntropySource();

      let status: "healthy" | "degraded" | "unhealthy";
      switch (entropyTest.status) {
        case "healthy":
          status = "healthy";
          break;
        case "degraded":
          status = "degraded";
          break;
        case "failed":
          status = "unhealthy";
          break;
      }

      return {
        name: "entropy",
        status,
        available: entropyTest.successfulRuns > 0,
        responseTime: entropyTest.avgGenerationTime,
        details: entropyTest,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        name: "entropy",
        status: "unhealthy",
        available: false,
        responseTime: 0,
        error:
          error instanceof Error
            ? error.message
            : "Entropy health check failed",
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Validate entropy quality using basic statistical tests
   */
  private validateEntropyQuality(bytes: Buffer): boolean {
    try {
      // Basic entropy quality checks
      const length = bytes.length;
      if (length < 16) return false;

      // Check for obvious patterns (all zeros, all ones, etc.)
      const uniqueBytes = new Set(bytes).size;
      if (uniqueBytes < length * 0.6) return false; // At least 60% unique bytes

      // Simple chi-square test for randomness
      const expected = length / 256;
      const counts = new Array(256).fill(0);
      for (let i = 0; i < length; i++) {
        const byteValue = bytes[i];
        if (byteValue !== undefined) {
          counts[byteValue]++;
        }
      }

      let chiSquare = 0;
      for (let i = 0; i < 256; i++) {
        const diff = counts[i] - expected;
        chiSquare += (diff * diff) / expected;
      }

      // Accept if chi-square is reasonable (not too perfect, not too random)
      return chiSquare < 400 && chiSquare > 100;
    } catch (error) {
      this.logger.warn("Entropy quality validation failed", { error });
      return false;
    }
  }

  /**
   * Calculate system-wide metrics
   */
  private async calculateSystemMetrics(components: ComponentHealth[]): Promise<{
    totalValidations: number;
    successRate: number;
    avgResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
  }> {
    // This would typically query metrics from the metrics system
    // For now, we'll calculate based on component health
    const healthyComponents = components.filter(
      (c) => c.status === "healthy"
    ).length;
    const totalComponents = components.length;

    const avgResponseTime =
      totalComponents > 0
        ? components.reduce((sum, c) => sum + c.responseTime, 0) /
          totalComponents
        : 0;

    const successRate =
      totalComponents > 0 ? (healthyComponents / totalComponents) * 100 : 0;

    const errorRate = 100 - successRate;

    return {
      totalValidations: 0, // Would be retrieved from metrics system
      successRate,
      avgResponseTime,
      cacheHitRate: 0, // Would be retrieved from cache metrics
      errorRate,
    };
  }

  /**
   * Determine overall system status
   */
  private determineSystemStatus(
    components: ComponentHealth[],
    database: ComponentHealth,
    entropy: ComponentHealth
  ): "healthy" | "degraded" | "unhealthy" | "critical" {
    // Critical dependencies must be healthy
    if (!database.available) return "critical";
    if (!entropy.available) return "critical";

    // Count component statuses
    const unhealthyComponents = components.filter(
      (c) => c.status === "unhealthy"
    ).length;
    const degradedComponents = components.filter(
      (c) => c.status === "degraded"
    ).length;
    const totalComponents = components.length;

    if (unhealthyComponents > totalComponents * 0.5) return "unhealthy";
    if (unhealthyComponents > 0 || degradedComponents > totalComponents * 0.3)
      return "degraded";
    if (database.status !== "healthy" || entropy.status !== "healthy")
      return "degraded";

    return "healthy";
  }

  /**
   * Generate health recommendations
   */
  private generateRecommendations(
    components: ComponentHealth[],
    metrics: any,
    database: ComponentHealth,
    entropy: ComponentHealth
  ): string[] {
    const recommendations: string[] = [];

    // Check critical dependencies
    if (!database.available) {
      recommendations.push(
        "CRITICAL: Database connection failed - immediate attention required"
      );
    }
    if (!entropy.available) {
      recommendations.push(
        "CRITICAL: Entropy source failed - secure key generation not possible"
      );
    }

    // Check component health
    const unhealthyComponents = components.filter(
      (c) => c.status === "unhealthy"
    );
    if (unhealthyComponents.length > 0) {
      recommendations.push(
        `${
          unhealthyComponents.length
        } components are unhealthy: ${unhealthyComponents
          .map((c) => c.name)
          .join(", ")}`
      );
    }

    // Check performance metrics
    if (
      metrics.avgResponseTime >
      this.config.performanceThresholds.maxResponseTime
    ) {
      recommendations.push(
        `Average response time (${metrics.avgResponseTime.toFixed(
          1
        )}ms) exceeds threshold`
      );
    }
    if (
      metrics.successRate < this.config.performanceThresholds.minSuccessRate
    ) {
      recommendations.push(
        `Success rate (${metrics.successRate.toFixed(1)}%) below threshold`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("System operating within normal parameters");
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting health monitor cleanup");

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    this.logger.info("Health monitor cleanup completed");
  }
}
