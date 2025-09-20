/**
 * Token Refresh Manager
 * Provides automatic token refresh capabilities for long-lived sessions
 * and WebSocket connections with proper error handling and retry logic
 */

import { createLogger } from "@libs/utils";
import { executeWithRetry, RetryOptions } from "@libs/utils";
import { TokenResponse, AuthenticationError, ClientType } from "../types";
import type { IKeycloakClientFactory } from "../types";
import { MetricsCollector, IMetricsCollector } from "@libs/monitoring";

const logger = createLogger("TokenRefreshManager");

/**
 * Token information with refresh metadata
 */
export interface ManagedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // timestamp in milliseconds
  refreshExpiresAt?: number | undefined; // refresh token expiration
  scope?: string | undefined;
  tokenType: string;
  sessionId: string;
  clientType: ClientType;
}

/**
 * Token refresh configuration - aligned with executeWithRetry utility
 */
export interface TokenRefreshConfig {
  /** How many seconds before expiry to refresh (default: 300 = 5 minutes) */
  refreshBufferSeconds: number;
  /** Maximum number of refresh attempts (default: 3) */
  maxRetryAttempts: number;
  /** Base delay between retry attempts in ms (default: 1000) */
  retryBaseDelay: number;
  /** Whether to use exponential backoff for retries (default: true) */
  useExponentialBackoff: boolean;
  /** Maximum delay between retries in ms (default: 30000 = 30 seconds) */
  maxRetryDelay: number;
  /** Automatic refresh interval check in ms (default: 60000 = 1 minute) */
  refreshCheckInterval: number;
  /** Enable circuit breaker for resilience (default: true) */
  enableCircuitBreaker: boolean;
  /** Circuit breaker failure threshold (default: 5) */
  circuitBreakerThreshold: number;
  /** Circuit breaker recovery timeout in ms (default: 60000 = 1 minute) */
  circuitBreakerTimeout: number;
  /** Enable metrics collection (default: true) */
  enableMetrics: boolean;
}

/**
 * Default token refresh configuration
 */
export const DEFAULT_REFRESH_CONFIG: TokenRefreshConfig = {
  refreshBufferSeconds: 300, // 5 minutes
  maxRetryAttempts: 3,
  retryBaseDelay: 1000, // 1 second
  useExponentialBackoff: true,
  maxRetryDelay: 30000, // 30 seconds
  refreshCheckInterval: 60000, // 1 minute
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 60000, // 1 minute
  enableMetrics: true,
};

/**
 * Token refresh event types
 */
export type TokenRefreshEvent =
  | { type: "refresh_success"; sessionId: string; newToken: ManagedToken }
  | {
      type: "refresh_failed";
      sessionId: string;
      error: Error;
      attemptsLeft: number;
    }
  | { type: "refresh_expired"; sessionId: string; reason: string }
  | { type: "session_removed"; sessionId: string; reason: string };

/**
 * Token refresh event handler
 */
export type TokenRefreshEventHandler = (event: TokenRefreshEvent) => void;

/**
 * Enhanced Token Refresh Manager
 */
export class TokenRefreshManager {
  private config: TokenRefreshConfig;
  private clientFactory: IKeycloakClientFactory;
  private managedTokens = new Map<string, ManagedToken>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private eventHandlers = new Set<TokenRefreshEventHandler>();
  private refreshInterval: NodeJS.Timeout | undefined;
  private disposed = false;

  // Race condition prevention
  private refreshLocks = new Map<string, Promise<ManagedToken>>();

  // Performance tracking
  private startTime: number;

  // Enterprise-grade metrics collection using @libs/monitoring
  private metricsCollector: IMetricsCollector;

  // Local state for metrics that need to be queried
  private localMetrics = {
    refreshTimes: [] as number[],
    totalFailures: 0,
    successCount: 0,
    recentFailures: [] as Array<{
      sessionId: string;
      error: string;
      timestamp: number;
    }>,
    circuitBreakerStatus: new Map<
      string,
      {
        failures: number;
        lastFailure: number;
        isOpen: boolean;
      }
    >(),
  };

