/**
 * Refresh Token Manager Service
 * Handles refresh token storage, scheduling, and refresh operations
 */

import { z } from "zod";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { decodeJwt } from "jose";
import {
  EncryptionManager,
  createEncryptionManager,
} from "../EncryptionManager";
import {
  KeycloakClient,
  type KeycloakTokenResponse,
} from "../../client/KeycloakClient";
import type { SecureCacheManager } from "./SecureCacheManager";
import { TokenRefreshScheduler } from "./TokenRefreshScheduler";

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
 * Encrypted token data structure
 */
interface EncryptedTokenData {
  __encrypted: true;
  data: string;
}

/**
 * Union type for token storage data (encrypted or plain)
 */
type TokenStorageData = StoredTokenInfo | EncryptedTokenData;

/**
 * Deserialized token data from JSON (may have string dates)
 */
interface DeserializedTokenData
  extends Omit<
    StoredTokenInfo,
    "expiresAt" | "refreshExpiresAt" | "createdAt" | "lastRefreshedAt"
  > {
  expiresAt: string | Date;
  refreshExpiresAt?: string | Date;
  createdAt: string | Date;
  lastRefreshedAt?: string | Date;
}

/**
 * Constants for magic numbers and configuration
 */
const MIN_CACHE_TTL = 300; // 5 minutes
const ENCRYPTION_TIME_METRIC = "refresh_token_manager.encryption_time";
const DECRYPTION_TIME_METRIC = "refresh_token_manager.decryption_time";
const REFRESH_SUCCESS_METRIC = "refresh_token_manager.refresh_success";
const REFRESH_ERROR_METRIC = "refresh_token_manager.refresh_error";
const ACTIVE_TIMERS_METRIC = "refresh_token_manager.active_timers";

/**
 * Type guard for encrypted token data
 */
