import { MiddlewareContext } from "./context.types";

/**
 * Core middleware function signature with proper return typing
 */
export type MiddlewareFunction = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void> | void;

/**
 * Configurable middleware factory function with generic constraints
 */
export interface ConfigurableMiddleware<T = Record<string, unknown>> {
  (config?: T): MiddlewareFunction;
}

/**
 * Middleware execution result with strict typing
 */
export interface MiddlewareResult {
  success: boolean;
  error?: Error | string;
  response?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Middleware chain configuration with enhanced error handling
 */
export interface MiddlewareChainConfig {
  middlewares: Array<{
    name: string;
    middleware: MiddlewareFunction;
    priority?: number;
    enabled?: boolean;
  }>;
  errorHandler?: (
    error: Error,
    context: MiddlewareContext
  ) => unknown | undefined;
}
