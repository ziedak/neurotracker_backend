/**
 * Authentication Module Index
 *
 * Modern authentication implementation using Oslo packages for
 * secure session management, password hashing, and JWT tokens.
 *
 * Features:
 * - Session-based authentication with Redis caching
 * - JWT token support for API authentication
 * - Secure password hashing with scrypt
 * - Rate limiting and brute force protection
 * - Role-based access control integration
 * - Comprehensive audit logging
 * - Elysia middleware integration
 */

// Core authentication service
export { AuthService } from "./service";

// User authentication integration
export { UserAuthService } from "./user-service";

// Elysia middleware
export {
  ElysiaAuthMiddleware,
  createAuthPlugin,
  authGuards,
} from "./middleware";

// Password utilities
export { PasswordUtils, DEFAULT_PASSWORD_REQUIREMENTS } from "./password-utils";

// Type definitions
export type {
  AuthConfig,
  AuthUser,
  AuthContext,
  LoginCredentials,
  SessionCreateOptions,
  SessionValidationResult,
  SessionTokenPayload,
  AuthAuditEntry,
  PasswordRequirements,
  CookieOptions,
  RateLimitConfig,
  SecurityHeaders,
  MFAConfig,
  PermissionCheckResult,
} from "./types";

export { SessionInvalidReason, AuthEvent } from "./types";

// Middleware configuration
export type { AuthMiddlewareConfig } from "./middleware";