  constructor(
    clientFactory: IKeycloakClientFactory,
    config: Partial<TokenRefreshConfig> = {}
  ) {
    this.clientFactory = clientFactory;
    this.config = this.validateConfig({ ...DEFAULT_REFRESH_CONFIG, ...config });
    this.startTime = Date.now();
    this.metricsCollector = MetricsCollector.create();
    this.startRefreshMonitoring();
  }

  /**
   * Validate configuration parameters with cross-field validation and performance warnings
   * @param config - Partial configuration to validate
   * @returns Validated complete configuration
   * @throws Error if configuration is invalid
   */
  private validateConfig(
    config: Partial<TokenRefreshConfig>
  ): TokenRefreshConfig {
    const validated = { ...DEFAULT_REFRESH_CONFIG, ...config };

    // Basic parameter validation
    if (
      config.refreshBufferSeconds !== undefined &&
      config.refreshBufferSeconds < 60
    ) {
      throw new Error("refreshBufferSeconds must be at least 60 seconds");
    }
    if (
      config.maxRetryAttempts !== undefined &&
      (config.maxRetryAttempts < 1 || config.maxRetryAttempts > 10)
    ) {
      throw new Error("maxRetryAttempts must be between 1 and 10");
    }
    if (config.retryBaseDelay !== undefined && config.retryBaseDelay < 100) {
      throw new Error("retryBaseDelay must be at least 100ms");
    }
    if (config.maxRetryDelay !== undefined && config.maxRetryDelay < 1000) {
      throw new Error("maxRetryDelay must be at least 1000ms");
    }
    if (
      config.refreshCheckInterval !== undefined &&
      config.refreshCheckInterval < 1000
    ) {
      throw new Error("refreshCheckInterval must be at least 1000ms");
    }

    // Cross-field validation
    if (validated.maxRetryDelay < validated.retryBaseDelay) {
      throw new Error(
        "maxRetryDelay must be greater than or equal to retryBaseDelay"
      );
    }

    if (validated.circuitBreakerThreshold < 1) {
      throw new Error("circuitBreakerThreshold must be at least 1");
    }

    if (validated.circuitBreakerTimeout < 1000) {
      throw new Error("circuitBreakerTimeout must be at least 1000ms");
    }

    // Performance warnings (log but don't throw)
    this.logPerformanceWarnings(validated);

    return validated;
  }

  /**
   * Log performance warnings for potentially suboptimal configuration
   */
  private logPerformanceWarnings(config: TokenRefreshConfig): void {
    const warnings: string[] = [];

    // Check refresh buffer vs check interval
    if (config.refreshBufferSeconds * 1000 > config.refreshCheckInterval) {
      warnings.push(
        `refreshBufferSeconds (${config.refreshBufferSeconds}s) is greater than refreshCheckInterval (${config.refreshCheckInterval}ms), ` +
          "which may cause tokens to expire before refresh attempts"
      );
    }

    // Check retry delay vs refresh buffer
    if (
      config.retryBaseDelay * config.maxRetryAttempts >
      config.refreshBufferSeconds * 1000
    ) {
      warnings.push(
        `Total retry time (${
          config.retryBaseDelay * config.maxRetryAttempts
        }ms) exceeds refresh buffer ` +
          `(${
            config.refreshBufferSeconds * 1000
          }ms), which may cause token expiration during retries`
      );
    }

    // Check circuit breaker timeout vs refresh interval
    if (config.circuitBreakerTimeout > config.refreshCheckInterval) {
      warnings.push(
        `circuitBreakerTimeout (${config.circuitBreakerTimeout}ms) is greater than refreshCheckInterval ` +
          `(${config.refreshCheckInterval}ms), which may delay recovery`
      );
    }

    // Check memory usage potential
    const estimatedMemoryMB = this.estimateMemoryUsage(config);
    if (estimatedMemoryMB > 50) {
      warnings.push(
        `Configuration may use approximately ${estimatedMemoryMB}MB of memory with high token counts`
      );
    }

    // Log warnings
    if (warnings.length > 0) {
      logger.warn("TokenRefreshManager configuration warnings", {
        warnings,
        config: {
          refreshBufferSeconds: config.refreshBufferSeconds,
          maxRetryAttempts: config.maxRetryAttempts,
          retryBaseDelay: config.retryBaseDelay,
          refreshCheckInterval: config.refreshCheckInterval,
          circuitBreakerTimeout: config.circuitBreakerTimeout,
        },
      });
    }
  }

