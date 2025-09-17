import { createLogger } from "@libs/utils";
/**
 * Rate limit monitoring service
 * Integrates with existing monitoring infrastructure
 */
export class RateLimitMonitoringService {
    rateLimiter;
    metrics = {
        totalRequests: 0,
        allowedRequests: 0,
        deniedRequests: 0,
        circuitBreakerTrips: 0,
        redisErrors: 0,
        averageResponseTime: 0,
        peakRequestsPerMinute: 0,
    };
    alerts = new Map();
    logger = createLogger("RateLimitMonitoring");
    constructor(rateLimiter) {
        this.rateLimiter = rateLimiter;
        this.initializeDefaultAlerts();
    }
    /**
     * Record a rate limit check
     */
    recordCheck(result, responseTime) {
        this.metrics.totalRequests++;
        if (result.allowed) {
            this.metrics.allowedRequests++;
        }
        else {
            this.metrics.deniedRequests++;
        }
        // Update average response time
        const totalResponseTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) +
            responseTime;
        this.metrics.averageResponseTime =
            totalResponseTime / this.metrics.totalRequests;
        // Check alerts
        this.checkAlerts();
        this.logger.debug("Rate limit check recorded", {
            allowed: result.allowed,
            responseTime,
            totalRequests: this.metrics.totalRequests,
        });
    }
    /**
     * Record circuit breaker event
     */
    recordCircuitBreakerTrip() {
        this.metrics.circuitBreakerTrips++;
        this.logger.warn("Circuit breaker tripped", {
            totalTrips: this.metrics.circuitBreakerTrips,
        });
    }
    /**
     * Record Redis error
     */
    recordRedisError(error) {
        this.metrics.redisErrors++;
        this.logger.error("Redis error in rate limiter", error, {
            totalErrors: this.metrics.redisErrors,
        });
    }
    /**
     * Get current metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Get health status
     */
    async getHealthStatus() {
        const rateLimiterHealth = await this.rateLimiter.getHealth();
        const stats = this.rateLimiter.getRateLimitingStats();
        const health = {
            status: "healthy",
            metrics: this.getMetrics(),
            rateLimiter: rateLimiterHealth,
            stats: stats,
            alerts: this.getActiveAlerts(),
            timestamp: new Date().toISOString(),
        };
        // Determine overall health
        if (this.metrics.redisErrors > 10 || this.metrics.circuitBreakerTrips > 5) {
            health.status = "unhealthy";
        }
        else if (this.metrics.redisErrors > 5 ||
            this.metrics.circuitBreakerTrips > 2) {
            health.status = "degraded";
        }
        return health;
    }
    /**
     * Initialize default alerts
     */
    initializeDefaultAlerts() {
        this.alerts.set("high-error-rate", {
            threshold: 0.1, // 10% error rate
            triggered: false,
        });
        this.alerts.set("high-denial-rate", {
            threshold: 0.5, // 50% denial rate
            triggered: false,
        });
        this.alerts.set("circuit-breaker-frequent", {
            threshold: 3, // 3+ trips
            triggered: false,
        });
    }
    /**
     * Check if any alerts should be triggered
     */
    checkAlerts() {
        const totalRequests = this.metrics.totalRequests;
        if (totalRequests === 0)
            return;
        const errorRate = this.metrics.redisErrors / totalRequests;
        const denialRate = this.metrics.deniedRequests / totalRequests;
        // Check error rate alert
        const errorAlert = this.alerts.get("high-error-rate");
        if (errorRate > errorAlert.threshold && !errorAlert.triggered) {
            errorAlert.triggered = true;
            this.logger.warn("High error rate alert triggered", {
                errorRate: errorRate.toFixed(3),
                threshold: errorAlert.threshold,
            });
        }
        else if (errorRate <= errorAlert.threshold && errorAlert.triggered) {
            errorAlert.triggered = false;
            this.logger.info("High error rate alert resolved", {
                errorRate: errorRate.toFixed(3),
            });
        }
        // Check denial rate alert
        const denialAlert = this.alerts.get("high-denial-rate");
        if (denialRate > denialAlert.threshold && !denialAlert.triggered) {
            denialAlert.triggered = true;
            this.logger.warn("High denial rate alert triggered", {
                denialRate: denialRate.toFixed(3),
                threshold: denialAlert.threshold,
            });
        }
        else if (denialRate <= denialAlert.threshold && denialAlert.triggered) {
            denialAlert.triggered = false;
            this.logger.info("High denial rate alert resolved", {
                denialRate: denialRate.toFixed(3),
            });
        }
        // Check circuit breaker alert
        const circuitAlert = this.alerts.get("circuit-breaker-frequent");
        if (this.metrics.circuitBreakerTrips >= circuitAlert.threshold &&
            !circuitAlert.triggered) {
            circuitAlert.triggered = true;
            this.logger.warn("Frequent circuit breaker trips alert triggered", {
                trips: this.metrics.circuitBreakerTrips,
                threshold: circuitAlert.threshold,
            });
        }
    }
    /**
     * Get currently active alerts
     */
    getActiveAlerts() {
        const activeAlerts = [];
        for (const [alertName, alert] of this.alerts) {
            if (alert.triggered) {
                activeAlerts.push(alertName);
            }
        }
        return activeAlerts;
    }
    /**
     * Reset metrics (useful for testing or periodic resets)
     */
    resetMetrics() {
        this.metrics = {
            totalRequests: 0,
            allowedRequests: 0,
            deniedRequests: 0,
            circuitBreakerTrips: 0,
            redisErrors: 0,
            averageResponseTime: 0,
            peakRequestsPerMinute: 0,
        };
        // Reset alert triggers
        for (const alert of this.alerts.values()) {
            alert.triggered = false;
        }
        this.logger.info("Metrics reset");
    }
    /**
     * Add custom alert
     */
    addAlert(name, threshold) {
        this.alerts.set(name, { threshold, triggered: false });
        this.logger.info("Custom alert added", { name, threshold });
    }
    /**
     * Remove alert
     */
    removeAlert(name) {
        if (this.alerts.delete(name)) {
            this.logger.info("Alert removed", { name });
        }
    }
}
//# sourceMappingURL=rateLimitMonitoring.js.map