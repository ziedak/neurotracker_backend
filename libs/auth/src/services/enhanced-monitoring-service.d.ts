/**
 * Enhanced Monitoring Service
 * Provides comprehensive metrics collection for authentication events
 * Supports real-time monitoring, alerting, and performance analytics
 */
import { ServiceDependencies } from "../types";
export interface AuthMetrics {
    loginAttempts: number;
    loginSuccesses: number;
    loginFailures: number;
    registrations: number;
    tokenRefreshes: number;
    tokenRevocations: number;
    bruteForceAttempts: number;
    suspiciousActivities: number;
    accountLockouts: number;
    ipBlocks: number;
    averageResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
    activeUsers: number;
    concurrentSessions: number;
    apiKeyUsages: number;
    uptime: number;
    memoryUsage: number;
    redisConnections: number;
}
export interface MonitoringEvent {
    type: string;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    timestamp: Date;
    metadata?: Record<string, any> | undefined;
    severity: "low" | "medium" | "high" | "critical";
}
export interface AlertRule {
    id: string;
    name: string;
    condition: (metrics: AuthMetrics) => boolean;
    severity: "warning" | "error" | "critical";
    message: string;
    cooldown: number;
    lastTriggered?: Date;
}
export declare class EnhancedMonitoringService {
    private deps;
    private metrics;
    private events;
    private alertRules;
    private startTime;
    constructor(deps: ServiceDependencies);
    /**
     * Initialize metrics with default values
     */
    private initializeMetrics;
    /**
     * Initialize default alert rules
     */
    private initializeAlertRules;
    /**
     * Record authentication event
     */
    recordAuthEvent(eventType: "login_attempt" | "login_success" | "login_failure" | "registration" | "token_refresh" | "token_revocation", userId?: string, metadata?: Record<string, any>): void;
    /**
     * Record security event
     */
    recordSecurityEvent(eventType: "brute_force" | "suspicious_activity" | "account_lockout" | "ip_block", userId?: string, ipAddress?: string, metadata?: Record<string, any>): void;
    /**
     * Record performance metric
     */
    recordPerformanceMetric(metricType: "response_time" | "cache_hit" | "cache_miss" | "error", value: number, metadata?: Record<string, any>): void;
    /**
     * Get current metrics
     */
    getMetrics(): AuthMetrics;
    /**
     * Get recent events
     */
    getRecentEvents(limit?: number): MonitoringEvent[];
    /**
     * Get events by type
     */
    getEventsByType(type: string, limit?: number): MonitoringEvent[];
    /**
     * Get events by user
     */
    getEventsByUser(userId: string, limit?: number): MonitoringEvent[];
    /**
     * Get events by IP address
     */
    getEventsByIP(ipAddress: string, limit?: number): MonitoringEvent[];
    /**
     * Clear old events (keep last N events)
     */
    clearOldEvents(keepLast?: number): void;
    /**
     * Reset metrics
     */
    resetMetrics(): void;
    /**
     * Add custom alert rule
     */
    addAlertRule(rule: AlertRule): void;
    /**
     * Remove alert rule
     */
    removeAlertRule(ruleId: string): void;
    /**
     * Get active alerts
     */
    getActiveAlerts(): AlertRule[];
    private getEventSeverity;
    private updateAverageResponseTime;
    private updateCacheHitRate;
    private calculateErrorRate;
    private checkAlerts;
}
/**
 * Create enhanced monitoring service instance
 */
export declare function createEnhancedMonitoringService(deps: ServiceDependencies): EnhancedMonitoringService;
/**
 * Quick metrics summary
 */
export declare function getMetricsSummary(metrics: AuthMetrics): Record<string, any>;
export default EnhancedMonitoringService;
//# sourceMappingURL=enhanced-monitoring-service.d.ts.map