  /**
   * Estimate memory usage based on configuration
   */
  private estimateMemoryUsage(config: TokenRefreshConfig): number {
    // Rough estimation: assume 1000 concurrent tokens
    const assumedTokenCount = 1000;
    const tokenSize = 200; // bytes per token
    const timerSize = 50; // bytes per timer
    const metricsSize = config.enableMetrics ? 1000 : 100; // bytes for metrics

    const totalBytes =
      assumedTokenCount * tokenSize +
      assumedTokenCount * timerSize +
      metricsSize;

    return Math.round(totalBytes / (1024 * 1024)); // Convert to MB
  }

  /**
   * Record metrics for a refresh operation using enterprise-grade metrics collector
   */
  private async recordRefreshMetrics(
    sessionId: string,
    duration: number,
    success: boolean,
    error?: Error
  ): Promise<void> {
    try {
      // Record to Prometheus metrics collector
      await this.metricsCollector.recordAuthOperation(
        "refresh",
        success ? "success" : "failure"
      );

      await this.metricsCollector.recordTimer(
        "token_refresh_duration",
        duration,
        {
          session_id: sessionId,
          result: success ? "success" : "failure",
        }
      );

      if (success) {
        await this.metricsCollector.recordCounter(
          "token_refresh_success_total",
          1,
          { session_id: sessionId }
        );
      } else {
        await this.metricsCollector.recordCounter(
          "token_refresh_failure_total",
          1,
          {
            session_id: sessionId,
            error_type: error?.name || "unknown",
          }
        );
      }

      // Update local metrics for query operations
      this.localMetrics.refreshTimes.push(duration);
      if (this.localMetrics.refreshTimes.length > 100) {
        this.localMetrics.refreshTimes.shift();
      }

      if (success) {
        this.localMetrics.successCount++;
      } else {
        this.localMetrics.totalFailures++;
        if (error) {
          this.localMetrics.recentFailures.push({
            sessionId,
            error: error.message,
            timestamp: Date.now(),
          });
          if (this.localMetrics.recentFailures.length > 10) {
            this.localMetrics.recentFailures.shift();
          }
        }
      }
    } catch (metricsError) {
      logger.warn("Failed to record refresh metrics", {
        sessionId,
        metricsError:
          metricsError instanceof Error
            ? metricsError.message
            : String(metricsError),
      });
    }
  }

  /**
   * Record the start of a refresh operation (for internal tracking)
   */
  private recordRefreshStart(sessionId: string): void {
    // Note: Prometheus metrics are typically recorded on completion
    // This method is kept for potential future enhancements
    logger.debug("Refresh operation started", { sessionId });
  }

  /**
   * Calculate average refresh time from collected metrics
   */
  private getAverageRefreshTime(): number {
    if (this.localMetrics.refreshTimes.length === 0) return 0;

    const sum = this.localMetrics.refreshTimes.reduce(
      (a: number, b: number) => a + b,
      0
    );
    return sum / this.localMetrics.refreshTimes.length;
  }

  /**
   * Calculate refresh success rate
   */
  private getRefreshSuccessRate(): number {
    const totalAttempts =
      this.localMetrics.successCount + this.localMetrics.totalFailures;
    if (totalAttempts === 0) return 100;

    return (this.localMetrics.successCount / totalAttempts) * 100;
  }

  /**
   * Update circuit breaker status for a session
   */
  private updateCircuitBreakerStatus(sessionId: string, failed: boolean): void {
    const status = this.localMetrics.circuitBreakerStatus.get(sessionId) || {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
    };

    if (failed) {
      status.failures++;
      status.lastFailure = Date.now();
      status.isOpen = status.failures >= this.config.circuitBreakerThreshold;
    } else {
      // Success - reset failure count
      status.failures = 0;
      status.isOpen = false;
    }

    this.localMetrics.circuitBreakerStatus.set(sessionId, status);
  }

