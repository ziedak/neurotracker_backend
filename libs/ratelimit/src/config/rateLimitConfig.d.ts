/**
 * Environment types for configuration
 */
export type Environment = "development" | "staging" | "production";
/**
 * Rate limit algorithms
 */
export type RateLimitAlgorithm = "sliding-window" | "token-bucket" | "fixed-window";
/**
 * Redis cluster node configuration
 */
export interface RedisClusterNode {
    host: string;
    port: number;
}
/**
 * Redis cluster configuration options
 */
export interface RedisClusterConfig {
    nodes: RedisClusterNode[];
    enableReadyCheck?: boolean;
    redisOptions?: {
        password?: string;
        db?: number;
        connectTimeout?: number;
        commandTimeout?: number;
        maxRetriesPerRequest?: number;
    };
    clusterRetryDelayOnFailover?: number;
    clusterRetryDelayOnClusterDown?: number;
    clusterMaxRedirections?: number;
    scaleReads?: "master" | "slave" | "all";
}
/**
 * Redis connection pool configuration
 */
export interface RedisConnectionPoolConfig {
    min: number;
    max: number;
    acquireTimeoutMs?: number;
    createTimeoutMs?: number;
    destroyTimeoutMs?: number;
    idleTimeoutMs?: number;
    reapIntervalMs?: number;
}
/**
 * Enhanced Redis configuration
 */
export interface EnhancedRedisConfig {
    keyPrefix?: string;
    ttlBuffer?: number;
    cluster?: RedisClusterConfig;
    connectionPool?: RedisConnectionPoolConfig;
    enableSentinel?: boolean;
    sentinelHosts?: Array<{
        host: string;
        port: number;
    }>;
    sentinelName?: string;
}
/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
    enabled: boolean;
    metricsExport?: "prometheus" | "datadog" | "custom" | "disabled";
    metricsPort?: number;
    metricsPath?: string;
    alerting?: {
        enabled: boolean;
        webhookUrl?: string;
        slackChannel?: string;
        pagerDutyKey?: string;
        customHandler?: string;
    };
    healthCheck?: {
        enabled: boolean;
        endpoint?: string;
        interval?: number;
        timeout?: number;
    };
}
/**
 * SLA threshold configuration
 */
export interface SLAConfig {
    latencyP95Ms: number;
    latencyP99Ms: number;
    throughputPerSecond: number;
    errorRatePercent: number;
    uptimePercent: number;
}
/**
 * Distributed rate limiting configuration
 */
export interface DistributedConfig {
    enabled: boolean;
    instanceId: string;
    syncInterval?: number;
    maxDrift?: number;
    consensusAlgorithm?: "raft" | "gossip" | "simple";
    healthCheck?: {
        enabled: boolean;
        interval?: number;
        timeout?: number;
        failureThreshold?: number;
    };
}
/**
 * Enhanced circuit breaker configuration
 */
export interface EnhancedCircuitBreakerConfig {
    enabled?: boolean;
    failureThreshold?: number;
    recoveryTimeout?: number;
    monitoringPeriod?: number;
    name?: string;
    halfOpenMaxCalls?: number;
    minimumThroughput?: number;
    rollingWindow?: number;
    granularity?: "global" | "per-command" | "per-key";
}
/**
 * Complete rate limit configuration for runtime
 */
export interface CompleteRateLimitConfig {
    algorithm: RateLimitAlgorithm;
    redis: EnhancedRedisConfig;
    circuitBreaker: EnhancedCircuitBreakerConfig;
    monitoring: MonitoringConfig;
    sla: SLAConfig;
    distributed: DistributedConfig;
    environment: Environment;
}
/**
 * Input configuration type (flexible for merging)
 */
export interface RateLimitConfigInput {
    algorithm?: RateLimitAlgorithm;
    redis?: Partial<EnhancedRedisConfig>;
    circuitBreaker?: Partial<EnhancedCircuitBreakerConfig>;
    monitoring?: Partial<MonitoringConfig>;
    sla?: Partial<SLAConfig>;
    distributed?: Partial<DistributedConfig>;
    environment: Environment;
}
/**
 * Development environment configuration
 */
export declare const DevelopmentConfig: CompleteRateLimitConfig;
/**
 * Staging environment configuration
 */
export declare const StagingConfig: CompleteRateLimitConfig;
/**
 * Production environment configuration
 */
export declare const ProductionConfig: CompleteRateLimitConfig;
/**
 * Rate limit configuration manager
 * Provides environment-specific configurations with validation
 */
export declare class RateLimitConfigManager {
    private static readonly configs;
    /**
     * Get configuration for specific environment
     */
    static getConfig(environment: Environment): CompleteRateLimitConfig;
    /**
     * Get configuration from environment variable
     */
    static getConfigFromEnv(): CompleteRateLimitConfig;
    /**
     * Validate configuration against schema (simplified validation)
     */
    private static validateConfig;
    /**
     * Create custom configuration with validation
     */
    static createCustomConfig(config: Partial<CompleteRateLimitConfig>): CompleteRateLimitConfig;
    /**
     * Get all available environments
     */
    static getAvailableEnvironments(): Environment[];
    /**
     * Check if environment is valid
     */
    static isValidEnvironment(env: string): env is Environment;
}
/**
 * Export legacy interface for backward compatibility
 */
export interface RateLimitConfig {
    algorithm?: RateLimitAlgorithm;
    redis?: {
        keyPrefix?: string;
        ttlBuffer?: number;
    };
    circuitBreaker?: {
        enabled?: boolean;
        failureThreshold?: number;
        recoveryTimeout?: number;
        monitoringPeriod?: number;
        name?: string;
    };
}
//# sourceMappingURL=rateLimitConfig.d.ts.map