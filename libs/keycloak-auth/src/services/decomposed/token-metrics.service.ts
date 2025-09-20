import { createLogger, type ILogger } from "@libs/utils";

/**
 * Metrics data structure for token operations
 */
export interface TokenMetricsData {
  jwtValidations: number;
  jwtValidationSuccesses: number;
  jwtValidationFailures: number;
  introspectionCalls: number;
  introspectionSuccesses: number;
  introspectionFailures: number;
  cacheHits: number;
  cacheMisses: number;
  publicKeyFetches: number;
  publicKeyFetchSuccesses: number;
  publicKeyFetchFailures: number;
  lastResetTime: number;
}

/**
 * Comprehensive metrics statistics
 */
export interface TokenMetricsStats {
  // Raw counters
  cacheHits: number;
  cacheMisses: number;
  introspectionCalls: number;
  jwtValidations: number;
  jwtValidationSuccesses: number;
  jwtValidationFailures: number;
  introspectionSuccesses: number;
  introspectionFailures: number;
  publicKeyFetches: number;
  publicKeyFetchSuccesses: number;
  publicKeyFetchFailures: number;

  // Calculated rates
  cacheHitRate: number;
  jwtValidationSuccessRate: number;
  introspectionSuccessRate: number;
  publicKeyFetchSuccessRate: number;

  // Operational metrics
  uptimeSeconds: number;
  operationsPerSecond: number;
}

/**
 * Metrics operation types for tracking
 */
export enum MetricsOperation {
  JWT_VALIDATION = "jwt_validation",
  JWT_VALIDATION_SUCCESS = "jwt_validation_success",
  JWT_VALIDATION_FAILURE = "jwt_validation_failure",
  INTROSPECTION_CALL = "introspection_call",
  INTROSPECTION_SUCCESS = "introspection_success",
  INTROSPECTION_FAILURE = "introspection_failure",
  CACHE_HIT = "cache_hit",
  CACHE_MISS = "cache_miss",
  PUBLIC_KEY_FETCH = "public_key_fetch",
  PUBLIC_KEY_FETCH_SUCCESS = "public_key_fetch_success",
  PUBLIC_KEY_FETCH_FAILURE = "public_key_fetch_failure",
  // WebSocket-specific operations
  WEBSOCKET_CONNECTION = "websocket_connection",
  WEBSOCKET_CONNECTION_SUCCESS = "websocket_connection_success",
  WEBSOCKET_CONNECTION_FAILURE = "websocket_connection_failure",
  WEBSOCKET_AUTH_VALIDATION = "websocket_auth_validation",
  WEBSOCKET_AUTH_SUCCESS = "websocket_auth_success",
  WEBSOCKET_AUTH_FAILURE = "websocket_auth_failure",
  WEBSOCKET_PERMISSION_CHECK = "websocket_permission_check",
  WEBSOCKET_PERMISSION_GRANTED = "websocket_permission_granted",
  WEBSOCKET_PERMISSION_DENIED = "websocket_permission_denied",
  WEBSOCKET_SESSION_REFRESH = "websocket_session_refresh",
  WEBSOCKET_CLEANUP = "websocket_cleanup",
}

/**
 * Interface for token metrics service
 */
export interface ITokenMetricsService {
  /**
   * Record a metrics operation
   */
  recordOperation(operation: MetricsOperation): void;

  /**
   * Get comprehensive metrics statistics
   */
  getStats(): TokenMetricsStats;

  /**
   * Reset all metrics counters
   */
  resetMetrics(): void;

  /**
   * Get raw metrics data
   */
  getRawMetrics(): TokenMetricsData;

  /**
   * Get service health metrics
   */
  getHealthMetrics(): {
    uptimeSeconds: number;
    totalOperations: number;
    successRate: number;
    cacheEfficiency: number;
  };
}

/**
 * Token Metrics Service
 *
 * Centralized metrics collection and reporting for token operations.
 * Provides comprehensive tracking of JWT validation, introspection, caching,
 * and public key operations with calculated success rates and performance metrics.
 *
 * Features:
 * - Real-time metrics collection
 * - Success rate calculations
 * - Cache efficiency tracking
 * - Health monitoring
 * - Configurable reset functionality
 */
export class TokenMetricsService implements ITokenMetricsService {
  private logger: ILogger;
  private metrics: TokenMetricsData;

  constructor() {
    this.logger = createLogger("token-metrics-service");
    this.metrics = this.initializeMetrics();

    this.logger.info("TokenMetricsService initialized");
  }

  /**
   * Initialize metrics with default values
   */
  private initializeMetrics(): TokenMetricsData {
    return {
      jwtValidations: 0,
      jwtValidationSuccesses: 0,
      jwtValidationFailures: 0,
      introspectionCalls: 0,
      introspectionSuccesses: 0,
      introspectionFailures: 0,
      cacheHits: 0,
      cacheMisses: 0,
      publicKeyFetches: 0,
      publicKeyFetchSuccesses: 0,
      publicKeyFetchFailures: 0,
      lastResetTime: Date.now(),
    };
  }

