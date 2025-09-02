/**
 * @fileoverview Simple configuration loader for authV2 Phase 1
 * @module config/loader
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import { AuthConfigSchema } from "./schema";
import { ConfigurationError } from "../errors/core";

/**
 * Simple configuration loader for Phase 1
 * Full featured configuration manager will be implemented in Phase 2
 */
export class SimpleConfigLoader {
  /**
   * Load configuration from environment variables with defaults
   */
  public static loadConfig() {
    try {
      const config = {
        jwt: {
          secret:
            process.env["JWT_SECRET"] ||
            "your-secret-key-change-in-production-minimum-32-chars-required",
          accessTokenExpiry: process.env["JWT_ACCESS_TOKEN_EXPIRY"] || "1h",
          refreshTokenExpiry: process.env["JWT_REFRESH_TOKEN_EXPIRY"] || "7d",
          algorithm: (process.env["JWT_ALGORITHM"] as any) || "HS256",
          issuer: process.env["JWT_ISSUER"] || "enterprise-auth-v2",
          audience: process.env["JWT_AUDIENCE"] || "enterprise-api",
          keyRotation: {
            enabled: false,
            rotationInterval: 24 * 60 * 60 * 1000,
            gracePeriod: 60 * 60 * 1000,
          },
        },
        session: {
          defaultExpiry: parseInt(
            process.env["SESSION_DEFAULT_EXPIRY"] || "86400000"
          ),
          maxConcurrentSessions: parseInt(
            process.env["SESSION_MAX_CONCURRENT"] || "5"
          ),
          cleanupInterval: parseInt(
            process.env["SESSION_CLEANUP_INTERVAL"] || "3600000"
          ),
          extendOnActivity:
            process.env["SESSION_EXTEND_ON_ACTIVITY"] !== "false",
          cookieName: process.env["SESSION_COOKIE_NAME"] || "auth_session",
          cookieOptions: {
            httpOnly: process.env["SESSION_HTTP_ONLY"] !== "false",
            secure: process.env["SESSION_SECURE"] === "true",
            sameSite: (process.env["SESSION_SAME_SITE"] as any) || "strict",
            path: process.env["SESSION_PATH"] || "/",
          },
        },
        cache: {
          redis: {
            host: process.env["REDIS_HOST"] || "localhost",
            port: parseInt(process.env["REDIS_PORT"] || "6379"),
            db: parseInt(process.env["REDIS_DB"] || "0"),
            keyPrefix: process.env["REDIS_KEY_PREFIX"] || "auth:",
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            enableOfflineQueue: false,
          },
          memory: {
            maxSize: 10000,
            ttl: 15 * 60,
            checkPeriod: 60,
          },
          userCache: {
            ttl: 30 * 60,
            maxSize: 5000,
          },
          permissionCache: {
            ttl: 60 * 60,
            maxSize: 50000,
          },
          sessionCache: {
            ttl: 10 * 60,
            maxSize: 10000,
          },
        },
        rateLimit: {
          authentication: {
            windowMs: 15 * 60 * 1000,
            maxAttempts: 5,
            blockDuration: 60 * 60 * 1000,
          },
          apiKey: {
            defaultRequestsPerHour: 1000,
            defaultRequestsPerDay: 10000,
            defaultBurstLimit: 100,
            windowSize: 60 * 1000,
          },
          registration: {
            windowMs: 60 * 60 * 1000,
            maxAttempts: 3,
            blockDuration: 24 * 60 * 60 * 1000,
          },
        },
        security: {
          password: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: false,
            maxAge: 90 * 24 * 60 * 60 * 1000,
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
            trustDuration: 30 * 24 * 60 * 60 * 1000,
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
          connectionString:
            process.env["DATABASE_URL"] || "postgresql://localhost:5432/auth",
          pool: {
            min: parseInt(process.env["DB_POOL_MIN"] || "2"),
            max: parseInt(process.env["DB_POOL_MAX"] || "10"),
            acquireTimeoutMillis: 30000,
            createTimeoutMillis: 30000,
            destroyTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            createRetryIntervalMillis: 200,
          },
        },
        monitoring: {
          metrics: {
            enabled: process.env["MONITORING_METRICS_ENABLED"] !== "false",
            prefix: process.env["MONITORING_PREFIX"] || "auth_",
            flushInterval: parseInt(
              process.env["MONITORING_FLUSH_INTERVAL"] || "10000"
            ),
          },
          logging: {
            level: (process.env["LOG_LEVEL"] as any) || "info",
            auditEvents: process.env["AUDIT_EVENTS"] !== "false",
            performanceMetrics: process.env["PERFORMANCE_METRICS"] !== "false",
            errorTracking: process.env["ERROR_TRACKING"] !== "false",
          },
          alerts: {
            enabled: process.env["ALERTS_ENABLED"] === "true",
            thresholds: {
              failedAuthentications: parseInt(
                process.env["ALERT_FAILED_AUTH_THRESHOLD"] || "100"
              ),
              responseTime: parseInt(
                process.env["ALERT_RESPONSE_TIME_THRESHOLD"] || "5000"
              ),
              errorRate: parseFloat(
                process.env["ALERT_ERROR_RATE_THRESHOLD"] || "0.05"
              ),
            },
          },
        },
        environment: (process.env["NODE_ENV"] as any) || "development",
        debug: process.env["DEBUG"] === "true",
      };

      // Validate configuration
      const validated = AuthConfigSchema.parse(config);
      return validated;
    } catch (error) {
      throw new ConfigurationError(
        "Failed to load and validate configuration",
        {
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Check if configuration is production ready
   */
  public static validateProductionConfig(config: any): void {
    if (config.environment === "production") {
      if (
        config.jwt.secret ===
        "your-secret-key-change-in-production-minimum-32-chars-required"
      ) {
        throw new ConfigurationError(
          "Default JWT secret detected in production"
        );
      }

      if (!config.session.cookieOptions.secure) {
        throw new ConfigurationError(
          "Secure cookies must be enabled in production"
        );
      }
    }
  }
}
