import { getEnv, getNumberEnv } from "@libs/config";

/**
 * Environment types for configuration
 */
export type Environment = "development" | "staging" | "production";

/**
 * Rate limit algorithms
 */
export type RateLimitAlgorithm =
  | "sliding-window"
  | "token-bucket"
  | "fixed-window";

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
  sentinelHosts?: Array<{ host: string; port: number }>;
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
export const DevelopmentConfig: CompleteRateLimitConfig = {
  environment: "development",
  algorithm: "sliding-window",
  redis: {
    keyPrefix: "dev_rate_limit",
    ttlBuffer: 10,
    connectionPool: {
      min: 1,
      max: 5,
      idleTimeoutMs: 30000,
    },
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    recoveryTimeout: 10000,
    granularity: "per-command",
  },
  monitoring: {
    enabled: true,
    metricsExport: "prometheus",
    metricsPort: 9090,
    metricsPath: "/metrics",
    alerting: {
      enabled: false,
    },
    healthCheck: {
      enabled: true,
      endpoint: "/health",
      interval: 30000,
      timeout: 5000,
    },
  },
  sla: {
    latencyP95Ms: 50,
    latencyP99Ms: 100,
    throughputPerSecond: 1000,
    errorRatePercent: 5,
    uptimePercent: 95,
  },
  distributed: {
    enabled: false,
    instanceId: "dev-instance",
  },
};

/**
 * Staging environment configuration
 */
export const StagingConfig: CompleteRateLimitConfig = {
  environment: "staging",
  algorithm: "sliding-window",
  redis: {
    keyPrefix: "staging_rate_limit",
    ttlBuffer: 20,
    connectionPool: {
      min: 2,
      max: 10,
      idleTimeoutMs: 60000,
    },
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeout: 30000,
    granularity: "per-command",
    halfOpenMaxCalls: 5,
  },
  monitoring: {
    enabled: true,
    metricsExport: "prometheus",
    metricsPort: 9090,
    metricsPath: "/metrics",
    alerting: {
      enabled: true,
      slackChannel: "#staging-alerts",
    },
    healthCheck: {
      enabled: true,
      endpoint: "/health",
      interval: 30000,
      timeout: 10000,
    },
  },
  sla: {
    latencyP95Ms: 25,
    latencyP99Ms: 50,
    throughputPerSecond: 5000,
    errorRatePercent: 2,
    uptimePercent: 98,
  },
  distributed: {
    enabled: true,
    instanceId: getEnv("INSTANCE_ID", "staging-instance"),
    syncInterval: 30000,
    maxDrift: 5000,
    consensusAlgorithm: "simple",
    healthCheck: {
      enabled: true,
      interval: 15000,
      timeout: 5000,
      failureThreshold: 3,
    },
  },
};

/**
 * Production environment configuration
 */
export const ProductionConfig: CompleteRateLimitConfig = {
  environment: "production",
  algorithm: "sliding-window",
  redis: {
    keyPrefix: "prod_rate_limit",
    ttlBuffer: 30,
    connectionPool: {
      min: 5,
      max: 20,
      idleTimeoutMs: 300000,
      acquireTimeoutMs: 5000,
      reapIntervalMs: 60000,
    },
    cluster: {
      nodes: [
        {
          host: getEnv("REDIS_CLUSTER_HOST_1", "redis-1"),
          port: getNumberEnv("REDIS_CLUSTER_PORT_1", 6379),
        },
        {
          host: getEnv("REDIS_CLUSTER_HOST_2", "redis-2"),
          port: getNumberEnv("REDIS_CLUSTER_PORT_2", 6379),
        },
        {
          host: getEnv("REDIS_CLUSTER_HOST_3", "redis-3"),
          port: getNumberEnv("REDIS_CLUSTER_PORT_3", 6379),
        },
      ],
      enableReadyCheck: true,
      redisOptions: {
        password: getEnv("REDIS_PASSWORD"),
        connectTimeout: 10000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 3,
      },
      clusterRetryDelayOnFailover: 2000,
      clusterRetryDelayOnClusterDown: 5000,
      scaleReads: "slave",
    },
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 10,
    recoveryTimeout: 60000,
    granularity: "per-command",
    halfOpenMaxCalls: 10,
    minimumThroughput: 100,
    rollingWindow: 60000,
  },
  monitoring: {
    enabled: true,
    metricsExport: "prometheus",
    metricsPort: 9090,
    metricsPath: "/metrics",
    alerting: {
      enabled: true,
      webhookUrl: getEnv("ALERT_WEBHOOK_URL"),
      slackChannel: getEnv("SLACK_ALERT_CHANNEL", "#production-alerts"),
      pagerDutyKey: getEnv("PAGERDUTY_INTEGRATION_KEY"),
    },
    healthCheck: {
      enabled: true,
      endpoint: "/health",
      interval: 15000,
      timeout: 5000,
    },
  },
  sla: {
    latencyP95Ms: 10,
    latencyP99Ms: 25,
    throughputPerSecond: 15000,
    errorRatePercent: 0.1,
    uptimePercent: 99.9,
  },
  distributed: {
    enabled: true,
    instanceId: getEnv("INSTANCE_ID", "prod-instance"),
    syncInterval: 15000,
    maxDrift: 2000,
    consensusAlgorithm: "raft",
    healthCheck: {
      enabled: true,
      interval: 10000,
      timeout: 3000,
      failureThreshold: 5,
    },
  },
};

