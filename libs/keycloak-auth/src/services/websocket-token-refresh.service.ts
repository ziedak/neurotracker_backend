/**
 * WebSocket Token Refresh Service
 * Handles token refresh for long-lived WebSocket connections with graceful session management
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
  TokenResponse,
  AuthContext,
  WebSocketAuthContext,
  WebSocketConnectionData,
} from "../types/index.js";
import {
  AuthErrors,
  failure,
  success,
  type Result,
  type AuthError,
} from "../utils/result.js";

const logger = createLogger("websocket-token-refresh-service");

/**
 * Token refresh configuration for WebSocket connections
 */
export interface WebSocketTokenRefreshConfig {
  /** Time before token expiry to trigger refresh (in seconds) */
  refreshThreshold: number;
  /** Maximum retry attempts for token refresh */
  maxRetryAttempts: number;
  /** Delay between retry attempts (in milliseconds) */
  retryDelay: number;
  /** Whether to enable automatic token refresh */
  enableAutoRefresh: boolean;
  /** Interval for checking token expiry (in milliseconds) */
  checkInterval: number;
  /** Grace period to keep connection alive during refresh (in milliseconds) */
  refreshGracePeriod: number;
}

/**
 * Token refresh result for WebSocket connections
 */
export interface WebSocketTokenRefreshResult {
  success: boolean;
  connectionId: string;
  oldToken?: string | undefined;
  newToken?: string | undefined;
  newAuthContext?: AuthContext | undefined;
  error?: string | undefined;
  retryAfter?: number | undefined;
  action:
    | "refresh_success"
    | "refresh_failed"
    | "connection_upgrade"
    | "connection_downgrade";
}

/**
 * WebSocket session state during token operations
 */
export interface WebSocketSessionState {
  connectionId: string;
  userId: string;
  currentToken?: string | undefined;
  refreshToken?: string | undefined;
  tokenExpiry?: Date | undefined;
  lastRefreshAttempt?: Date | undefined;
  refreshAttempts: number;
  isRefreshing: boolean;
  sessionValid: boolean;
  gracePeriodExpiry?: Date | undefined;
}

/**
 * WebSocket Token Refresh Service
 * Manages token lifecycle for long-lived WebSocket connections
 */
export class WebSocketTokenRefreshService {
  private readonly refreshSessions = new Map<string, WebSocketSessionState>();
  private refreshTimer?: NodeJS.Timeout | undefined;
  private readonly config: WebSocketTokenRefreshConfig;

  constructor(
    private readonly keycloakClientFactory: IKeycloakClientFactory,
    private readonly tokenIntrospectionService: ITokenIntrospectionService,
    private readonly metrics: IMetricsCollector,
    config: Partial<WebSocketTokenRefreshConfig> = {}
  ) {
    this.config = {
      refreshThreshold: 300, // 5 minutes
      maxRetryAttempts: 3,
      retryDelay: 5000, // 5 seconds
      enableAutoRefresh: true,
      checkInterval: 60000, // 1 minute
      refreshGracePeriod: 30000, // 30 seconds
      ...config,
    };

    if (this.config.enableAutoRefresh) {
      this.startAutoRefreshMonitor();
    }

    logger.info("WebSocket token refresh service initialized", {
      refreshThreshold: this.config.refreshThreshold,
      autoRefresh: this.config.enableAutoRefresh,
      checkInterval: this.config.checkInterval,
    });
  }

  /**
   * Register a WebSocket connection for token refresh monitoring
   */
  public registerConnection(
    connectionId: string,
    connectionData: WebSocketConnectionData
  ): Result<void, AuthError> {
    try {
      const tokenExpiry = this.extractTokenExpiry(connectionData.auth);

      const sessionState: WebSocketSessionState = {
        connectionId,
        userId: connectionData.auth.userId || "anonymous",
        currentToken: connectionData.auth.token,
        refreshToken: connectionData.auth.refreshToken,
        tokenExpiry,
        refreshAttempts: 0,
        isRefreshing: false,
        sessionValid: true,
      };

      this.refreshSessions.set(connectionId, sessionState);

      logger.debug("WebSocket connection registered for token refresh", {
        connectionId,
        userId: sessionState.userId,
        tokenExpiry: tokenExpiry?.toISOString(),
      });

      this.metrics.recordCounter("websocket_token_refresh_registrations", 1);

      return success(undefined);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to register connection for token refresh", {
        connectionId,
        error: errorMessage,
      });

