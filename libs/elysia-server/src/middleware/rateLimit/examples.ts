/**
 * Rate Limiting Strategies - Usage Examples
 *
 * This file demonstrates how to use the different rate limiting strategies
 * with both HTTP and WebSocket middlewares.
 */

import {
  RATE_LIMIT_PRESETS,
  WEBSOCKET_RATE_LIMIT_PRESETS,
  createRateLimitStrategy,
  RATE_LIMIT_STRATEGY_PRESETS,
  createRateLimitHttpMiddleware,
  createRateLimitWebSocketMiddleware,
} from "./index";
import type { IMetricsCollector } from "@libs/monitoring";

// Mock metrics collector for examples
const mockMetrics: IMetricsCollector = {} as IMetricsCollector;

/**
 * Example 1: IP-based Rate Limiting
 * Use case: Public API endpoints, file downloads, anonymous access
 */
export function createHttpIpBasedRateLimit() {
  return createRateLimitHttpMiddleware(mockMetrics, {
    ...RATE_LIMIT_PRESETS.general(),
    keyStrategy: "ip",
    maxRequests: 100,
    name: "ip-rate-limit",
  });
}

/**
 * Example 2: User-based Rate Limiting (Standard)
 * Use case: Authenticated API with fallback for anonymous users
 */
export function createHttpUserBasedRateLimit() {
  return createRateLimitHttpMiddleware(mockMetrics, {
    algorithm: "sliding-window",
    maxRequests: 1000, // Higher limit for authenticated users
    windowMs: 60000,
    keyStrategy: "user", // Will use UserStrategy internally
    standardHeaders: true,
    name: "user-rate-limit",
    enabled: true,
  });
}

/**
 * Example 3: API Key-based Rate Limiting
 * Use case: Third-party API access, partner integrations
 */
export function createHttpApiKeyBasedRateLimit() {
  return createRateLimitHttpMiddleware(mockMetrics, {
    ...RATE_LIMIT_PRESETS.api(),
    keyStrategy: "apiKey",
    maxRequests: 5000, // High limit for API key users
    name: "api-key-rate-limit",
  });
}

/**
 * Example 4: Custom Strategy Configuration
 * Use case: When you need custom key generation logic
 */
export function createHttpCustomRateLimit() {
  return createRateLimitHttpMiddleware(mockMetrics, {
    algorithm: "token-bucket",
    maxRequests: 200,
    windowMs: 60000,
    keyStrategy: "custom",
    customKeyGenerator: (context) => {
      // Custom logic: Combine user tier and IP
      const userTier = context.user?.["tier"] || "free";
      const ip = context.request.ip || "unknown";
      return `tier:${userTier}:ip:${ip}`;
    },
    name: "custom-rate-limit",
    enabled: true,
  });
}

/**
 * Example 5: WebSocket User-based Rate Limiting
 * Use case: Chat applications, real-time gaming
 */
export function createWebSocketUserRateLimit() {
  return createRateLimitWebSocketMiddleware(mockMetrics, {
    ...WEBSOCKET_RATE_LIMIT_PRESETS.chat(),
    keyStrategy: "user",
    maxMessagesPerMinute: 60,
    maxConnectionsPerIP: 5,
    enableConnectionLimiting: true,
    sendWarningMessage: true,
    warningThreshold: 80,
  });
}

/**
 * Example 6: WebSocket IP-based Rate Limiting
 * Use case: Anonymous WebSocket connections, public chat rooms
 */
export function createWebSocketIpRateLimit() {
  return createRateLimitWebSocketMiddleware(mockMetrics, {
    algorithm: "sliding-window",
    maxMessagesPerMinute: 30, // Lower limit for anonymous
    maxConnectionsPerIP: 3, // Strict connection limit
    windowMs: 60000,
    keyStrategy: "ip",
    enableConnectionLimiting: true,
    closeOnLimit: true, // Close on limit for anonymous users
    sendWarningMessage: false,
    excludeMessageTypes: ["ping", "pong", "heartbeat"],
    name: "websocket-ip-rate-limit",
    enabled: true,
    priority: 15,
  });
}

/**
 * Example 7: Multi-tier Rate Limiting
 * Use case: SaaS application with different user tiers
 */
