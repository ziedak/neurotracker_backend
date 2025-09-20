import {
  ElysiaWebSocket,
  WebSocketAuthContext,
  WebSocketAuthMethod,
  WebSocketConnectionData,
  TokenValidationResult,
  WebSocketAuthError,
  TokenClaims,
} from "../types/index";
import { createLogger } from "@libs/utils";
import { executeWithRetry } from "@libs/utils/src/executeWithRetry";

// Import decomposed services
import { TokenServiceCollection } from "./decomposed/index";

// Import the actual enum, not the type
import { MetricsOperation } from "./decomposed/token-metrics.service";

// Import constants
import {
  TIME_CONSTANTS,
  SIZE_CONSTANTS,
  CIRCUIT_BREAKER_CONSTANTS,
  RETRY_CONSTANTS,
  PERFORMANCE_THRESHOLDS,
  CACHE_CONSTANTS,
  VALIDATION_PATTERNS,
  ENV_VARS,
  DEFAULTS,
} from "./websocket-token-validator.constants";

// Create logger with proper typing
const logger = createLogger("websocket-token-validator");

/**
 * WebSocket Token Validation Infrastructure
 * Handles authentication for Elysia WebSocket connections using Keycloak tokens
 */
export class WebSocketTokenValidator {
  constructor(private readonly services: TokenServiceCollection) {
    // Validate configuration at startup
    this.validateConfiguration();

    // Using executeWithRetry utility for circuit breaker and retry logic
  }

  /**
   * Validate configuration at startup
   */
  private validateConfiguration(): void {
    const requiredEnvVars = [
      ENV_VARS.KEYCLOAK_REALM,
      ENV_VARS.KEYCLOAK_WEBSOCKET_CLIENT_ID,
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    // Validate realm format
    const realm = process.env[ENV_VARS.KEYCLOAK_REALM];
    if (realm && !VALIDATION_PATTERNS.SESSION_ID_REGEX.test(realm)) {
      throw new Error(`Invalid realm format: ${realm}`);
    }

    // Validate client ID format
    const clientId = process.env[ENV_VARS.KEYCLOAK_WEBSOCKET_CLIENT_ID];
    if (clientId && !VALIDATION_PATTERNS.SESSION_ID_REGEX.test(clientId)) {
      throw new Error(`Invalid client ID format: ${clientId}`);
    }

    logger.info("WebSocket token validator configuration validated", {
      realm,
      clientId,
      hasApiKeys: !!process.env[ENV_VARS.VALID_API_KEYS],
    });
  }
  /**
   * Extract token from WebSocket connection request
   * Supports multiple token sources: headers, query params, cookies
   */
  public extractToken(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): { token: string; method: WebSocketAuthMethod } | null {
    const result = this.services.tokenExtractor.extractToken(
      headers,
      query,
      cookies
    );
    return result ? { token: result.token, method: result.method } : null;
  }

  /**
   * Validate token and create WebSocket authentication context
   */
  public async validateConnectionToken(
    token: string,
    method: WebSocketAuthMethod,
    connectionId: string
  ): Promise<WebSocketAuthContext> {
    const startTime = Date.now();

    try {
      // Record WebSocket connection attempt
      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_CONNECTION
      );
      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_AUTH_VALIDATION
      );

      const cacheKey = `ws:auth:${method}:${this.hashTokenSecurely(token)}`;

      // Check cache first using decomposed cache service
      const cached = await this.services.cache.get<TokenValidationResult>(
        cacheKey
      );
      if (cached.hit && cached.data && cached.data.valid) {
        logger.debug("Using cached token validation result", {
          connectionId,
          method,
        });
        // Record cache hit metric
        this.services.metrics.recordOperation(MetricsOperation.CACHE_HIT);
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_CONNECTION_SUCCESS
        );
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_AUTH_SUCCESS
        );

