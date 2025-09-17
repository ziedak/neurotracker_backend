/**
 * Enhanced Monitoring Service
 * Provides comprehensive metrics collection for authentication events
 * Supports real-time monitoring, alerting, and performance analytics
 */
// ===================================================================
// ENHANCED MONITORING SERVICE
// ===================================================================
export class EnhancedMonitoringService {
    deps;
    metrics;
    events = [];
    alertRules = [];
    startTime;
    constructor(deps) {
        this.deps = deps;
        this.startTime = new Date();
        this.initializeMetrics();
        this.initializeAlertRules();
    }
    /**
     * Initialize metrics with default values
     */
    initializeMetrics() {
        this.metrics = {
            loginAttempts: 0,
            loginSuccesses: 0,
            loginFailures: 0,
            registrations: 0,
            tokenRefreshes: 0,
            tokenRevocations: 0,
            bruteForceAttempts: 0,
            suspiciousActivities: 0,
            accountLockouts: 0,
            ipBlocks: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            errorRate: 0,
            activeUsers: 0,
            concurrentSessions: 0,
            apiKeyUsages: 0,
            uptime: 0,
            memoryUsage: 0,
            redisConnections: 0,
        };
    }
    /**
     * Initialize default alert rules
     */
    initializeAlertRules() {
        this.alertRules = [
            {
                id: "high-failure-rate",
                name: "High Authentication Failure Rate",
                condition: (metrics) => {
                    const total = metrics.loginAttempts;
                    const failures = metrics.loginFailures;
                    return total > 10 && failures / total > 0.5;
                },
                severity: "warning",
                message: "Authentication failure rate exceeds 50%",
                cooldown: 5,
            },
            {
                id: "brute-force-detected",
                name: "Brute Force Attack Detected",
                condition: (metrics) => metrics.bruteForceAttempts > 5,
                severity: "critical",
                message: "Potential brute force attack detected",
                cooldown: 1,
            },
            {
                id: "high-error-rate",
                name: "High Error Rate",
                condition: (metrics) => metrics.errorRate > 0.1,
                severity: "error",
                message: "Authentication error rate exceeds 10%",
                cooldown: 10,
            },
            {
                id: "suspicious-activity",
                name: "Suspicious Activity Spike",
                condition: (metrics) => metrics.suspiciousActivities > 10,
                severity: "warning",
                message: "Unusual number of suspicious activities detected",
                cooldown: 15,
            },
        ];
    }
    /**
     * Record authentication event
     */
    recordAuthEvent(eventType, userId, metadata) {
        const event = {
            type: eventType,
            userId,
            timestamp: new Date(),
            metadata,
            severity: this.getEventSeverity(eventType),
        };
        this.events.push(event);
        // Update metrics
        switch (eventType) {
            case "login_attempt":
                this.metrics.loginAttempts++;
                break;
            case "login_success":
                this.metrics.loginSuccesses++;
                break;
            case "login_failure":
                this.metrics.loginFailures++;
                break;
            case "registration":
                this.metrics.registrations++;
                break;
            case "token_refresh":
                this.metrics.tokenRefreshes++;
                break;
            case "token_revocation":
                this.metrics.tokenRevocations++;
                break;
        }
        // Check alert rules
        this.checkAlerts();
        // Log event
        this.deps.monitoring.logger.info(`Auth event: ${eventType}`, {
            userId,
            ...metadata,
        });
    }
    /**
     * Record security event
     */
    recordSecurityEvent(eventType, userId, ipAddress, metadata) {
        const event = {
            type: eventType,
            userId,
            ipAddress,
            timestamp: new Date(),
            metadata,
            severity: "high",
        };
        this.events.push(event);
        // Update metrics
        switch (eventType) {
            case "brute_force":
                this.metrics.bruteForceAttempts++;
                break;
            case "suspicious_activity":
                this.metrics.suspiciousActivities++;
                break;
            case "account_lockout":
                this.metrics.accountLockouts++;
                break;
            case "ip_block":
                this.metrics.ipBlocks++;
                break;
        }
        // Check alert rules
        this.checkAlerts();
        // Log security event with higher priority
        this.deps.monitoring.logger.warn(`Security event: ${eventType}`, {
            userId,
            ipAddress,
            ...metadata,
        });
    }
    /**
     * Record performance metric
     */
    recordPerformanceMetric(metricType, value, metadata) {
        const event = {
            type: `performance_${metricType}`,
            timestamp: new Date(),
            metadata: { value, ...metadata },
            severity: "low",
        };
        this.events.push(event);
        // Update performance metrics
        switch (metricType) {
            case "response_time":
                this.updateAverageResponseTime(value);
                break;
            case "cache_hit":
                this.updateCacheHitRate(true);
                break;
            case "cache_miss":
                this.updateCacheHitRate(false);
                break;
            case "error":
                this.metrics.errorRate = this.calculateErrorRate();
                break;
        }
    }
    /**
     * Get current metrics
     */
    getMetrics() {
        // Update real-time metrics
        this.metrics.uptime = Date.now() - this.startTime.getTime();
        this.metrics.memoryUsage = process.memoryUsage().heapUsed;
        this.metrics.errorRate = this.calculateErrorRate();
        return { ...this.metrics };
    }
    /**
     * Get recent events
     */
    getRecentEvents(limit = 100) {
        return this.events.slice(-limit);
    }
    /**
     * Get events by type
     */
    getEventsByType(type, limit = 50) {
        return this.events.filter((event) => event.type === type).slice(-limit);
    }
    /**
     * Get events by user
     */
    getEventsByUser(userId, limit = 50) {
        return this.events.filter((event) => event.userId === userId).slice(-limit);
    }
    /**
     * Get events by IP address
     */
    getEventsByIP(ipAddress, limit = 50) {
        return this.events
            .filter((event) => event.ipAddress === ipAddress)
            .slice(-limit);
    }
    /**
     * Clear old events (keep last N events)
     */
    clearOldEvents(keepLast = 1000) {
        if (this.events.length > keepLast) {
            this.events = this.events.slice(-keepLast);
        }
    }
    /**
     * Reset metrics
     */
    resetMetrics() {
        this.initializeMetrics();
        this.startTime = new Date();
    }
    /**
     * Add custom alert rule
     */
    addAlertRule(rule) {
        this.alertRules.push(rule);
    }
    /**
     * Remove alert rule
     */
    removeAlertRule(ruleId) {
        this.alertRules = this.alertRules.filter((rule) => rule.id !== ruleId);
    }
    /**
     * Get active alerts
     */
    getActiveAlerts() {
        return this.alertRules.filter((rule) => rule.lastTriggered);
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    getEventSeverity(eventType) {
        const severityMap = {
            login_attempt: "low",
            login_success: "low",
            login_failure: "medium",
            registration: "low",
            token_refresh: "low",
            token_revocation: "medium",
            brute_force: "critical",
            suspicious_activity: "high",
            account_lockout: "high",
            ip_block: "high",
        };
        return severityMap[eventType] || "medium";
    }
    updateAverageResponseTime(responseTime) {
        const currentAvg = this.metrics.averageResponseTime;
        const totalRequests = this.metrics.loginAttempts + this.metrics.tokenRefreshes;
        if (totalRequests === 0) {
            this.metrics.averageResponseTime = responseTime;
        }
        else {
            this.metrics.averageResponseTime =
                (currentAvg * (totalRequests - 1) + responseTime) / totalRequests;
        }
    }
    updateCacheHitRate(isHit) {
        // Simple cache hit rate calculation
        // In production, you'd track this more accurately
        const currentRate = this.metrics.cacheHitRate;
        this.metrics.cacheHitRate = isHit
            ? Math.min(currentRate + 0.01, 1.0)
            : Math.max(currentRate - 0.01, 0.0);
    }
    calculateErrorRate() {
        const total = this.metrics.loginAttempts + this.metrics.tokenRefreshes;
        const errors = this.metrics.loginFailures;
        return total > 0 ? errors / total : 0;
    }
    checkAlerts() {
        const metrics = this.getMetrics();
        for (const rule of this.alertRules) {
            // Check cooldown
            if (rule.lastTriggered) {
                const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
                const cooldownMs = rule.cooldown * 60 * 1000;
                if (timeSinceLastTrigger < cooldownMs) {
                    continue;
                }
            }
            // Check condition
            if (rule.condition(metrics)) {
                rule.lastTriggered = new Date();
                // Log alert
                const logLevel = rule.severity === "critical"
                    ? "error"
                    : rule.severity === "error"
                        ? "error"
                        : "warn";
                this.deps.monitoring.logger[logLevel](`ALERT: ${rule.name}`, {
                    message: rule.message,
                    severity: rule.severity,
                    metrics,
                });
                // In production, you might want to send notifications here
                // this.sendAlertNotification(rule);
            }
        }
    }
}
// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================
/**
 * Create enhanced monitoring service instance
 */
export function createEnhancedMonitoringService(deps) {
    return new EnhancedMonitoringService(deps);
}
/**
 * Quick metrics summary
 */
export function getMetricsSummary(metrics) {
    const totalLogins = metrics.loginAttempts;
    const successRate = totalLogins > 0 ? (metrics.loginSuccesses / totalLogins) * 100 : 0;
    const failureRate = totalLogins > 0 ? (metrics.loginFailures / totalLogins) * 100 : 0;
    return {
        authentication: {
            totalAttempts: totalLogins,
            successRate: `${successRate.toFixed(1)}%`,
            failureRate: `${failureRate.toFixed(1)}%`,
            registrations: metrics.registrations,
        },
        security: {
            bruteForceAttempts: metrics.bruteForceAttempts,
            suspiciousActivities: metrics.suspiciousActivities,
            accountLockouts: metrics.accountLockouts,
            ipBlocks: metrics.ipBlocks,
        },
        performance: {
            averageResponseTime: `${metrics.averageResponseTime.toFixed(2)}ms`,
            cacheHitRate: `${(metrics.cacheHitRate * 100).toFixed(1)}%`,
            errorRate: `${(metrics.errorRate * 100).toFixed(1)}%`,
        },
        activity: {
            activeUsers: metrics.activeUsers,
            concurrentSessions: metrics.concurrentSessions,
            apiKeyUsages: metrics.apiKeyUsages,
        },
    };
}
export default EnhancedMonitoringService;
//# sourceMappingURL=enhanced-monitoring-service.js.map