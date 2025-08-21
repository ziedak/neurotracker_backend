/**
 * @fileoverview Enterprise authentication configuration management
 * @module config/schema
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import { z } from "zod";

/**
 * JWT configuration schema
 */
export const JWTConfigSchema = z.object({
  accessTokenExpiry: z.string().default("1h"),
  refreshTokenExpiry: z.string().default("7d"),
  algorithm: z
    .enum(["HS256", "HS384", "HS512", "RS256", "RS384", "RS512"])
    .default("HS256"),
  issuer: z.string().default("enterprise-auth-v2"),
  audience: z.string().default("enterprise-api"),
  secret: z.string().min(32),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
  keyRotation: z
    .object({
      enabled: z.boolean().default(false),
      rotationInterval: z.number().default(24 * 60 * 60 * 1000), // 24 hours
      gracePeriod: z.number().default(60 * 60 * 1000), // 1 hour
    })
    .default({}),
});

/**
 * Session configuration schema
 */
export const SessionConfigSchema = z.object({
  defaultExpiry: z.number().default(24 * 60 * 60 * 1000), // 24 hours
  maxConcurrentSessions: z.number().default(5),
  cleanupInterval: z.number().default(60 * 60 * 1000), // 1 hour
  extendOnActivity: z.boolean().default(true),
  cookieName: z.string().default("auth_session"),
  cookieOptions: z
    .object({
      httpOnly: z.boolean().default(true),
      secure: z.boolean().default(true),
      sameSite: z.enum(["strict", "lax", "none"]).default("strict"),
      domain: z.string().optional(),
      path: z.string().default("/"),
    })
    .default({}),
});

/**
 * Cache configuration schema
 */
export const CacheConfigSchema = z.object({
  redis: z.object({
    host: z.string().default("localhost"),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
    keyPrefix: z.string().default("auth:"),
    maxRetriesPerRequest: z.number().default(3),
    retryDelayOnFailover: z.number().default(100),
    enableOfflineQueue: z.boolean().default(false),
  }),
  memory: z
    .object({
      maxSize: z.number().default(10000),
      ttl: z.number().default(15 * 60), // 15 minutes
      checkPeriod: z.number().default(60), // 1 minute
    })
    .default({}),
  userCache: z
    .object({
      ttl: z.number().default(30 * 60), // 30 minutes
      maxSize: z.number().default(5000),
    })
    .default({}),
  permissionCache: z
    .object({
      ttl: z.number().default(60 * 60), // 1 hour
      maxSize: z.number().default(50000),
    })
    .default({}),
  sessionCache: z
    .object({
      ttl: z.number().default(10 * 60), // 10 minutes
      maxSize: z.number().default(10000),
    })
    .default({}),
});

/**
 * Rate limiting configuration schema
 */
export const RateLimitConfigSchema = z.object({
  authentication: z
    .object({
      windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
      maxAttempts: z.number().default(5),
      blockDuration: z.number().default(60 * 60 * 1000), // 1 hour
    })
    .default({}),
  apiKey: z
    .object({
      defaultRequestsPerHour: z.number().default(1000),
      defaultRequestsPerDay: z.number().default(10000),
      defaultBurstLimit: z.number().default(100),
      windowSize: z.number().default(60 * 1000), // 1 minute
    })
    .default({}),
  registration: z
    .object({
      windowMs: z.number().default(60 * 60 * 1000), // 1 hour
      maxAttempts: z.number().default(3),
      blockDuration: z.number().default(24 * 60 * 60 * 1000), // 24 hours
    })
    .default({}),
});

/**
 * Security configuration schema
 */