        const authContext = this.createAuthContext(
          cached.data,
          method,
          connectionId
        );
        this.logWebSocketMetrics(
          "cache_hit",
          method,
          Date.now() - startTime,
          true
        );
        return authContext;
      }

      // Record cache miss metric
      this.services.metrics.recordOperation(MetricsOperation.CACHE_MISS);

      // Validate token using orchestrator for JWT tokens
      logger.debug("Validating token with orchestrator", {
        connectionId,
        method,
      });
      let validationResult: TokenValidationResult;

      if (method === "jwt_token") {
        // Use the orchestrator for JWT validation with retry and circuit breaker protection
        validationResult = await executeWithRetry(
          () => this.services.orchestrator.validateJWT(token),
          (error: unknown, attempt?: number) => {
            logger.warn(`JWT validation retry attempt ${attempt}`, {
              error: error instanceof Error ? error.message : String(error),
              connectionId,
            });
          },
          {
            operationName: "websocket-jwt-validation",
            maxRetries: RETRY_CONSTANTS.MAX_RETRIES,
            retryDelay: RETRY_CONSTANTS.RETRY_DELAY_MS,
            enableCircuitBreaker: true,
            circuitBreakerThreshold:
              CIRCUIT_BREAKER_CONSTANTS.FAILURE_THRESHOLD,
            circuitBreakerTimeout:
              CIRCUIT_BREAKER_CONSTANTS.RECOVERY_TIMEOUT_MS,
          }
        );
        this.services.metrics.recordOperation(MetricsOperation.JWT_VALIDATION);
      } else if (method === "api_key") {
        // For API keys, we might need a different validation approach
        validationResult = await this.validateApiKey(token);
      } else if (method === "session_based") {
        validationResult = await this.validateSession(token);
      } else {
        throw new WebSocketAuthError(
          `Unsupported authentication method: ${method}`
        );
      }

      // Cache the result using decomposed cache service
      if (validationResult.valid && validationResult.claims) {
        const ttl = this.calculateCacheTtl(validationResult.claims);
        await this.services.cache.set(cacheKey, validationResult, ttl);
      }

      if (!validationResult.valid) {
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_CONNECTION_FAILURE
        );
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_AUTH_FAILURE
        );
        throw new WebSocketAuthError("Token validation failed", {
          method,
          error: validationResult.error,
        });
      }

      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_CONNECTION_SUCCESS
      );
      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_AUTH_SUCCESS
      );

      const authContext = this.createAuthContext(
        validationResult,
        method,
        connectionId
      );
      this.logWebSocketMetrics(
        "validation_success",
        method,
        Date.now() - startTime,
        true
      );
      return authContext;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_CONNECTION_FAILURE
      );
      this.services.metrics.recordOperation(
        MetricsOperation.WEBSOCKET_AUTH_FAILURE
      );

      this.logWebSocketMetrics("validation_failure", method, duration, false);

      logger.error("WebSocket token validation failed", {
        connectionId,
        method,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Log WebSocket-specific metrics for monitoring
   */
  private logWebSocketMetrics(
    operation: string,
    method: WebSocketAuthMethod,
    duration: number,
    success: boolean
  ): void {
    logger.info("WebSocket authentication metrics", {
      operation,
      method,
      duration: `${duration}ms`,
      success,
      timestamp: new Date().toISOString(),
    });

    // Additional structured logging for monitoring systems
    if (success) {
      logger.debug("WebSocket auth operation successful", {
        operation,
        method,
        duration,
        performance:
          duration < PERFORMANCE_THRESHOLDS.FAST_OPERATION_MS
            ? "fast"
            : duration < PERFORMANCE_THRESHOLDS.NORMAL_OPERATION_MS
            ? "normal"
            : "slow",
      });
    } else {
      logger.warn("WebSocket auth operation failed", {
        operation,
        method,
        duration,
        needsInvestigation: duration > PERFORMANCE_THRESHOLDS.SLOW_OPERATION_MS, // Flag slow failures for investigation
      });
    }
  }

  /**
   * Create authentication context from validation result
   */
  private createAuthContext(
    validationResult: TokenValidationResult,
    method: WebSocketAuthMethod,
    connectionId: string
  ): WebSocketAuthContext {
    const claims = validationResult.claims!;

    return {
      method,
      claims,
      sessionId: claims.session_state || "",
      clientId: claims.azp || "unknown",
      userId: claims.sub,
      scopes: this.extractScopes(claims),
      permissions: this.extractPermissions(claims),
      connectionId,
      connectedAt: new Date(),
      lastValidated: new Date(),
    };
  }

  /**
   * Extract scopes from token claims
   */
  private extractScopes(claims: TokenClaims): string[] {
    if (claims.scope) {
      return claims.scope.split(" ").filter((s) => s.length > 0);
    }
    return ["openid"]; // Default scope
  }

  /**
   * Extract permissions from token claims (from roles)
   */
  private extractPermissions(claims: TokenClaims): string[] {
    const permissions: string[] = [];

    // Extract realm roles
    if (claims.realm_access?.roles) {
      permissions.push(
        ...claims.realm_access.roles.map((role) => `realm:${role}`)
      );
    }

    // Extract client roles
    if (claims.resource_access) {
      Object.entries(claims.resource_access).forEach(
        ([clientId, clientAccess]) => {
          if (clientAccess.roles) {
            permissions.push(
              ...clientAccess.roles.map((role) => `${clientId}:${role}`)
            );
          }
        }
      );
    }

    return permissions;
  }

  /**
   * Validate API key using decomposed services
   */
  private async validateApiKey(apiKey: string): Promise<TokenValidationResult> {
    const startTime = Date.now();

    try {
      // Record API key validation attempt
      this.services.metrics.recordOperation(MetricsOperation.JWT_VALIDATION);

      // Check cache first for API key validation
      const cacheKey = `api_key:${this.hashTokenSecurely(apiKey)}`;
      const cached = await this.services.cache.get<TokenValidationResult>(
        cacheKey
      );

      if (cached.hit && cached.data) {
        logger.debug("Using cached API key validation result");
        return cached.data;
      }

      // For API keys, we can use token introspection if configured
      // Otherwise, fall back to environment-based validation
      let validationResult: TokenValidationResult;

      if (await this.isIntrospectionAvailable()) {
        // Use token introspection for API key validation
        validationResult = await this.validateApiKeyViaIntrospection(apiKey);
      } else {
        // Fallback to environment-based validation
        validationResult = await this.validateApiKeyViaEnvironment(apiKey);
      }

      // Cache the result if valid
      if (validationResult.valid) {
        const ttl = TIME_CONSTANTS.CACHE_API_KEY_TTL_SECONDS; // Cache API key validation for 1 hour
        await this.services.cache.set(cacheKey, validationResult, ttl);
      }

      const duration = Date.now() - startTime;
      logger.info("API key validation completed", {
        valid: validationResult.valid,
        duration: `${duration}ms`,
        method: validationResult.cached ? "cached" : "fresh",
      });

      return validationResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("API key validation failed", {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        error:
          error instanceof Error ? error.message : "API key validation failed",
        cached: false,
      };
    }
  }

  /**
   * Check if token introspection is available
   */
  private async isIntrospectionAvailable(): Promise<boolean> {
    try {
      // Check if introspection endpoint is available for the default realm
      return await executeWithRetry(
        () =>
          this.services.client.isIntrospectionAvailable(
            process.env[ENV_VARS.KEYCLOAK_REALM] || DEFAULTS.REALM
          ),
        (error: unknown, attempt?: number) => {
          logger.debug(
            `Introspection availability check failed (attempt ${attempt})`,
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        },
        {
          operationName: "introspection-availability-check",
          maxRetries: RETRY_CONSTANTS.AVAILABILITY_CHECK_MAX_RETRIES,
          retryDelay: RETRY_CONSTANTS.RETRY_DELAY_MS,
          enableCircuitBreaker: false, // Don't use circuit breaker for availability checks
        }
      );
    } catch (error) {
      logger.debug("Introspection availability check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Validate API key using token introspection
   */
  private async validateApiKeyViaIntrospection(
    apiKey: string
  ): Promise<TokenValidationResult> {
    try {
      const realm = process.env[ENV_VARS.KEYCLOAK_REALM] || DEFAULTS.REALM;
      const clientId =
        process.env[ENV_VARS.KEYCLOAK_WEBSOCKET_CLIENT_ID] ||
        DEFAULTS.CLIENT_ID;

      // Create introspection request manually since the method doesn't exist on the interface
      const request = {
        token: apiKey,
        clientId,
        realm,
      };

      const result = await executeWithRetry(
        () => this.services.client.introspect(request),
        (error: unknown, attempt?: number) => {
          logger.warn(`API key introspection failed (attempt ${attempt})`, {
            error: error instanceof Error ? error.message : String(error),
          });
        },
        {
          operationName: "api-key-introspection",
          maxRetries: RETRY_CONSTANTS.MAX_RETRIES,
          retryDelay: RETRY_CONSTANTS.RETRY_DELAY_MS,
          enableCircuitBreaker: true,
          circuitBreakerThreshold: RETRY_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD,
          circuitBreakerTimeout: RETRY_CONSTANTS.CIRCUIT_BREAKER_TIMEOUT_MS,
        }
      );

      if (result.response.active) {
        // Create claims from introspection response
        const response = result.response;
        const claims: TokenClaims = {
          sub: response.sub || "",
          iss: response.iss || "",
          aud: response.aud || "",
          exp: response.exp || 0,
          iat: response.iat || 0,
          azp: response.client_id || clientId,
          scope: response.scope || "openid",
        };

        // Add optional properties if they exist
        if (response["realm_access"]) {
          claims.realm_access = response["realm_access"] as { roles: string[] };
        }
        if (response["resource_access"]) {
          claims.resource_access = response["resource_access"] as {
            [clientId: string]: { roles: string[] };
          };
        }

        return {
          valid: true,
          claims,
          cached: false,
        };
      }

      return {
        valid: false,
        error: "API key is not active",
        cached: false,
      };
    } catch (error) {
      logger.warn("API key introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fall back to environment validation
      return this.validateApiKeyViaEnvironment(apiKey);
    }
  }

  /**
   * Validate API key using environment configuration
   */
  private async validateApiKeyViaEnvironment(
    apiKey: string
  ): Promise<TokenValidationResult> {
    const validApiKeys = (process.env["VALID_API_KEYS"] || "")
      .split(",")
      .filter((key) => key.trim());
    const isValid = validApiKeys.includes(apiKey);

    if (isValid) {
      // Create basic claims for valid API key
      const claims: TokenClaims = {
        sub: `api-key-${this.hashTokenSecurely(apiKey).substring(0, 8)}`,
        iss: "websocket-validator",
        aud: "websocket",
        exp:
          Math.floor(Date.now() / 1000) +
          TIME_CONSTANTS.CACHE_DEFAULT_TTL_SECONDS, // 1 hour
        iat: Math.floor(Date.now() / 1000),
        azp: "websocket-client",
        scope: DEFAULTS.SCOPE,
      };

      return {
        valid: true,
        claims,
        cached: false,
      };
    }

    return {
      valid: false,
      error: "Invalid API key",
      cached: false,
    };
  }

  /**
   * Validate session using decomposed services
   */
  private async validateSession(
    sessionId: string
  ): Promise<TokenValidationResult> {
    const startTime = Date.now();

    try {
      // Record session validation attempt
      this.services.metrics.recordOperation(MetricsOperation.JWT_VALIDATION);

      // Check cache first for session validation
      const cacheKey = `session:${this.hashTokenSecurely(sessionId)}`;
      const cached = await this.services.cache.get<TokenValidationResult>(
        cacheKey
      );

      if (cached.hit && cached.data) {
        logger.debug("Using cached session validation result");
        return cached.data;
      }

      // For sessions, we can validate against a session store or use introspection
      let validationResult: TokenValidationResult;

      if (await this.isIntrospectionAvailable()) {
        // Try to validate session via introspection if it's a JWT-like session token
        validationResult = await this.validateSessionViaIntrospection(
          sessionId
        );
      } else {
        // Fallback to basic session validation
        validationResult = await this.validateSessionViaBasic(sessionId);
      }

      // Cache the result if valid
      if (validationResult.valid) {
        const ttl = TIME_CONSTANTS.CACHE_SESSION_TTL_SECONDS; // Cache session validation for 30 minutes
        await this.services.cache.set(cacheKey, validationResult, ttl);
      }

      const duration = Date.now() - startTime;
      logger.info("Session validation completed", {
        valid: validationResult.valid,
        duration: `${duration}ms`,
        method: validationResult.cached ? "cached" : "fresh",
      });

      return validationResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Session validation failed", {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        error:
          error instanceof Error ? error.message : "Session validation failed",
        cached: false,
      };
    }
  }

  /**
   * Validate session using token introspection
   */
  private async validateSessionViaIntrospection(
    sessionId: string
  ): Promise<TokenValidationResult> {
    try {
      const realm = process.env[ENV_VARS.KEYCLOAK_REALM] || DEFAULTS.REALM;
      const clientId =
        process.env[ENV_VARS.KEYCLOAK_WEBSOCKET_CLIENT_ID] ||
        DEFAULTS.CLIENT_ID;

      // Create introspection request for session token
      const request = {
        token: sessionId,
        clientId,
        realm,
      };

      const result = await executeWithRetry(
        () => this.services.client.introspect(request),
        (error: unknown, attempt?: number) => {
          logger.warn(`Session introspection failed (attempt ${attempt})`, {
            error: error instanceof Error ? error.message : String(error),
          });
        },
        {
          operationName: "session-introspection",
          maxRetries: RETRY_CONSTANTS.MAX_RETRIES,
          retryDelay: RETRY_CONSTANTS.RETRY_DELAY_MS,
          enableCircuitBreaker: true,
          circuitBreakerThreshold: RETRY_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD,
          circuitBreakerTimeout: RETRY_CONSTANTS.CIRCUIT_BREAKER_TIMEOUT_MS,
        }
      );

      if (result.response.active) {
        // Create claims from introspection response
        const response = result.response;
        const claims: TokenClaims = {
          sub: response.sub || "",
          iss: response.iss || "",
          aud: response.aud || "",
          exp: response.exp || 0,
          iat: response.iat || 0,
          azp: response.client_id || clientId,
          scope: response.scope || "openid",
          session_state: (response["session_state"] as string) || sessionId,
        };

        // Add optional properties if they exist
        if (response["realm_access"]) {
          claims.realm_access = response["realm_access"] as { roles: string[] };
        }
        if (response["resource_access"]) {
          claims.resource_access = response["resource_access"] as {
            [clientId: string]: { roles: string[] };
          };
        }

        return {
          valid: true,
          claims,
          cached: false,
        };
      }

      return {
        valid: false,
        error: "Session is not active",
        cached: false,
      };
    } catch (error) {
      logger.warn("Session introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fall back to basic validation
      return this.validateSessionViaBasic(sessionId);
    }
  }

  /**
   * Validate session using basic validation
   */
  private async validateSessionViaBasic(
    sessionId: string
  ): Promise<TokenValidationResult> {
    // Basic validation: check if session ID is non-empty and has valid format
    const isValid =
      typeof sessionId === "string" &&
      sessionId.length > 0 &&
      sessionId.length <= SIZE_CONSTANTS.MAX_SESSION_ID_LENGTH && // Reasonable length limit
      VALIDATION_PATTERNS.SESSION_ID_REGEX.test(sessionId); // Alphanumeric with dashes/underscores

    if (isValid) {
      // Create basic claims for valid session
      const claims: TokenClaims = {
        sub: `session-${this.hashTokenSecurely(sessionId).substring(0, 8)}`,
        iss: "websocket-validator",
        aud: "websocket",
        exp:
          Math.floor(Date.now() / 1000) +
          TIME_CONSTANTS.CACHE_DEFAULT_TTL_SECONDS, // 1 hour
        iat: Math.floor(Date.now() / 1000),
        azp: "websocket-client",
        scope: DEFAULTS.SCOPE,
        session_state: sessionId,
      };

      return {
        valid: true,
        claims,
        cached: false,
      };
    }

    return {
      valid: false,
      error: "Invalid session ID format",
      cached: false,
    };
  }

  private calculateCacheTtl(claims: TokenClaims): number {
    if (claims.exp) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = claims.exp - now - CACHE_CONSTANTS.CACHE_TTL_BUFFER_SECONDS; // Cache until 1 minute before expiration
      return Math.max(ttl, TIME_CONSTANTS.CACHE_MINIMUM_TTL_SECONDS); // Minimum 5 minutes
    }
    return TIME_CONSTANTS.CACHE_DEFAULT_TTL_SECONDS; // Default 1 hour
  }

  /**
   * Create a cryptographically secure hash of the token for cache key
   */
  private hashTokenSecurely(token: string): string {
    // Use SHA-256 for secure hashing
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Refresh authentication context for long-lived connections
   */
  public async refreshAuthContext(
    ws: ElysiaWebSocket<WebSocketConnectionData>
  ): Promise<WebSocketAuthContext> {
    const currentAuth = ws.data.auth;
    const connectionId = currentAuth.connectionId;

    logger.debug("Refreshing WebSocket auth context", { connectionId });

    // For JWT tokens, we might need to re-validate
    if (currentAuth.method === "jwt_token" && currentAuth.claims) {
      const now = Math.floor(Date.now() / 1000);
      const exp = currentAuth.claims.exp || 0;

      // If token is close to expiration, we might want to disconnect or prompt refresh
      if (exp - now < TIME_CONSTANTS.TOKEN_EXPIRATION_WARNING_MINUTES * 60) {
        // Less than 5 minutes remaining
        logger.warn("WebSocket token close to expiration", {
          connectionId,
          expiresIn: exp - now,
        });

        // Option 1: Disconnect the client
        // ws.close(1000, 'Token expired');
        // throw new WebSocketAuthError('Token expired');

        // Option 2: Allow continued connection but mark as expired
        return {
          ...currentAuth,
          lastValidated: new Date(),
        };
      }
    }

    // Update last validated time
    return {
      ...currentAuth,
      lastValidated: new Date(),
    };
  }

  /**
   * Check if a WebSocket connection has required permissions for an action
   */
  public hasPermission(
    authContext: WebSocketAuthContext,
    requiredScopes?: string[],
    requiredPermissions?: string[]
  ): boolean {
    // Record permission check
    this.services.metrics.recordOperation(
      MetricsOperation.WEBSOCKET_PERMISSION_CHECK
    );

    // Check scopes
    if (requiredScopes && requiredScopes.length > 0) {
      const hasRequiredScope = requiredScopes.every((scope) =>
        authContext.scopes.includes(scope)
      );
      if (!hasRequiredScope) {
        logger.debug("WebSocket connection missing required scopes", {
          connectionId: authContext.connectionId,
          requiredScopes,
          userScopes: authContext.scopes,
        });
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_PERMISSION_DENIED
        );
        return false;
      }
    }

    // Check permissions
    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasRequiredPermission = requiredPermissions.every((permission) =>
        authContext.permissions.includes(permission)
      );
      if (!hasRequiredPermission) {
        logger.debug("WebSocket connection missing required permissions", {
          connectionId: authContext.connectionId,
          requiredPermissions,
          userPermissions: authContext.permissions,
        });
        this.services.metrics.recordOperation(
          MetricsOperation.WEBSOCKET_PERMISSION_DENIED
        );
        return false;
      }
    }

    this.services.metrics.recordOperation(
      MetricsOperation.WEBSOCKET_PERMISSION_GRANTED
    );
    return true;
  }

  /**
   * Clean up expired authentication contexts from cache
   */
  public async cleanupExpiredAuth(): Promise<void> {
    const pattern = "ws:auth:*";

    // Record cleanup operation
    this.services.metrics.recordOperation(MetricsOperation.WEBSOCKET_CLEANUP);

    try {
      const invalidated = await executeWithRetry(
        () => this.services.cache.invalidatePattern(pattern),
        (error: unknown, attempt?: number) => {
          logger.warn(`Cache invalidation failed (attempt ${attempt})`, {
            pattern,
            error: error instanceof Error ? error.message : String(error),
          });
        },
        {
          operationName: "websocket-cache-cleanup",
          maxRetries: RETRY_CONSTANTS.CACHE_CLEANUP_MAX_RETRIES,
          retryDelay: RETRY_CONSTANTS.RETRY_DELAY_MS,
          enableCircuitBreaker: false, // Don't use circuit breaker for cleanup
        }
      );
      logger.info("Cleaned up expired WebSocket auth contexts", {
        invalidated,
      });
    } catch (error) {
      logger.error("Failed to cleanup expired auth contexts", { error });
      // Fallback: report to monitoring, optionally retry or escalate
      // Fallback: log error for monitoring/reporting
      logger.error("Cache invalidation failure fallback", {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Factory function to create WebSocket token validator
 */
export const createWebSocketTokenValidator = (
  services: TokenServiceCollection
): WebSocketTokenValidator => {
  return new WebSocketTokenValidator(services);
};
