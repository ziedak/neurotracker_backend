/**
 * Authentication Middleware Usage Examples
 * Comprehensive examples demonstrating AuthMiddleware integration and configuration
 */

import {
  createAuthMiddleware,
  AuthMiddleware,
  AUTH_PRESETS,
  type AuthMiddlewareConfig,
} from "./index";
import { type AuthenticationService } from "@libs/auth";
import { type IMetricsCollector } from "@libs/monitoring";

/**
 * Example 1: Basic Authentication Setup
 * Simple authentication middleware with JWT support
 */
export function createBasicAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "basic-auth",
    requireAuth: true,
    jwtAuth: true,
    apiKeyAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
  });
}

/**
 * Example 2: Role-Based Access Control
 * Middleware configured for admin-only access
 */
export function createAdminOnlyExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "admin-access",
    requireAuth: true,
    roles: ["admin", "super_admin"],
    jwtAuth: true,
    allowAnonymous: false,
    bypassRoutes: ["/health", "/metrics"],
  });
}

/**
 * Example 3: Multi-Method Authentication
 * Supports JWT, API keys, and sessions with fallback
 */
export function createMultiMethodAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "multi-method-auth",
    requireAuth: false, // Optional authentication
    jwtAuth: true,
    apiKeyAuth: true,
    sessionAuth: true,
    allowAnonymous: true,
    extractUserInfo: true,
    bypassRoutes: ["/health", "/metrics", "/docs", "/favicon.ico"],
  });
}

/**
 * Example 4: Permission-Based Authorization
 * Fine-grained permission checking for resource access
 */
export function createPermissionBasedExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "permission-based",
    requireAuth: true,
    permissions: ["read:documents", "write:documents"],
    jwtAuth: true,
    allowAnonymous: false,
    strictMode: true,
  });
}

/**
 * Example 5: CASL Ability-Based Authorization
 * Advanced authorization using CASL abilities
 */
export function createAbilityBasedExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "ability-based",
    requireAuth: true,
    action: "update",
    resource: "user",
    jwtAuth: true,
    allowAnonymous: false,
  });
}

/**
 * Example 6: API Gateway Configuration
 * Enterprise API gateway with comprehensive authentication
 */
export function createAPIGatewayExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "api-gateway",
    requireAuth: true,
    jwtAuth: true,
    apiKeyAuth: true,
    sessionAuth: false,
    allowAnonymous: false,
    strictMode: true,
    bypassRoutes: ["/health", "/metrics", "/docs"],
    extractUserInfo: true,
    priority: 10,
  });
}

/**
 * Example 7: Development Environment Setup
 * Relaxed authentication for development
 */
export function createDevelopmentExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, AUTH_PRESETS.development());
}

/**
 * Example 8: Production Environment Setup
 * Strict authentication for production
 */
export function createProductionExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, AUTH_PRESETS.production());
}

/**
 * Example 9: Custom Authentication Strategy
 * Custom middleware configuration for specific needs
 */
export function createCustomStrategyExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  // Custom configuration for microservice communication
  const customConfig: Partial<AuthMiddlewareConfig> = {
    name: "microservice-auth",
    requireAuth: true,
    apiKeyAuth: true,
    jwtAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
    strictMode: true,
    bypassRoutes: ["/health", "/metrics", "/internal/status"],
    permissions: ["service:access", "internal:read"],
    priority: 15, // Higher priority for security
  };

  return createAuthMiddleware(metrics, authService, customConfig);
}

/**
 * Example 10: Conditional Authentication
 * Different authentication based on environment
 */
export function createConditionalAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService,
  environment: string = "development"
): AuthMiddleware {
  const getConfigForEnvironment = (
    env: string
  ): Partial<AuthMiddlewareConfig> => {
    switch (env) {
      case "production":
        return {
          name: "production-auth",
          requireAuth: true,
          strictMode: true,
          jwtAuth: true,
          apiKeyAuth: true,
          allowAnonymous: false,
          bypassRoutes: ["/health", "/metrics"],
        };

      case "staging":
        return {
          name: "staging-auth",
          requireAuth: true,
          jwtAuth: true,
          apiKeyAuth: true,
          allowAnonymous: false,
          bypassRoutes: ["/health", "/metrics", "/docs"],
        };

      case "development":
      default:
        return {
          name: "development-auth",
          requireAuth: false,
          jwtAuth: true,
          allowAnonymous: true,
          bypassRoutes: ["/health", "/metrics", "/docs", "/test"],
          strictMode: false,
        };
    }
  };

  return createAuthMiddleware(
    metrics,
    authService,
    getConfigForEnvironment(environment)
  );
}

/**
 * Example 11: Performance Monitoring
 * Authentication middleware with detailed performance tracking
 */
export function createPerformanceMonitoringExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthMiddleware {
  return createAuthMiddleware(metrics, authService, {
    name: "performance-monitored-auth",
    requireAuth: true,
    jwtAuth: true,
    apiKeyAuth: true,
    extractUserInfo: true,
    bypassRoutes: ["/health", "/metrics", "/docs"],
  });
}

/**
 * Configuration Presets Usage Examples
 * Demonstrating the use of pre-built configuration presets
 */
