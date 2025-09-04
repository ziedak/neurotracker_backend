/**
 * Keycloak Authentication Types and Interfaces
 *
 * Defines types for Keycloak integration in the middleware system
 */

/**
 * Keycloak configuration interface with enhanced options
 */
export interface KeycloakConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string | undefined;
  publicKey?: string;
  jwksUri?: string;
  rolesClaim?: string;
  usernameClaim?: string;
  emailClaim?: string;
  groupsClaim?: string;
  skipPaths?: string[];
  requireAuth?: boolean;
  cacheTTL?: number;
  enableUserInfoEndpoint?: boolean;
  verifyTokenLocally?: boolean;
  connectTimeout?: number;
  readTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetTimeout?: number;
  enableMetrics?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
  trustedProxies?: string[];
  corsOrigins?: string[];
}

/**
 * Keycloak JWT payload structure
 */
export interface KeycloakJWTPayload {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | string[];
  readonly exp: number;
  readonly iat: number;
  readonly auth_time?: number;
  readonly jti: string;
  readonly typ: string;
  readonly azp?: string;
  readonly nonce?: string;
  readonly session_state?: string;
  readonly acr?: string;
  readonly scope?: string;
  readonly sid?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly preferred_username?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly email?: string;
  readonly realm_access?: {
    roles: string[];
  };
  readonly resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };
  readonly groups?: string[];
  readonly [key: string]: any;
}

/**
 * Keycloak user information structure
 */
export interface KeycloakUserInfo {
  readonly sub: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly name?: string;
  readonly preferredUsername?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly roles: string[];
  readonly groups: string[];
  readonly clientRoles: Record<string, string[]>;
  readonly attributes?: Record<string, any>;
}

/**
 * Token verification result
 */
export interface KeycloakTokenVerification {
  readonly valid: boolean;
  readonly payload?: KeycloakJWTPayload;
  readonly userInfo?: KeycloakUserInfo;
  readonly error?: string;
  readonly source: "local" | "remote";
}

/**
 * Keycloak authentication context
 */
export interface KeycloakAuthContext {
  readonly authenticated: boolean;
  readonly user?: KeycloakUserInfo;
  readonly token?: string;
  readonly refreshToken?: string;
  readonly sessionId?: string;
  readonly roles: string[];
  readonly groups: string[];
  readonly permissions: string[];
  readonly clientRoles: Record<string, string[]>;
}

/**
 * Keycloak middleware configuration
 */
export interface KeycloakMiddlewareConfig extends KeycloakConfig {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  readonly errorHandler?: (error: Error, context: any) => void;
  readonly tokenValidator?: (token: string) => Promise<boolean>;
  readonly userTransform?: (userInfo: KeycloakUserInfo) => any;
}

/**
 * Keycloak WebSocket configuration
 */
export interface KeycloakWebSocketConfig extends KeycloakConfig {
  readonly name: string; // Required for WebSocket middleware
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  readonly skipMessageTypes?: string[];
  readonly requireAuth?: boolean;
  readonly closeOnAuthFailure?: boolean;
  readonly skipAuthenticationForTypes?: string[];
  readonly messagePermissions?: Record<string, string[]>;
  readonly messageRoles?: Record<string, string[]>;
  readonly errorHandler?: (error: Error, context: any) => void;
  readonly tokenValidator?: (token: string) => Promise<boolean>;
  readonly userTransform?: (userInfo: KeycloakUserInfo) => any;
}

/**
 * Keycloak introspection response
 */
export interface KeycloakIntrospectionResponse {
  readonly active: boolean;
  readonly scope?: string;
  readonly client_id?: string;
  readonly username?: string;
  readonly token_type?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly sub?: string;
  readonly aud?: string | string[];
  readonly iss?: string;
  readonly jti?: string;
  readonly email?: string;
  readonly preferred_username?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly name?: string;
  readonly realm_access?: {
    roles: string[];
  };
  readonly resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };
  readonly groups?: string[];
}

/**
 * Keycloak service response
 */
