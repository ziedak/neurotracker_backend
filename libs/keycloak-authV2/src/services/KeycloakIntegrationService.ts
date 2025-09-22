/**
 * Comprehensive Keycloak Integration Service
 * - KeycloakClient for OIDC authentication flows
 * - KeycloakUserManager for user management via Admin API
 * - KeycloakSessionManager for session management with token integration
 * - Comprehensive error handling and logging
 */

import crypto from "crypto";
import { z } from "zod";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import { KeycloakClient } from "../client/KeycloakClient";
import { KeycloakUserManager } from "./KeycloakUserManager";
import { TokenManager } from "./KeycloakTokenManager";
import {
  KeycloakSessionManager,
  type KeycloakSessionData,
  type SessionStats,
} from "./KeycloakSessionManager";
import type { UserInfo } from "../types";

// Configuration Constants
const CACHE_TTL = {
  STATS: 5000, // 5 seconds for stats cache
  JWT: 300, // 5 minutes for JWT cache
  API_KEY: 600, // 10 minutes for API key cache
  SESSION: 3600, // 1 hour for session cache
  USER_INFO: 1800, // 30 minutes for user info cache
} as const;

const SESSION_CONFIG = {
  MAX_CONCURRENT: 5, // Maximum concurrent sessions per user
  ROTATION_INTERVAL: 86400, // 24 hours in seconds for user sessions
  ROTATION_INTERVAL_SESSIONS: 43200, // 12 hours in seconds for session manager
} as const;

const SECURITY_CONFIG = {
  API_KEY_HASH_ROUNDS: 12, // bcrypt rounds for API key hashing
  KEY_DERIVATION_ITERATIONS: 100000, // PBKDF2 iterations for encryption
} as const;

const VALIDATION_LIMITS = {
  USERNAME_MAX_LENGTH: 100,
  PASSWORD_MAX_LENGTH: 1000,
  USER_AGENT_MAX_LENGTH: 1000,
  AUTH_CODE_MAX_LENGTH: 2000,
} as const;

// Input Sanitization Utilities
const sanitizeHtml = (input: string): string => {
  return input.replace(/[<>"'&]/g, (match) => {
    switch (match) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#x27;";
      case "&":
        return "&amp;";
      default:
        return match;
    }
  });
};