export const SecurityConfigSchema = z.object({
  password: z
    .object({
      minLength: z.number().default(8),
      requireUppercase: z.boolean().default(true),
      requireLowercase: z.boolean().default(true),
      requireNumbers: z.boolean().default(true),
      requireSpecialChars: z.boolean().default(true),
      maxAge: z.number().default(90 * 24 * 60 * 60 * 1000), // 90 days
      preventReuse: z.number().default(5), // last 5 passwords
    })
    .default({}),
  mfa: z
    .object({
      enabled: z.boolean().default(false),
      enforced: z.boolean().default(false),
      backupCodes: z.number().default(10),
      totpWindow: z.number().default(1),
    })
    .default({}),
  deviceTrust: z
    .object({
      enabled: z.boolean().default(false),
      trustDuration: z.number().default(30 * 24 * 60 * 60 * 1000), // 30 days
      maxTrustedDevices: z.number().default(10),
    })
    .default({}),
  anomalyDetection: z
    .object({
      enabled: z.boolean().default(false),
      riskThreshold: z.number().default(0.7),
      locationTracking: z.boolean().default(false),
      deviceFingerprinting: z.boolean().default(false),
    })
    .default({}),
  encryption: z
    .object({
      algorithm: z.string().default("aes-256-gcm"),
      keyDerivation: z.string().default("pbkdf2"),
      saltRounds: z.number().default(12),
      iterations: z.number().default(100000),
    })
    .default({}),
});

/**
 * Database configuration schema
 */
export const DatabaseConfigSchema = z.object({
  connectionString: z.string(),
  pool: z
    .object({
      min: z.number().default(2),
      max: z.number().default(10),
      acquireTimeoutMillis: z.number().default(30000),
      createTimeoutMillis: z.number().default(30000),
      destroyTimeoutMillis: z.number().default(5000),
      idleTimeoutMillis: z.number().default(30000),
      createRetryIntervalMillis: z.number().default(200),
    })
    .default({}),
});

/**
 * Monitoring configuration schema
 */
export const MonitoringConfigSchema = z.object({
  metrics: z
    .object({
      enabled: z.boolean().default(true),
      prefix: z.string().default("auth_"),
      flushInterval: z.number().default(10000), // 10 seconds
    })
    .default({}),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      auditEvents: z.boolean().default(true),
      performanceMetrics: z.boolean().default(true),
      errorTracking: z.boolean().default(true),
    })
    .default({}),
  alerts: z
    .object({
      enabled: z.boolean().default(false),
      thresholds: z
        .object({
          failedAuthentications: z.number().default(100),
          responseTime: z.number().default(5000),
          errorRate: z.number().default(0.05),
        })
        .default({}),
    })
    .default({}),
});

/**
 * Complete authentication configuration schema
 */
export const AuthConfigSchema = z.object({
  jwt: JWTConfigSchema,
  session: SessionConfigSchema,
  cache: CacheConfigSchema,
  rateLimit: RateLimitConfigSchema,
  security: SecurityConfigSchema,
  database: DatabaseConfigSchema,
  monitoring: MonitoringConfigSchema,
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
  debug: z.boolean().default(false),
});

/**
 * TypeScript types derived from schemas
 */
export type JWTConfig = z.infer<typeof JWTConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * Configuration validation and loading utilities
 */
