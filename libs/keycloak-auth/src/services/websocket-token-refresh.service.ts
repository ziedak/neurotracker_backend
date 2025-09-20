/**
 * WebSocket Token Refresh Service
 * Handles token refresh for long-lived WebSocket connections with graceful session management
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import {
  executeWebSocketTokenRefresh,
  type WebSocketOperationContext,
} from "@libs/utils";
import { z } from "zod";
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
 * Zod schema for WebSocket token refresh configuration validation
 */
const WebSocketTokenRefreshConfigSchema = z
  .object({
    refreshThreshold: z
      .number()
      .min(60, "refreshThreshold must be at least 60 seconds"),
    maxRetryAttempts: z
      .number()
      .min(1, "maxRetryAttempts must be at least 1")
      .max(10, "maxRetryAttempts must be at most 10"),
    retryDelay: z.number().min(100, "retryDelay must be at least 100ms"),
    enableAutoRefresh: z.boolean(),
    checkInterval: z
      .number()
      .min(1000, "checkInterval must be at least 1000ms"),
    refreshGracePeriod: z
      .number()
      .min(1000, "refreshGracePeriod must be at least 1000ms"),
    maxConcurrentRefreshes: z
      .number()
      .min(1, "maxConcurrentRefreshes must be at least 1"),
    cleanupInterval: z
      .number()
      .min(60000, "cleanupInterval must be at least 60000ms (1 minute)"),
    maxSessionAge: z.number(),
    refreshTimeout: z
      .number()
      .min(10000, "refreshTimeout must be at least 10000ms (10 seconds)")
      .max(300000, "refreshTimeout must be at most 300000ms (5 minutes)"),
    maxSessions: z
      .number()
      .min(10, "maxSessions must be at least 10")
      .max(10000, "maxSessions must be at most 10000"),
  })
  .refine((data) => data.maxSessionAge > data.cleanupInterval, {
    message: "maxSessionAge must be greater than cleanupInterval",
    path: ["maxSessionAge"],
  })
  .refine((data) => data.checkInterval <= data.refreshThreshold * 1000, {
    message:
      "checkInterval should not be greater than refreshThreshold (inefficient checking)",
    path: ["checkInterval"],
  })
  .refine((data) => data.refreshTimeout < data.refreshGracePeriod, {
    message: "refreshTimeout should be less than refreshGracePeriod",
    path: ["refreshTimeout"],
  });

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
  /** Maximum number of concurrent refresh operations */
  maxConcurrentRefreshes: number;
  /** Session cleanup interval (in milliseconds) */
  cleanupInterval: number;
  /** Maximum session age before cleanup (in milliseconds) */
  maxSessionAge: number;
  /** Timeout for refresh operations to prevent stuck states (in milliseconds) */
  refreshTimeout: number;
  /** Maximum number of sessions allowed */
  maxSessions: number;
}

/**
 * Default WebSocket token refresh configuration
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketTokenRefreshConfig = {
  refreshThreshold: 300, // 5 minutes
  maxRetryAttempts: 3,
  retryDelay: 5000, // 5 seconds
  enableAutoRefresh: true,
  checkInterval: 300000, // 5 minutes (matches refreshThreshold)
  refreshGracePeriod: 30000, // 30 seconds
  maxConcurrentRefreshes: 10, // Limit concurrent refreshes
  cleanupInterval: 300000, // 5 minutes cleanup interval
  maxSessionAge: 3600000, // 1 hour max session age
  refreshTimeout: 25000, // 25 seconds (less than refreshGracePeriod)
  maxSessions: 1000, // Maximum 1000 concurrent sessions
};

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
  lastAccessed: Date; // Track when session was last accessed for LRU-like behavior
  refreshAttempts: number;
  isRefreshing: boolean;
  sessionValid: boolean;
  gracePeriodExpiry?: Date | undefined;
  refreshStartTime?: Date | undefined; // Track when refresh operation started
}

/**
 * WebSocket Token Refresh Service
 * Manages token lifecycle for long-lived WebSocket connections
 */
export class WebSocketTokenRefreshService {
  private readonly refreshSessions = new Map<string, WebSocketSessionState>();
  private refreshTimer?: NodeJS.Timeout | undefined;
  private cleanupTimer?: NodeJS.Timeout | undefined;
  private readonly config: WebSocketTokenRefreshConfig;
  private activeRefreshes = 0; // Track concurrent refresh operations

