/**
 * Performance Benchmarking Suite for libs/auth Optimization
 * Phase 1: Establish baseline metrics and Redis-first caching
 */

import { performance } from "perf_hooks";
import { Logger } from "@libs/monitoring";
import { RedisClient } from "@libs/database";

export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
  success: boolean;
  error?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface BenchmarkResult {
  operation: string;
  samples: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  minLatency: number;
  maxLatency: number;
  errorRate: number;
  throughput: number; // operations per second
  memoryUsage: {
    average: number;
    peak: number;
    delta: number;
  };
}

export interface SystemBaseline {
  timestamp: number;
  authenticationLatency: BenchmarkResult;
  sessionLookup: BenchmarkResult;
  permissionCheck: BenchmarkResult;
  tokenValidation: BenchmarkResult;
  websocketMessageValidation?: BenchmarkResult;
  overallMemoryUsage: number;
  redisHealth: {
    connected: boolean;
    latency: number;
  };
  databaseConnections: number;
}

/**
 * Performance benchmarking service
 */
export class PerformanceBenchmark {
  private readonly logger: ILogger;
  private readonly redis: any;
  private readonly measurements: PerformanceMetrics[] = [];

  constructor() {
    this.logger = new Logger({ service: "PerformanceBenchmark" });
    this.redis = RedisClient.getInstance();
  }