export class AuthConfigManager {
  private static instance: AuthConfigManager | null = null;
  private config: AuthConfig | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): AuthConfigManager {
    if (!AuthConfigManager.instance) {
      AuthConfigManager.instance = new AuthConfigManager();
    }
    return AuthConfigManager.instance;
  }

  /**
   * Load configuration from environment variables and defaults
   */
  public async loadConfig(
    overrides: Partial<AuthConfig> = {}
  ): Promise<AuthConfig> {
    const envConfig = this.loadFromEnvironment();
    const mergedConfig = this.mergeConfig(envConfig, overrides);

    try {
      this.config = AuthConfigSchema.parse(mergedConfig);
      await this.validateConfig(this.config);
      return this.config;
    } catch (error) {
      throw new Error(
        `Invalid authentication configuration: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): AuthConfig {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call loadConfig() first.");
    }
    return this.config;
  }

  /**
   * Get specific configuration section
   */
  public getJWTConfig(): JWTConfig {
    return this.getConfig().jwt;
  }

  public getSessionConfig(): SessionConfig {
    return this.getConfig().session;
  }

  public getCacheConfig(): CacheConfig {
    return this.getConfig().cache;
  }

  public getRateLimitConfig(): RateLimitConfig {
    return this.getConfig().rateLimit;
  }

  public getSecurityConfig(): SecurityConfig {
    return this.getConfig().security;
  }

  public getDatabaseConfig(): DatabaseConfig {
    return this.getConfig().database;
  }

  public getMonitoringConfig(): MonitoringConfig {
    return this.getConfig().monitoring;
  }

  /**
   * Check if running in development mode
   */
  public isDevelopment(): boolean {
    return this.getConfig().environment === "development";
  }

  /**
   * Check if debug mode is enabled
   */
  public isDebugEnabled(): boolean {
    return this.getConfig().debug;
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): Partial<AuthConfig> {
    const env = process.env;

    return {
      jwt: {
        accessTokenExpiry: env["JWT_ACCESS_TOKEN_EXPIRY"] || "1h",
        refreshTokenExpiry: env["JWT_REFRESH_TOKEN_EXPIRY"] || "7d",
        algorithm: (env["JWT_ALGORITHM"] as any) || "HS256",
        issuer: env["JWT_ISSUER"] || "enterprise-auth-v2",
        audience: env["JWT_AUDIENCE"] || "enterprise-api",
        secret: env["JWT_SECRET"] || "",
        publicKey: env["JWT_PUBLIC_KEY"],
        privateKey: env["JWT_PRIVATE_KEY"],
        keyRotation: {
          enabled: env["JWT_KEY_ROTATION_ENABLED"] === "true",
          rotationInterval: parseInt(
            env["JWT_KEY_ROTATION_INTERVAL"] || "86400000"
          ),
          gracePeriod: parseInt(env["JWT_KEY_GRACE_PERIOD"] || "3600000"),
        },
      },
      session: {
        defaultExpiry: parseInt(env["SESSION_DEFAULT_EXPIRY"] || "86400000"),
        maxConcurrentSessions: parseInt(env["SESSION_MAX_CONCURRENT"] || "5"),
        cleanupInterval: parseInt(env["SESSION_CLEANUP_INTERVAL"] || "3600000"),
        extendOnActivity: env["SESSION_EXTEND_ON_ACTIVITY"] !== "false",
        cookieName: env["SESSION_COOKIE_NAME"] || "auth_session",
        cookieOptions: {
          httpOnly: env["SESSION_COOKIE_HTTP_ONLY"] !== "false",
          secure: env["SESSION_COOKIE_SECURE"] !== "false",
          sameSite: (env["SESSION_COOKIE_SAME_SITE"] as any) || "strict",
          domain: env["SESSION_COOKIE_DOMAIN"],
          path: env["SESSION_COOKIE_PATH"] || "/",
        },
      },
      cache: {
        redis: {
          host: env["REDIS_HOST"] || "localhost",
          port: parseInt(env["REDIS_PORT"] || "6379"),
          password: env["REDIS_PASSWORD"],
          db: parseInt(env["REDIS_DB"] || "0"),
          keyPrefix: env["REDIS_KEY_PREFIX"] || "auth:",
          maxRetriesPerRequest: parseInt(env["REDIS_MAX_RETRIES"] || "3"),
          retryDelayOnFailover: parseInt(env["REDIS_RETRY_DELAY"] || "100"),
          enableOfflineQueue: env["REDIS_ENABLE_OFFLINE_QUEUE"] === "true",
        },
        memory: {
          maxSize: parseInt(env["MEMORY_CACHE_MAX_SIZE"] || "10000"),
          ttl: parseInt(env["MEMORY_CACHE_TTL"] || "900"),
          checkPeriod: parseInt(env["MEMORY_CACHE_CHECK_PERIOD"] || "60"),
        },
        userCache: {
          ttl: parseInt(env["USER_CACHE_TTL"] || "1800"), // 30 minutes
          maxSize: parseInt(env["USER_CACHE_MAX_SIZE"] || "5000"),
        },
        permissionCache: {
          ttl: parseInt(env["PERMISSION_CACHE_TTL"] || "3600"), // 1 hour
          maxSize: parseInt(env["PERMISSION_CACHE_MAX_SIZE"] || "50000"),
        },
        sessionCache: {
          ttl: parseInt(env["SESSION_CACHE_TTL"] || "600"), // 10 minutes
          maxSize: parseInt(env["SESSION_CACHE_MAX_SIZE"] || "10000"),
        },
      },
      database: {
        connectionString: env["DATABASE_URL"] || "",
        pool: {
          min: parseInt(env["DB_POOL_MIN"] || "2"),
          max: parseInt(env["DB_POOL_MAX"] || "10"),
          acquireTimeoutMillis: parseInt(
            env["DB_POOL_ACQUIRE_TIMEOUT"] || "30000"
          ),
          createTimeoutMillis: parseInt(
            env["DB_POOL_CREATE_TIMEOUT"] || "30000"
          ),
          destroyTimeoutMillis: parseInt(
            env["DB_POOL_DESTROY_TIMEOUT"] || "5000"
          ),
          idleTimeoutMillis: parseInt(env["DB_POOL_IDLE_TIMEOUT"] || "30000"),
          createRetryIntervalMillis: parseInt(
            env["DB_POOL_CREATE_RETRY_INTERVAL"] || "200"
          ),
        },
      },
      environment: (env["NODE_ENV"] as any) || "development",
      debug: env["DEBUG"] === "true",
    };
  }

  /**
   * Merge configuration objects with deep merging
   */
  private mergeConfig(
    base: Partial<AuthConfig>,
    override: Partial<AuthConfig>
  ): Partial<AuthConfig> {
    const merged = { ...base } as any;

    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          merged[key] = {
            ...(merged[key] || {}),
            ...value,
          };
        } else {
          merged[key] = value;
        }
      }
    }

    return merged as Partial<AuthConfig>;
  }

  /**
   * Validate configuration after parsing
   */
  private async validateConfig(config: AuthConfig): Promise<void> {
    // Validate JWT secret
    if (!config.jwt.secret || config.jwt.secret.length < 32) {
      throw new Error("JWT secret must be at least 32 characters long");
    }

    // Validate database connection
    if (!config.database.connectionString) {
      throw new Error("Database connection string is required");
    }

    // Validate Redis configuration in production
    if (config.environment === "production") {
      if (!config.cache.redis.password) {
        console.warn(
          "WARNING: Redis password not set in production environment"
        );
      }

      if (!config.security.mfa.enabled) {
        console.warn("WARNING: MFA is disabled in production environment");
      }
    }

    // Validate asymmetric JWT keys if specified
    if (
      config.jwt.algorithm.startsWith("RS") ||
      config.jwt.algorithm.startsWith("ES")
    ) {
      if (!config.jwt.publicKey || !config.jwt.privateKey) {
        throw new Error(
          `Asymmetric JWT algorithm ${config.jwt.algorithm} requires both public and private keys`
        );
      }
    }
  }
}

/**
 * Singleton instance for global access
 */
export const authConfig = AuthConfigManager.getInstance();

/**
 * Configuration constants for common values
 */
export const CONFIG_CONSTANTS = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  DEFAULT_SESSION_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours
  DEFAULT_JWT_EXPIRY: "1h",
  DEFAULT_REFRESH_TOKEN_EXPIRY: "7d",
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  ACCOUNT_LOCKOUT_DURATION: 60 * 60 * 1000, // 1 hour
  DEFAULT_CACHE_TTL: 15 * 60, // 15 minutes
  MAX_API_KEYS_PER_USER: 10,
  DEFAULT_RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  MAX_CONCURRENT_SESSIONS: 5,
} as const;
