/**
 * Token service types
 *
 * Consolidated type definitions for token management services
 */

import { z } from "zod";
import type { AuthResult, UserInfo } from "../shared/auth";
import type { ValidationResult } from "../shared/validation";

/**
 * JWT payload interface
 */
export interface JWTPayload {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | string[];
  readonly exp: number;
  readonly iat: number;
  readonly [key: string]: any;
}

/**
 * Token validation options
 */
export interface TokenValidationOptions {
  readonly allowExpired?: boolean;
  readonly maxAge?: number;
  readonly requiredClaims?: string[];
  readonly introspectionEndpoint?: string;
  readonly enableCaching?: boolean;
  readonly strictAudience?: boolean;
  readonly validateExpiry?: boolean;
  readonly validateIssuer?: boolean;
  readonly validateAudience?: boolean;
}

/**
 * Token introspection result
 */
export interface TokenIntrospectionResult {
  readonly active: boolean;
  readonly sub?: string;
  readonly email?: string;
  readonly roles?: string[];
  readonly permissions?: string[];
  readonly exp?: number;
  readonly iat?: number;
  readonly [key: string]: any;
}

/**
 * Token manager statistics
 */
export interface TokenManagerStats {
  readonly jwksCached: boolean;
  readonly jwksAge: number;
  readonly cacheEnabled: boolean;
  readonly totalValidations: number;
  readonly successfulValidations: number;
  readonly failedValidations: number;
  readonly cacheHitRate: number;
}

/**
 * Token validation result
 */
export interface TokenValidationResult extends AuthResult {
  readonly payload?: JWTPayload;
  readonly introspection?: TokenIntrospectionResult;
  readonly source: "jwt" | "introspection" | "cache";
  readonly validatedAt: Date;
}

/**
 * JWKS (JSON Web Key Set) cache configuration
 */
export interface JWKSCacheConfig {
  readonly enabled: boolean;
  readonly ttl: number;
  readonly maxKeys: number;
  readonly refreshThreshold: number;
  readonly backgroundRefresh: boolean;
}

/**
 * Token cache configuration
 */
export interface TokenCacheConfig {
  readonly enabled: boolean;
  readonly ttl: number;
  readonly maxEntries: number;
  readonly cleanupInterval: number;
  readonly compressionEnabled: boolean;
}

/**
 * Token service configuration
 */
export interface TokenServiceConfig {
  readonly jwksUrl: string;
  readonly audience: string;
  readonly issuer: string;
  readonly clockTolerance: number;
  readonly introspectionEndpoint?: string;
  readonly cache: {
    readonly jwks: JWKSCacheConfig;
    readonly tokens: TokenCacheConfig;
  };
  readonly validation: TokenValidationOptions;
}

/**
 * Public key information
 */
export interface PublicKeyInfo {
  readonly kid: string;
  readonly kty: string;
  readonly use: string;
  readonly alg: string;
  readonly n?: string;
  readonly e?: string;
  readonly x?: string;
  readonly y?: string;
  readonly crv?: string;
  readonly cachedAt: Date;
  readonly expiresAt?: Date;
}

/**
 * Token metrics interface
 */
export interface TokenMetrics {
  readonly totalValidations: number;
  readonly successfulValidations: number;
  readonly failedValidations: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly introspectionCalls: number;
  readonly jwksRefreshCount: number;
  readonly averageValidationTime: number;
  readonly peakValidationTime: number;
  readonly lastReset: Date;
}

/**
 * Token error class
 */
export class TokenError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;
  public readonly recoverable: boolean;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    details?: Record<string, any>,
    recoverable: boolean = true
  ) {
    super(message);
    this.name = "TokenError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    this.recoverable = recoverable;
    this.timestamp = new Date();
  }
}

/**
 * Validation schemas for token types
 */
export const TokenSchemas = {
  jwt: z
    .string()
    .min(10)
    .regex(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*$/),
  bearer: z
    .string()
    .startsWith("Bearer ")
    .transform((val) => val.slice(7)),
  audience: z.union([z.string(), z.array(z.string())]),

  jwtPayload: z
    .object({
      sub: z.string(),
      iss: z.string(),
      aud: z.union([z.string(), z.array(z.string())]),
      exp: z.number().int().positive(),
      iat: z.number().int().positive(),
    })
    .passthrough(),

  validationOptions: z.object({
    allowExpired: z.boolean().optional().default(false),
    maxAge: z.number().positive().optional(),
    requiredClaims: z.array(z.string()).optional(),
    introspectionEndpoint: z.string().url().optional(),
    enableCaching: z.boolean().optional().default(true),
    strictAudience: z.boolean().optional().default(true),
  }),
};

/**
 * Type guards for runtime checking
 */
export function isJWTPayload(obj: any): obj is JWTPayload {
  try {
    TokenSchemas.jwtPayload.parse(obj);
    return true;
  } catch {
    return false;
  }
}

export function isTokenValidationResult(
  obj: any
): obj is TokenValidationResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.success === "boolean" &&
    obj.validatedAt instanceof Date &&
    ["jwt", "introspection", "cache"].includes(obj.source)
  );
}

export function isValidJWT(token: string): boolean {
  try {
    TokenSchemas.jwt.parse(token);
    return true;
  } catch {
    return false;
  }
}

// Re-export commonly used types
export type { AuthResult, UserInfo };
export type { ValidationResult };