  constructor(
    private readonly keycloakClientFactory: IKeycloakClientFactory,
    private readonly tokenIntrospectionService: ITokenIntrospectionService,
    private readonly metrics: IMetricsCollector,
    config: Partial<WebSocketTokenRefreshConfig> = {}
  ) {
    this.config = this.validateConfig({
      ...DEFAULT_WEBSOCKET_CONFIG,
      ...config,
    });

    if (this.config.enableAutoRefresh) {
      this.startAutoRefreshMonitor();
      this.startSessionCleanup();
    }

    logger.info("WebSocket token refresh service initialized", {
      refreshThreshold: this.config.refreshThreshold,
      autoRefresh: this.config.enableAutoRefresh,
      checkInterval: this.config.checkInterval,
      maxConcurrentRefreshes: this.config.maxConcurrentRefreshes,
      cleanupInterval: this.config.cleanupInterval,
    });
  }

  /**
   * Validate configuration parameters using Zod schema
   */
  private validateConfig(
    config: Partial<WebSocketTokenRefreshConfig>
  ): WebSocketTokenRefreshConfig {
    try {
      const mergedConfig = { ...DEFAULT_WEBSOCKET_CONFIG, ...config };
      const validatedConfig =
        WebSocketTokenRefreshConfigSchema.parse(mergedConfig);

      return validatedConfig;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        throw new Error(`Configuration validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  /**
   * Start session cleanup monitoring
   */
  private startSessionCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.performSessionCleanup();
    }, this.config.cleanupInterval);

    this.cleanupTimer.unref();

    logger.info("Session cleanup monitor started", {
      cleanupInterval: this.config.cleanupInterval,
      maxSessionAge: this.config.maxSessionAge,
    });
  }

  /**
   * Perform cleanup of expired and invalid sessions
   */
  private performSessionCleanup(): void {
    const now = Date.now();
    const initialCount = this.refreshSessions.size;
    let cleanedCount = 0;

    // Monitor memory usage
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    // Alert on high memory usage
    if (heapUsedMB > 500) {
      // 500MB threshold
      logger.warn("High memory usage detected", {
        heapUsedMB,
        heapTotalMB,
        sessionCount: this.refreshSessions.size,
      });
      this.metrics.recordGauge("websocket_memory_heap_used_mb", heapUsedMB);
      this.metrics.recordGauge("websocket_memory_heap_total_mb", heapTotalMB);
    }

    for (const [connectionId, sessionState] of this.refreshSessions.entries()) {
      let shouldRemove = false;
      let reason = "";

      try {
        // Remove invalid sessions
        if (!sessionState.sessionValid) {
          shouldRemove = true;
          reason = "session_invalid";
        }
        // Remove sessions with expired grace period
        else if (
          sessionState.gracePeriodExpiry &&
          now > sessionState.gracePeriodExpiry.getTime()
        ) {
          shouldRemove = true;
          reason = "grace_period_expired";
        }
        // Remove very old sessions (LRU-like behavior)
        else if (sessionState.lastRefreshAttempt) {
          const sessionAge = now - sessionState.lastRefreshAttempt.getTime();
          if (sessionAge > this.config.maxSessionAge) {
            shouldRemove = true;
            reason = "session_too_old";
          }
        }
        // Remove sessions with stuck refresh states
        else if (
          sessionState.isRefreshing &&
          sessionState.refreshStartTime &&
          now - sessionState.refreshStartTime.getTime() >
            this.config.refreshTimeout
        ) {
          sessionState.isRefreshing = false;
          sessionState.refreshStartTime = undefined;
          sessionState.sessionValid = false; // Mark as invalid due to stuck refresh
          shouldRemove = true;
          reason = "stuck_refresh_timeout";

          logger.warn("Reset stuck refresh state", {
            connectionId,
            userId: sessionState.userId,
            refreshDuration: sessionState.refreshStartTime
              ? now - (sessionState.refreshStartTime as Date).getTime()
              : undefined,
            timeout: this.config.refreshTimeout,
          });
        }
        // Remove sessions that never refresh but have very old tokens
        else if (
          !sessionState.lastRefreshAttempt &&
          sessionState.tokenExpiry &&
          now > sessionState.tokenExpiry.getTime() + this.config.maxSessionAge
        ) {
          shouldRemove = true;
          reason = "never_refreshed_old_token";
        }
        // Remove sessions that haven't been accessed recently (LRU cleanup)
        else if (
          now - sessionState.lastAccessed.getTime() >
          this.config.maxSessionAge
        ) {
          shouldRemove = true;
          reason = "not_accessed_recently";
        }

        if (shouldRemove) {
          this.refreshSessions.delete(connectionId);
          cleanedCount++;

          logger.debug("Cleaned up expired session", {
            connectionId,
            userId: sessionState.userId,
            reason,
            sessionAge: sessionState.lastRefreshAttempt
              ? now - sessionState.lastRefreshAttempt.getTime()
              : undefined,
          });
        }
      } catch (error) {
        logger.error("Error during session cleanup", {
          connectionId,
          userId: sessionState.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next session to prevent cleanup from breaking
      }
    }

    if (cleanedCount > 0) {
      this.metrics.recordCounter("websocket_sessions_cleaned", cleanedCount);
      logger.info("Session cleanup completed", {
        initialCount,
        finalCount: this.refreshSessions.size,
        cleanedCount,
      });
    }
  }

  /**
   * Register a WebSocket connection for token refresh monitoring
   */
  public registerConnection(
    connectionId: string,
    connectionData: WebSocketConnectionData
  ): Result<void, AuthError> {
    try {
      // Check session limit before registering
      if (this.refreshSessions.size >= this.config.maxSessions) {
        logger.warn("Session limit reached, performing emergency cleanup", {
          currentSessions: this.refreshSessions.size,
          maxSessions: this.config.maxSessions,
        });

        // Perform emergency cleanup - remove oldest sessions
        this.performEmergencyCleanup();

        // If still at limit, reject registration
        if (this.refreshSessions.size >= this.config.maxSessions) {
          this.metrics.recordCounter("websocket_session_limit_reached", 1);
          return failure(
            AuthErrors.systemError(
              `Session limit reached (${this.config.maxSessions})`
            )
          );
        }
      }

      const tokenExpiry = this.extractTokenExpiry(connectionData.auth);

      const sessionState: WebSocketSessionState = {
        connectionId,
        userId: connectionData.auth.userId || "anonymous",
        currentToken: connectionData.auth.token,
        refreshToken: connectionData.auth.refreshToken,
        tokenExpiry,
        lastAccessed: new Date(), // Track access time
        refreshAttempts: 0,
        isRefreshing: false,
        sessionValid: true,
        refreshStartTime: undefined,
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
   * Perform emergency cleanup when session limit is reached
   * Removes oldest sessions based on lastAccessed time
   */
  private performEmergencyCleanup(): void {
    const sessions = Array.from(this.refreshSessions.entries());

    // Sort by lastAccessed time (oldest first)
    sessions.sort(
      ([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime()
    );

    const targetCount = Math.floor(this.config.maxSessions * 0.8); // Target 80% of max
    const sessionsToRemove = sessions.slice(0, sessions.length - targetCount);

    let emergencyCleanedCount = 0;
    for (const [connectionId, sessionState] of sessionsToRemove) {
      this.refreshSessions.delete(connectionId);
      emergencyCleanedCount++;

      logger.warn("Emergency cleanup removed session", {
        connectionId,
        userId: sessionState.userId,
        lastAccessed: sessionState.lastAccessed.toISOString(),
        reason: "session_limit_emergency",
      });
    }

    if (emergencyCleanedCount > 0) {
      this.metrics.recordCounter(
        "websocket_emergency_cleanup",
        emergencyCleanedCount
      );
      logger.info("Emergency cleanup completed", {
        removedCount: emergencyCleanedCount,
        remainingSessions: this.refreshSessions.size,
        targetCount,
      });
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

    // Update last accessed time for LRU tracking
    sessionState.lastAccessed = new Date();

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

    // Update last accessed time for LRU tracking
    sessionState.lastAccessed = new Date();

    // Check concurrent refresh limit
    if (this.activeRefreshes >= this.config.maxConcurrentRefreshes) {
      logger.warn("Concurrent refresh limit reached, deferring refresh", {
        connectionId,
        userId: sessionState.userId,
        activeRefreshes: this.activeRefreshes,
        maxConcurrentRefreshes: this.config.maxConcurrentRefreshes,
      });

      this.metrics.recordCounter("websocket_refresh_deferred", 1, {
        userId: sessionState.userId,
        reason: "concurrent_limit",
      });

      return failure(
        AuthErrors.systemError(
          `Concurrent refresh limit reached (${this.config.maxConcurrentRefreshes})`
        )
      );
    }

    try {
      if (sessionState.isRefreshing) {
        return failure(
          AuthErrors.validationError("Token refresh already in progress")
        );
      }

      // Increment active refreshes counter
      this.activeRefreshes++;
      this.metrics.recordGauge(
        "websocket_active_refreshes",
        this.activeRefreshes
      );

      // Mark as refreshing
      sessionState.isRefreshing = true;
      sessionState.lastRefreshAttempt = new Date();
      sessionState.refreshAttempts++;
      sessionState.refreshStartTime = new Date(); // Track refresh start time

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
        sessionState.refreshStartTime = undefined; // Clear refresh start time

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
        sessionState.refreshStartTime = undefined; // Clear refresh start time on failure

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
      sessionState.refreshStartTime = undefined; // Clear refresh start time on error

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
    } finally {
      // Always decrement active refreshes counter
      this.activeRefreshes = Math.max(0, this.activeRefreshes - 1);
      this.metrics.recordGauge(
        "websocket_active_refreshes",
        this.activeRefreshes
      );
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

    // Update last accessed time for LRU tracking
    sessionState.lastAccessed = new Date();

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
    const sessionState = this.refreshSessions.get(connectionId);
    if (sessionState) {
      // Update last accessed time for LRU tracking
      sessionState.lastAccessed = new Date();
    }
    return sessionState || null;
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
    activeRefreshes: number;
    maxConcurrentRefreshes: number;
    memoryUsage: {
      heapUsedMB: number;
      heapTotalMB: number;
      externalMB: number;
    };
    sessionLimit: number;
    maxSessionAge: number;
  } {
    const sessions = Array.from(this.refreshSessions.values());
    const memUsage = process.memoryUsage();

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
      activeRefreshes: this.activeRefreshes,
      maxConcurrentRefreshes: this.config.maxConcurrentRefreshes,
      memoryUsage: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        externalMB: Math.round(memUsage.external / 1024 / 1024),
      },
      sessionLimit: this.config.maxSessions,
      maxSessionAge: this.config.maxSessionAge,
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

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Reset active refreshes counter
    this.activeRefreshes = 0;
    this.metrics.recordGauge("websocket_active_refreshes", 0);

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
   * Perform the actual token refresh operation using WebSocket-optimized retry logic
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

      // Use WebSocket-optimized retry function
      const tokenResponse = await executeWebSocketTokenRefresh(
        async () => {
          // Use the Keycloak client factory to refresh the token
          if (!sessionState.refreshToken) {
            throw new Error(
              "No refresh token available for WebSocket operation"
            );
          }
          return await this.keycloakClientFactory.refreshToken(
            sessionState.refreshToken
          );
        },
        (
          error: unknown,
          context: WebSocketOperationContext,
          attempt?: number
        ) => {
          // Enhanced error handling with WebSocket context
          logger.warn("WebSocket token refresh attempt failed", {
            connectionId: context.connectionId,
            operationId: context.operationId,
            attempt,
            error: error instanceof Error ? error.message : String(error),
            isRealTime: context.isRealTime,
            retryCount: context.retryCount,
          });
        },
        sessionState.connectionId,
        {
          maxRetries: 3,
          retryDelay: 2000,
          gracePeriod: 15000, // 15 seconds grace period
          isRealTime: true,
          enableCircuitBreaker: true,
          circuitBreakerThreshold: 3,
          circuitBreakerTimeout: 60000,
          connectionTimeout: 30000,
          enableMetrics: true,
          handleWebSocketErrors: true,
          connectionHealthCheck: async () => {
            // Check if connection is still valid
            return this.isSessionValid(sessionState.connectionId);
          },
        },
        this.metrics
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
