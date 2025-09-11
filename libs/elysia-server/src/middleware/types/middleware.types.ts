import { MiddlewareContext } from "./context.types";

/**
 * Core middleware function signature
 */
export type MiddlewareFunction = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void | any>;

/**
 * Configurable middleware factory function
 */
export interface ConfigurableMiddleware<T = any> {
  (config?: T): MiddlewareFunction;
}

/**
 * Middleware execution result
 */
export interface MiddlewareResult {
  success: boolean;
  error?: string;
  response?: any;
  metadata?: Record<string, any>;
}

/**
 * Middleware chain configuration
 */
export interface MiddlewareChainConfig {
  middlewares: Array<{
    name: string;
    middleware: MiddlewareFunction;
    priority?: number;
    enabled?: boolean;
  }>;
  errorHandler?:
    | ((error: Error, context: MiddlewareContext) => any)
    | undefined;
}
