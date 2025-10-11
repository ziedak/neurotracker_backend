/**
 * Refresh Token Manager Service
 * Handles refresh token storage, scheduling, and refresh operations
 */

import { z } from "zod";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import {
  EncryptionManager,
  createEncryptionManager,
} from "../EncryptionManager";
import {
  KeycloakClient,
  type KeycloakTokenResponse,
} from "../../client/KeycloakClient";
import type { SecureCacheManager } from "../SecureCacheManager";
import { TokenRefreshScheduler } from "./TokenRefreshScheduler";
import { AccountService } from "../account/AccountService";
import type { SessionStore } from "../session/SessionStore";

/**
 * Zod schemas for validation
 */
const UserIdSchema = z
  .string()
  .min(1, "User ID must be a non-empty string")
  .max(255, "User ID too long");

const SessionIdSchema = z
  .string()
  .min(1, "Session ID must be a non-empty string")
  .max(255, "Session ID too long");

const StoredTokenInfoSchema = z.object({
  accessToken: z.string().min(1, "Access token must be a non-empty string"),
  refreshToken: z.string().min(1, "Refresh token must be a non-empty string"),
  expiresAt: z.date(),
  refreshExpiresAt: z.date().optional(),
  tokenType: z.string().min(1, "Token type must be a non-empty string"),
  scope: z.string(),
  userId: UserIdSchema,
  sessionId: SessionIdSchema,
  createdAt: z.date(),
  lastRefreshedAt: z.date().optional(),
  refreshCount: z.number().int().min(0, "Refresh count must be non-negative"),
});

const RefreshTokenConfigSchema = z.object({
  refreshBuffer: z.number().int().min(0, "Refresh buffer must be non-negative"),
  enableEncryption: z.boolean(),
  encryptionKey: z.string().optional(),
  cleanupInterval: z
    .number()
    .int()
    .min(1000, "Cleanup interval must be at least 1000ms"),
});

const TokenRefreshParamsSchema = z.object({
  userId: UserIdSchema,
  sessionId: SessionIdSchema,
  accessToken: z.string().min(1, "Access token must be a non-empty string"),
  refreshToken: z.string().min(1, "Refresh token must be a non-empty string"),
  expiresIn: z.number().int().min(1, "Expires in must be positive"),
  refreshExpiresIn: z
    .number()
    .int()
    .min(1, "Refresh expires in must be positive")
    .optional(),
});

/**
 * Type definitions for better type safety
 */
export type UserId = z.infer<typeof UserIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type StoredTokenInfo = z.infer<typeof StoredTokenInfoSchema>;
export type RefreshTokenConfig = z.infer<typeof RefreshTokenConfigSchema>;
export type TokenRefreshParams = z.infer<typeof TokenRefreshParamsSchema>;

/**
 * Constants for magic numbers and configuration
 */
const REFRESH_SUCCESS_METRIC = "refresh_token_manager.refresh_success";
const REFRESH_ERROR_METRIC = "refresh_token_manager.refresh_error";
const ACTIVE_TIMERS_METRIC = "refresh_token_manager.active_timers";

/**
 * Refresh Result
 */
export interface RefreshResult {
  success: boolean;
  tokens?: KeycloakTokenResponse;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  userId: UserId;
  sessionId: SessionId;
  timestamp: Date;
  error?: string;
}

/**
 * Token Refresh Event
 */
export interface TokenRefreshEvent {
  type?: string;
  userId: UserId;
  sessionId: SessionId;
  timestamp: Date;
  success: boolean;
  oldAccessToken?: string;
  newTokens?: KeycloakTokenResponse;
  metadata?: {
    expiresAt?: string;
    refreshExpiresAt?: string;
  };
}

/**
 * Token Expiry Event
 */
export interface TokenExpiryEvent {
  userId: UserId;
  sessionId: SessionId;
  accessToken: string;
  reason: "expired" | "refresh_failed" | "refresh_token_expired";
  timestamp: Date;
}

/**
 * Event Handlers for refresh token operations
 */