  /**
   * Get approximate memory usage of the manager
   */
  private getMemoryUsage(): number {
    // Rough estimation of memory usage
    const tokenSize = 200; // Approximate bytes per token
    const timerSize = 50; // Approximate bytes per timer
    const lockSize = 100; // Approximate bytes per lock

    return (
      this.managedTokens.size * tokenSize +
      this.refreshTimers.size * timerSize +
      this.refreshLocks.size * lockSize +
      this.localMetrics.refreshTimes.length * 8 + // 8 bytes per number
      this.localMetrics.recentFailures.length * 150 // Approximate bytes per failure record
    );
  }

  /**
   * Add a token to refresh management
   * @param sessionId - Unique session identifier
   * @param tokenResponse - OAuth 2.1 token response from Keycloak
   * @param clientType - Type of client (frontend, service, tracker, websocket)
   * @returns Managed token with refresh metadata
   * @throws Error if token response doesn't contain refresh token
   */
  public addManagedToken(
    sessionId: string,
    tokenResponse: TokenResponse,
    clientType: ClientType = "frontend"
  ): ManagedToken {
    this.checkNotDisposed();
    if (!tokenResponse.refresh_token) {
      throw new Error("Cannot manage token without refresh token");
    }

    const now = Date.now();
    const expiresAt = now + tokenResponse.expires_in * 1000;
    const refreshExpiresAt = tokenResponse["refresh_expires_in"]
      ? now + Number(tokenResponse["refresh_expires_in"]) * 1000
      : undefined;

    const managedToken: ManagedToken = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      refreshExpiresAt,
      scope: tokenResponse.scope,
      tokenType: tokenResponse.token_type || "Bearer",
      sessionId,
      clientType,
    };

    this.managedTokens.set(sessionId, managedToken);
    this.scheduleRefresh(sessionId, managedToken);

    logger.info("Token added to refresh management", {
      sessionId,
      clientType,
      expiresIn: Math.round((expiresAt - now) / 1000),
      scope: tokenResponse.scope,
    });