  /**
   * Start a performance measurement
   */
  startMeasurement(
    operation: string,
    metadata?: Record<string, unknown>
  ): string {
    const measurementId = `${operation}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;

    const measurement: PerformanceMetrics = {
      operation,
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      memoryBefore: this.getMemoryUsage(),
      memoryAfter: 0,
      memoryDelta: 0,
      success: true,
      metadata: metadata || undefined,
    };

    this.measurements.push(measurement);
    return measurementId;
  }

  /**
   * End a performance measurement
   */
  endMeasurement(
    measurementId: string,
    success: boolean = true,
    error?: string
  ): PerformanceMetrics {
    const measurement = this.measurements.find(
      (m) => measurementId.startsWith(`${m.operation}_`) && m.endTime === 0
    );

    if (!measurement) {
      throw new Error(`Measurement not found: ${measurementId}`);
    }

    measurement.endTime = performance.now();
    measurement.duration = measurement.endTime - measurement.startTime;
    measurement.memoryAfter = this.getMemoryUsage();
    measurement.memoryDelta =
      measurement.memoryAfter - measurement.memoryBefore;
    measurement.success = success;
    if (error !== undefined) {
      measurement.error = error;
    }

    // Log the measurement
    this.logger.debug("Performance measurement completed", {
      operation: measurement.operation,
      duration: measurement.duration,
      memoryDelta: measurement.memoryDelta,
      success: measurement.success,
    });

    return measurement;
  }

  /**
   * Run a benchmark for a specific operation
   */
  async runBenchmark<T>(
    operationName: string,
    operation: () => Promise<T>,
    samples: number = 100,
    warmupSamples: number = 10
  ): Promise<BenchmarkResult> {
    this.logger.info(`Starting benchmark: ${operationName}`, {
      samples,
      warmupSamples,
    });

    const measurements: PerformanceMetrics[] = [];
    const memoryUsages: number[] = [];
    let errors = 0;

    // Warmup
    for (let i = 0; i < warmupSamples; i++) {
      try {
        await operation();
      } catch (error) {
        // Ignore warmup errors
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const startTime = performance.now();

    // Run benchmark samples
    for (let i = 0; i < samples; i++) {
      const measurementId = this.startMeasurement(operationName, { sample: i });

      try {
        await operation();
        const measurement = this.endMeasurement(measurementId, true);
        measurements.push(measurement);
        memoryUsages.push(measurement.memoryAfter);
      } catch (error) {
        this.endMeasurement(
          measurementId,
          false,
          error instanceof Error ? error.message : String(error)
        );
        errors++;
      }
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    // Calculate statistics
    const durations = measurements.map((m) => m.duration).sort((a, b) => a - b);
    const memoryDeltas = measurements.map((m) => m.memoryDelta);

    const result: BenchmarkResult = {
      operation: operationName,
      samples: measurements.length,
      averageLatency:
        durations.reduce((sum, d) => sum + d, 0) / durations.length,
      p50Latency: durations[Math.floor(durations.length * 0.5)] || 0,
      p95Latency: durations[Math.floor(durations.length * 0.95)] || 0,
      p99Latency: durations[Math.floor(durations.length * 0.99)] || 0,
      minLatency: durations[0] || 0,
      maxLatency: durations[durations.length - 1] || 0,
      errorRate: errors / samples,
      throughput: (samples - errors) / (totalDuration / 1000), // ops per second
      memoryUsage: {
        average:
          memoryUsages.reduce((sum, m) => sum + m, 0) / memoryUsages.length,
        peak: Math.max(...memoryUsages),
        delta:
          memoryDeltas.reduce((sum, d) => sum + d, 0) / memoryDeltas.length,
      },
    };

    this.logger.info(`Benchmark completed: ${operationName}`, result);
    return result;
  }

  /**
   * Establish system performance baseline
   */
  async establishBaseline(): Promise<SystemBaseline> {
    this.logger.info("Establishing performance baseline");

    // Mock implementations for benchmarking - replace with actual service calls
    const mockAuthOperation = async () => {
      // Simulate authentication latency
      await this.redis.get("mock_session_key");
      await this.sleep(Math.random() * 10); // Simulate DB query
      return { success: true };
    };

    const mockSessionLookup = async () => {
      await this.redis.get(`session:${Math.random()}`);
      return { sessionId: "test", userId: "test" };
    };

    const mockPermissionCheck = async () => {
      await this.redis.get(`permissions:${Math.random()}`);
      await this.sleep(Math.random() * 5); // Simulate permission logic
      return { hasPermission: true };
    };

    const mockTokenValidation = async () => {
      await this.sleep(Math.random() * 3); // Simulate JWT verification
      return { valid: true };
    };

    // Run benchmarks
    const [authLatency, sessionLatency, permissionLatency, tokenLatency] =
      await Promise.all([
        this.runBenchmark("authentication", mockAuthOperation, 50),
        this.runBenchmark("session_lookup", mockSessionLookup, 50),
        this.runBenchmark("permission_check", mockPermissionCheck, 50),
        this.runBenchmark("token_validation", mockTokenValidation, 50),
      ]);

    // Check Redis health
    const redisHealth = await this.checkRedisHealth();
    const memoryUsage = this.getMemoryUsage();

    const baseline: SystemBaseline = {
      timestamp: Date.now(),
      authenticationLatency: authLatency,
      sessionLookup: sessionLatency,
      permissionCheck: permissionLatency,
      tokenValidation: tokenLatency,
      overallMemoryUsage: memoryUsage,
      redisHealth,
      databaseConnections: 0, // TODO: Get actual DB connection count
    };

    // Store baseline in Redis for future comparison
    await this.redis.setex(
      "auth:performance:baseline",
      86400, // 24 hours
      JSON.stringify(baseline)
    );

    this.logger.info("Performance baseline established", {
      authLatency: `${authLatency.p95Latency.toFixed(2)}ms P95`,
      sessionLatency: `${sessionLatency.p95Latency.toFixed(2)}ms P95`,
      permissionLatency: `${permissionLatency.p95Latency.toFixed(2)}ms P95`,
      tokenLatency: `${tokenLatency.p95Latency.toFixed(2)}ms P95`,
      memoryUsage: `${(memoryUsage / 1024 / 1024).toFixed(2)}MB`,
    });

    return baseline;
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return memUsage.rss; // Resident Set Size
  }

  /**
   * Check Redis health and latency
   */
  private async checkRedisHealth(): Promise<{
    connected: boolean;
    latency: number;
  }> {
    try {
      const start = performance.now();
      await this.redis.ping();
      const latency = performance.now() - start;

      return {
        connected: true,
        latency,
      };
    } catch (error) {
      return {
        connected: false,
        latency: -1,
      };
    }
  }

  /**
   * Helper function to simulate async delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get historical measurements
   */
  getMeasurements(operation?: string): PerformanceMetrics[] {
    if (operation) {
      return this.measurements.filter((m) => m.operation === operation);
    }
    return [...this.measurements];
  }

  /**
   * Clear measurements
   */
  clearMeasurements(): void {
    this.measurements.length = 0;
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const operations = [...new Set(this.measurements.map((m) => m.operation))];
    let report = "Performance Report\n=================\n\n";

    for (const operation of operations) {
      const opMeasurements = this.measurements.filter(
        (m) => m.operation === operation
      );
      const durations = opMeasurements.map((m) => m.duration);
      const avgDuration =
        durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const successRate =
        opMeasurements.filter((m) => m.success).length / opMeasurements.length;

      report += `${operation}:\n`;
      report += `  Samples: ${opMeasurements.length}\n`;
      report += `  Average Duration: ${avgDuration.toFixed(2)}ms\n`;
      report += `  Success Rate: ${(successRate * 100).toFixed(2)}%\n\n`;
    }

    return report;
  }
}