  /**
   * Record a metrics operation
   *
   * @param operation - The operation type to record
   */
  public recordOperation(operation: MetricsOperation): void {
    switch (operation) {
      case MetricsOperation.JWT_VALIDATION:
        this.metrics.jwtValidations++;
        break;
      case MetricsOperation.JWT_VALIDATION_SUCCESS:
        this.metrics.jwtValidationSuccesses++;
        break;
      case MetricsOperation.JWT_VALIDATION_FAILURE:
        this.metrics.jwtValidationFailures++;
        break;
      case MetricsOperation.INTROSPECTION_CALL:
        this.metrics.introspectionCalls++;
        break;
      case MetricsOperation.INTROSPECTION_SUCCESS:
        this.metrics.introspectionSuccesses++;
        break;
      case MetricsOperation.INTROSPECTION_FAILURE:
        this.metrics.introspectionFailures++;
        break;
      case MetricsOperation.CACHE_HIT:
        this.metrics.cacheHits++;
        break;
      case MetricsOperation.CACHE_MISS:
        this.metrics.cacheMisses++;
        break;
      case MetricsOperation.PUBLIC_KEY_FETCH:
        this.metrics.publicKeyFetches++;
        break;
      case MetricsOperation.PUBLIC_KEY_FETCH_SUCCESS:
        this.metrics.publicKeyFetchSuccesses++;
        break;
      case MetricsOperation.PUBLIC_KEY_FETCH_FAILURE:
        this.metrics.publicKeyFetchFailures++;
        break;
      default:
        this.logger.warn("Unknown metrics operation", { operation });
    }
  }

  /**
   * Get comprehensive metrics statistics with calculated rates
   *
   * @returns Complete metrics statistics including rates and uptime
   */
  public getStats(): TokenMetricsStats {
    const uptimeSeconds = Math.floor(
      (Date.now() - this.metrics.lastResetTime) / 1000
    );

    const totalOperations =
      this.metrics.jwtValidations +
      this.metrics.introspectionCalls +
      this.metrics.publicKeyFetches;

    const operationsPerSecond =
      uptimeSeconds > 0 ? totalOperations / uptimeSeconds : 0;

    return {
      // Raw counters
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      introspectionCalls: this.metrics.introspectionCalls,
      jwtValidations: this.metrics.jwtValidations,
      jwtValidationSuccesses: this.metrics.jwtValidationSuccesses,
      jwtValidationFailures: this.metrics.jwtValidationFailures,
      introspectionSuccesses: this.metrics.introspectionSuccesses,
      introspectionFailures: this.metrics.introspectionFailures,
      publicKeyFetches: this.metrics.publicKeyFetches,
      publicKeyFetchSuccesses: this.metrics.publicKeyFetchSuccesses,
      publicKeyFetchFailures: this.metrics.publicKeyFetchFailures,

      // Calculated rates
      cacheHitRate: this.calculateRate(
        this.metrics.cacheHits,
        this.metrics.cacheMisses
      ),
      jwtValidationSuccessRate: this.calculateRate(
        this.metrics.jwtValidationSuccesses,
        this.metrics.jwtValidationFailures
      ),
      introspectionSuccessRate: this.calculateRate(
        this.metrics.introspectionSuccesses,
        this.metrics.introspectionFailures
      ),
      publicKeyFetchSuccessRate: this.calculateRate(
        this.metrics.publicKeyFetchSuccesses,
        this.metrics.publicKeyFetchFailures
      ),

      // Operational metrics
      uptimeSeconds,
      operationsPerSecond,
    };
  }

  /**
   * Reset all metrics counters to zero
   */
  public resetMetrics(): void {
    this.metrics = this.initializeMetrics();
    this.logger.info("Metrics counters reset");
  }

  /**
   * Get raw metrics data without calculations
   *
   * @returns Raw metrics data structure
   */
  public getRawMetrics(): TokenMetricsData {
    return { ...this.metrics };
  }

  /**
   * Get service health metrics for monitoring
   *
   * @returns Health metrics including uptime, operations, and efficiency rates
   */
  public getHealthMetrics(): {
    uptimeSeconds: number;
    totalOperations: number;
    successRate: number;
    cacheEfficiency: number;
  } {
    const uptimeSeconds = Math.floor(
      (Date.now() - this.metrics.lastResetTime) / 1000
    );

    const totalOperations =
      this.metrics.jwtValidations +
      this.metrics.introspectionCalls +
      this.metrics.publicKeyFetches;

    const totalSuccesses =
      this.metrics.jwtValidationSuccesses +
      this.metrics.introspectionSuccesses +
      this.metrics.publicKeyFetchSuccesses;

    const totalFailures =
      this.metrics.jwtValidationFailures +
      this.metrics.introspectionFailures +
      this.metrics.publicKeyFetchFailures;

    const successRate = this.calculateRate(totalSuccesses, totalFailures);
    const cacheEfficiency = this.calculateRate(
      this.metrics.cacheHits,
      this.metrics.cacheMisses
    );

    return {
      uptimeSeconds,
      totalOperations,
      successRate,
      cacheEfficiency,
    };
  }

  /**
   * Calculate success rate as a percentage
   *
   * @param successes - Number of successful operations
   * @param failures - Number of failed operations
   * @returns Success rate as percentage (0-100) with 2 decimal precision
   */
  private calculateRate(successes: number, failures: number): number {
    const total = successes + failures;
    return total > 0 ? Math.round((successes / total) * 100 * 100) / 100 : 0;
  }

  /**
   * Get metrics summary for logging
   *
   * @returns Formatted metrics summary
   */
  public getMetricsSummary(): Record<string, any> {
    const stats = this.getStats();
    return {
      uptime: `${stats.uptimeSeconds}s`,
      operations: {
        jwt: stats.jwtValidations,
        introspection: stats.introspectionCalls,
        publicKey: stats.publicKeyFetches,
      },
      rates: {
        cacheHit: `${stats.cacheHitRate}%`,
        jwtSuccess: `${stats.jwtValidationSuccessRate}%`,
        introspectionSuccess: `${stats.introspectionSuccessRate}%`,
        publicKeySuccess: `${stats.publicKeyFetchSuccessRate}%`,
      },
      opsPerSecond: stats.operationsPerSecond.toFixed(2),
    };
  }
}

/**
 * Factory function to create token metrics service
 */
export const createTokenMetricsService = (): TokenMetricsService => {
  return new TokenMetricsService();
};