export const CONFIG_EXAMPLES = {
  // Require authentication for all requests
  requireAuth: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => createAuthMiddleware(metrics, authService, AUTH_PRESETS.requireAuth()),

  // Optional authentication with user context extraction
  optionalAuth: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => createAuthMiddleware(metrics, authService, AUTH_PRESETS.optionalAuth()),

  // Admin-only access with role checking
  adminOnly: (metrics: IMetricsCollector, authService: AuthenticationService) =>
    createAuthMiddleware(metrics, authService, AUTH_PRESETS.adminOnly()),

  // User or admin access with multiple roles
  userOrAdmin: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => createAuthMiddleware(metrics, authService, AUTH_PRESETS.userOrAdmin()),

  // API access with API key authentication only
  apiAccess: (metrics: IMetricsCollector, authService: AuthenticationService) =>
    createAuthMiddleware(metrics, authService, AUTH_PRESETS.apiAccess()),

  // Web application with session and JWT support
  webApp: (metrics: IMetricsCollector, authService: AuthenticationService) =>
    createAuthMiddleware(metrics, authService, AUTH_PRESETS.webApp()),

  // Development environment with relaxed security
  development: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => createAuthMiddleware(metrics, authService, AUTH_PRESETS.development()),

  // Production environment with strict security
  production: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => createAuthMiddleware(metrics, authService, AUTH_PRESETS.production()),
} as const;

/**
 * Usage Pattern Examples
 * Common patterns for implementing authentication middleware
 */
export const USAGE_PATTERNS = {
  /**
   * Pattern 1: Single Global Authentication
   * Apply one authentication middleware globally
   */
  singleGlobal: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    const middleware = createMultiMethodAuthExample(metrics, authService);

    // Usage: app.use(middleware.getMiddlewareFunction());
    return middleware;
  },

  /**
   * Pattern 2: Layered Authentication
   * Different authentication levels for different route groups
   */
  layered: (metrics: IMetricsCollector, authService: AuthenticationService) => {
    const publicAuth = createAuthMiddleware(metrics, authService, {
      name: "public-auth",
      requireAuth: false,
      allowAnonymous: true,
      extractUserInfo: true,
    });

    const protectedAuth = createAuthMiddleware(metrics, authService, {
      name: "protected-auth",
      requireAuth: true,
      allowAnonymous: false,
    });

    const adminAuth = createAuthMiddleware(metrics, authService, {
      name: "admin-auth",
      requireAuth: true,
      roles: ["admin"],
      allowAnonymous: false,
    });

    return { publicAuth, protectedAuth, adminAuth };
  },

  /**
   * Pattern 3: Route-Specific Authentication
   * Custom authentication per route or route group
   */
  routeSpecific: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    const readOnlyAuth = createAuthMiddleware(metrics, authService, {
      name: "read-only",
      requireAuth: true,
      permissions: ["read"],
      action: "read",
    });

    const writeAuth = createAuthMiddleware(metrics, authService, {
      name: "write-access",
      requireAuth: true,
      permissions: ["write"],
      action: "update",
    });

    const deleteAuth = createAuthMiddleware(metrics, authService, {
      name: "delete-access",
      requireAuth: true,
      permissions: ["delete"],
      roles: ["admin"],
      action: "delete",
    });

    return { readOnlyAuth, writeAuth, deleteAuth };
  },

  /**
   * Pattern 4: Environment-Based Configuration
   * Different configurations for different environments
   */
  environmentBased: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    const environment = process.env["NODE_ENV"] || "development";

    const configs = {
      development: {
        name: "dev-auth",
        requireAuth: false,
        allowAnonymous: true,
        strictMode: false,
        bypassRoutes: ["/health", "/metrics", "/docs", "/test", "/debug"],
      },
      staging: {
        name: "staging-auth",
        requireAuth: true,
        allowAnonymous: false,
        strictMode: false,
        bypassRoutes: ["/health", "/metrics", "/docs"],
      },
      production: {
        name: "prod-auth",
        requireAuth: true,
        allowAnonymous: false,
        strictMode: true,
        bypassRoutes: ["/health", "/metrics"],
      },
    } as const;

    const config =
      configs[environment as keyof typeof configs] || configs.development;
    return createAuthMiddleware(metrics, authService, config);
  },
} as const;

/**
 * Testing Utilities
 * Helper functions for testing authentication middleware
 */
export const TESTING_UTILS = {
  /**
   * Create a mock authentication middleware for testing
   */
  createMockMiddleware: () => {
    const mockMetrics = {
      increment: jest.fn(),
      histogram: jest.fn(),
      gauge: jest.fn(),
      recordMetric: jest.fn(),
    } as any;

    const mockAuthService = {
      verifyToken: jest.fn(),
      getUserById: jest.fn(),
      getJWTService: jest.fn(() => ({
        extractTokenFromHeader: jest.fn(),
      })),
      getPermissionService: jest.fn(() => ({
        createAuthContext: jest.fn(),
      })),
      getApiKeyService: jest.fn(() => ({
        validateApiKey: jest.fn(),
      })),
      getSessionService: jest.fn(() => ({
        getSession: jest.fn(),
      })),
      can: jest.fn(),
    } as any;

    const middleware = createAuthMiddleware(mockMetrics, mockAuthService, {
      name: "test-auth",
      requireAuth: true,
      jwtAuth: true,
    });

    return {
      middleware,
      mocks: {
        metrics: mockMetrics,
        authService: mockAuthService,
      },
    };
  },

  /**
   * Create test context for middleware testing
   */
  createTestContext: (overrides: any = {}) => ({
    request: {
      method: "GET",
      url: "/test",
      headers: {},
      ...overrides.request,
    },
    user: null,
    ...overrides,
  }),
} as const;

// Export all examples for easy usage
export const EXAMPLES = {
  basic: createBasicAuthExample,
  adminOnly: createAdminOnlyExample,
  multiMethod: createMultiMethodAuthExample,
  permissionBased: createPermissionBasedExample,
  abilityBased: createAbilityBasedExample,
  apiGateway: createAPIGatewayExample,
  development: createDevelopmentExample,
  production: createProductionExample,
  customStrategy: createCustomStrategyExample,
  conditional: createConditionalAuthExample,
  performance: createPerformanceMonitoringExample,
} as const;