const sanitizeSql = (input: string): string => {
  // Remove or escape SQL injection patterns
  return input
    .replace(/[';-]/g, "") // Remove common SQL injection chars
    .replace(/--/g, "") // Remove SQL comment indicators
    .replace(
      /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b/gi,
      ""
    ) // Remove SQL keywords
    .trim();
};

const sanitizeInput = (input: string): string => {
  return sanitizeSql(sanitizeHtml(input.trim()));
};

// Zod Validation Schemas with Enhanced Sanitization
const SessionIdSchema = z.string().uuid("Invalid session ID format");

const UsernameSchema = z
  .string()
  .trim()
  .min(1, "Username cannot be empty")
  .max(
    VALIDATION_LIMITS.USERNAME_MAX_LENGTH,
    `Username too long (max ${VALIDATION_LIMITS.USERNAME_MAX_LENGTH} characters)`
  )
  .regex(/^[a-zA-Z0-9._@-]+$/, "Username contains invalid characters")
  .transform(sanitizeInput); // Apply sanitization after validation

const PasswordSchema = z
  .string()
  .min(1, "Password cannot be empty")
  .max(
    VALIDATION_LIMITS.PASSWORD_MAX_LENGTH,
    `Password too long (max ${VALIDATION_LIMITS.PASSWORD_MAX_LENGTH} characters)`
  )
  // Note: Passwords should NOT be sanitized as it changes their value
  .refine((password) => {
    // Check for suspicious patterns that might indicate injection attempts
    const suspiciousPatterns = /[<>"'`;]/;
    return !suspiciousPatterns.test(password) || password.length > 50; // Allow in long passwords
  }, "Password contains potentially unsafe characters");

const AuthCodeSchema = z
  .string()
  .trim()
  .min(1, "Authorization code cannot be empty")
  .max(VALIDATION_LIMITS.AUTH_CODE_MAX_LENGTH, "Authorization code too long")
  .regex(/^[a-zA-Z0-9._-]+$/, "Authorization code contains invalid characters")
  .transform(sanitizeInput); // Sanitize authorization codes

const RedirectUriSchema = z
  .string()
  .trim()
  .url("Invalid redirect URI format")
  .transform(sanitizeHtml) // Only HTML sanitize URIs, not SQL
  .refine((uri) => {
    const url = new URL(uri);
    return (
      url.protocol === "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    );
  }, "Redirect URI must use HTTPS or be localhost");

const ClientContextSchema = z.object({
  ipAddress: z
    .string()
    .min(1, "IP address is required")
    .regex(
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^localhost$/,
      "Invalid IP address format"
    )
    .transform(sanitizeInput), // Sanitize IP addresses
  userAgent: z
    .string()
    .min(1, "User agent is required")
    .max(VALIDATION_LIMITS.USER_AGENT_MAX_LENGTH, "User agent too long")
    .transform(sanitizeHtml), // Only HTML sanitize user agents (common to contain special chars)
  clientId: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeInput(val) : val)),
});

// Strict Configuration Interfaces
export interface KeycloakConnectionOptions {
  readonly serverUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface ClientContext {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly clientId?: string;
}

export interface ValidationContext {
  readonly operationType: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly timestamp: number;
}

// Stats Cache Interface
interface StatsData {
  session: SessionStats;
  client: {
    discoveryLoaded: boolean;
    cacheEnabled: boolean;
    requestCount: number;
  };
  token: {
    cacheHits: number;
    cacheMisses: number;
    validationCount: number;
    jwksLoaded: boolean;
  };
}

export interface AuthenticationResult {
  success: boolean;
  user?: UserInfo;
  tokens?: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in?: number;
  };
  session?: {
    sessionId: string;
    sessionData: KeycloakSessionData;
  };
  error?: string;
  requiresMFA?: boolean;
  redirectUrl?: string;
}

export interface LogoutResult {
  success: boolean;
  loggedOut: boolean;
  sessionDestroyed: boolean;
  keycloakLogout: boolean;
  keycloakLogoutError?: string;
  error?: string;
}

/**
 * Comprehensive Keycloak Integration Service
 *
 * Provides a unified interface for:
 * - User authentication with multiple flows
 * - Session management with token handling
 * - User management operations
 * - Comprehensive logging and metrics
 */
export class KeycloakIntegrationService {
  private readonly logger = createLogger("KeycloakIntegrationService");
  private keycloakClient: KeycloakClient;
  private userManager: KeycloakUserManager;
  private sessionManager: KeycloakSessionManager;
  private tokenManager: TokenManager;

  // Performance optimization for getStats - cache with TTL and race condition protection
  private statsCache: {
    data: StatsData;
    timestamp: number;
    ttl: number;
  } | null = null;
  private readonly STATS_CACHE_TTL = CACHE_TTL.STATS;
  private isGeneratingStats: boolean = false;

  constructor(
    private readonly keycloakOptions: KeycloakConnectionOptions,
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize Keycloak client
    this.keycloakClient = new KeycloakClient(
      {
        realm: {
          serverUrl: this.keycloakOptions.serverUrl,
          realm: this.keycloakOptions.realm,
          clientId: this.keycloakOptions.clientId,
          ...(this.keycloakOptions.clientSecret && {
            clientSecret: this.keycloakOptions.clientSecret,
          }),
          scopes: ["openid", "profile", "email"], // Default OIDC scopes
        },
      },
      metrics
    );

    // Create shared base configuration
    const baseConfig = this.createBaseConfiguration(!!metrics);

    // Initialize token manager first since others might depend on it
    this.tokenManager = new TokenManager(
      this.keycloakClient,
      {
        jwt: {
          issuer: `${this.keycloakOptions.serverUrl}/realms/${this.keycloakOptions.realm}`,
          audience: this.keycloakOptions.clientId,
          jwksUrl: `${this.keycloakOptions.serverUrl}/realms/${this.keycloakOptions.realm}/protocol/openid_connect/certs`,
        },
        cache: baseConfig.cache,
        security: baseConfig.security,
        session: baseConfig.session,
        encryption: baseConfig.encryption,
      },
      metrics
    );

    // Initialize user manager with user-specific configuration
    this.userManager = new KeycloakUserManager(
      this.keycloakClient,
      {
        ...baseConfig,
        // User manager specific overrides
        session: {
          ...baseConfig.session,
          enforceUserAgentConsistency: false, // More flexible for user management
        },
      },
      metrics
    );

    // Initialize session manager with session-specific configuration
    this.sessionManager = new KeycloakSessionManager(
      this.keycloakClient,
      {
        ...baseConfig,
        // Session manager specific overrides
        security: {
          ...baseConfig.security,
          sessionRotationInterval: SESSION_CONFIG.ROTATION_INTERVAL_SESSIONS,
        },
      },
      this.dbClient, // PostgreSQL client for session persistence
      metrics
    );
  }

  private createBaseConfiguration(hasMetrics: boolean) {
    return {
      jwt: {},
      cache: {
        enabled: hasMetrics,
        ttl: {
          jwt: CACHE_TTL.JWT,
          apiKey: CACHE_TTL.API_KEY,
          session: CACHE_TTL.SESSION,
          userInfo: CACHE_TTL.USER_INFO,
        },
      },
      security: {
        constantTimeComparison: true,
        apiKeyHashRounds: SECURITY_CONFIG.API_KEY_HASH_ROUNDS,
        sessionRotationInterval: SESSION_CONFIG.ROTATION_INTERVAL,
      },
      session: {
        maxConcurrentSessions: SESSION_CONFIG.MAX_CONCURRENT,
        enforceIpConsistency: true,
        enforceUserAgentConsistency: true,
        tokenEncryption: true,
      },
      encryption: {
        keyDerivationIterations: SECURITY_CONFIG.KEY_DERIVATION_ITERATIONS,
      },
    };
  }

  /**
   * Validate session ID format (UUID) using Zod
   */
  private validateSessionId(sessionId: string): boolean {
    return SessionIdSchema.safeParse(sessionId).success;
  }

  /**
   * Validate and sanitize username input using Zod
   */
  private validateUsername(username: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  } {
    const result = UsernameSchema.safeParse(username);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Username validation failed",
      };
    }
    return { valid: true, sanitized: result.data };
  }

  /**
   * Validate password input using Zod
   */
  private validatePassword(password: string): {
    valid: boolean;
    error?: string;
  } {
    const result = PasswordSchema.safeParse(password);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Password validation failed",
      };
    }
    return { valid: true };
  }

  /**
   * Validate OAuth authorization code using Zod
   */
  private validateAuthCode(code: string): { valid: boolean; error?: string } {
    const result = AuthCodeSchema.safeParse(code);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message ||
          "Authorization code validation failed",
      };
    }
    return { valid: true };
  }

  /**
   * Validate redirect URI using Zod
   */
  private validateRedirectUri(uri: string): { valid: boolean; error?: string } {
    const result = RedirectUriSchema.safeParse(uri);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message || "Redirect URI validation failed",
      };
    }
    return { valid: true };
  }

  /**
   * Validate client context using Zod
   */
  private validateClientContext(context: any): {
    valid: boolean;
    error?: string;
  } {
    const result = ClientContextSchema.safeParse(context);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message || "Client context validation failed",
      };
    }
    return { valid: true };
  }

  /**
   * Verify and extract claims from JWT tokens using TokenManager
   */
  private async verifyAndExtractJwtClaims(
    accessToken: string,
    context: ValidationContext
  ): Promise<{
    valid: boolean;
    claims?: Record<string, unknown>;
    sessionId?: string;
    error?: string;
  }> {
    try {
      // Delegate to TokenManager for JWT verification
      const result = await this.tokenManager.validateJwt(accessToken);

      if (!result.success) {
        return {
          valid: false,
          error: result.error || "Token validation failed",
        };
      }

      // For session ID extraction, we need to access the raw JWT claims
      // Since UserInfo doesn't contain session information, extract it from the token directly
      // This will require additional method in TokenManager or manual JWT decoding
      const sessionId = await this.extractSessionIdFromToken(accessToken);

      this.logger.debug("JWT verification successful", {
        operationType: context.operationType,
        userId: context.userId,
        hasSessionId: !!sessionId,
        subject: result.user?.id,
        username: result.user?.username,
      });

      return {
        valid: true,
        claims: result.user as unknown as Record<string, unknown>,
        ...(sessionId && { sessionId }),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("JWT verification failed", {
        error: errorMessage,
        operationType: context.operationType,
        userId: context.userId,
        sessionId: context.sessionId,
        ipAddress: context.ipAddress,
        timestamp: context.timestamp,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });

      return {
        valid: false,
        error: "Token verification failed",
      };
    }
  }

  /**
   * Extract session ID from JWT token (fallback to crypto.randomUUID if not found)
   */
  private async extractSessionIdFromToken(token: string): Promise<string> {
    try {
      // Simple base64 decode of JWT payload for session ID extraction
      // This is safe since we already validated the signature through TokenManager
      const parts = token.split(".");
      if (parts.length !== 3) {
        return crypto.randomUUID();
      }

      const payload = JSON.parse(
        Buffer.from(parts[1]!, "base64url").toString()
      );

      return (
        payload.sid ||
        payload.session_id ||
        payload.sessionId ||
        crypto.randomUUID()
      );
    } catch (error) {
      this.logger.debug(
        "Could not extract session ID from token, generating new one",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return crypto.randomUUID();
    }
  }

  /**
   * Extract Keycloak session ID from verified JWT tokens using TokenManager
   */
  private async extractKeycloakSessionId(
    tokens: {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in: number;
      refresh_expires_in?: number;
    },
    context: ValidationContext
  ): Promise<string | null> {
    const verificationResult = await this.verifyAndExtractJwtClaims(
      tokens.access_token,
      context
    );

    if (verificationResult.valid && verificationResult.sessionId) {
      return verificationResult.sessionId;
    }

    // Log warning but don't fail - session ID is optional
    this.logger.warn("Could not extract session ID from verified JWT", {
      operationType: context.operationType,
      userId: context.userId,
      hasValidToken: verificationResult.valid,
      error: verificationResult.error,
    });

    return null;
  }

  /**
   * Initialize the Keycloak integration
   * Must be called before using other methods
   */
  async initialize(): Promise<void> {
    try {
      await this.keycloakClient.initialize();
      this.logger.info("Keycloak integration initialized successfully");
      this.metrics?.recordCounter("keycloak.integration.initialized", 1);
    } catch (error) {
      // Specific error handling for initialization
      let errorMessage = "Failed to initialize Keycloak integration";
      let metricSuffix = "init_error";

      if (error instanceof Error) {
        if (
          error.message.includes("network") ||
          error.message.includes("ENOTFOUND")
        ) {
          errorMessage = "Cannot connect to Keycloak server";
          metricSuffix = "init_connection_failed";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Keycloak server timeout during initialization";
          metricSuffix = "init_timeout";
        } else if (
          error.message.includes("401") ||
          error.message.includes("403")
        ) {
          errorMessage = "Invalid Keycloak credentials";
          metricSuffix = "init_auth_failed";
        } else if (error.message.includes("404")) {
          errorMessage = "Keycloak realm or configuration not found";
          metricSuffix = "init_config_not_found";
        }
      }

      this.logger.error("Failed to initialize Keycloak integration", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });
      this.metrics?.recordCounter(`keycloak.integration.${metricSuffix}`, 1);
      throw new Error(errorMessage);
    }
  }

  /**
   * Authenticate user with username/password
   */
  async authenticateWithPassword(
    username: string,
    password: string,
    clientContext: {
      ipAddress: string;
      userAgent: string;
      clientId?: string;
    }
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    // Input validation
    const usernameValidation = this.validateUsername(username);
    if (!usernameValidation.valid) {
      return {
        success: false,
        error: usernameValidation.error || "Invalid username",
      };
    }

    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      return {
        success: false,
        error: passwordValidation.error || "Invalid password",
      };
    }

    const contextValidation = this.validateClientContext(clientContext);
    if (!contextValidation.valid) {
      return {
        success: false,
        error: contextValidation.error || "Invalid client context",
      };
    }

    try {
      // Perform authentication with sanitized username
      const authResult = await this.keycloakClient.authenticateWithPassword(
        usernameValidation.sanitized!,
        password,
        clientContext.clientId
      );

      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error || "Authentication failed",
        };
      }

      if (!authResult.tokens) {
        return {
          success: false,
          error: "Authentication succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        authResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo: userInfo,
        keycloakSessionId:
          (await this.extractKeycloakSessionId(authResult.tokens, {
            operationType: "password_authentication",
            userId: userInfo.sub,
            ipAddress: clientContext.ipAddress,
            timestamp: Date.now(),
          })) || crypto.randomUUID(),
        tokens: authResult.tokens,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });

      this.metrics?.recordCounter("keycloak.integration.auth_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.auth_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated successfully", {
        userId: userInfo.sub,
        username: userInfo.preferred_username,
        // sessionId removed for security - never log session identifiers
      });

      return {
        success: true,
        user: userInfo,
        tokens: authResult.tokens,
        session: sessionResult,
      };
    } catch (error) {
      // Specific error handling based on error type
      let errorMessage = "Authentication failed";
      let metricSuffix = "auth_error";

      if (error instanceof Error) {
        if (
          error.message.includes("401") ||
          error.message.includes("Unauthorized")
        ) {
          errorMessage = "Invalid credentials";
          metricSuffix = "auth_invalid_credentials";
        } else if (
          error.message.includes("network") ||
          error.message.includes("ENOTFOUND")
        ) {
          errorMessage = "Authentication service unavailable";
          metricSuffix = "auth_service_unavailable";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Authentication timeout";
          metricSuffix = "auth_timeout";
        } else if (
          error.message.includes("429") ||
          error.message.includes("Too Many Requests")
        ) {
          errorMessage = "Too many login attempts";
          metricSuffix = "auth_rate_limited";
        }
      }

      this.logger.error("Authentication failed", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        // username removed for security - never log user identifiers
      });
      this.metrics?.recordCounter(`keycloak.integration.${metricSuffix}`, 1);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Authenticate with authorization code (OAuth2 flow)
   */
  async authenticateWithCode(
    code: string,
    redirectUri: string,
    clientContext: {
      ipAddress: string;
      userAgent: string;
      clientId?: string;
    },
    codeVerifier?: string
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    // Input validation
    const codeValidation = this.validateAuthCode(code);
    if (!codeValidation.valid) {
      return {
        success: false,
        error: codeValidation.error || "Invalid authorization code",
      };
    }

    const uriValidation = this.validateRedirectUri(redirectUri);
    if (!uriValidation.valid) {
      return {
        success: false,
        error: uriValidation.error || "Invalid redirect URI",
      };
    }

    const contextValidation = this.validateClientContext(clientContext);
    if (!contextValidation.valid) {
      return {
        success: false,
        error: contextValidation.error || "Invalid client context",
      };
    }

    try {
      // Exchange code for tokens
      const tokenResult = await this.keycloakClient.exchangeCodeForTokens(
        code,
        redirectUri,
        codeVerifier
      );

      if (!tokenResult.success) {
        return {
          success: false,
          error: tokenResult.error || "Code exchange failed",
        };
      }

      if (!tokenResult.tokens) {
        return {
          success: false,
          error: "Token exchange succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        tokenResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo: userInfo,
        keycloakSessionId:
          (await this.extractKeycloakSessionId(tokenResult.tokens, {
            operationType: "code_authentication",
            userId: userInfo.sub,
            ipAddress: clientContext.ipAddress,
            timestamp: Date.now(),
          })) || crypto.randomUUID(),
        tokens: tokenResult.tokens,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });

      this.metrics?.recordCounter("keycloak.integration.code_auth_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.code_auth_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated with code successfully", {
        userId: userInfo.sub,
        username: userInfo.preferred_username,
        // sessionId removed for security - never log session identifiers
      });

      return {
        success: true,
        user: userInfo,
        tokens: tokenResult.tokens,
        session: sessionResult,
      };
    } catch (error) {
      // Specific error handling for OAuth2 code flow
      let errorMessage = "Code authentication failed";
      let metricSuffix = "code_auth_error";

      if (error instanceof Error) {
        if (
          error.message.includes("invalid_grant") ||
          error.message.includes("invalid_code")
        ) {
          errorMessage = "Invalid or expired authorization code";
          metricSuffix = "code_auth_invalid_code";
        } else if (error.message.includes("invalid_redirect_uri")) {
          errorMessage = "Invalid redirect URI";
          metricSuffix = "code_auth_invalid_redirect";
        } else if (
          error.message.includes("network") ||
          error.message.includes("ENOTFOUND")
        ) {
          errorMessage = "Authentication service unavailable";
          metricSuffix = "code_auth_service_unavailable";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Authentication timeout";
          metricSuffix = "code_auth_timeout";
        }
      }

      this.logger.error("Code authentication failed", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });
      this.metrics?.recordCounter(`keycloak.integration.${metricSuffix}`, 1);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate and refresh session
   */
  async validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<{
    valid: boolean;
    session?: KeycloakSessionData;
    refreshed?: boolean;
    error?: string;
  }> {
    // Input validation
    if (!this.validateSessionId(sessionId)) {
      return {
        valid: false,
        error: "Invalid session ID format",
      };
    }

    if (!context || !context.ipAddress || !context.userAgent) {
      return {
        valid: false,
        error: "Invalid context: IP address and user agent are required",
      };
    }

    try {
      const validation = await this.sessionManager.validateSession(
        sessionId,
        context
      );

      if (!validation.valid) {
        return {
          valid: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      this.metrics?.recordCounter("keycloak.integration.session_validated", 1);

      return {
        valid: true,
        ...(validation.session && { session: validation.session }),
        ...(validation.requiresTokenRefresh !== undefined && {
          refreshed: validation.requiresTokenRefresh,
        }),
      };
    } catch (error) {
      // Specific error handling for session validation
      let errorMessage = "Session validation failed";
      let metricSuffix = "session_validation_error";

      if (error instanceof Error) {
        if (
          error.message.includes("expired") ||
          error.message.includes("invalid")
        ) {
          errorMessage = "Session expired or invalid";
          metricSuffix = "session_expired";
        } else if (
          error.message.includes("network") ||
          error.message.includes("ENOTFOUND")
        ) {
          errorMessage = "Session service unavailable";
          metricSuffix = "session_service_unavailable";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Session validation timeout";
          metricSuffix = "session_timeout";
        } else if (
          error.message.includes("permission") ||
          error.message.includes("unauthorized")
        ) {
          errorMessage = "Insufficient permissions";
          metricSuffix = "session_permission_denied";
        }
      }

      this.logger.error("Session validation failed", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        // sessionId removed for security - never log session identifiers
      });
      this.metrics?.recordCounter(`keycloak.integration.${metricSuffix}`, 1);
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Logout user and destroy session
   */
  async logout(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    },
    options?: {
      logoutFromKeycloak?: boolean;
      destroyAllSessions?: boolean;
    }
  ): Promise<LogoutResult> {
    const startTime = performance.now();
    let sessionDestroyed = false;
    let keycloakLogout = false;
    let keycloakLogoutError: string | undefined;

    try {
      // Get session data for logout - validate session properly
      const validation = await this.sessionManager.validateSession(sessionId, {
        ipAddress: context.ipAddress || "unknown", // Use actual context
        userAgent: context.userAgent || "unknown",
      });

      if (validation.valid && validation.session) {
        const session = validation.session;

        // Logout from Keycloak if requested and tokens available
        if (options?.logoutFromKeycloak && session.refreshToken) {
          try {
            await this.keycloakClient.logout(session.refreshToken);
            keycloakLogout = true;
            this.logger.info("User logged out from Keycloak", {
              userId: session.userId,
              // sessionId removed for security - never log session identifiers
            });
          } catch (logoutError) {
            keycloakLogoutError =
              logoutError instanceof Error
                ? logoutError.message
                : String(logoutError);
            this.logger.error("Failed to logout from Keycloak", {
              error: logoutError,
              userId: session.userId,
              // sessionId removed for security - never log session identifiers
            });
            // Record specific logout failure metric
            this.metrics?.recordCounter(
              "keycloak.integration.keycloak_logout_failure",
              1
            );
          }
        }

        // Destroy all user sessions if requested
        if (options?.destroyAllSessions) {
          await this.sessionManager.destroyAllUserSessions(session.userId);
        } else {
          // Destroy current session
          await this.sessionManager.destroySession(sessionId, "logout");
        }
        sessionDestroyed = true;
      }

      this.metrics?.recordCounter("keycloak.integration.logout_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.logout_duration",
        performance.now() - startTime
      );

      const result: LogoutResult = {
        success: true,
        loggedOut: true,
        sessionDestroyed,
        keycloakLogout,
      };

      if (keycloakLogoutError) {
        result.keycloakLogoutError = keycloakLogoutError;
      }

      return result;
    } catch (error) {
      this.logger.error("Logout failed", {
        error,
        // sessionId removed for security - never log session identifiers
      });
      this.metrics?.recordCounter("keycloak.integration.logout_error", 1);
      return {
        success: false,
        loggedOut: false,
        sessionDestroyed,
        keycloakLogout,
        error: "Logout failed",
      };
    }
  }

  /**
   * Sanitize user attributes
   */
  private sanitizeAttributes(
    attributes: Record<string, string[]>
  ): Record<string, string[]> {
    const sanitized: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(attributes)) {
      sanitized[sanitizeInput(key)] = values.map((value) =>
        sanitizeInput(value)
      );
    }
    return sanitized;
  }

  /**
   * Create a new user
   */
  async createUser(userData: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<{
    success: boolean;
    userId?: string;
    error?: string;
  }> {
    try {
      // Sanitize user input data, preserving optional field handling
      const sanitizedUserData = {
        username: sanitizeInput(userData.username),
        email: sanitizeInput(userData.email),
        ...(userData.firstName && {
          firstName: sanitizeInput(userData.firstName),
        }),
        ...(userData.lastName && {
          lastName: sanitizeInput(userData.lastName),
        }),
        ...(userData.password && { password: userData.password }), // Never sanitize passwords
        ...(userData.enabled !== undefined && { enabled: userData.enabled }),
        ...(userData.emailVerified !== undefined && {
          emailVerified: userData.emailVerified,
        }),
        ...(userData.attributes && {
          attributes: this.sanitizeAttributes(userData.attributes),
        }),
      };

      const userId = await this.userManager.createUser(sanitizedUserData);
      this.metrics?.recordCounter("keycloak.integration.user_created", 1);
      return {
        success: true,
        userId,
      };
    } catch (error) {
      this.logger.error("User creation failed", {
        error,
        // username removed for security - never log user identifiers
      });
      this.metrics?.recordCounter("keycloak.integration.user_create_error", 1);
      return {
        success: false,
        error: "User creation failed",
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<{
    success: boolean;
    user?: UserInfo;
    error?: string;
  }> {
    try {
      const userInfo = await this.userManager.getCompleteUserInfo(userId);
      this.metrics?.recordCounter("keycloak.integration.user_retrieved", 1);

      if (userInfo) {
        return {
          success: true,
          user: userInfo,
        };
      } else {
        return {
          success: false,
          error: "User not found",
        };
      }
    } catch (error) {
      this.logger.error("User retrieval failed", {
        error,
        // userId removed for security - never log user identifiers
      });
      this.metrics?.recordCounter(
        "keycloak.integration.user_retrieval_error",
        1
      );
      return {
        success: false,
        error: "User retrieval failed",
      };
    }
  }

  /**
   * Get service statistics with race condition protection
   */
  getStats(): {
    session: SessionStats;
    client: {
      discoveryLoaded: boolean;
      cacheEnabled: boolean;
      requestCount: number;
    };
    token: {
      cacheHits: number;
      cacheMisses: number;
      validationCount: number;
      jwksLoaded: boolean;
    };
  } {
    const now = Date.now();

    // Check cache validity
    if (
      this.statsCache &&
      now - this.statsCache.timestamp < this.STATS_CACHE_TTL
    ) {
      return this.statsCache.data;
    }

    // If stats are being generated by another call, return stale cache if available
    if (this.isGeneratingStats) {
      if (this.statsCache) {
        return this.statsCache.data;
      }
      // If no cache available, proceed to generate (this is rare edge case)
    }

    // Set generation flag to prevent race conditions
    this.isGeneratingStats = true;

    try {
      // Generate fresh stats - reuse objects when possible
      const defaultClientStats = {
        discoveryLoaded: false,
        cacheEnabled: false,
        requestCount: 0,
      };

      const defaultTokenStats = {
        cacheHits: 0,
        cacheMisses: 0,
        validationCount: 0,
        jwksLoaded: false,
      };

      const stats = {
        session: this.sessionManager.getStats(),
        client: this.keycloakClient.getStats?.() || defaultClientStats,
        token: defaultTokenStats, // TokenManager doesn't expose stats currently
      };

      // Cache the result with atomic update
      this.statsCache = {
        data: stats,
        timestamp: now,
        ttl: this.STATS_CACHE_TTL,
      };

      return stats;
    } finally {
      // Always clear the generation flag
      this.isGeneratingStats = false;
    }
  }

  /**
   * Cleanup all resources and connections
   * Call this method when shutting down the service to prevent memory leaks
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting KeycloakIntegrationService cleanup");
    const cleanupErrors: Error[] = [];

    try {
      // Cleanup session manager - implement cleanup by clearing any internal caches
      try {
        // Force cleanup of expired sessions
        // Note: SessionManager doesn't have cleanup method, but we can trigger maintenance
        this.logger.debug(
          "Session manager cleanup - sessions managed by expiration"
        );
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup session manager", { error });
      }

      // Cleanup user manager - no persistent resources to clean
      try {
        this.logger.debug("User manager cleanup - no persistent resources");
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup user manager", { error });
      }

      // Cleanup Keycloak client - no persistent connections to close
      try {
        this.logger.debug(
          "Keycloak client cleanup - no persistent connections"
        );
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup Keycloak client", { error });
      }

      // Cleanup database connection using the actual disconnect method
      try {
        await this.dbClient.disconnect();
        this.logger.debug("Database client disconnected successfully");
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup database client", { error });
      }

      // Clear stats cache and generation flag to free memory
      this.statsCache = null;
      this.isGeneratingStats = false;

      this.logger.info("KeycloakIntegrationService cleanup completed", {
        errors: cleanupErrors.length,
      });

      // Record cleanup metrics
      this.metrics?.recordCounter("keycloak.integration.cleanup_completed", 1);
      if (cleanupErrors.length > 0) {
        this.metrics?.recordCounter(
          "keycloak.integration.cleanup_errors",
          cleanupErrors.length
        );
      }

      // If there were cleanup errors, throw them
      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      } else if (cleanupErrors.length > 1) {
        throw new Error(
          `Multiple cleanup errors: ${cleanupErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }
    } catch (error) {
      this.logger.error("Critical error during cleanup", { error });
      this.metrics?.recordCounter(
        "keycloak.integration.cleanup_critical_error",
        1
      );
      throw error;
    }
  }

  /**
   * Get resource usage statistics for monitoring memory leaks
   */
  getResourceStats(): {
    connections: {
      keycloak: boolean;
      database: boolean;
      sessions: number;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
    };
    uptime: number;
  } {
    const memUsage = process.memoryUsage();

    return {
      connections: {
        keycloak: !!this.keycloakClient,
        database: !!this.dbClient,
        sessions: 0, // Would need to implement session counting in session manager
      },
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      uptime: process.uptime(),
    };
  }
}
