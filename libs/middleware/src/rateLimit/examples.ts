/**
 * Rate Limiting Strategies - Usage Examples
 *
 * This file demonstrates how to use the different rate limiting strategies
 * with both HTTP and WebSocket middlewares.
 */

import {
  RateLimitMiddleware,
  WebSocketRateLimitMiddleware,
  createRateLimitMiddleware,
  createWebSocketRateLimitMiddleware,
  RATE_LIMIT_PRESETS,
  WEBSOCKET_RATE_LIMIT_PRESETS,
  createRateLimitStrategy,
  RATE_LIMIT_STRATEGY_PRESETS,
} from "./index";
import type { IMetricsCollector } from "@libs/monitoring";

// Mock metrics collector for examples
const mockMetrics: IMetricsCollector = {} as IMetricsCollector;

/**
 * Example 1: IP-based Rate Limiting
 * Use case: Public API endpoints, file downloads, anonymous access
 */
export function createIpBasedRateLimit() {
  return createRateLimitMiddleware(mockMetrics, {
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
export function createUserBasedRateLimit() {
  return new RateLimitMiddleware(mockMetrics, {
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
export function createApiKeyBasedRateLimit() {
  return createRateLimitMiddleware(mockMetrics, {
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
export function createCustomRateLimit() {
  return new RateLimitMiddleware(mockMetrics, {
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
  return createWebSocketRateLimitMiddleware(mockMetrics, {
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
  return new WebSocketRateLimitMiddleware(mockMetrics, {
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
  return new RateLimitMiddleware(mockMetrics, {
    algorithm: "sliding-window",
    maxRequests: 100, // Base limit
    windowMs: 60000,
    keyStrategy: "custom",
    customKeyGenerator: (context) => {
      const userId = context.user?.id;
      const userTier = context.user?.["subscription"]?.["tier"] || "free";

      if (userId) {
        return `user:${userTier}:${userId}`;
      }

      // Anonymous users get strict limits
      const ip = context.request.ip || "unknown";
      return `anonymous:${ip}`;
    },
    // Use different configurations based on tier in middleware logic
    onLimitReached: (_result, context) => {
      const userTier = context.user?.["subscription"]?.["tier"];
      console.log(`Rate limit reached for ${userTier || "anonymous"} user`);
    },
    name: "tiered-rate-limit",
    enabled: true,
  });
}

/**
 * Example 8: Gaming WebSocket Rate Limiting
 * Use case: Real-time gaming with high message frequency
 */
export function createGamingWebSocketRateLimit() {
  return createWebSocketRateLimitMiddleware(mockMetrics, {
    ...WEBSOCKET_RATE_LIMIT_PRESETS.gaming(),
    keyStrategy: "user", // Per-player limits
    maxMessagesPerMinute: 600, // 10 messages per second
    excludeMessageTypes: [
      "ping",
      "pong",
      "heartbeat",
      "game_tick",
      "position_update",
      "health_update",
    ],
    sendWarningMessage: false, // No warnings in gaming
    enableConnectionLimiting: true,
    maxConnectionsPerIP: 2, // Multiple game clients per IP
  });
}

/**
 * Example 9: Progressive Rate Limiting
 * Use case: Graceful degradation based on user behavior
 */
export function createProgressiveRateLimit() {
  return new RateLimitMiddleware(mockMetrics, {
    algorithm: "leaky-bucket",
    maxRequests: 120,
    windowMs: 60000,
    keyStrategy: "user",
    onLimitReached: (_result, context) => {
      // Could implement progressive penalties here
      const userId = context.user?.id || "anonymous";
      console.log(`Progressive limit reached for user: ${userId}`);

      // Example: Reduce limits for repeat offenders
      // This would require additional state management
    },
    name: "progressive-rate-limit",
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
    return createRateLimitMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.development(),
      keyStrategy: "ip", // Simple for development
      maxRequests: 10000, // Very high limit
    });
  }

  return createRateLimitMiddleware(mockMetrics, {
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
    createRateLimitMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.api(),
      keyStrategy: "apiKey",
    }),

  /**
   * For user-facing web applications
   */
  webApplication: () =>
    createRateLimitMiddleware(mockMetrics, {
      ...RATE_LIMIT_PRESETS.general(),
      keyStrategy: "user",
      standardHeaders: true,
    }),

  /**
   * For WebSocket chat applications
   */
  chatApplication: () =>
    createWebSocketRateLimitMiddleware(mockMetrics, {
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
    createRateLimitMiddleware(mockMetrics, {
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

export default {
  createIpBasedRateLimit,
  createUserBasedRateLimit,
  createApiKeyBasedRateLimit,
  createCustomRateLimit,
  createWebSocketUserRateLimit,
  createWebSocketIpRateLimit,
  createTieredRateLimit,
  createGamingWebSocketRateLimit,
  createProgressiveRateLimit,
  createEnvironmentSpecificRateLimit,
  demonstrateStrategyUsage,
  bestPracticeExamples,
};