/**
 * Rate limit configuration manager
 * Provides environment-specific configurations with validation
 */
export class RateLimitConfigManager {
  private static readonly configs = new Map<
    Environment,
    CompleteRateLimitConfig
  >([
    ["development", DevelopmentConfig],
    ["staging", StagingConfig],
    ["production", ProductionConfig],
  ]);

  /**
   * Get configuration for specific environment
   */
  static getConfig(environment: Environment): CompleteRateLimitConfig {
    const config = this.configs.get(environment);
    if (!config) {
      throw new Error(`No configuration found for environment: ${environment}`);
    }
    return this.validateConfig(config);
  }

  /**
   * Get configuration from environment variable
   */
  static getConfigFromEnv(): CompleteRateLimitConfig {
    const env = getEnv("NODE_ENV", "development") as Environment;
    if (!["development", "staging", "production"].includes(env)) {
      throw new Error(
        `Invalid NODE_ENV: ${env}. Must be development, staging, or production`
      );
    }
    return this.getConfig(env);
  }

  /**
   * Validate configuration against schema (simplified validation)
   */
  private static validateConfig(
    config: CompleteRateLimitConfig
  ): CompleteRateLimitConfig {
    // Basic validation - ensure required fields are present
    if (!config.environment) {
      throw new Error(
        "Rate limit configuration validation failed: environment is required"
      );
    }

    if (
      !["development", "staging", "production"].includes(config.environment)
    ) {
      throw new Error(
        `Rate limit configuration validation failed: invalid environment ${config.environment}`
      );
    }

    if (!config.algorithm) {
      throw new Error(
        "Rate limit configuration validation failed: algorithm is required"
      );
    }

    if (!config.redis || !config.redis.keyPrefix) {
      throw new Error(
        "Rate limit configuration validation failed: redis.keyPrefix is required"
      );
    }

    if (!config.monitoring) {
      throw new Error(
        "Rate limit configuration validation failed: monitoring configuration is required"
      );
    }

    if (!config.distributed || !config.distributed.instanceId) {
      throw new Error(
        "Rate limit configuration validation failed: distributed.instanceId is required"
      );
    }

    return config;
  }

  /**
   * Create custom configuration with validation
   */
  static createCustomConfig(
    config: Partial<CompleteRateLimitConfig>
  ): CompleteRateLimitConfig {
    const environment = config.environment || "development";
    const baseConfig = this.getConfig(environment);

    // Build configuration ensuring all required properties
    const result: CompleteRateLimitConfig = {
      environment,
      algorithm: config.algorithm || baseConfig.algorithm,
      redis: config.redis
        ? { ...baseConfig.redis, ...config.redis }
        : baseConfig.redis,
      circuitBreaker: config.circuitBreaker
        ? { ...baseConfig.circuitBreaker, ...config.circuitBreaker }
        : baseConfig.circuitBreaker,
      monitoring: config.monitoring
        ? { ...baseConfig.monitoring, ...config.monitoring }
        : baseConfig.monitoring,
      sla: config.sla ? { ...baseConfig.sla, ...config.sla } : baseConfig.sla,
      distributed: config.distributed
        ? { ...baseConfig.distributed, ...config.distributed }
        : baseConfig.distributed,
    };

    return this.validateConfig(result);
  }

  /**
   * Get all available environments
   */
  static getAvailableEnvironments(): Environment[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Check if environment is valid
   */
  static isValidEnvironment(env: string): env is Environment {
    return this.configs.has(env as Environment);
  }
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
