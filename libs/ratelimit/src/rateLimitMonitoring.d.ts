import { RateLimitingCacheAdapter } from "./adapters/RateLimitingCacheAdapter";
import { RateLimitResult } from "./types";
/**
 * Rate limit monitoring service
 * Integrates with existing monitoring infrastructure
 */
export declare class RateLimitMonitoringService {
    private rateLimiter;
    private metrics;
    private readonly alerts;
    logger: import("@libs/utils").ILogger;
    constructor(rateLimiter: RateLimitingCacheAdapter);
    /**
     * Record a rate limit check
     */
    recordCheck(result: RateLimitResult, responseTime: number): void;
    /**
     * Record circuit breaker event
     */
    recordCircuitBreakerTrip(): void;
    /**
     * Record Redis error
     */
    recordRedisError(error: Error): void;
    /**
     * Get current metrics
     */
    getMetrics(): typeof this.metrics;
    /**
     * Get health status
     */
    getHealthStatus(): Promise<any>;
    /**
     * Initialize default alerts
     */
    private initializeDefaultAlerts;
    /**
     * Check if any alerts should be triggered
     */
    private checkAlerts;
    /**
     * Get currently active alerts
     */
    private getActiveAlerts;
    /**
     * Reset metrics (useful for testing or periodic resets)
     */
    resetMetrics(): void;
    /**
     * Add custom alert
     */
    addAlert(name: string, threshold: number): void;
    /**
     * Remove alert
     */
    removeAlert(name: string): void;
}
//# sourceMappingURL=rateLimitMonitoring.d.ts.map