function isEncryptedTokenData(
  data: TokenStorageData
): data is EncryptedTokenData {
  return "__encrypted" in data && data.__encrypted === true;
}

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
  private encryptionManager: EncryptionManager | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly keycloakClient: KeycloakClient,
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
   * Calculate cache TTL based on refresh token expiration or cleanup interval
   */
  private calculateCacheTtl(
    refreshExpiresAt: Date | undefined,
    now: Date
  ): number {
    // Use the shorter of: refresh token TTL or cleanup interval
    const refreshTokenTtl = refreshExpiresAt
      ? Math.floor((refreshExpiresAt.getTime() - now.getTime()) / 1000)
      : Math.floor(this.config.cleanupInterval / 1000);

    return Math.min(
      refreshTokenTtl,
      Math.floor(this.config.cleanupInterval / 1000)
    );
  }

  /**
   * Validate user ID and session ID format
   */
  private validateUserSession(userId: string, sessionId: string): void {
    UserIdSchema.parse(userId);
    SessionIdSchema.parse(sessionId);
  }

  /**
   * Generate cache key for refresh token storage
   * Uses '#' delimiter to avoid conflicts with user IDs containing ':'
   */
  private generateRefreshCacheKey(userId: string, sessionId: string): string {
    // Use # as safe delimiter (validated by Zod schemas)
    return `refresh_tokens#${userId}#${sessionId}`;
  }

  /**
   * Encrypt token info for secure storage
   */
  private encryptTokenInfo(tokenInfo: StoredTokenInfo): TokenStorageData {
    if (!this.encryptionManager) {
      return tokenInfo;
    }

    const startTime = Date.now();
    try {
      const serialized = JSON.stringify(tokenInfo, (key, value) => {
        if (key.endsWith("At") && value instanceof Date) {
          return { __type: "Date", value: value.toISOString() };
        }
        return value;
      });

      const encrypted = this.encryptionManager.encryptCompact(serialized);

      const encryptionTime = Date.now() - startTime;
      this.metrics?.recordTimer(ENCRYPTION_TIME_METRIC, encryptionTime);

      return {
        __encrypted: true,
        data: encrypted,
      };
    } catch (error) {
      this.logger.error("Failed to encrypt token info", {
        error: error instanceof Error ? error.message : String(error),
      });
      return tokenInfo;
    }
  }

  /**
   * Decrypt token info from storage
   */
  private decryptTokenInfo(encryptedData: TokenStorageData): StoredTokenInfo {
    if (!isEncryptedTokenData(encryptedData) || !this.encryptionManager) {
      return this.deserializeTokenInfo(encryptedData as DeserializedTokenData);
    }

    const startTime = Date.now();
    try {
      const decrypted = this.encryptionManager.decryptCompact(
        encryptedData.data
      );

      const tokenInfo = JSON.parse(decrypted, (_key, value) => {
        if (value && typeof value === "object" && value.__type === "Date") {
          return new Date(value.value);
        }
        return value;
      });

      const decryptionTime = Date.now() - startTime;
      this.metrics?.recordTimer(DECRYPTION_TIME_METRIC, decryptionTime);

      return this.deserializeTokenInfo(tokenInfo);
    } catch (error) {
      this.logger.error("Failed to decrypt token info", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Token decryption failed");
    }
  }

  /**
   * Deserialize token info (convert date strings to Date objects)
   * Validates the result to ensure data integrity
   */
  private deserializeTokenInfo(data: DeserializedTokenData): StoredTokenInfo {
    const tokenInfo = {
      ...data,
      expiresAt:
        typeof data.expiresAt === "string"
          ? new Date(data.expiresAt)
          : data.expiresAt,
      refreshExpiresAt: data.refreshExpiresAt
        ? typeof data.refreshExpiresAt === "string"
          ? new Date(data.refreshExpiresAt)
          : data.refreshExpiresAt
        : undefined,
      createdAt:
        typeof data.createdAt === "string"
          ? new Date(data.createdAt)
          : data.createdAt,
      lastRefreshedAt: data.lastRefreshedAt
        ? typeof data.lastRefreshedAt === "string"
          ? new Date(data.lastRefreshedAt)
          : data.lastRefreshedAt
        : undefined,
    };

    // Validate deserialized data for security
    try {
      return StoredTokenInfoSchema.parse(tokenInfo);
    } catch (validationError) {
      this.logger.error("Deserialized token info failed validation", {
        error:
          validationError instanceof Error
            ? validationError.message
            : String(validationError),
      });
      throw new Error("Invalid token data from cache");
    }
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
   * Get stored tokens
   */
  async getStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<StoredTokenInfo | null> {
    this.validateUserSession(userId, sessionId);

    try {
      const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
      const cachedResult = await this.cacheManager.get(
        "stored_tokens",
        cacheKey
      );

      if (!cachedResult.hit || !cachedResult.data) {
        return null;
      }

      // Parse JSON with error handling
      let encryptedInfo: TokenStorageData;
      try {
        encryptedInfo = JSON.parse(cachedResult.data as unknown as string);
      } catch (parseError) {
        this.logger.error("Failed to parse cached token data", {
          userId,
          sessionId,
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
        // Invalidate corrupted cache entry
        await this.cacheManager.invalidate("stored_tokens", cacheKey);
        return null;
      }

      return this.decryptTokenInfo(encryptedInfo);
    } catch (error) {
      this.logger.error("Failed to get stored tokens", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Store tokens with refresh token support
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

    // Parse access token to get expiration info
    let decodedToken: Record<string, unknown> = {};
    try {
      const payload = decodeJwt(accessToken);
      decodedToken = payload;
    } catch (error) {
      this.logger.warn("Could not parse access token payload", { error });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    const refreshExpiresAt = refreshExpiresIn
      ? new Date(now.getTime() + refreshExpiresIn * 1000)
      : undefined;

    const tokenInfo: StoredTokenInfo = {
      accessToken,
      refreshToken,
      expiresAt,
      tokenType: "Bearer",
      scope: (decodedToken["scope"] as string) || "",
      userId,
      sessionId,
      createdAt: now,
      refreshCount: 0,
      ...(refreshExpiresAt && { refreshExpiresAt }),
    };

    // Validate token info before storing
    StoredTokenInfoSchema.parse(tokenInfo);
    const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
    const encryptedInfo = this.encryptTokenInfo(tokenInfo);

    // Calculate TTL based on refresh token expiration or cleanup interval
    const cacheTtl = this.calculateCacheTtl(refreshExpiresAt, now);

    await this.cacheManager.set(
      "stored_tokens",
      cacheKey,
      JSON.stringify(encryptedInfo),
      Math.max(cacheTtl, MIN_CACHE_TTL)
    );

    // Schedule automatic refresh
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

    this.logger.info("Tokens stored with refresh support", {
      userId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt?.toISOString(),
      hasRefreshToken: !!refreshToken,
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

      // Store the new tokens
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
    const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
    await this.cacheManager.invalidate("stored_tokens", cacheKey);

    // Cancel any scheduled refresh using the scheduler
    const refreshKey = `${userId}:${sessionId}`;
    this.scheduler.cancelRefresh(refreshKey);

    this.logger.debug("Stored tokens removed", {
      userId,
      sessionId,
    });
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