export function createTieredRateLimit() {
  return createRateLimitHttpMiddleware(mockMetrics, {
    algorithm: "sliding-window",
    maxRequests: 100, // Base limit
    windowMs: 60000,
    keyStrategy: "custom",
    customKeyGenerator: (context) => {
      const userId = context.user?.id;
      const subscription = (context.user as Record<string, unknown>)?.[
        "subscription"
      ] as Record<string, unknown> | undefined;
      const userTier = (subscription?.["tier"] as string) ?? "free";

      if (userId) {
        return `user:${userTier}:${userId}`;
      }

      // Anonymous users get strict limits
      const ip = context.request.ip || "unknown";
      return `anonymous:${ip}`;
    },
    // Use different configurations based on tier in middleware logic
    onLimitReached: (_result, context) => {
      const subscription = (context.user as Record<string, unknown>)?.[
        "subscription"
      ] as Record<string, unknown> | undefined;
      const userTier = (subscription?.["tier"] as string) ?? "anonymous";
      // Note: Replace console.log with proper logging in production
      console.error(`Rate limit reached for ${userTier} user`);
    },
    name: "tiered-rate-limit",
    enabled: true,
  });
}

/**
 * Example 10: Development vs Production Configurations
 */
export function createEnvironmentSpecificRateLimit(
  env: "development" | "production"
) {
  if (env === "development") {
    return createRateLimitHttpMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.development(),
      keyStrategy: "ip", // Simple for development
      maxRequests: 10000, // Very high limit
    });
  }

  return createRateLimitHttpMiddleware(mockMetrics, {
    ...RATE_LIMIT_PRESETS.production(),
    keyStrategy: "user", // User-based for production
    maxRequests: 300,
    onLimitReached: (_result, context) => {
      // Production logging/alerting
      console.error("Production rate limit exceeded", {
        userId: context.user?.id,
        ip: context.request.ip,
        resetTime: _result.resetTime,
        algorithm: _result.algorithm,
      });
    },
  });
}

/**
 * Strategy Usage Examples
 * Showing how the improved strategies work
 */
export function demonstrateStrategyUsage() {
  // Using strategy presets
  const webAppStrategy = RATE_LIMIT_STRATEGY_PRESETS.webApp();
  const apiStrategy = RATE_LIMIT_STRATEGY_PRESETS.publicApi();
  const cdnStrategy = RATE_LIMIT_STRATEGY_PRESETS.cdn();

  // Using strategy factory
  const customUserStrategy = createRateLimitStrategy.userSessionAware();
  const strictUserStrategy = createRateLimitStrategy.userStrict();

  return {
    webAppStrategy,
    apiStrategy,
    cdnStrategy,
    customUserStrategy,
    strictUserStrategy,
  };
}

/**
 * Best Practices Examples
 */
export const bestPracticeExamples = {
  /**
   * For public APIs
   */
  publicApi: () =>
    createRateLimitHttpMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.api(),
      keyStrategy: "apiKey",
    }),

  /**
   * For user-facing web applications
   */
  webApplication: () =>
    createRateLimitHttpMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.general(),
      keyStrategy: "user",
      standardHeaders: true,
    }),

  /**
   * For WebSocket chat applications
   */
  chatApplication: () =>
    createRateLimitWebSocketMiddleware(mockMetrics, {
      ...WEBSOCKET_RATE_LIMIT_PRESETS.chat(),
      keyStrategy: "user",
      countMessageTypes: ["message", "typing", "reaction"],
      excludeMessageTypes: ["ping", "pong", "heartbeat"],
      sendWarningMessage: true,
      warningThreshold: 85,
    }),

  /**
   * For high-security applications
   */
  highSecurity: () =>
    createRateLimitHttpMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.strict(),
      keyStrategy: "user",
      maxRequests: 50, // Very conservative
      algorithm: "fixed-window", // Strict windowing
      onLimitReached: (_result, context) => {
        // Security logging
        console.warn("Security rate limit triggered", {
          userId: context.user?.id,
          ip: context.request.ip,
          userAgent: context.request.headers["user-agent"],
          timestamp: new Date().toISOString(),
        });
      },
    }),
};