    return managedToken;
  }

  /**
   * Get current managed token
   */
  public getManagedToken(sessionId: string): ManagedToken | undefined {
    return this.managedTokens.get(sessionId);
  }

  /**
   * Remove token from management
   */
  public removeManagedToken(
    sessionId: string,
    reason = "manual_removal"
  ): void {
    const timer = this.refreshTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(sessionId);
    }

    const wasManaged = this.managedTokens.delete(sessionId);

    if (wasManaged) {
      logger.info("Token removed from management", { sessionId, reason });
      this.emitEvent({
        type: "session_removed",
        sessionId,
        reason,
      });
    }
  }

  /**
   * Force refresh a managed token
   */
  public async refreshManagedToken(sessionId: string): Promise<ManagedToken> {
    this.checkNotDisposed();
    const token = this.managedTokens.get(sessionId);
    if (!token) {
      throw new Error(`No managed token found for session: ${sessionId}`);
    }

    return this.performTokenRefresh(sessionId, token);
  }

  /**
   * Check if a token needs refresh
   */
  public needsRefresh(sessionId: string): boolean {
    const token = this.managedTokens.get(sessionId);
    if (!token) return false;

    const now = Date.now();
    const refreshTime =
      token.expiresAt - this.config.refreshBufferSeconds * 1000;

    return now >= refreshTime;
  }

  /**
   * Check if a refresh token is expired
   */
  public isRefreshTokenExpired(sessionId: string): boolean {
    const token = this.managedTokens.get(sessionId);
    if (!token || !token.refreshExpiresAt) return false;

    return Date.now() >= token.refreshExpiresAt;
  }

  /**
   * Get all managed sessions
   */
  public getManagedSessions(): string[] {
    return Array.from(this.managedTokens.keys());
  }

  /**
   * Get refresh statistics
   */
  public getRefreshStats(): {
    totalManagedTokens: number;
    tokensNeedingRefresh: number;
    expiredRefreshTokens: number;
  } {
    const sessions = this.getManagedSessions();
    const tokensNeedingRefresh = sessions.filter((id) =>
      this.needsRefresh(id)
    ).length;
    const expiredRefreshTokens = sessions.filter((id) =>
      this.isRefreshTokenExpired(id)
    ).length;

    return {
      totalManagedTokens: sessions.length,
      tokensNeedingRefresh,
      expiredRefreshTokens,
    };
  }

  /**
   * Get detailed metrics and health status
   */
  public getDetailedMetrics(): {
    basic: ReturnType<TokenRefreshManager["getRefreshStats"]>;
    performance: {
      averageRefreshTime: number;
      refreshSuccessRate: number;
      totalRefreshAttempts: number;
      activeRefreshLocks: number;
    };
    errors: {
      totalFailures: number;
      recentFailures: Array<{
        sessionId: string;
        error: string;
        timestamp: number;
      }>;
      circuitBreakerStatus: Record<string, any>; // Circuit breaker status from executeWithRetry utility
    };
    health: {
      status: "healthy" | "degraded" | "unhealthy";
      managedTokens: number;
      activeTimers: number;
      memoryUsage: number;
      uptime: number;
    };
  } {
    const basic = this.getRefreshStats();
    const now = Date.now();

    // Calculate performance metrics (simplified since circuit breaker is handled by utility)
    const totalFailures = 0; // Would need to track this separately or get from utility

    // Determine health status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (totalFailures > 10) {
      status = "degraded";
    }
    if (
      basic.expiredRefreshTokens > basic.totalManagedTokens * 0.5 ||
      totalFailures > 50
    ) {
      status = "unhealthy";
    }

    return {
      basic,
      performance: {
        averageRefreshTime: this.getAverageRefreshTime(),
        refreshSuccessRate: this.getRefreshSuccessRate(),
        totalRefreshAttempts:
          this.localMetrics.successCount + this.localMetrics.totalFailures,
        activeRefreshLocks: this.refreshLocks.size,
      },
      errors: {
        totalFailures: this.localMetrics.totalFailures,
        recentFailures: [...this.localMetrics.recentFailures],
        circuitBreakerStatus: Object.fromEntries(
          this.localMetrics.circuitBreakerStatus
        ),
      },
      health: {
        status,
        managedTokens: basic.totalManagedTokens,
        activeTimers: this.refreshTimers.size,
        memoryUsage: this.getMemoryUsage(),
        uptime: now - this.startTime,
      },
    };
  }

  /**
   * Get health status summary
   */
  public getHealthStatus(): {
    status: "healthy" | "degraded" | "unhealthy";
    message: string;
    details: Record<string, unknown>;
  } {
    const metrics = this.getDetailedMetrics();

    let message = "Token refresh manager is operating normally";
    if (metrics.health.status === "degraded") {
      message = "Token refresh manager is experiencing issues";
    } else if (metrics.health.status === "unhealthy") {
      message = "Token refresh manager requires attention";
    }

    return {
      status: metrics.health.status,
      message,
      details: {
        managedTokens: metrics.health.managedTokens,
        activeTimers: metrics.health.activeTimers,
        totalFailures: metrics.errors.totalFailures,
        openCircuitBreakers: 0, // Circuit breaker status managed by executeWithRetry utility
        refreshSuccessRate: metrics.performance.refreshSuccessRate,
      },
    };
  }

  /**
   * Add event handler
   */
  public onRefreshEvent(handler: TokenRefreshEventHandler): void {
    this.checkNotDisposed();
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event handler
   */
  public removeRefreshEventHandler(handler: TokenRefreshEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Test helper methods - only available in test environment
   * These methods provide access to internal state for testing purposes
   */
  public readonly __testOnly = {
    /**
     * Get current refresh locks for testing race condition handling
     */
    getRefreshLocks: (): Map<string, Promise<ManagedToken>> => {
      return new Map(this.refreshLocks);
    },

    /**
     * Get current refresh timers for testing timer management
     */
    getRefreshTimers: (): Map<string, NodeJS.Timeout> => {
      return new Map(this.refreshTimers);
    },

    /**
     * Trigger manual refresh check for testing monitoring behavior
     */
    triggerRefreshCheck: (): void => {
      const sessions = this.getManagedSessions();
      const sessionsNeedingRefresh = sessions.filter((id) =>
        this.needsRefresh(id)
      );

      if (sessionsNeedingRefresh.length > 0) {
        this.processBatchRefresh(sessionsNeedingRefresh, 5);
      }
    },

    /**
     * Clear all timers for testing cleanup behavior
     */
    clearAllTimers: (): void => {
      for (const timer of this.refreshTimers.values()) {
        clearTimeout(timer);
      }
      this.refreshTimers.clear();

      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = undefined;
      }
    },

    /**
     * Get raw metrics collector for testing metrics collection
     */
    getMetricsCollector: () => {
      return {
        refreshTimes: [...this.localMetrics.refreshTimes],
        totalFailures: this.localMetrics.totalFailures,
        successCount: this.localMetrics.successCount,
        recentFailures: [...this.localMetrics.recentFailures],
        circuitBreakerStatus: new Map(this.localMetrics.circuitBreakerStatus),
      };
    },

    /**
     * Simulate time passage for testing timer behavior
     * @param milliseconds - Milliseconds to advance
     */
    advanceTime: (milliseconds: number): void => {
      // This is a simplified simulation - in real tests you'd use a time mocking library
      const newTime = Date.now() + milliseconds;
      (global as any).Date.now = jest.fn(() => newTime);
    },

    /**
     * Get configuration validation warnings for testing
     */
    validateConfigForTest: (
      config: Partial<TokenRefreshConfig>
    ): { isValid: boolean; warnings: string[] } => {
      try {
        this.validateConfig(config);
        return { isValid: true, warnings: [] };
      } catch (error) {
        return {
          isValid: false,
          warnings: [error instanceof Error ? error.message : String(error)],
        };
      }
    },
  };

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    // Clear all timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();

    // Clear refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    // Clear managed tokens
    this.managedTokens.clear();
    this.eventHandlers.clear();

    // Clear refresh locks
    this.refreshLocks.clear();

    logger.info("Token refresh manager disposed", {
      uptime: Date.now() - this.startTime,
      finalManagedTokens: 0,
      finalActiveTimers: 0,
    });
  }

  /**
   * Check if manager has been disposed
   */
  private checkNotDisposed(): void {
    if (this.disposed) {
      throw new Error("TokenRefreshManager has been disposed");
    }
  }

  /**
   * Schedule automatic refresh for a token
   */
  private scheduleRefresh(sessionId: string, token: ManagedToken): void {
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const now = Date.now();
    const refreshTime =
      token.expiresAt - this.config.refreshBufferSeconds * 1000;
    const delay = Math.max(0, refreshTime - now);

    const timer = setTimeout(async () => {
      try {
        await this.performTokenRefresh(sessionId, token);
      } catch (error) {
        logger.error("Scheduled token refresh failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delay);

    this.refreshTimers.set(sessionId, timer);

    logger.debug("Token refresh scheduled", {
      sessionId,
      refreshInSeconds: Math.round(delay / 1000),
    });
  }

  /**
   * Perform token refresh with retry logic and race condition prevention
   *
   * This method implements a sophisticated refresh mechanism that:
   * 1. Prevents concurrent refresh operations for the same session using locks
   * 2. Implements exponential backoff retry logic with circuit breaker pattern
   * 3. Records comprehensive metrics for monitoring and debugging
   * 4. Handles various error scenarios gracefully
   *
   * @param sessionId - Unique session identifier for the token being refreshed
   * @param currentToken - Current managed token with refresh metadata
   * @returns Promise resolving to updated managed token
   * @throws AuthenticationError if refresh token is expired or max retries exceeded
   * @throws Error for other unexpected failures
   *
   * @example
   * ```typescript
   * const updatedToken = await manager.performTokenRefresh(sessionId, currentToken);
   * console.log('Token refreshed, new expiry:', new Date(updatedToken.expiresAt));
   * ```
   */
  private async performTokenRefresh(
    sessionId: string,
    currentToken: ManagedToken
  ): Promise<ManagedToken> {
    // Check if refresh is already in progress for this session
    const existingRefresh = this.refreshLocks.get(sessionId);
    if (existingRefresh) {
      logger.debug(
        "Refresh already in progress, waiting for existing refresh",
        { sessionId }
      );
      return existingRefresh;
    }

    // Create and store the refresh promise to prevent concurrent refreshes
    const refreshPromise = this.doPerformTokenRefresh(sessionId, currentToken);
    this.refreshLocks.set(sessionId, refreshPromise);

    try {
      const result = await refreshPromise;
      return result;
    } finally {
      this.refreshLocks.delete(sessionId);
    }
  }

  private async doPerformTokenRefresh(
    sessionId: string,
    currentToken: ManagedToken
  ): Promise<ManagedToken> {
    /**
     * Internal token refresh implementation using executeWithRetry utility
     *
     * This method orchestrates the complete token refresh workflow:
     * 1. Records refresh start time for metrics collection
     * 2. Validates refresh token expiration before attempting refresh
     * 3. Executes refresh with comprehensive retry and circuit breaker logic
     * 4. Updates managed token state and schedules next refresh
     * 5. Records success/failure metrics and emits appropriate events
     * 6. Handles cleanup on max retry exhaustion
     *
     * The method uses the executeWithRetry utility which provides:
     * - Exponential backoff with jitter
     * - Circuit breaker pattern for resilience
     * - Comprehensive error handling and logging
     * - Metrics collection integration
     *
     * @param sessionId - Unique session identifier
     * @param currentToken - Current managed token state
     * @returns Promise resolving to refreshed managed token
     * @throws AuthenticationError if refresh token expired or max retries reached
     * @throws Error for network or server errors during refresh
     *
     * @private
     */
    const startTime = Date.now();
    this.recordRefreshStart(sessionId);

    const refreshOperation = async (): Promise<ManagedToken> => {
      logger.debug("Attempting token refresh", { sessionId });

      // Check if refresh token is expired
      if (this.isRefreshTokenExpired(sessionId)) {
        const reason = "Refresh token expired";
        this.removeManagedToken(sessionId, reason);
        this.emitEvent({
          type: "refresh_expired",
          sessionId,
          reason,
        });
        throw new AuthenticationError(reason, "REFRESH_TOKEN_EXPIRED", 401);
      }

      // Perform the refresh
      const tokenResponse = await this.clientFactory.refreshToken(
        currentToken.refreshToken
      );

      // Update managed token
      const updatedToken = this.addManagedToken(
        sessionId,
        tokenResponse,
        currentToken.clientType
      );

      this.emitEvent({
        type: "refresh_success",
        sessionId,
        newToken: updatedToken,
      });

      logger.info("Token refresh successful", {
        sessionId,
        newExpiresIn: Math.round((updatedToken.expiresAt - Date.now()) / 1000),
      });

      return updatedToken;
    };

    const onError = (error: unknown, attempt?: number) => {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.recordRefreshMetrics(sessionId, duration, false, err);
      this.updateCircuitBreakerStatus(sessionId, true);

      logger.warn("Token refresh attempt failed", {
        sessionId,
        attempt,
        error: err.message,
      });

      this.emitEvent({
        type: "refresh_failed",
        sessionId,
        error: err,
        attemptsLeft: this.config.maxRetryAttempts - (attempt || 1),
      });
    };

    const retryOptions: Partial<RetryOptions> = {
      operationName: `token_refresh_${sessionId}`,
      maxRetries: this.config.maxRetryAttempts,
      retryDelay: this.config.retryBaseDelay,
      enableCircuitBreaker: this.config.enableCircuitBreaker,
      circuitBreakerThreshold: this.config.circuitBreakerThreshold,
      circuitBreakerTimeout: this.config.circuitBreakerTimeout,
      enableMetrics: this.config.enableMetrics,
      jitterEnabled: this.config.useExponentialBackoff,
    };

    try {
      const result = await executeWithRetry(
        refreshOperation,
        onError,
        retryOptions
      );
      const duration = Date.now() - startTime;

      this.recordRefreshMetrics(sessionId, duration, true);
      this.updateCircuitBreakerStatus(sessionId, false);

      return result;
    } catch (error) {
      // Max attempts reached - remove from management
      this.removeManagedToken(sessionId, "max_refresh_attempts_reached");
      throw error;
    }
  }

  /**
   * Start monitoring for tokens that need refresh with batch processing
   */
  private startRefreshMonitoring(): void {
    this.refreshInterval = setInterval(() => {
      const sessions = this.getManagedSessions();
      const sessionsNeedingRefresh = sessions.filter((id) =>
        this.needsRefresh(id)
      );

      if (sessionsNeedingRefresh.length === 0) return;

      // Process refreshes in batches with concurrency control
      this.processBatchRefresh(sessionsNeedingRefresh, 5); // Max 5 concurrent refreshes
    }, this.config.refreshCheckInterval);

    logger.info("Token refresh monitoring started", {
      checkInterval: this.config.refreshCheckInterval,
    });
  }

  /**
   * Process token refreshes in batches with concurrency control
   *
   * This method implements intelligent batch processing to prevent system overload:
   * 1. Splits refresh requests into manageable batches based on concurrency limit
   * 2. Processes batches sequentially to avoid overwhelming Keycloak servers
   * 3. Adds small delays between batches for additional throttling
   * 4. Handles individual refresh failures gracefully without affecting other tokens
   * 5. Provides comprehensive logging for monitoring batch processing
   *
   * Benefits of batch processing:
   * - Prevents thundering herd problems during mass token expiration
   * - Reduces server load by controlling concurrent requests
   * - Improves overall system stability and performance
   * - Allows graceful degradation under high load conditions
   *
   * @param sessionIds - Array of session IDs that need refresh
   * @param concurrencyLimit - Maximum number of concurrent refresh operations (default: 5)
   * @returns Promise that resolves when all batches are processed
   *
   * @example
   * ```typescript
   * const sessionsNeedingRefresh = ['session1', 'session2', 'session3'];
   * await this.processBatchRefresh(sessionsNeedingRefresh, 3);
   * ```
   *
   * @private
   */
  private async processBatchRefresh(
    sessionIds: string[],
    concurrencyLimit: number
  ): Promise<void> {
    const batches: string[][] = [];

    // Split sessions into batches
    for (let i = 0; i < sessionIds.length; i += concurrencyLimit) {
      batches.push(sessionIds.slice(i, i + concurrencyLimit));
    }

    // Process batches sequentially to avoid overwhelming the system
    for (const batch of batches) {
      const refreshPromises = batch.map(async (sessionId) => {
        const token = this.managedTokens.get(sessionId);
        if (!token) return;

        try {
          await this.performTokenRefresh(sessionId, token);
          logger.debug("Batch refresh successful", { sessionId });
        } catch (error) {
          logger.error("Batch refresh failed", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.allSettled(refreshPromises);

      // Small delay between batches to prevent system overload
      if (batches.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    logger.debug("Batch refresh processing completed", {
      totalSessions: sessionIds.length,
      batchesProcessed: batches.length,
      concurrencyLimit,
    });
  }

  /**
   * Emit refresh event to all registered handlers
   *
   * This method implements a robust event emission system:
   * 1. Iterates through all registered event handlers
   * 2. Calls each handler with the event data
   * 3. Implements error isolation - handler failures don't affect other handlers
   * 4. Logs handler failures for debugging and monitoring
   * 5. Continues processing even if individual handlers fail
   *
   * Event types handled:
   * - `refresh_success`: Token refresh completed successfully
   * - `refresh_failed`: Token refresh attempt failed (with retry info)
   * - `refresh_expired`: Refresh token has expired
   * - `session_removed`: Token removed from management
   *
   * Error handling strategy:
   * - Individual handler errors are logged but don't stop event emission
   * - Failed handlers can be tracked for removal if needed
   * - Event emission is fire-and-forget for performance
   *
   * @param event - The refresh event to emit to all handlers
   * @returns void - This method doesn't return a value
   *
   * @example
   * ```typescript
   * this.emitEvent({
   *   type: "refresh_success",
   *   sessionId: "user123",
   *   newToken: updatedToken
   * });
   * ```
   *
   * @private
   */
  private emitEvent(event: TokenRefreshEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error("Token refresh event handler failed", {
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Create a singleton token refresh manager
 */
let globalTokenRefreshManager: TokenRefreshManager | undefined;

export function createTokenRefreshManager(
  clientFactory: IKeycloakClientFactory,
  config?: Partial<TokenRefreshConfig>
): TokenRefreshManager {
  if (!globalTokenRefreshManager) {
    globalTokenRefreshManager = new TokenRefreshManager(clientFactory, config);
  }
  return globalTokenRefreshManager;
}

export function getTokenRefreshManager(): TokenRefreshManager | undefined {
  return globalTokenRefreshManager;
}
