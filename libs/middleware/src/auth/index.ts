/**
 * Authentication Middleware Exports
 * Production-grade authentication middleware components and utilities
 */

export {
  AuthMiddleware,
  type AuthMiddlewareConfig,
  createAuthMiddleware,
  AUTH_PRESETS,
} from "./AuthMiddleware";

export {
  WebSocketAuthMiddleware,
  type WebSocketAuthMiddlewareConfig,
  createWebSocketAuthMiddleware,
  WS_AUTH_PRESETS,
} from "./WebSocketAuthMiddleware";

// Re-export commonly used auth types for convenience
export type { User, AuthContext, Action, Resource } from "@libs/auth";

export { UnauthorizedError, ForbiddenError } from "@libs/auth";
