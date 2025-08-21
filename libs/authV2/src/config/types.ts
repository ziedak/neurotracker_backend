/**
 * @fileoverview Configuration types for authV2
 * @module config/types
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { z } from "zod";
import type {
  JWTConfigSchema,
  SessionConfigSchema,
  CacheConfigSchema,
  RateLimitConfigSchema,
  SecurityConfigSchema,
  DatabaseConfigSchema,
  MonitoringConfigSchema,
  AuthConfigSchema,
} from "./schema";

/**
 * Inferred configuration types from Zod schemas
 */
export type IJWTConfig = z.infer<typeof JWTConfigSchema>;
export type ISessionConfig = z.infer<typeof SessionConfigSchema>;
export type ICacheConfig = z.infer<typeof CacheConfigSchema>;
export type IRateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type ISecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type IDatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type IMonitoringConfig = z.infer<typeof MonitoringConfigSchema>;
export type IAuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * Configuration validation result
 */
export interface IConfigValidationResult {
  readonly success: boolean;
  readonly config?: IAuthConfig;
  readonly errors?: ReadonlyArray<IConfigError>;
}

/**
 * Configuration error details
 */
export interface IConfigError {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly code: string;
  readonly received?: unknown;
  readonly expected?: string;
}

/**
 * Configuration source metadata
 */
export interface IConfigSource {
  readonly type: "environment" | "file" | "override" | "default";
  readonly path?: string;
  readonly timestamp: string;
  readonly checksum?: string;
}

/**
 * Configuration with metadata
 */
export interface IConfigWithMetadata {
  readonly config: IAuthConfig;
  readonly source: IConfigSource;
  readonly validatedAt: string;
  readonly version: string;
}

/**
 * Default configuration values that match the schema
 */
export const DEFAULT_CONFIG: IAuthConfig = {
  jwt: {
    secret: "your-secret-key-change-in-production-minimum-32-chars-required",
    accessTokenExpiry: "1h",
    refreshTokenExpiry: "7d",
    algorithm: "HS256",
    issuer: "enterprise-auth-v2",
    audience: "enterprise-api",
    keyRotation: {
      enabled: false,
      rotationInterval: 24 * 60 * 60 * 1000, // 24 hours
      gracePeriod: 60 * 60 * 1000, // 1 hour
    },
  },
  session: {
    defaultExpiry: 24 * 60 * 60 * 1000, // 24 hours
    maxConcurrentSessions: 5,
    cleanupInterval: 60 * 60 * 1000, // 1 hour
    extendOnActivity: true,
    cookieName: "auth_session",
    cookieOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    },
  },
  cache: {
    redis: {
      host: "localhost",
      port: 6379,
      db: 0,
      keyPrefix: "auth:",
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
    },
    memory: {
      maxSize: 10000,
      ttl: 15 * 60, // 15 minutes
      checkPeriod: 60, // 1 minute
    },
    userCache: {
      ttl: 30 * 60, // 30 minutes
      maxSize: 5000,
    },
    permissionCache: {
      ttl: 60 * 60, // 1 hour
      maxSize: 50000,
    },
    sessionCache: {
      ttl: 10 * 60, // 10 minutes
      maxSize: 10000,
    },
  },
  rateLimit: {
    authentication: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 5,
      blockDuration: 60 * 60 * 1000, // 1 hour
    },
    apiKey: {
      defaultRequestsPerHour: 1000,
      defaultRequestsPerDay: 10000,
      defaultBurstLimit: 100,
      windowSize: 60 * 1000, // 1 minute
    },
    registration: {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxAttempts: 3,
      blockDuration: 24 * 60 * 60 * 1000, // 24 hours
    },
  },
  security: {
    password: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
      preventReuse: 5,
    },
    mfa: {
      enabled: false,
      enforced: false,
      backupCodes: 10,
      totpWindow: 1,
    },
    deviceTrust: {
      enabled: false,
      trustDuration: 30 * 24 * 60 * 60 * 1000, // 30 days
      maxTrustedDevices: 10,
    },
    anomalyDetection: {
      enabled: false,
      riskThreshold: 0.7,
      locationTracking: false,
      deviceFingerprinting: false,
    },
    encryption: {
      algorithm: "aes-256-gcm",
      keyDerivation: "pbkdf2",
      saltRounds: 12,
      iterations: 100000,
    },
  },
  database: {
    connectionString: "postgresql://localhost:5432/auth",
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      createRetryIntervalMillis: 200,
    },
  },
  monitoring: {
    metrics: {
      enabled: true,
      prefix: "auth_",
      flushInterval: 10000,
    },
    logging: {
      level: "info",
      auditEvents: true,
      performanceMetrics: true,
      errorTracking: true,
    },
    alerts: {
      enabled: false,
      thresholds: {
        failedAuthentications: 100,
        responseTime: 5000,
        errorRate: 0.05,
      },
    },
  },
  environment: "development",
  debug: false,
};