export interface KeycloakServiceResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly cached?: boolean;
  readonly source?: string;
}

/**
 * JWKS (JSON Web Key Set) structure
 */
export interface JWKS {
  readonly keys: JWK[];
}

/**
 * JWK (JSON Web Key) structure
 */
export interface JWK {
  readonly kty: string;
  readonly use?: string;
  readonly key_ops?: string[];
  readonly alg?: string;
  readonly kid?: string;
  readonly x5u?: string;
  readonly x5c?: string[];
  readonly x5t?: string;
  readonly "x5t#S256"?: string;
  readonly n?: string;
  readonly e?: string;
  readonly d?: string;
  readonly p?: string;
  readonly q?: string;
  readonly dp?: string;
  readonly dq?: string;
  readonly qi?: string;
  readonly oth?: Array<{
    r?: string;
    d?: string;
    t?: string;
  }>;
  readonly k?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

/**
 * Enhanced cache entry structure with metadata
 */
export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly hitCount?: number;
  readonly lastAccessedAt?: number;
  readonly source?: "local" | "remote";
  readonly version?: string;
}

/**
 * Rate limiting result interface
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetTime: number;
  readonly retryAfter?: number;
}

/**
 * Circuit breaker status interface
 */
export interface CircuitBreakerStatus {
  readonly state: "closed" | "open" | "half-open";
  readonly failureCount: number;
  readonly lastFailureTime?: number;
  readonly nextAttemptTime?: number;
}

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  readonly status: "healthy" | "unhealthy" | "degraded";
  readonly details: {
    readonly redis?: "connected" | "disconnected" | "error";
    readonly keycloak?: "accessible" | "unreachable" | "error";
    readonly circuitBreaker?: CircuitBreakerStatus;
    readonly cacheStats?: Record<string, number>;
    readonly uptime?: number;
    readonly version?: string;
  };
  readonly timestamp: number;
}

/**
 * Enhanced metrics interface
 */
export interface KeycloakMetrics {
  readonly authSuccessCount: number;
  readonly authFailureCount: number;
  readonly tokenValidationDuration: number;
  readonly cacheHitRate: number;
  readonly rateLimitedRequests: number;
  readonly circuitBreakerTrips: number;
  readonly activeConnections: number;
}

/**
 * Keycloak error types with additional security errors
 */
export enum KeycloakErrorType {
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  INVALID_ISSUER = "INVALID_ISSUER",
  INVALID_AUDIENCE = "INVALID_AUDIENCE",
  CONNECTION_ERROR = "CONNECTION_ERROR",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  RATE_LIMITED = "RATE_LIMITED",
  CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN",
  JWKS_ERROR = "JWKS_ERROR",
  CACHE_ERROR = "CACHE_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}

/**
 * Enhanced Keycloak error class with better error context
 */
export class KeycloakError extends Error {
  public readonly type: KeycloakErrorType;
  public readonly statusCode?: number;
  public readonly details?: any;
  public readonly timestamp: number;
  public readonly requestId?: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    type: KeycloakErrorType,
    statusCode?: number,
    details?: any,
    requestId?: string
  ) {
    super(message);
    this.name = "KeycloakError";
    this.type = type;
    this.timestamp = Date.now();
    if (requestId !== undefined) {
      this.requestId = requestId;
    }

    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
    if (details !== undefined) {
      this.details = details;
    }

    // Determine if error is retryable
    this.retryable = this.isRetryableError(type);

    // Capture stack trace
    Error.captureStackTrace?.(this, KeycloakError);
  }

  /**
   * Determine if an error type is retryable
   */
  private isRetryableError(type: KeycloakErrorType): boolean {
    switch (type) {
      case KeycloakErrorType.CONNECTION_ERROR:
      case KeycloakErrorType.CIRCUIT_BREAKER_OPEN:
      case KeycloakErrorType.CACHE_ERROR:
        return true;
      default:
        return false;
    }
  }

  /**
   * Convert error to JSON for structured logging
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      requestId: this.requestId,
      retryable: this.retryable,
      details: this.details,
    };
  }
}
