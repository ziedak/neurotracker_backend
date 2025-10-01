/**
 * Common types shared across all keycloak-authV2 services
 *
 * This file consolidates type definitions that were previously
 * scattered across multiple service-specific files to eliminate
 * duplication and ensure consistency.
 */

/**
 * Standard health check result interface
 * Used by all services for consistent health reporting
 */
export interface HealthCheckResult {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly details: Record<string, any>;
  readonly timestamp?: Date;
  readonly message?: string;
}

/**
 * Individual component health information
 * Used by monitoring systems and health aggregators
 */
export interface ComponentHealth {
  readonly name: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly available: boolean;
  readonly responseTime: number;
  readonly error?: string;
  readonly details?: any;
  readonly lastCheck: Date;
}

/**
 * System-wide health aggregation
 * Provides comprehensive health overview across all components
 */
export interface SystemHealth {
  readonly status: "healthy" | "degraded" | "unhealthy" | "critical";
  readonly components: ComponentHealth[];
  readonly dependencies: {
    readonly database: ComponentHealth;
    readonly cache: ComponentHealth;
    readonly entropy: ComponentHealth;
  };
  readonly metrics: {
    readonly totalValidations: number;
    readonly successRate: number;
    readonly avgResponseTime: number;
    readonly cacheHitRate: number;
    readonly errorRate: number;
  };
  readonly recommendations: string[];
  readonly lastCheck: Date;
}

/**
 * Configuration interface for health monitoring
 * Allows customization of health check behavior
 */
export interface HealthMonitorConfig {
  readonly healthCheckInterval: number;
  readonly enableContinuousMonitoring: boolean;
  readonly performanceThresholds: {
    readonly maxResponseTime: number;
    readonly minSuccessRate: number;
    readonly maxErrorRate: number;
    readonly minCacheHitRate: number;
  };
}

/**
 * Performance metrics interface
 * Used for tracking and reporting system performance
 */
export interface PerformanceMetrics {
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly averageResponseTime: number;
  readonly peakResponseTime: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly startTime: Date;
  readonly lastUpdated: Date;
}
