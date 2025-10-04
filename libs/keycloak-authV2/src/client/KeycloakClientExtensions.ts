/**
 * Keycloak Client Extensions - Graceful Degradation and Fallback Mechanisms
 * Provides enhanced resilience patterns for authentication failures
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { KeycloakClient, IKeycloakClient } from "./KeycloakClient";
import type { AuthResult, UserInfo } from "../types";

/**
 * Fallback configuration for degraded operation modes
 */
export interface FallbackConfig {
  enableOfflineMode?: boolean;
  offlineTokenValidityMinutes?: number;
  enableAnonymousAccess?: boolean;
  anonymousPermissions?: string[];
  maxCachedTokens?: number;
  fallbackUserInfo?: Partial<UserInfo>;
}

/**
 * Cached authentication result for offline operation
 */
interface CachedAuthResult extends AuthResult {
  cachedAt: Date;
  validUntil: Date;
}

/**
 * Enhanced Keycloak client with graceful degradation capabilities
 */
export class ResilientKeycloakClient implements IKeycloakClient {
  private readonly logger = createLogger("ResilientKeycloakClient");
  private readonly offlineCache = new Map<string, CachedAuthResult>();
  private isKeycloakAvailable = true;
  private lastHealthCheck = Date.now();
  private readonly healthCheckInterval = 30000; // 30 seconds

  constructor(
    private readonly client: KeycloakClient,
    private readonly fallbackConfig: FallbackConfig = {},
    private readonly metrics?: IMetricsCollector
  ) {
    // Set default fallback configuration
    this.fallbackConfig = {
      enableOfflineMode: true,
      offlineTokenValidityMinutes: 15,
      enableAnonymousAccess: false,
      anonymousPermissions: ["read:public"],
      maxCachedTokens: 1000,
      ...fallbackConfig,
    };
  }
  async validateClientCredentials(
    clientId: string,
    clientSecret: string
  ): Promise<boolean> {
    if (!this.isKeycloakAvailable) {
      throw new Error(
        "Client credentials validation requires Keycloak availability"
      );
    }
    return this.client.validateClientCredentials(clientId, clientSecret);
  }

  async logout(userId: string, sessionId?: string): Promise<void> {
    if (this.isKeycloakAvailable) {
      try {
        await this.client.logout(userId, sessionId);
      } catch (error) {
        this.logger.warn("Logout failed, clearing local cache", { error });
      }
    } else {
      this.logger.warn(
        "Logout called while Keycloak unavailable, clearing local cache",
        { userId }
      );
    }

    // Always clear local cache if sessionId provided
    if (sessionId) {
      this.clearTokenFromCache(sessionId);
    }
  }

  /**
   * Initialize with enhanced error handling
   */
  async initialize(): Promise<void> {
    try {
      await this.client.initialize();
      this.isKeycloakAvailable = true;
      this.metrics?.recordCounter(
        "keycloak.resilient.initialization_success",
        1
      );
    } catch (error) {
      this.logger.warn(
        "Keycloak initialization failed, enabling degraded mode",
        { error }
      );
      this.isKeycloakAvailable = false;
      this.metrics?.recordCounter(
        "keycloak.resilient.initialization_fallback",
        1
      );

      if (
        !this.fallbackConfig.enableOfflineMode &&
        !this.fallbackConfig.enableAnonymousAccess
      ) {
        throw error; // Fail fast if no fallback mechanisms are enabled
      }
    }
  }

  /**
   * Validate token with fallback to cached results
   */
  async validateToken(token: string): Promise<AuthResult> {
    // Try primary validation first
    if (this.isKeycloakAvailable) {
      try {
        const result = await this.client.validateToken(token);

        // Cache successful results for offline use
        if (result.success && this.fallbackConfig.enableOfflineMode) {
          this.cacheAuthResult(token, result);
        }

        return result;
      } catch (error) {
        this.logger.warn("Token validation failed, checking fallback options", {
          error,
        });
        this.markKeycloakUnavailable();
      }
    }

    // Fallback to cached result if available
    if (this.fallbackConfig.enableOfflineMode) {
      const cachedResult = this.getCachedAuthResult(token);
      if (cachedResult) {
        this.metrics?.recordCounter(
          "keycloak.resilient.token_validation_cached",
          1
        );
        return cachedResult;
      }
    }

    // Fallback to anonymous access if enabled
    if (this.fallbackConfig.enableAnonymousAccess) {
      this.metrics?.recordCounter(
        "keycloak.resilient.token_validation_anonymous",
        1
      );
      return this.createAnonymousAuthResult();
    }

    // No fallback available
    return {
      success: false,
      error: "Token validation failed and no fallback mechanisms available",
    };
  }

