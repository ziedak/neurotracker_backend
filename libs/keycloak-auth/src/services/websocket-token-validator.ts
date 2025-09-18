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

// Create logger with explicit type
const logger: any = createLogger("websocket-token-validator");

/**
 * WebSocket Token Validation Infrastructure
 * Handles authentication for Elysia WebSocket connections using Keycloak tokens
 */
export class WebSocketTokenValidator {
  constructor(
    private readonly tokenIntrospectionService: any, // Will be injected
    private readonly cacheService: any // Will use @libs/database cache
  ) {}

  /**
   * Extract token from WebSocket connection request
   * Supports multiple token sources: headers, query params, cookies
   */
  public extractToken(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): { token: string; method: WebSocketAuthMethod } | null {
    // 1. Check Authorization header (JWT Bearer token)
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token) {
        logger.debug("Token extracted from Authorization header");
        return { token, method: "jwt_token" };
      }
    }

    // 2. Check query parameters
    if (query["token"]) {
      logger.debug("Token extracted from query parameter");
      return { token: query["token"], method: "jwt_token" };
    }

    // 3. Check API key in headers
    const apiKey = headers["x-api-key"] || headers["X-API-Key"];
    if (apiKey) {
      logger.debug("API key extracted from headers");
      return { token: apiKey, method: "api_key" };
    }

    // 4. Check cookies if available
    if (cookies?.["access_token"]) {
      logger.debug("Token extracted from cookie");
      return { token: cookies["access_token"], method: "jwt_token" };
    }

    if (cookies?.["session_id"]) {
      logger.debug("Session ID extracted from cookie");
      return { token: cookies["session_id"], method: "session_based" };
    }

    logger.debug("No token found in request");
    return null;
  }

  /**
   * Validate token and create WebSocket authentication context
   */
  public async validateConnectionToken(
    token: string,
    method: WebSocketAuthMethod,
    connectionId: string
  ): Promise<WebSocketAuthContext> {
    const cacheKey = `ws:auth:${method}:${this.hashToken(token)}`;

    try {
      // Check cache first
      const cachedResult = await this.cacheService.get(cacheKey);
      if (
        cachedResult.data &&
        (cachedResult.data as TokenValidationResult).valid
      ) {
        logger.debug("Using cached token validation result", {
          connectionId,
          method,
        });
        return this.createAuthContext(
          cachedResult.data as TokenValidationResult,
          method,
          connectionId
        );
      }

      // Validate token with Keycloak
      logger.debug("Validating token with Keycloak", { connectionId, method });
      let validationResult: TokenValidationResult;

      if (method === "jwt_token") {
        validationResult = await this.tokenIntrospectionService.validateJWT(
          token
        );
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

      // Cache the result
      if (validationResult.valid && validationResult.claims) {
        const ttl = this.calculateCacheTtl(validationResult.claims);
        await this.cacheService.set(cacheKey, validationResult, ttl);
      }

      if (!validationResult.valid) {
        throw new WebSocketAuthError("Token validation failed", {
          method,
          error: validationResult.error,
        });
      }

      return this.createAuthContext(validationResult, method, connectionId);
    } catch (error) {
      logger.error("WebSocket token validation failed", {
        connectionId,
        method,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
   * Validate API key (placeholder - implement based on your API key strategy)
   */
  private async validateApiKey(apiKey: string): Promise<TokenValidationResult> {
    // Example: check against a list of valid API keys (replace with real logic)
    const validApiKeys = (process.env["VALID_API_KEYS"] || "").split(",");
    const isValid = validApiKeys.includes(apiKey);
    return {
      valid: isValid,
      error: isValid ? "" : "Invalid API key",
      cached: false,
    };
  }

  /**
   * Validate session (placeholder - implement based on your session strategy)
   */
  private async validateSession(
    sessionId: string
  ): Promise<TokenValidationResult> {
    // Example: check session validity (replace with real logic)
    // For demonstration, treat any non-empty sessionId as valid
    const isValid = typeof sessionId === "string" && sessionId.length > 0;
    return {
      valid: isValid,
      error: isValid ? "" : "Invalid session ID",
      cached: false,
    };
  }

  /**
   * Calculate cache TTL based on token expiration
   */
  private calculateCacheTtl(claims: TokenClaims): number {
    if (claims.exp) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = claims.exp - now - 60; // Cache until 1 minute before expiration
      return Math.max(ttl, 300); // Minimum 5 minutes
    }
    return 3600; // Default 1 hour
  }

  /**
   * Create a hash of the token for cache key (for security)
   */
  private hashToken(token: string): string {
    // Use a simple hash function - in production, consider using a proper hash function
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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
      if (exp - now < 300) {
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
        return false;
      }
    }

    return true;
  }

  /**
   * Clean up expired authentication contexts from cache
   */
  public async cleanupExpiredAuth(): Promise<void> {
    const pattern = "ws:auth:*";
    try {
      const invalidated = await this.cacheService.invalidatePattern(pattern);
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
  tokenIntrospectionService: any,
  cacheService: any
): WebSocketTokenValidator => {
  return new WebSocketTokenValidator(tokenIntrospectionService, cacheService);
};
