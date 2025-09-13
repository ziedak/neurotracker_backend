import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseMiddleware,
  type HttpMiddlewareConfig,
} from "../base/BaseMiddleware";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base/BaseWebSocketMiddleware";
import {
  HttpMiddlewareChain,
  type HttpMiddlewareChainConfig,
} from "../base/middlewareChain/httpMiddlewareChain";
import { WebSocketMiddlewareChain } from "../base/middlewareChain/WebSocketMiddlewareChain";
import { MiddlewareContext, WebSocketContext } from "../types";

/**
 * Factory functions for creating middleware chains with proper configuration
 * Provides convenient APIs for common middleware chain patterns
 *
 * Features:
 * - Type-safe chain creation
 * - Automatic priority assignment
 * - Metrics integration
 * - Error handling setup
 *
 * Usage:
 * ```typescript
 * // HTTP middleware chain
 * const httpChain = createHttpMiddlewareChain(metrics, [
 *   { name: "auth", middleware: authMiddleware },
 *   { name: "cors", middleware: corsMiddleware },
 * ]);
 *
 * // WebSocket middleware chain
 * const wsChain = createWebSocketMiddlewareChain(metrics, [
 *   { name: "auth", middleware: wsAuthMiddleware },
 *   { name: "rate-limit", middleware: wsRateLimitMiddleware },
 * ]);
 * ```
 */

/**
 * HTTP middleware chain item configuration
 */
export interface HttpChainItem {
  readonly name: string;
  readonly middleware: BaseMiddleware<any>;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly config?: Partial<HttpMiddlewareConfig>;
}

/**
 * WebSocket middleware chain item configuration
 */
export interface WebSocketChainItem {
  readonly name: string;
  readonly middleware: BaseWebSocketMiddleware<any>;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly config?: Partial<WebSocketMiddlewareConfig>;
}

/**
 * Create HTTP middleware chain from BaseMiddleware instances
 * @param metrics - Metrics collector instance
 * @param chainName - Name for the chain
 * @param middlewares - Array of middleware configurations
 */
export function createHttpMiddlewareChain(
  metrics: IMetricsCollector,
  chainName: string,
  middlewares: HttpChainItem[]
): HttpMiddlewareChain {
  const chainConfig: HttpMiddlewareChainConfig = {
    name: chainName,
    middlewares: middlewares.map((item, index) => {
      // Apply per-chain configuration if provided
      const middlewareInstance = item.config
        ? item.middleware.withConfig(item.config)
        : item.middleware;

      return {
        name: item.name,
        middleware: middlewareInstance.middleware(),
        priority: item.priority ?? (middlewares.length - index) * 10, // Auto-assign descending priorities
        enabled: item.enabled ?? true,
      };
    }),
  };

  return new HttpMiddlewareChain(metrics, chainConfig);
}

/**
 * Create WebSocket middleware chain from BaseWebSocketMiddleware instances
 * @param metrics - Metrics collector instance
 * @param chainName - Name for the chain
 * @param middlewares - Array of middleware configurations
 */
export function createWebSocketMiddlewareChain(
  metrics: IMetricsCollector,
  chainName: string,
  middlewares: WebSocketChainItem[]
): WebSocketMiddlewareChain {
  const chain = new WebSocketMiddlewareChain(metrics, chainName);

  // Register middlewares with auto-assigned priorities
  middlewares.forEach((item, index) => {
    const middlewareInstance = item.config
      ? item.middleware.withConfig(item.config)
      : item.middleware;

    chain.register(
      {
        name: item.name,
        priority: item.priority ?? (middlewares.length - index) * 10,
        optional: !item.enabled,
      },
      middlewareInstance.middleware()
    );
  });

  return chain;
}

/**
 * Create a simple HTTP middleware chain with basic configuration
 * @param metrics - Metrics collector instance
 * @param middlewares - Simple middleware function array
 */
export function createSimpleHttpChain(
  metrics: IMetricsCollector,
  middlewares: Array<{
    name: string;
    middleware: (
      context: MiddlewareContext,
      next: () => Promise<void>
    ) => Promise<void>;
    priority?: number;
  }>
): HttpMiddlewareChain {
  const chainConfig: HttpMiddlewareChainConfig = {
    name: "simple-http-chain",
    middlewares: middlewares.map((item) => ({
      name: item.name,
      middleware: item.middleware,
      priority: item.priority ?? 0,
      enabled: true,
    })),
  };

  return new HttpMiddlewareChain(metrics, chainConfig);
}

/**
 * Create a simple WebSocket middleware chain with basic configuration
 * @param metrics - Metrics collector instance
 * @param middlewares - Simple middleware function array
 */
export function createSimpleWebSocketChain(
  metrics: IMetricsCollector,
  middlewares: Array<{
    name: string;
    middleware: (
      context: WebSocketContext,
      next: () => Promise<void>
    ) => Promise<void>;
    priority?: number;
  }>
): WebSocketMiddlewareChain {
  const chain = new WebSocketMiddlewareChain(metrics, "simple-ws-chain");

  middlewares.forEach((item) => {
    chain.register(
      {
        name: item.name,
        priority: item.priority ?? 0,
      },
      item.middleware
    );
  });

  return chain;
}

/**
 * Predefined middleware chain patterns
 */
export const MiddlewareChainPatterns = {
  /**
   * Basic security chain for HTTP
   */
  BASIC_HTTP_SECURITY: () => ({
    name: "basic-http-security",
    priorities: {
      cors: 100,
      security: 90,
      rateLimit: 80,
      auth: 70,
      metrics: 10,
    },
  }),

  /**
   * Basic security chain for WebSocket
   */
  BASIC_WS_SECURITY: () => ({
    name: "basic-ws-security",
    priorities: {
      auth: 100,
      rateLimit: 90,
      validation: 80,
    },
  }),

  /**
   * Full production chain for HTTP
   */
  PRODUCTION_HTTP: () => ({
    name: "production-http",
    priorities: {
      logging: 150,
      cors: 140,
      security: 130,
      rateLimit: 120,
      auth: 110,
      validation: 100,
      business: 50,
      metrics: 10,
    },
  }),

  /**
   * Full production chain for WebSocket
   */
  PRODUCTION_WS: () => ({
    name: "production-ws",
    priorities: {
      logging: 150,
      auth: 140,
      rateLimit: 130,
      validation: 120,
      business: 100,
      metrics: 10,
    },
  }),

  /**
   * Development chain with minimal security
   */
  DEVELOPMENT: () => ({
    name: "development",
    priorities: {
      logging: 100,
      auth: 50,
      rateLimit: 40,
    },
  }),
} as const;

/**
 * Chain factory for creating predefined middleware patterns
 */
export const ChainFactory = {
  patterns: MiddlewareChainPatterns,
  createHttpChain: createHttpMiddlewareChain,
  createWebSocketChain: createWebSocketMiddlewareChain,
  createSimpleHttpChain,
  createSimpleWebSocketChain,
};
