/**
 * Authentication Middleware Exports
 * Production-grade authentication middleware components and utilities
 */

export * from "./auth.http.middleware";
export * from "./auth.websocket.middleware";

// Re-export commonly used auth types for convenience
export type { User, AuthContext, Action, Resource } from "@libs/auth";

export { UnauthorizedError, ForbiddenError } from "@libs/auth";
