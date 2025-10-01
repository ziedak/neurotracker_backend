/**
 * Central type exports for keycloak-authV2 library
 *
 * This module provides a single entry point for all type definitions,
 * making it easier to import and maintain type consistency across the codebase.
 */

// Common shared types
export * from "./common";
export * from "./shared/auth";
export * from "./shared/security";
export * from "./shared/validation";

// Service-specific types - be explicit to avoid conflicts
export * from "./services/apikey";
export * from "./services/session";
export {
  JWTPayload,
  TokenValidationOptions,
  TokenIntrospectionResult,
  TokenManagerStats,
  TokenValidationResult as TokenServiceValidationResult,
  JWKSCacheConfig,
  TokenCacheConfig,
  TokenServiceConfig,
  PublicKeyInfo,
  TokenMetrics,
  TokenError,
  TokenSchemas,
  isJWTPayload,
  isTokenValidationResult,
  isValidJWT,
} from "./services/token";
export * from "./services/ability";

// Legacy re-exports for backward compatibility (non-conflicting types only)
export type { AuthConfig, AuthV2Config, APIKeyInfo } from "../types";
