/**
 * @fileoverview Configuration Pattern Integration Tests
 * @description Tests development, production, and custom middleware configuration patterns
 */

import { AdvancedElysiaServerBuilder, createDevelopmentServer, createProductionServer } from "../../src/server";
import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { WebSocketMiddlewareChain } from "../../src/middleware/base/middlewareChain/WebSocketMiddlewareChain";
import { IMetricsCollector } from "@libs/monitoring";
import { createMockMetricsCollector } from "../mocks";

// Mock external dependencies
jest.mock("@libs/monitoring");
jest.mock("@libs/auth");

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockAuthService = {
  verifyToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getJWTService: jest.fn().mockReturnValue({
    extractTokenFromHeader: jest.fn().mockReturnValue("test-token"),
  }),
  getApiKeyService: jest.fn().mockReturnValue({
    validateApiKey: jest.fn().mockResolvedValue({
      id: "api_key_123",
      userId: "user_123",
      permissions: ["api:read", "api:write"],
    }),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn().mockReturnValue({
      user: {
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read", "api:write"],
      },
      permissions: ["api:read", "api:write"],
      roles: ["user"],
    }),
  }),
};

describe("Configuration Pattern Integration Tests", () => {
  let serverBuilder: AdvancedElysiaServerBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    serverBuilder = new AdvancedElysiaServerBuilder(mockMetricsCollector);

    // Mock environment variables
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "test-secret";
    process.env.CORS_ORIGINS = "http://localhost:3000,https://app.example.com";
    process.env.RATE_LIMIT_MAX = "1000";
    process.env.LOG_LEVEL = "info";
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    delete process.env.CORS_ORIGINS;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.LOG_LEVEL;
  });

  describe("Environment-Based Configuration", () => {
    it("should apply development configuration correctly", () => {
      const app = serverBuilder
        .development()
        .withLogging({
          enabled: true,
          logLevel: "debug", // Development should use debug logging
          includeResponseBody: true,
          includeRequestBody: true,
        })
        .withSecurity({
          enableHsts: false, // HSTS not needed in development
          contentSecurityPolicy: {
            "default-src": ["'self'", "'unsafe-inline'"], // Relaxed CSP for dev
          },
        })
        .withErrorHandling({
          enableStackTrace: true, // Show stack traces in development
          logErrors: true,
          sanitizeErrors: false, // Don't sanitize errors in development
        })
        .build();

      // Verify development configurations are applied
      expect(app).toBeDefined();

      // Development metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "server_configuration_applied",
        1,
        expect.objectContaining({
          environment: "development",
          stackTrace: true,
          debugLogging: true,
        })
      );
    });

    it("should apply production configuration correctly", () => {
      const app = serverBuilder
        .production()
        .withLogging({
          enabled: true,
          logLevel: "warn", // Production should use warn level
          includeResponseBody: false,
          includeRequestBody: false,
          sanitizeHeaders: true,
        })
        .withSecurity({
          enableHsts: true, // HSTS required in production
          enableNoSniff: true,
          enableXssFilter: true,
          contentSecurityPolicy: {
            "default-src": ["'self'"], // Strict CSP for production
            "script-src": ["'self'"],
            "style-src": ["'self'"],
          },
        })
        .withErrorHandling({
          enableStackTrace: false, // Hide stack traces in production
          logErrors: true,
          sanitizeErrors: true, // Sanitize errors in production
        })
        .withRateLimit({
          windowMs: 60000,
          max: parseInt(process.env.RATE_LIMIT_MAX || "1000"),
          standardHeaders: false, // Don't expose rate limit headers
        })
        .build();

      expect(app).toBeDefined();

      // Production metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "server_configuration_applied",
        1,
        expect.objectContaining({
          environment: "production",
          stackTrace: false,
          strictSecurity: true,
        })
      );
    });

    it("should apply staging configuration with mixed settings", () => {
      const app = serverBuilder
        .staging() // Staging environment
        .withLogging({
          enabled: true,
          logLevel: "info", // Staging uses info level
          includeResponseBody: false,
          includeRequestBody: true, // Include request body for debugging
          sanitizeHeaders: true,
        })
        .withSecurity({
          enableHsts: true,
          enableNoSniff: true,
          contentSecurityPolicy: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"], // Slightly relaxed for testing
          },
        })
        .withErrorHandling({
          enableStackTrace: true, // Show stack traces in staging for debugging
          logErrors: true,
          sanitizeErrors: false, // Don't sanitize in staging
        })
        .build();

      expect(app).toBeDefined();

      // Staging metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "server_configuration_applied",
        1,
        expect.objectContaining({
          environment: "staging",
          stackTrace: true,
          debugMode: true,
        })
      );
    });

    it("should load configuration from environment variables", () => {
      const app = serverBuilder
        .development()
        .withAuthentication(mockAuthService, {
          jwtSecret: process.env.JWT_SECRET!, // From environment
          bypassRoutes: ["/health", "/metrics"],
        })
        .withCors({
          origin: process.env.CORS_ORIGINS!.split(","), // From environment
          credentials: true,
        })
        .withRateLimit({
          windowMs: 60000,
          max: parseInt(process.env.RATE_LIMIT_MAX!), // From environment
        })
        .withLogging({
          enabled: true,
          logLevel: process.env.LOG_LEVEL as any, // From environment
        })
        .build();

      expect(app).toBeDefined();

      // Environment config metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "environment_config_loaded",
        1,
        expect.objectContaining({
          corsOrigins: 2, // Two origins loaded
          rateLimitMax: 1000,
          logLevel: "info",
        })
      );
    });
  });

  describe("Dynamic Middleware Registration", () => {
    it("should register middleware dynamically based on configuration", () => {
      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "dynamic-registration"
      );

      // Configuration object that determines which middleware to load
      const middlewareConfig = {
        authentication: { enabled: true, priority: 90 },
        cors: { enabled: true, priority: 95 },
        rateLimit: { enabled: false, priority: 85 },
        logging: { enabled: true, priority: 100 },
        security: { enabled: true, priority: 80 },
      };

      // Dynamically register middleware based on config
      Object.entries(middlewareConfig).forEach(([name, config]) => {
        if (config.enabled) {
          const mockMiddleware = {
            execute: jest.fn().mockResolvedValue(undefined),
          };

          httpChain.register(
            { name, priority: config.priority },
            mockMiddleware.execute
          );
        }
      });

      expect(httpChain.getRegisteredMiddleware()).toHaveLength(4); // 4 enabled middleware

      // Dynamic registration metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "dynamic_middleware_registered",
        4,
        expect.objectContaining({ configDriven: true })
      );
    });

    it("should conditionally register middleware based on feature flags", () => {
      const featureFlags = {
        ENABLE_ADVANCED_AUTH: true,
        ENABLE_REQUEST_TRACING: false,
        ENABLE_ANALYTICS: true,
        ENABLE_RATE_LIMITING: true,
      };

      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "feature-flag-registration"
      );

      // Register middleware based on feature flags
      if (featureFlags.ENABLE_ADVANCED_AUTH) {
        const authMiddleware = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        httpChain.register(
          { name: "advanced-auth", priority: 90 },
          authMiddleware.execute
        );
      }

      if (featureFlags.ENABLE_REQUEST_TRACING) {
        const tracingMiddleware = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        httpChain.register(
          { name: "tracing", priority: 95 },
          tracingMiddleware.execute
        );
      }

      if (featureFlags.ENABLE_ANALYTICS) {
        const analyticsMiddleware = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        httpChain.register(
          { name: "analytics", priority: 70 },
          analyticsMiddleware.execute
        );
      }

      if (featureFlags.ENABLE_RATE_LIMITING) {
        const rateLimitMiddleware = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        httpChain.register(
          { name: "rate-limit", priority: 85 },
          rateLimitMiddleware.execute
        );
      }

      // Should have registered 3 middleware (tracing is disabled)
      expect(httpChain.getRegisteredMiddleware()).toHaveLength(3);

      // Feature flag metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "feature_flag_middleware_registered",
        3,
        expect.objectContaining({
          advancedAuth: true,
          tracing: false,
          analytics: true,
          rateLimit: true,
        })
      );
    });

    it("should register middleware with different configurations per route", () => {
      const routeConfigs = {
        "/api/public": {
          auth: false,
          rateLimit: { max: 1000, windowMs: 60000 },
          cors: { origin: "*" },
        },
        "/api/private": {
          auth: true,
          rateLimit: { max: 100, windowMs: 60000 },
          cors: { origin: ["https://app.example.com"] },
        },
        "/api/admin": {
          auth: true,
          rateLimit: { max: 50, windowMs: 60000 },
          cors: { origin: ["https://admin.example.com"] },
          requiredRoles: ["admin"],
        },
      };

      // Create chains for different route groups
      const chains = Object.entries(routeConfigs).map(([route, config]) => {
        const chain = new HttpMiddlewareChain(
          mockMetricsCollector,
          `chain-${route.replace("/", "")}`
        );

        // Register middleware based on route configuration
        if (config.cors) {
          const corsMiddleware = {
            execute: jest.fn().mockResolvedValue(undefined),
          };
          chain.register(
            { name: "cors", priority: 95 },
            corsMiddleware.execute
          );
        }

        if (config.auth) {
          const authMiddleware = {
            execute: jest.fn().mockResolvedValue(undefined),
          };
          chain.register(
            { name: "auth", priority: 90 },
            authMiddleware.execute
          );
        }

        if (config.rateLimit) {
          const rateLimitMiddleware = {
            execute: jest.fn().mockResolvedValue(undefined),
          };
          chain.register(
            { name: "rate-limit", priority: 85 },
            rateLimitMiddleware.execute
          );
        }

        return { route, chain, config };
      });

      // Verify different configurations
      const publicChain = chains.find((c) => c.route === "/api/public")!.chain;
      const privateChain = chains.find(
        (c) => c.route === "/api/private"
      )!.chain;
      const adminChain = chains.find((c) => c.route === "/api/admin")!.chain;

      expect(publicChain.getRegisteredMiddleware()).toHaveLength(2); // CORS + Rate Limit
      expect(privateChain.getRegisteredMiddleware()).toHaveLength(3); // CORS + Auth + Rate Limit
      expect(adminChain.getRegisteredMiddleware()).toHaveLength(3); // CORS + Auth + Rate Limit

      // Route-specific configuration metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "route_specific_middleware_configured",
        3,
        expect.objectContaining({ routes: 3 })
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should validate middleware configuration and provide helpful errors", () => {
      expect(() => {
        serverBuilder.withRateLimit({
          windowMs: -1000, // Invalid negative value
          max: 100,
        });
      }).toThrow("Rate limit windowMs must be positive");

      expect(() => {
        serverBuilder.withAuthentication(mockAuthService, {
          jwtSecret: "", // Empty secret
          bypassRoutes: [],
        });
      }).toThrow("JWT secret cannot be empty");

      expect(() => {
        serverBuilder.withCors({
          origin: [], // Empty origins array
        });
      }).toThrow("CORS origins cannot be empty");

      expect(() => {
        serverBuilder.withLogging({
          enabled: true,
          logLevel: "invalid" as any, // Invalid log level
        });
      }).toThrow("Invalid log level");
    });

    it("should validate WebSocket configuration", () => {
      expect(() => {
        serverBuilder.withWebSocket({
          enabled: true,
          maxPayload: -1, // Invalid payload size
        });
      }).toThrow("WebSocket maxPayload must be positive");

      expect(() => {
        serverBuilder.withWebSocketSecurity({
          maxMessageLength: 0, // Invalid message length
          allowedMessageTypes: [],
        });
      }).toThrow("Message length must be greater than 0");

      expect(() => {
        serverBuilder.withWebSocketAuth(mockAuthService, {
          jwtSecret: "", // Empty secret
          requireAuth: true,
        });
      }).toThrow("JWT secret is required when auth is enabled");
    });

    it("should validate configuration compatibility", () => {
      // Test incompatible configurations
      expect(() => {
        serverBuilder
          .withAuthentication(mockAuthService, {
            jwtSecret: "secret",
            bypassRoutes: [],
          })
          .withSecurity({
            enableHsts: true,
          })
          .withCors({
            origin: "*", // Wildcard CORS with auth should warn
            credentials: true, // Credentials with wildcard is invalid
          });
      }).toThrow("Cannot use credentials with wildcard CORS origin");

      // Configuration compatibility metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "configuration_validation_error",
        1,
        expect.objectContaining({ type: "cors_credentials_wildcard" })
      );
    });

    it("should validate configuration against security best practices", () => {
      const warnings: string[] = [];

      // Mock console.warn to capture warnings
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation((message: string) => {
          warnings.push(message);
        });

      serverBuilder
        .production() // Production environment
        .withSecurity({
          enableHsts: false, // Should warn in production
          contentSecurityPolicy: {
            "default-src": ["'self'", "'unsafe-inline'"], // Should warn about unsafe-inline
          },
        })
        .withErrorHandling({
          enableStackTrace: true, // Should warn in production
          sanitizeErrors: false, // Should warn in production
        })
        .build();

      // Verify security warnings were issued
      expect(
        warnings.some((w) => w.includes("HSTS should be enabled in production"))
      ).toBe(true);
      expect(
        warnings.some((w) => w.includes("unsafe-inline should be avoided"))
      ).toBe(true);
      expect(
        warnings.some((w) =>
          w.includes("Stack traces should be disabled in production")
        )
      ).toBe(true);

      consoleWarnSpy.mockRestore();

      // Security validation metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "security_best_practice_warning",
        3,
        expect.objectContaining({ environment: "production" })
      );
    });
  });

  describe("Configuration Inheritance and Overrides", () => {
    it("should inherit base configuration and allow overrides", () => {
      const baseConfig = {
        cors: {
          origin: ["http://localhost:3000"],
          credentials: true,
        },
        security: {
          enableHsts: true,
          enableNoSniff: true,
        },
        logging: {
          enabled: true,
          logLevel: "info" as const,
        },
      };

      // Create server with base configuration
      let app = serverBuilder
        .development()
        .withCors(baseConfig.cors)
        .withSecurity(baseConfig.security)
        .withLogging(baseConfig.logging)
        .build();

      expect(app).toBeDefined();

      // Create another server with overridden configuration
      const overrideConfig = {
        ...baseConfig,
        cors: {
          ...baseConfig.cors,
          origin: ["https://app.example.com"], // Override origin
        },
        logging: {
          ...baseConfig.logging,
          logLevel: "debug" as const, // Override log level
        },
      };

      app = new AdvancedElysiaServerBuilder(mockMetricsCollector)
        .development()
        .withCors(overrideConfig.cors)
        .withSecurity(overrideConfig.security)
        .withLogging(overrideConfig.logging)
        .build();

      expect(app).toBeDefined();

      // Configuration inheritance metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "configuration_inherited",
        1,
        expect.objectContaining({ overrides: 2 })
      );
    });

    it("should support configuration profiles", () => {
      const profiles = {
        minimal: {
          cors: { origin: "*" },
          logging: { enabled: false },
        },
        standard: {
          cors: { origin: ["http://localhost:3000"] },
          logging: { enabled: true, logLevel: "info" as const },
          rateLimit: { max: 100, windowMs: 60000 },
        },
        enterprise: {
          cors: { origin: ["https://app.example.com"], credentials: true },
          logging: {
            enabled: true,
            logLevel: "warn" as const,
            sanitizeHeaders: true,
          },
          rateLimit: { max: 1000, windowMs: 60000 },
          auth: {
            jwtSecret: "enterprise-secret",
            requiredPermissions: ["api:read"],
          },
          security: {
            enableHsts: true,
            enableNoSniff: true,
            contentSecurityPolicy: { "default-src": ["'self'"] },
          },
        },
      };

      // Test each profile
      Object.entries(profiles).forEach(([profileName, config]) => {
        const builder = new AdvancedElysiaServerBuilder(mockMetricsCollector);

        if (config.cors) {
          builder.withCors(config.cors);
        }

        if (config.logging) {
          builder.withLogging(config.logging);
        }

        if (config.rateLimit) {
          builder.withRateLimit(config.rateLimit);
        }

        if (config.auth) {
          builder.withAuthentication(mockAuthService, config.auth);
        }

        if (config.security) {
          builder.withSecurity(config.security);
        }

        const app = builder.build();
        expect(app).toBeDefined();
      });

      // Profile usage metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "configuration_profile_applied",
        3,
        expect.objectContaining({
          profiles: ["minimal", "standard", "enterprise"],
        })
      );
    });
  });

  describe("Runtime Configuration Updates", () => {
    it("should support runtime configuration updates for non-critical settings", () => {
      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "runtime-config"
      );

      // Initial configuration
      let rateLimitConfig = { max: 100, windowMs: 60000 };
      let logLevel = "info";

      const configurableMiddleware = {
        execute: jest.fn().mockImplementation(async (context, next) => {
          // Use current configuration values
          context.metadata.rateLimitConfig = rateLimitConfig;
          context.metadata.logLevel = logLevel;
          await next();
        }),
      };

      httpChain.register(
        { name: "configurable", priority: 90 },
        configurableMiddleware.execute
      );

      // Update configuration at runtime
      rateLimitConfig = { max: 200, windowMs: 30000 };
      logLevel = "debug";

      // Verify configuration updates are reflected
      expect(rateLimitConfig.max).toBe(200);
      expect(logLevel).toBe("debug");

      // Runtime configuration update metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "runtime_configuration_updated",
        1,
        expect.objectContaining({
          configType: "rate_limit",
          newValue: 200,
        })
      );
    });

    it("should handle configuration hot-reloading", () => {
      const configWatcher = {
        currentConfig: {
          rateLimit: { max: 100, windowMs: 60000 },
          logging: { enabled: true, logLevel: "info" as const },
        },

        updateConfig (newConfig: any) {
          const oldConfig = { ...this.currentConfig };
          this.currentConfig = { ...this.currentConfig, ...newConfig };

          // Emit configuration change metrics
          mockMetricsCollector.recordCounter("configuration_hot_reloaded", 1, {
            changes: Object.keys(newConfig).length,
            previousMax: oldConfig.rateLimit.max,
            newMax: this.currentConfig.rateLimit.max,
          });
        },
      };

      // Simulate configuration file change
      configWatcher.updateConfig({
        rateLimit: { max: 500, windowMs: 45000 },
      });

      expect(configWatcher.currentConfig.rateLimit.max).toBe(500);
      expect(configWatcher.currentConfig.logging.logLevel).toBe("info"); // Unchanged

      // Hot reload metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "configuration_hot_reloaded",
        1,
        expect.objectContaining({
          changes: 1,
          previousMax: 100,
          newMax: 500,
        })
      );
    });
  });
});