export interface RefreshTokenEventHandlers {
  onTokenStored?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenRefreshed?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenExpired?: (event: TokenExpiryEvent) => Promise<void>;
  onRefreshFailed?: (
    userId: UserId,
    sessionId: SessionId,
    error: string
  ) => Promise<void>;
}

/**
 * Statistics for refresh token manager
 */
export interface RefreshTokenStats {
  enabled: boolean;
  config: RefreshTokenConfig;
  activeTimers: number;
  cleanupEnabled: boolean;
  scheduledRefreshes: string[];
}

export class RefreshTokenManager {
  private readonly logger = createLogger("RefreshTokenManager");
  private readonly scheduler: TokenRefreshScheduler;
  private readonly accountService: AccountService;
  private encryptionManager: EncryptionManager | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly sessionStore: SessionStore,
    private readonly cacheManager: SecureCacheManager,
    private readonly config: RefreshTokenConfig,
    private readonly eventHandlers: RefreshTokenEventHandlers = {},
    private readonly metrics?: IMetricsCollector
  ) {
    // Validate configuration
    RefreshTokenConfigSchema.parse(config);
    this.validateConfiguration();

    // Initialize token refresh scheduler
    this.scheduler = new TokenRefreshScheduler(
      { refreshBuffer: config.refreshBuffer },
      metrics
    );

    // Initialize AccountService for token vault operations
    this.accountService = (sessionStore as any).accountService;
    if (!this.accountService) {
      throw new Error(
        "SessionStore must have AccountService for token vault operations"
      );
    }

    // Initialize encryption manager if enabled
    if (config.enableEncryption) {
      this.encryptionManager = createEncryptionManager(config.encryptionKey);
    }
  }

  /**
   * Validate configuration constraints
   */
  private validateConfiguration(): void {
    if (this.config.refreshBuffer > this.config.cleanupInterval) {
      throw new Error("Refresh buffer cannot exceed cleanup interval");
    }
    if (this.config.refreshBuffer < 0) {
      throw new Error("Refresh buffer must be non-negative");
    }
  }

  /**
   * Validate user ID and session ID format
   */
  private validateUserSession(userId: string, sessionId: string): void {
    UserIdSchema.parse(userId);
    SessionIdSchema.parse(sessionId);
  }

  /**
   * Schedule automatic token refresh using the scheduler
   */
  private async scheduleTokenRefresh(
    userId: string,
    sessionId: string,
    expiresAt: Date
  ): Promise<void> {
    const key = `${userId}:${sessionId}`;

    await this.scheduler.scheduleRefresh(key, expiresAt, async () => {
      try {
        const result = await this.refreshUserTokens(userId, sessionId);
        return result.success;
      } catch (error) {
        this.logger.error("Refresh callback failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    });
  }

  /**
   * Get stored tokens from vault via SessionStore
   */
  async getStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<StoredTokenInfo | null> {
    this.validateUserSession(userId, sessionId);

    try {
      // Fetch session with tokens from vault (includeTokens=true)
      const session = await this.sessionStore.retrieveSession(sessionId, true);

      if (!session || session.userId !== userId) {
        this.logger.warn("Session not found or user mismatch", {
          userId,
          sessionId,
        });
        return null;
      }

      // Extract token info from session (tokens attached from vault)
      const accessToken = (session as any).accessToken;
      const refreshToken = (session as any).refreshToken;
      const expiresAt = (session as any).tokenExpiresAt;
      const refreshExpiresAt = (session as any).refreshTokenExpiresAt;

      if (!accessToken || !refreshToken) {
        this.logger.warn("No tokens found in session", { userId, sessionId });
        return null;
      }

      return {
        accessToken,
        refreshToken,
        expiresAt: expiresAt || new Date(Date.now() + 3600000), // Default 1 hour
        refreshExpiresAt,
        tokenType: "Bearer",
        scope: "",
        userId,
        sessionId,
        createdAt: session.createdAt,
        refreshCount: 0, // Could track separately if needed
      };
    } catch (error) {
      this.logger.error("Failed to get stored tokens from vault", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Store tokens with refresh token support
   * Note: Tokens are now stored in Account vault by SessionStore
   * This method only schedules automatic refresh
   */
  async storeTokensWithRefresh(
    userId: string,
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn?: number
  ): Promise<void> {
    // Validate input parameters
    TokenRefreshParamsSchema.parse({
      userId,
      sessionId,
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    const refreshExpiresAt = refreshExpiresIn
      ? new Date(now.getTime() + refreshExpiresIn * 1000)
      : undefined;

    // Schedule automatic refresh
    // Note: Tokens are stored in vault by SessionStore, not here
    this.scheduleTokenRefresh(userId, sessionId, expiresAt);

    // Emit token stored event
    if (this.eventHandlers?.onTokenStored) {
      const event: TokenRefreshEvent = {
        type: "token_stored",
        userId,
        sessionId,
        timestamp: now,
        success: true,
        metadata: {
          expiresAt: expiresAt.toISOString(),
          ...(refreshExpiresAt && {
            refreshExpiresAt: refreshExpiresAt.toISOString(),
          }),
        },
      };

      try {
        await this.eventHandlers.onTokenStored(event);
      } catch (error) {
        this.logger.error("Token stored event handler failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info("Token refresh scheduled (tokens stored in vault)", {
      userId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt?.toISOString(),
    });
  }

  /**
   * Manually refresh tokens for a user session
   */
  async refreshUserTokens(
    userId: string,
    sessionId: string
  ): Promise<RefreshResult> {
    this.validateUserSession(userId, sessionId);

    const tokenInfo = await this.getStoredTokens(userId, sessionId);
    if (!tokenInfo) {
      return {
        success: false,
        error: "No stored tokens found",
        userId,
        sessionId,
        timestamp: new Date(),
      };
    }

    try {
      // Use KeycloakClient to refresh the token
      const refreshResult = await this.keycloakClient.refreshToken(
        tokenInfo.refreshToken
      );

      if (!refreshResult.access_token) {
        return {
          success: false,
          error: "Token refresh failed",
          userId,
          sessionId,
          timestamp: new Date(),
        };
      }

      // Update tokens in vault via SessionStore
      const now = new Date();
      const updateTokensInput: {
        accessToken: string;
        refreshToken?: string;
        expiresAt: Date;
        refreshExpiresAt?: Date;
      } = {
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token || tokenInfo.refreshToken,
        expiresAt: new Date(now.getTime() + refreshResult.expires_in * 1000),
      };

      if (refreshResult.refresh_expires_in) {
        updateTokensInput.refreshExpiresAt = new Date(
          now.getTime() + refreshResult.refresh_expires_in * 1000
        );
      }

      await this.sessionStore.updateSessionTokens(sessionId, updateTokensInput);

      // Re-schedule automatic refresh with new expiration
      await this.storeTokensWithRefresh(
        userId,
        sessionId,
        refreshResult.access_token,
        refreshResult.refresh_token || tokenInfo.refreshToken,
        refreshResult.expires_in,
        refreshResult.refresh_expires_in
      );

      this.logger.info("Tokens refreshed successfully", {
        userId,
        sessionId,
      });

      this.metrics?.recordCounter(REFRESH_SUCCESS_METRIC, 1);

      return {
        success: true,
        tokens: refreshResult,
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token || tokenInfo.refreshToken,
        expiresIn: refreshResult.expires_in,
        userId,
        sessionId,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Token refresh failed", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.metrics?.recordCounter(REFRESH_ERROR_METRIC, 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Remove stored tokens and cancel automatic refresh
   */
  async removeStoredTokens(userId: string, sessionId: string): Promise<void> {
    try {
      // Get session metadata to find accountId
      const session = await this.sessionStore.retrieveSession(sessionId, false);

      if (session && (session as any).accountId) {
        // Clear tokens from vault
        await this.accountService.clearTokens((session as any).accountId);
      }

      // Cancel any scheduled refresh using the scheduler
      const refreshKey = `${userId}:${sessionId}`;
      this.scheduler.cancelRefresh(refreshKey);

      this.logger.debug("Stored tokens removed from vault", {
        userId,
        sessionId,
      });
    } catch (error) {
      this.logger.error("Failed to remove stored tokens", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if stored tokens exist and are valid
   */
  async hasValidStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    const tokenInfo = await this.getStoredTokens(userId, sessionId);
    if (!tokenInfo) {
      return false;
    }

    const now = new Date();

    // Check if access token is still valid
    if (tokenInfo.expiresAt > now) {
      return true;
    }

    // Check if refresh token is still valid
    if (tokenInfo.refreshExpiresAt && tokenInfo.refreshExpiresAt > now) {
      return true;
    }

    return false;
  }

  /**
   * Get refresh token manager statistics
   */
  getRefreshTokenStats() {
    const schedulerStats = this.scheduler.getStats();

    const stats = {
      enabled: true,
      config: this.config,
      activeTimers: schedulerStats.activeTimers,
      cleanupEnabled: !!this.cleanupTimer,
      scheduledRefreshes: schedulerStats.scheduledRefreshes,
    };

    // Record gauge metrics
    this.metrics?.recordGauge(
      ACTIVE_TIMERS_METRIC,
      schedulerStats.activeTimers
    );

    return stats;
  }

  /**
   * Health check for the refresh token manager
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy" | "degraded";
    details: Record<string, unknown>;
  }> {
    const stats = this.getRefreshTokenStats();
    const issues: string[] = [];

    // Check for excessive active timers (potential memory leak)
    if (stats.activeTimers > 1000) {
      issues.push(`Too many active timers: ${stats.activeTimers}`);
    }

    // Note: Locks are now TTL-based, so we don't check for excessive locks
    // TTL automatically prevents accumulation of stale locks

    // Check cleanup is running
    if (!stats.cleanupEnabled) {
      issues.push("Periodic cleanup not running");
    }

    // Check encryption manager health if enabled
    let encryptionHealthy = true;
    if (this.config.enableEncryption && this.encryptionManager) {
      try {
        // Simple encryption test
        const testData = "health_check";
        const encrypted = this.encryptionManager.encryptCompact(testData);
        const decrypted = this.encryptionManager.decryptCompact(encrypted);
        encryptionHealthy = decrypted === testData;
      } catch {
        encryptionHealthy = false;
      }
    }

    if (!encryptionHealthy) {
      issues.push("Encryption manager unhealthy");
    }

    // Determine status
    let status: "healthy" | "unhealthy" | "degraded" = "healthy";
    if (issues.length > 0) {
      status = issues.some(
        (issue) => issue.includes("Too many") || issue.includes("not running")
      )
        ? "unhealthy"
        : "degraded";
    }

    return {
      status,
      details: {
        ...stats,
        issues,
        encryptionHealthy,
        cacheHealth: await this.checkCacheHealth(),
        ttlLockingEnabled: true, // Indicates TTL-based locking is active
      },
    };
  }

  /**
   * Check cache manager health
   */
  private async checkCacheHealth(): Promise<{
    enabled: boolean;
    responsive: boolean;
    error?: string;
  }> {
    try {
      // Simple cache health check
      const testKey = `health_check_${Date.now()}`;
      await this.cacheManager.set("health", testKey, "test_value", 60);
      const result = await this.cacheManager.get("health", testKey);
      await this.cacheManager.invalidate("health", testKey);

      return {
        enabled: true,
        responsive: result.hit === true,
      };
    } catch (error) {
      return {
        enabled: false,
        responsive: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Dispose and cleanup all resources
   * Call this when the application is shutting down
   */
  async dispose(): Promise<void> {
    const schedulerStats = this.scheduler.getStats();

    this.logger.debug("Disposing RefreshTokenManager resources", {
      activeTimers: schedulerStats.activeTimers,
    });

    // Stop periodic cleanup
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Dispose scheduler (handles all timer cleanup)
    await this.scheduler.dispose();

    // Clean up encryption manager if present
    if (this.encryptionManager) {
      this.encryptionManager.destroy();
      this.encryptionManager = undefined;
    }

    this.logger.info("RefreshTokenManager disposed successfully");
  }
}