  /**
   * Introspect token with fallback mechanisms
   */
  async introspectToken(token: string): Promise<AuthResult> {
    if (this.isKeycloakAvailable) {
      try {
        const result = await this.client.introspectToken(token);

        if (result.success && this.fallbackConfig.enableOfflineMode) {
          this.cacheAuthResult(token, result);
        }

        return result;
      } catch (error) {
        this.logger.warn("Token introspection failed, using fallback", {
          error,
        });
        this.markKeycloakUnavailable();
      }
    }

    // Use same fallback logic as validateToken
    return this.validateToken(token);
  }

  /**
   * Get user info with fallback to cached data
   */
  async getUserInfo(accessToken: string): Promise<any> {
    if (this.isKeycloakAvailable) {
      try {
        return await this.client.getUserInfo(accessToken);
      } catch (error) {
        this.logger.warn("User info retrieval failed, using fallback", {
          error,
        });
        this.markKeycloakUnavailable();
      }
    }

    // Check if we have cached user info
    const cachedAuth = this.getCachedAuthResult(accessToken);
    if (cachedAuth?.user) {
      this.metrics?.recordCounter("keycloak.resilient.userinfo_cached", 1);
      return {
        sub: cachedAuth.user.id,
        preferred_username: cachedAuth.user.username,
        email: cachedAuth.user.email,
        name: cachedAuth.user.name,
        roles: cachedAuth.user.roles,
        permissions: cachedAuth.user.permissions,
        ...this.fallbackConfig.fallbackUserInfo,
      };
    }

    throw new Error("User information not available and not cached");
  }

  /**
   * Health check with automatic recovery detection
   */
  async healthCheck(): Promise<boolean> {
    const now = Date.now();

    // Rate limit health checks
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isKeycloakAvailable;
    }

    this.lastHealthCheck = now;

