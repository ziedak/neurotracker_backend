/**
 * Refresh Token Manager Service
 * Handles refresh token storage, scheduling, and refresh operations
 */

import crypto from "crypto";
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
 * Stored Token Information with refresh support
 */
export interface StoredTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt?: Date;
  tokenType: string;
  scope: string;
  userId: string;
  sessionId: string;
  createdAt: Date;
  lastRefreshedAt?: Date;
  refreshCount: number;
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
  userId: string;
  sessionId: string;
  timestamp: Date;
  error?: string;
}

/**
 * Token Refresh Event
 */
export interface TokenRefreshEvent {
  type?: string;
  userId: string;
  sessionId: string;
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
  userId: string;
  sessionId: string;
  accessToken: string;
  reason: "expired" | "refresh_failed" | "refresh_token_expired";
  timestamp: Date;
}

/**
 * Refresh Token Configuration
 */
export interface RefreshTokenConfig {
  /** Buffer time before token expiration to trigger refresh (seconds) */
  refreshBuffer: number;
  /** Whether to enable secure token encryption in storage */
  enableEncryption: boolean;
  /** Encryption key for token storage (32 bytes) */
  encryptionKey?: string;
  /** Cleanup interval for expired tokens (milliseconds) */
  cleanupInterval: number;
}

/**
 * Event Handlers for refresh token operations
 */
export interface RefreshTokenEventHandlers {
  onTokenStored?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenRefreshed?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenExpired?: (event: TokenExpiryEvent) => Promise<void>;
  onRefreshFailed?: (
    userId: string,
    sessionId: string,
    error: string
  ) => Promise<void>;
}

export class RefreshTokenManager {
  private readonly logger = createLogger("RefreshTokenManager");
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private encryptionManager?: EncryptionManager;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly cacheManager: SecureCacheManager,
    private readonly config: RefreshTokenConfig,
    private readonly eventHandlers: RefreshTokenEventHandlers = {},
    private readonly metrics?: IMetricsCollector
  ) {
    // Validate configuration
    RefreshTokenConfigSchema.parse(config);

    // Initialize encryption manager if enabled
    if (config.enableEncryption) {
      this.encryptionManager = createEncryptionManager(config.encryptionKey);
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
   * Generate cache key for refresh token storage
   */
  private generateRefreshCacheKey(userId: string, sessionId: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${userId}:${sessionId}`)
      .digest("hex");
    return `refresh_tokens:${hash.slice(0, 32)}`;
  }

  /**
   * Encrypt token info for secure storage
   */
  private encryptTokenInfo(tokenInfo: StoredTokenInfo): any {
    if (!this.encryptionManager) {
      return tokenInfo;
    }

    try {
      const serialized = JSON.stringify(tokenInfo, (key, value) => {
        if (key.endsWith("At") && value instanceof Date) {
          return { __type: "Date", value: value.toISOString() };
        }
        return value;
      });

      const encrypted = this.encryptionManager.encryptCompact(serialized);

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
  private decryptTokenInfo(encryptedData: any): StoredTokenInfo {
    if (!encryptedData.__encrypted || !this.encryptionManager) {
      return this.deserializeTokenInfo(encryptedData);
    }

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
   */
  private deserializeTokenInfo(data: any): StoredTokenInfo {
    return {
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
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(
    userId: string,
    sessionId: string,
    expiresAt: Date
  ): void {
    const refreshKey = `${userId}:${sessionId}`;

    // Cancel existing timer if any
    if (this.refreshTimers.has(refreshKey)) {
      clearTimeout(this.refreshTimers.get(refreshKey)!);
      this.refreshTimers.delete(refreshKey);
    }

    // Calculate refresh time (buffer before expiration)
    const refreshTime = new Date(
      expiresAt.getTime() - this.config.refreshBuffer * 1000
    );
    const delay = Math.max(0, refreshTime.getTime() - Date.now());

    if (delay === 0) {
      this.logger.debug("Token expires soon, refreshing immediately", {
        userId,
        sessionId,
        expiresAt: expiresAt.toISOString(),
      });

      this.refreshUserTokens(userId, sessionId).catch((error) => {
        this.logger.error("Immediate refresh failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    // Schedule refresh
    const timer = setTimeout(async () => {
      this.logger.debug("Scheduled token refresh triggered", {
        userId,
        sessionId,
        scheduledFor: refreshTime.toISOString(),
      });

      try {
        await this.refreshUserTokens(userId, sessionId);
      } catch (error) {
        this.logger.error("Scheduled refresh failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.refreshTimers.delete(refreshKey);
      }
    }, delay);

    this.refreshTimers.set(refreshKey, timer);

    this.logger.debug("Token refresh scheduled", {
      userId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      refreshAt: refreshTime.toISOString(),
      delayMs: delay,
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

      const encryptedInfo = JSON.parse(cachedResult.data as unknown as string);
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
    let decodedToken: any = {};
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
      scope: decodedToken.scope || "",
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

    await this.cacheManager.set(
      "stored_tokens",
      cacheKey,
      JSON.stringify(encryptedInfo) as unknown as any,
      Math.floor(this.config.cleanupInterval / 1000)
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

      this.metrics?.recordCounter("refresh_token_manager.refresh_success", 1);

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

      this.metrics?.recordCounter("refresh_token_manager.refresh_error", 1);

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

    // Cancel any scheduled refresh
    const refreshKey = `${userId}:${sessionId}`;
    if (this.refreshTimers.has(refreshKey)) {
      clearTimeout(this.refreshTimers.get(refreshKey)!);
      this.refreshTimers.delete(refreshKey);
    }

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
    return {
      enabled: true,
      config: this.config,
      activeTimers: this.refreshTimers.size,
    };
  }
}
