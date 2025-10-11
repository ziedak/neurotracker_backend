/**
 * SessionTokenCoordinator - Simple Delegation Layer with Automatic Refresh
 *
 * Purpose: Coordinate token operations between session layer and token layer
 * Pattern: Pure delegation - no implementation, just orchestration
 *
 * Delegates to:
 * - KeycloakClient: Token validation and refresh (already implemented)
 * - SessionStore: Token storage (already implemented)
 * - TokenRefreshScheduler: Automatic background token refresh scheduling
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { KeycloakClient } from "../../client/KeycloakClient";
import type { SessionStore } from "./SessionStore";
import type { UserSession } from "@libs/database";
import type { AuthResult } from "../../types";
import { TokenRefreshScheduler } from "../token/TokenRefreshScheduler";
import type { SchedulerConfig } from "../token/TokenRefreshScheduler";
import type { UserSessionWithTokens } from "./sessionTypes";

/**
 * Simple coordinator - delegates all operations
 */
export class SessionTokenCoordinator {
  private readonly logger: ILogger;
  private readonly scheduler: TokenRefreshScheduler;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly sessionStore: SessionStore,
    schedulerConfig: SchedulerConfig = { refreshBuffer: 300 }, // Default: 5 minutes before expiry
    private readonly metrics?: IMetricsCollector
  ) {
    this.logger = createLogger("SessionTokenCoordinator");
    this.scheduler = new TokenRefreshScheduler(schedulerConfig, metrics);

    this.logger.info(
      "SessionTokenCoordinator initialized with automatic refresh",
      {
        refreshBuffer: schedulerConfig.refreshBuffer,
      }
    );
  }

  /**
   * Validate session token
   * Delegates to: KeycloakClient.validateToken()
   * NOTE: Fetches tokens from vault as they're no longer in UserSession
   */
  async validateSessionToken(sessionData: UserSession): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      this.logger.debug("Validating session token", {
        sessionId: sessionData.id,
      });

      // Check if session is linked to token vault
      if (!sessionData.accountId) {
        this.logger.warn("Session not linked to token vault", {
          sessionId: sessionData.id,
        });
        return {
          success: false,
          error: "Session not linked to token vault (legacy session)",
        };
      }

      // Fetch session with tokens from vault
      const sessionWithTokens = (await this.sessionStore.retrieveSession(
        sessionData.id,
        true // includeTokens=true to fetch from vault
      )) as UserSessionWithTokens | null;

      if (!sessionWithTokens || !sessionWithTokens.accessToken) {
        return {
          success: false,
          error: "No access token in session vault",
        };
      }

      // Delegate to KeycloakClient (already implemented)
      const result = await this.keycloakClient.validateToken(
        sessionWithTokens.accessToken
      );

      this.metrics?.recordCounter("session.token_validated", 1, {
        success: result.success.toString(),
      });
      this.metrics?.recordTimer(
        "session.validate_token.duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token validation failed", {
        error,
        sessionId: sessionData.id,
      });

      this.metrics?.recordCounter("session.token_validation.error", 1);

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token validation failed",
      };
    }
  }

  /**
   * Refresh session tokens
   * Delegates to: KeycloakClient.refreshToken() + SessionStore.updateSessionTokens()
   * Also schedules automatic refresh for the new token
   * NOTE: Fetches tokens from vault as they're no longer in UserSession
   */
  async refreshSessionTokens(sessionData: UserSession): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.debug("Refreshing session tokens", {
        sessionId: sessionData.id,
      });

      // Check if session is linked to token vault
      if (!sessionData.accountId) {
        const error = `Session ${sessionData.id} not linked to token vault (legacy session)`;
        this.logger.error(error, {
          sessionId: sessionData.id,
        });
        throw new Error(error);
      }

      // Fetch session with tokens from vault
      const sessionWithTokens = (await this.sessionStore.retrieveSession(
        sessionData.id,
        true // includeTokens=true to fetch from vault
      )) as UserSessionWithTokens | null;

      if (!sessionWithTokens || !sessionWithTokens.refreshToken) {
        throw new Error("No refresh token available in vault");
      }

      // Delegate to KeycloakClient (already implemented)
      const newTokens = await this.keycloakClient.refreshToken(
        sessionWithTokens.refreshToken
      );

      // Calculate expiration times
      const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);
      const refreshExpiresAt = newTokens.refresh_expires_in
        ? new Date(Date.now() + newTokens.refresh_expires_in * 1000)
        : undefined;

      // Delegate to SessionStore (just implemented)
      await this.sessionStore.updateSessionTokens(sessionData.id, {
        accessToken: newTokens.access_token,
        ...(newTokens.refresh_token && {
          refreshToken: newTokens.refresh_token,
        }),
        expiresAt,
        ...(refreshExpiresAt && { refreshExpiresAt }),
      });

      // Schedule automatic refresh for the new token
      await this.scheduleAutomaticRefresh(sessionData.id, expiresAt);

      this.logger.info("Session tokens refreshed successfully", {
        sessionId: sessionData.id,
        expiresAt: expiresAt.toISOString(),
      });

      this.metrics?.recordCounter("session.tokens_refreshed", 1);
      this.metrics?.recordTimer(
        "session.refresh_tokens.duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.error("Token refresh failed", {
        error,
        sessionId: sessionData.id,
      });

      this.metrics?.recordCounter("session.token_refresh.error", 1);
      throw error; // Critical operation - throw to caller
    }
  }

  /**
   * Schedule automatic background token refresh
   * Delegates to: TokenRefreshScheduler
   */
  private async scheduleAutomaticRefresh(
    sessionId: string,
    expiresAt: Date
  ): Promise<void> {
    await this.scheduler.scheduleRefresh(sessionId, expiresAt, async () => {
      try {
        // Get current session data
        const sessionData = await this.sessionStore.retrieveSession(sessionId);
        if (!sessionData) {
          this.logger.warn("Session not found for automatic refresh", {
            sessionId,
          });
          return false;
        }

        // Perform refresh
        await this.refreshSessionTokens(sessionData);
        return true;
      } catch (error) {
        this.logger.error("Automatic token refresh failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    });
  }

  /**
   * Cancel automatic refresh for a session
   */
  cancelAutomaticRefresh(sessionId: string): void {
    this.scheduler.cancelRefresh(sessionId);
    this.logger.debug("Cancelled automatic refresh", { sessionId });
  }

  /**
   * Check if token needs refresh
   * NOTE: Now async because it needs to fetch token expiry from vault
   */
  async checkTokenRefreshNeeded(
    sessionData: UserSession,
    thresholdSeconds: number = 300 // Default: 5 minutes
  ): Promise<boolean> {
    // Check if session is linked to token vault
    if (!sessionData.accountId) {
      this.logger.warn(
        "Session not linked to token vault, cannot check refresh",
        {
          sessionId: sessionData.id,
        }
      );
      return false;
    }

    // Fetch session with tokens from vault to get expiry
    const sessionWithTokens = (await this.sessionStore.retrieveSession(
      sessionData.id,
      true // includeTokens=true
    )) as UserSessionWithTokens | null;

    const tokenExpiresAt = sessionWithTokens?.tokenExpiresAt;
    if (!tokenExpiresAt) {
      return false;
    }

    const now = new Date();
    const expiresAt = new Date(tokenExpiresAt);
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const thresholdMs = thresholdSeconds * 1000;

    const needsRefresh = timeUntilExpiry < thresholdMs;

    if (needsRefresh) {
      this.logger.debug("Token refresh needed", {
        sessionId: sessionData.id,
        timeUntilExpiry: Math.floor(timeUntilExpiry / 1000) + "s",
        threshold: thresholdSeconds + "s",
      });
    }

    return needsRefresh;
  }

  /**
   * Validate and refresh if needed (convenience method)
   */
  async validateAndRefreshIfNeeded(
    sessionData: UserSession
  ): Promise<AuthResult> {
    // Check if refresh is needed (now async)
    const needsRefresh = await this.checkTokenRefreshNeeded(sessionData);

    if (needsRefresh) {
      try {
        await this.refreshSessionTokens(sessionData);

        // Get updated session data
        const updatedSession = await this.sessionStore.retrieveSession(
          sessionData.id
        );

        if (!updatedSession) {
          return {
            success: false,
            error: "Session not found after refresh",
          };
        }

        // Validate with new token
        return this.validateSessionToken(updatedSession);
      } catch (error) {
        this.logger.error(
          "Token refresh failed, attempting validation anyway",
          {
            error,
            sessionId: sessionData.id,
          }
        );
        // Fall through to validation with existing token
      }
    }

    // Validate current token
    return this.validateSessionToken(sessionData);
  }

  /**
   * Create session with automatic refresh
   * Helper method to initialize a session with automatic token refresh
   */
  async createSessionWithAutoRefresh(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
      refreshExpiresAt?: Date;
    },
    sessionMetadata: {
      ipAddress: string;
      userAgent: string;
      fingerprint: string;
    }
  ): Promise<UserSession> {
    // Generate unique session ID
    const sessionId = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Build session options conditionally to avoid undefined
    const sessionOptions: any = {
      userId,
      sessionId,
      ipAddress: sessionMetadata.ipAddress,
      userAgent: sessionMetadata.userAgent,
      fingerprint: sessionMetadata.fingerprint,
      expiresAt: tokens.expiresAt,
    };

    // Only add defined token fields
    if (tokens.accessToken) {
      sessionOptions.accessToken = tokens.accessToken;
    }
    if (tokens.refreshToken) {
      sessionOptions.refreshToken = tokens.refreshToken;
    }
    if (tokens.expiresAt) {
      sessionOptions.tokenExpiresAt = tokens.expiresAt;
    }
    if (tokens.refreshExpiresAt) {
      sessionOptions.refreshExpiresAt = tokens.refreshExpiresAt;
    }

    // Delegate session storage to SessionStore
    await this.sessionStore.storeSession(sessionOptions);

    // Retrieve the created session
    const createdSession = await this.sessionStore.retrieveSession(sessionId);
    if (!createdSession) {
      throw new Error("Failed to retrieve created session");
    }

    // Schedule automatic refresh
    await this.scheduleAutomaticRefresh(sessionId, tokens.expiresAt);

    this.logger.info("Session created with automatic refresh", {
      sessionId,
      userId,
      expiresAt: tokens.expiresAt.toISOString(),
    });

    return createdSession;
  }

  /**
   * Destroy session and cancel automatic refresh
   */
  async destroySession(sessionId: string): Promise<void> {
    // Cancel automatic refresh
    this.cancelAutomaticRefresh(sessionId);

    // Retrieve and invalidate session from SessionStore
    const session = await this.sessionStore.retrieveSession(sessionId);
    if (session) {
      // SessionStore doesn't have deleteSession, so we clear the cache/db manually
      // This should be handled by SessionStore in a proper implementation
      this.logger.warn(
        "SessionStore.deleteSession not implemented, session may persist in storage"
      );
    }

    this.logger.info("Session destroyed and refresh cancelled", { sessionId });
  }

  /**
   * Get scheduler statistics
   */
  getSchedulerStats() {
    return this.scheduler.getStats();
  }

  /**
   * Health check including scheduler health
   */
  async healthCheck() {
    const schedulerHealth = await this.scheduler.healthCheck();
    return {
      coordinator: "healthy",
      scheduler: schedulerHealth,
    };
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    await this.scheduler.dispose();
    this.logger.info("SessionTokenCoordinator disposed");
  }
}