    try {
      const isHealthy = await this.client.healthCheck();

      if (isHealthy && !this.isKeycloakAvailable) {
        this.logger.info("Keycloak service recovered, exiting degraded mode");
        this.isKeycloakAvailable = true;
        this.metrics?.recordCounter("keycloak.resilient.service_recovered", 1);
      }

      return isHealthy;
    } catch (error) {
      this.markKeycloakUnavailable();
      return false;
    }
  }

  /**
   * Get resilient client status including fallback information
   */
  getStats(): any {
    const baseStats = this.client.getStats();

    return {
      ...baseStats,
      resilientMode: {
        isKeycloakAvailable: this.isKeycloakAvailable,
        fallbackEnabled:
          this.fallbackConfig.enableOfflineMode ||
          this.fallbackConfig.enableAnonymousAccess,
        cachedTokens: this.offlineCache.size,
        lastHealthCheck: new Date(this.lastHealthCheck),
        offlineModeEnabled: this.fallbackConfig.enableOfflineMode,
        anonymousAccessEnabled: this.fallbackConfig.enableAnonymousAccess,
      },
    };
  }

  // Delegate all other methods to the underlying client
  async authenticateClientCredentials(scopes?: string[]): Promise<any> {
    if (!this.isKeycloakAvailable) {
      throw new Error(
        "Client credentials authentication requires Keycloak availability"
      );
    }
    return this.client.authenticateClientCredentials(scopes);
  }

  async exchangeAuthorizationCode(
    code: string,
    codeVerifier?: string
  ): Promise<any> {
    if (!this.isKeycloakAvailable) {
      throw new Error(
        "Authorization code exchange requires Keycloak availability"
      );
    }
    return this.client.exchangeAuthorizationCode(code, codeVerifier);
  }

  async refreshToken(refreshToken: string): Promise<any> {
    if (!this.isKeycloakAvailable) {
      throw new Error("Token refresh requires Keycloak availability");
    }
    return this.client.refreshToken(refreshToken);
  }

  getAuthorizationUrl(
    state: string,
    nonce: string,
    codeChallenge?: string,
    additionalScopes?: string[]
  ): string {
    return this.client.getAuthorizationUrl(
      state,
      nonce,
      codeChallenge,
      additionalScopes
    );
  }

  getLogoutUrl(postLogoutRedirectUri?: string, idTokenHint?: string): string {
    return this.client.getLogoutUrl(postLogoutRedirectUri, idTokenHint);
  }

  async authenticateWithPassword(
    username: string,
    password: string,
    clientId?: string
  ): Promise<any> {
    if (!this.isKeycloakAvailable) {
      throw new Error("Password authentication requires Keycloak availability");
    }
    return this.client.authenticateWithPassword(username, password, clientId);
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<any> {
    if (!this.isKeycloakAvailable) {
      throw new Error("Code exchange requires Keycloak availability");
    }
    return this.client.exchangeCodeForTokens(code, redirectUri, codeVerifier);
  }

  async revokingRefreshToken(refreshToken: string): Promise<void> {
    if (this.isKeycloakAvailable) {
      try {
        await this.client.revokingRefreshToken(refreshToken);
      } catch (error) {
        this.logger.warn("Logout failed, clearing local cache", { error });
      }
    }

    // Always clear local cache
    this.clearTokenFromCache(refreshToken);
  }

  getDiscoveryDocument(): any {
    return this.client.getDiscoveryDocument();
  }

  async dispose(): Promise<void> {
    this.offlineCache.clear();
    return this.client.dispose();
  }

  isReady(): boolean {
    return this.isKeycloakAvailable
      ? this.client.isReady()
      : this.fallbackConfig.enableOfflineMode ||
          this.fallbackConfig.enableAnonymousAccess ||
          false;
  }

  // Private helper methods

  private cacheAuthResult(token: string, result: AuthResult): void {
    if (!result.success || !this.fallbackConfig.enableOfflineMode) return;

    const validityMinutes =
      this.fallbackConfig.offlineTokenValidityMinutes || 15;
    const validUntil = new Date(Date.now() + validityMinutes * 60 * 1000);

    const cachedResult: CachedAuthResult = {
      ...result,
      cachedAt: new Date(),
      validUntil,
    };

    // Implement cache size limit
    if (
      this.offlineCache.size >= (this.fallbackConfig.maxCachedTokens || 1000)
    ) {
      const oldestEntry = Array.from(this.offlineCache.entries()).sort(
        ([, a], [, b]) => a.cachedAt.getTime() - b.cachedAt.getTime()
      )[0];

      if (oldestEntry) {
        this.offlineCache.delete(oldestEntry[0]);
      }
    }

    const tokenHash = this.hashToken(token);
    this.offlineCache.set(tokenHash, cachedResult);
  }

  private getCachedAuthResult(token: string): AuthResult | null {
    const tokenHash = this.hashToken(token);
    const cached = this.offlineCache.get(tokenHash);

    if (!cached) return null;

    // Check if cached result is still valid
    if (cached.validUntil < new Date()) {
      this.offlineCache.delete(tokenHash);
      return null;
    }

    // Return the cached result without the caching metadata
    const { cachedAt, validUntil, ...authResult } = cached;
    return authResult;
  }

  private clearTokenFromCache(token: string): void {
    const tokenHash = this.hashToken(token);
    this.offlineCache.delete(tokenHash);
  }

  private createAnonymousAuthResult(): AuthResult {
    return {
      success: true,
      user: {
        id: "anonymous",
        username: "anonymous",
        email: undefined,
        name: "Anonymous User",
        roles: ["anonymous"],
        permissions: this.fallbackConfig.anonymousPermissions || [
          "read:public",
        ],
        metadata: {
          fallbackMode: true,
          authMode: "anonymous",
        },
      },
      token: "anonymous",
      scopes: ["anonymous"],
    };
  }

  private markKeycloakUnavailable(): void {
    if (this.isKeycloakAvailable) {
      this.logger.warn(
        "Marking Keycloak as unavailable, entering degraded mode"
      );
      this.isKeycloakAvailable = false;
      this.metrics?.recordCounter("keycloak.resilient.service_unavailable", 1);
    }
  }

  private hashToken(token: string): string {
    // Simple hash for cache keys (same as KeycloakClient)
    return require("crypto").createHash("sha256").update(token).digest("hex");
  }
}

/**
 * Factory function to create a resilient Keycloak client
 */
export function createResilientKeycloakClient(
  client: KeycloakClient,
  fallbackConfig?: FallbackConfig,
  metrics?: IMetricsCollector
): ResilientKeycloakClient {
  return new ResilientKeycloakClient(client, fallbackConfig, metrics);
}
