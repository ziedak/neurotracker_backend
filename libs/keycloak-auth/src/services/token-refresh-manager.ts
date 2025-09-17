/**
 * Token Refresh Manager
 * Provides automatic token refresh capabilities for long-lived sessions
 * and WebSocket connections with proper error handling and retry logic
 */

import { createLogger } from "@libs/utils";
import { TokenResponse, AuthenticationError, ClientType } from "../types";
import type { IKeycloakClientFactory } from "../types";

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
 * Token refresh configuration
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

  constructor(
    clientFactory: IKeycloakClientFactory,
    config: Partial<TokenRefreshConfig> = {}
  ) {
    this.clientFactory = clientFactory;
    this.config = { ...DEFAULT_REFRESH_CONFIG, ...config };
    this.startRefreshMonitoring();
  }

  /**
   * Add a token to be managed for automatic refresh
   */
  public addManagedToken(
    sessionId: string,
    tokenResponse: TokenResponse,
    clientType: ClientType = "frontend"
  ): ManagedToken {
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
   * Add event handler
   */
  public onRefreshEvent(handler: TokenRefreshEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event handler
   */
  public removeRefreshEventHandler(handler: TokenRefreshEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
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

    logger.info("Token refresh manager disposed");
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
   * Perform token refresh with retry logic
   */
  private async performTokenRefresh(
    sessionId: string,
    currentToken: ManagedToken,
    attempt = 1
  ): Promise<ManagedToken> {
    try {
      logger.debug("Attempting token refresh", { sessionId, attempt });

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
        attempt,
        newExpiresIn: Math.round((updatedToken.expiresAt - Date.now()) / 1000),
      });

      return updatedToken;
    } catch (error) {
      const attemptsLeft = this.config.maxRetryAttempts - attempt;

      logger.warn("Token refresh attempt failed", {
        sessionId,
        attempt,
        attemptsLeft,
        error: error instanceof Error ? error.message : String(error),
      });

      this.emitEvent({
        type: "refresh_failed",
        sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
        attemptsLeft,
      });

      if (attemptsLeft > 0) {
        // Calculate retry delay
        let delay = this.config.retryBaseDelay;
        if (this.config.useExponentialBackoff) {
          delay *= Math.pow(2, attempt - 1);
        }
        delay = Math.min(delay, this.config.maxRetryDelay);

        logger.debug("Retrying token refresh", { sessionId, delay });

        // Schedule retry
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.performTokenRefresh(sessionId, currentToken, attempt + 1);
      }

      // Max attempts reached - remove from management
      this.removeManagedToken(sessionId, "max_refresh_attempts_reached");
      throw error;
    }
  }

  /**
   * Start monitoring for tokens that need refresh
   */
  private startRefreshMonitoring(): void {
    this.refreshInterval = setInterval(() => {
      const sessions = this.getManagedSessions();

      for (const sessionId of sessions) {
        if (this.needsRefresh(sessionId)) {
          const token = this.managedTokens.get(sessionId);
          if (token) {
            this.performTokenRefresh(sessionId, token).catch((error) => {
              logger.error("Monitoring refresh failed", {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        }
      }
    }, this.config.refreshCheckInterval);

    logger.info("Token refresh monitoring started", {
      checkInterval: this.config.refreshCheckInterval,
    });
  }

  /**
   * Emit refresh event to all handlers
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