      return failure(AuthErrors.systemError(errorMessage));
    }
  }

  /**
   * Unregister a WebSocket connection from token refresh monitoring
   */
  public unregisterConnection(connectionId: string): void {
    const sessionState = this.refreshSessions.get(connectionId);
    if (sessionState) {
      this.refreshSessions.delete(connectionId);

      logger.debug("WebSocket connection unregistered from token refresh", {
        connectionId,
        userId: sessionState.userId,
      });

      this.metrics.recordCounter("websocket_token_refresh_unregistrations", 1);
    }
  }

  /**
   * Check if a connection needs token refresh
   */
  public needsTokenRefresh(connectionId: string): boolean {
    const sessionState = this.refreshSessions.get(connectionId);
    if (!sessionState || !sessionState.tokenExpiry) {
      return false;
    }

    const now = new Date();
    const refreshThresholdMs = this.config.refreshThreshold * 1000;
    const refreshTime = new Date(
      sessionState.tokenExpiry.getTime() - refreshThresholdMs
    );

    return now >= refreshTime && !sessionState.isRefreshing;
  }

  /**
   * Perform token refresh for a WebSocket connection
   */
  public async refreshConnectionToken(
    connectionId: string
  ): Promise<Result<WebSocketTokenRefreshResult, AuthError>> {
    const sessionState = this.refreshSessions.get(connectionId);
    if (!sessionState) {
      return failure(
        AuthErrors.validationError(
          "Connection not registered for token refresh"
        )
      );
    }
    try {
      if (sessionState.isRefreshing) {
        return failure(
          AuthErrors.validationError("Token refresh already in progress")
        );
      }
      // Mark as refreshing
      sessionState.isRefreshing = true;
      sessionState.lastRefreshAttempt = new Date();
      sessionState.refreshAttempts++;
      // Set grace period
      sessionState.gracePeriodExpiry = new Date(
        Date.now() + this.config.refreshGracePeriod
      );
      // Try to refresh the token
      const refreshResult = await this.performTokenRefresh(sessionState);
      if (refreshResult.success) {
        const { newToken, newAuthContext } = refreshResult.data;
        sessionState.currentToken = newToken.access_token;
        sessionState.refreshToken = newToken.refresh_token;
        sessionState.tokenExpiry = new Date(
          Date.now() + newToken.expires_in * 1000
        );
        sessionState.refreshAttempts = 0;
        sessionState.isRefreshing = false;
        sessionState.gracePeriodExpiry = undefined;
        const result: WebSocketTokenRefreshResult = {
          success: true,
          connectionId,
          oldToken: sessionState.currentToken,
          newToken: newToken.access_token,
          newAuthContext,
          action: "refresh_success",
        };
        this.metrics.recordCounter("websocket_token_refresh_success", 1, {
          userId: sessionState.userId,
        });
        logger.info("Token refresh successful for WebSocket connection", {
          connectionId,
          userId: sessionState.userId,
          newExpiry: sessionState.tokenExpiry.toISOString(),
        });
        return success(result);
      } else {
        sessionState.isRefreshing = false;
        let errorCode = "TOKEN_ERROR";
        let errorMessage = "Token refresh failed";
        let statusCode = 401;
        if (
          refreshResult.error &&
          typeof refreshResult.error.message === "string"
        ) {
          errorMessage = refreshResult.error.message;
          if (errorMessage === "Session invalidated") {
            errorCode = "SESSION_INVALID";
            statusCode = 440;
            sessionState.sessionValid = false;
          } else if (errorMessage === "Token expired") {
            errorCode = "TOKEN_ERROR";
            statusCode = 401;
          } else if (errorMessage === "Token invalid") {
            errorCode = "VALIDATION_ERROR";
            statusCode = 400;
          }
        }

        this.metrics.recordCounter("websocket_token_refresh_failure", 1, {
          userId: sessionState.userId,
          error: errorCode,
        });
        logger.warn("Token refresh failed", {
          connectionId,
          userId: sessionState.userId,
          error: errorCode,
          errorMessage,
        });
        return failure(
          AuthErrors.customError(
            errorCode,
            errorMessage,
            statusCode,
            refreshResult.error?.details
          )
        );
      }
    } catch (error) {
      sessionState.isRefreshing = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.metrics.recordCounter("websocket_token_refresh_error", 1, {
        userId: sessionState.userId,
        error: errorMessage,
      });
      logger.error("Token refresh error for WebSocket connection", {
        connectionId,
        userId: sessionState.userId,
        error: errorMessage,
      });
      return failure(AuthErrors.systemError(errorMessage));
    }
  }

  /**
   * Check if a WebSocket connection session is valid
   */
  public isSessionValid(connectionId: string): boolean {
    const sessionState = this.refreshSessions.get(connectionId);
    if (!sessionState) {
      return false;
    }

    // Check if session is marked invalid
    if (!sessionState.sessionValid) {
      return false;
    }

    // Check if grace period has expired
    if (
      sessionState.gracePeriodExpiry &&
      new Date() > sessionState.gracePeriodExpiry
    ) {
      sessionState.sessionValid = false;
      return false;
    }

    return true;
  }

  /**
   * Get session state for monitoring
   */
  public getSessionState(connectionId: string): WebSocketSessionState | null {
    return this.refreshSessions.get(connectionId) || null;
  }

  /**
   * Get statistics about token refresh operations
   */
  public getRefreshStats(): {
    totalSessions: number;
    activeSessions: number;
    refreshingSessions: number;
    invalidSessions: number;
    averageRefreshAttempts: number;
  } {
    const sessions = Array.from(this.refreshSessions.values());

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.sessionValid).length,
      refreshingSessions: sessions.filter((s) => s.isRefreshing).length,
      invalidSessions: sessions.filter((s) => !s.sessionValid).length,
      averageRefreshAttempts:
        sessions.length > 0
          ? sessions.reduce((sum, s) => sum + s.refreshAttempts, 0) /
            sessions.length
          : 0,
    };
  }

  /**
   * Graceful shutdown of the token refresh service
   */
  public async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    // Notify all active sessions about shutdown
    for (const [connectionId, sessionState] of this.refreshSessions.entries()) {
      logger.info("Shutting down token refresh for connection", {
        connectionId,
        userId: sessionState.userId,
      });
    }

    this.refreshSessions.clear();

    logger.info("WebSocket token refresh service shutdown completed");
  }

  /**
   * Start automatic token refresh monitoring
   */
  private startAutoRefreshMonitor(): void {
    this.refreshTimer = setInterval(async () => {
      const connectionsNeedingRefresh = Array.from(
        this.refreshSessions.entries()
      )
        .filter(([connectionId]) => this.needsTokenRefresh(connectionId))
        .map(([connectionId]) => connectionId);

      if (connectionsNeedingRefresh.length > 0) {
        logger.debug("Auto-refresh check found connections needing refresh", {
          count: connectionsNeedingRefresh.length,
        });

        for (const connectionId of connectionsNeedingRefresh) {
          // Trigger refresh (fire and forget)
          this.refreshConnectionToken(connectionId).catch((error) => {
            logger.error("Auto-refresh failed for connection", {
              connectionId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    }, this.config.checkInterval);

    // Don't prevent process exit
    this.refreshTimer.unref();

    logger.info("Auto-refresh monitor started", {
      interval: this.config.checkInterval,
    });
  }

  /**
   * Extract token expiry from WebSocket auth context
   */
  private extractTokenExpiry(
    authContext: WebSocketAuthContext
  ): Date | undefined {
    if (authContext.claims?.exp) {
      return new Date(authContext.claims.exp * 1000);
    }
    return undefined;
  }

  /**
   * Perform the actual token refresh operation
   */
  private async performTokenRefresh(
    sessionState: WebSocketSessionState
  ): Promise<
    Result<{ newToken: TokenResponse; newAuthContext: AuthContext }, AuthError>
  > {
    try {
      if (!sessionState.refreshToken) {
        return failure(
          AuthErrors.validationError("No refresh token available")
        );
      }

      // Use the Keycloak client factory to refresh the token
      const tokenResponse = await this.keycloakClientFactory.refreshToken(
        sessionState.refreshToken
      );

      // Validate the new token
      const validationResult = await this.tokenIntrospectionService.validateJWT(
        tokenResponse.access_token,
        this.keycloakClientFactory.getClient("frontend")
      );

      if (!validationResult.valid || !validationResult.claims) {
        // Use error string from TokenValidationResult
        let errorType = validationResult.error || "New token validation failed";
        if (errorType === "SESSION_INVALID") {
          sessionState.sessionValid = false;
          errorType = "Session invalidated";
        } else if (errorType === "TOKEN_ERROR") {
          errorType = "Token expired";
        } else if (errorType === "VALIDATION_ERROR") {
          errorType = "Token invalid";
        }
        return failure(AuthErrors.tokenError(errorType));
      }

      // Create new auth context
      const audienceClaim = validationResult.claims.aud;
      const clientId =
        validationResult.claims.azp ||
        (Array.isArray(audienceClaim) ? audienceClaim[0] : audienceClaim);

      if (!clientId) {
        return failure(
          AuthErrors.tokenError("Token missing client ID in azp or aud claims")
        );
      }

      const newAuthContext: AuthContext = {
        userId: validationResult.claims.sub,
        clientId: clientId,
        authenticated: true,
        method: "jwt",
        scopes: tokenResponse.scope?.split(" ") || [],
        permissions: validationResult.claims.realm_access?.roles || [],
        validatedAt: new Date(),
        cached: false,
        claims: validationResult.claims,
      };

      return success({
        newToken: tokenResponse,
        newAuthContext,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return failure(
        AuthErrors.systemError(`Token refresh failed: ${errorMessage}`)
      );
    }
  }
}

/**
 * Factory function to create WebSocket token refresh service
 */
export function createWebSocketTokenRefreshService(
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService,
  metrics: IMetricsCollector,
  config: Partial<WebSocketTokenRefreshConfig> = {}
): WebSocketTokenRefreshService {
  return new WebSocketTokenRefreshService(
    keycloakClientFactory,
    tokenIntrospectionService,
    metrics,
    config
  );
}
