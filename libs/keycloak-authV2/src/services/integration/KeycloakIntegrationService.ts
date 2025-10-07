/**
 * Keycloak Integration Service - SOLID Architecture
 * Main facade orchestrating all integration components
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient, CacheService } from "@libs/database";
import {
  UserSessionRepository,
  SessionLogRepository,
  SessionActivityRepository,
} from "@libs/database";
import type { UserSyncService } from "../user/sync/UserSyncService";
import { KeycloakClient } from "../../client/KeycloakClient";
import { KeycloakUserService } from "../user/KeycloakUserService";
import { SessionManager } from "../session";
import { TokenManager } from "../token/TokenManager";
import { createAuthV2Config, type AuthV2Config } from "../token/config";
import { UserFacade } from "../user/UserFacade";
import { APIKeyManager } from "../apikey/APIKeyManager";

// Component imports
import { InputValidator } from "./InputValidator";
import { ConfigurationManager } from "./ConfigurationManager";
import { StatisticsCollector } from "./StatisticsCollector";
import { AuthenticationManager } from "./AuthenticationManager";
import { SessionValidator } from "./SessionValidator";
import { UserManager } from "./UserManager";
import { ResourceManager } from "./ResourceManager";

import type {
  IIntegrationService,
  KeycloakConnectionOptions,
  ClientContext,
  AuthenticationResult,
  LogoutResult,
  IntegrationStats,
} from "./interfaces";

/**
 * Keycloak Integration Service - SOLID Compliant Architecture
 *
 * Provides a unified interface for:
 * - User authentication with multiple flows
 * - Session management with token handling
 * - User management operations
 * - Comprehensive logging and metrics
 *
 * Components:
 * - InputValidator: Input validation and sanitization
 * - ConfigurationManager: Service configuration management
 * - StatisticsCollector: Service statistics with caching
 * - AuthenticationManager: Authentication flow handling
 * - SessionValidator: Session validation and logout
 * - UserManager: User management operations
 * - ResourceManager: Resource lifecycle and health monitoring
 */
export class KeycloakIntegrationService implements IIntegrationService {
  private readonly logger = createLogger("KeycloakIntegrationService");

  // Components following SOLID principles
  private readonly inputValidator: InputValidator;
  private readonly configManager: ConfigurationManager;
  private readonly statisticsCollector: StatisticsCollector;
  private readonly authenticationManager: AuthenticationManager;
  private readonly sessionValidator: SessionValidator;
  private readonly userManager: UserManager;
  private readonly resourceManager: ResourceManager;

  // Core services
  private readonly keycloakClient: KeycloakClient;
  private readonly userService: KeycloakUserService;
  private readonly userFacade: UserFacade;
  private readonly sessionManager: SessionManager;
  private readonly tokenManager: TokenManager;
  private readonly apiKeyManager: APIKeyManager;

  /**
   * Factory method for creating KeycloakIntegrationService
   * Handles all dependency injection and component setup
   *
   * @deprecated Use KeycloakIntegrationServiceBuilder instead for better flexibility
   */
  static create(
    keycloakOptions: KeycloakConnectionOptions,
    dbClient: PostgreSQLClient,
    metrics?: IMetricsCollector
  ): KeycloakIntegrationService {
    return new KeycloakIntegrationService(
      keycloakOptions,
      dbClient,
      undefined, // cacheService
      metrics,
      undefined // syncService
    );
  }

  /**
   * Create integration service with all options
   */
  static createWithOptions(
    keycloakOptions: KeycloakConnectionOptions,
    dbClient: PostgreSQLClient,
    options: {
      cacheService?: CacheService;
      metrics?: IMetricsCollector;
      syncService?: UserSyncService;
    }
  ): KeycloakIntegrationService {
    return new KeycloakIntegrationService(
      keycloakOptions,
      dbClient,
      options.cacheService,
      options.metrics,
      options.syncService
    );
  }

  constructor(
    private readonly keycloakOptions: KeycloakConnectionOptions,
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    private readonly syncService?: UserSyncService
  ) {
    // Initialize core services
    this.keycloakClient = new KeycloakClient(
      {
        realm: {
          serverUrl: this.keycloakOptions.serverUrl,
          realm: this.keycloakOptions.realm,
          clientId: this.keycloakOptions.clientId,
          ...(this.keycloakOptions.clientSecret && {
            clientSecret: this.keycloakOptions.clientSecret,
          }),
          scopes: ["openid", "profile", "email"],
        },
      },
      metrics
    );

    // Initialize components (dependency injection)
    this.configManager = new ConfigurationManager(keycloakOptions);
    this.inputValidator = new InputValidator();

    const baseConfig = this.configManager.createBaseConfiguration(!!metrics);

    // Create repositories from database client
    const userSessionRepo = new UserSessionRepository(
      this.dbClient.prisma,
      this.metrics
    );
    const sessionLogRepo = new SessionLogRepository(
      this.dbClient.prisma,
      this.metrics
    );
    const sessionActivityRepo = new SessionActivityRepository(
      this.dbClient.prisma,
      this.metrics
    );

    // Create token manager configuration
    const tokenConfig: AuthV2Config = createAuthV2Config({
      jwt: {
        issuer: `${this.keycloakOptions.serverUrl}/realms/${this.keycloakOptions.realm}`,
        audience: this.keycloakOptions.clientId,
      },
      cache: {
        enabled: !!this.cacheService, // Enable cache if cacheService is provided
        ttl: {
          jwt: 300,
          apiKey: 600,
          session: 3600,
          userInfo: 1800,
        },
      },
    });

    // Create token manager
    this.tokenManager = new TokenManager(
      this.keycloakClient,
      tokenConfig,
      this.metrics
    );

    // Initialize API Key Manager for API-based authentication
    this.apiKeyManager = new APIKeyManager(
      this.logger,
      this.metrics || ({} as IMetricsCollector),
      this.dbClient,
      this.cacheService, // Optional cache service
      {
        features: {
          enableCaching: !!this.cacheService,
          enableUsageTracking: true,
          enableSecurityMonitoring: true,
          enableHealthMonitoring: !!this.metrics,
        },
      }
    );

    // Initialize user service
    this.userService = KeycloakUserService.create(
      this.keycloakClient,
      {
        ...baseConfig,
        session: {
          ...baseConfig.session,
          enforceUserAgentConsistency: false,
        },
      },
      undefined,
      metrics
    );

    // Create and store UserFacade for user operations
    this.userFacade = UserFacade.create(
      this.keycloakClient,
      this.userService,
      this.dbClient.prisma,
      this.syncService, // Use injected sync service (optional)
      this.metrics
    );

    // Initialize session manager with proper dependencies
    this.sessionManager = new SessionManager(
      this.tokenManager,
      userSessionRepo,
      sessionLogRepo,
      sessionActivityRepo,
      this.keycloakClient,
      this.cacheService, // Use injected cache service (optional)
      this.metrics
    );

    // Initialize component managers (following dependency inversion)
    this.statisticsCollector = new StatisticsCollector(
      this.keycloakClient,
      this.sessionManager,
      metrics
    );

    this.authenticationManager = new AuthenticationManager(
      this.keycloakClient,
      this.sessionManager,
      this.userFacade,
      this.inputValidator,
      metrics
    );

    this.sessionValidator = new SessionValidator(
      this.keycloakClient,
      this.sessionManager,
      this.inputValidator,
      metrics
    );

    this.userManager = new UserManager(
      this.userService,
      this.inputValidator,
      metrics
    );

    this.resourceManager = new ResourceManager(
      this.keycloakClient,
      this.dbClient,
      metrics
    );

    this.logger.info(
      "Keycloak Integration Service created with SOLID architecture",
      {
        cacheEnabled: !!this.cacheService,
        syncServiceEnabled: !!this.syncService,
        metricsEnabled: !!metrics,
        apiKeyManagerEnabled: true,
      }
    );
  }

  // IResourceManager implementation
  async initialize(): Promise<void> {
    return this.resourceManager.initialize();
  }

  async cleanup(): Promise<void> {
    try {
      // Cleanup API key manager first
      await this.apiKeyManager.cleanup();
      this.logger.info("API Key Manager cleanup completed");
    } catch (error) {
      this.logger.error("Failed to cleanup API Key Manager", { error });
    }

    // Then cleanup other resources
    return this.resourceManager.cleanup();
  }

  getResourceStats(): {
    connections: {
      keycloak: boolean;
      database: boolean;
      sessions: number;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
    };
    uptime: number;
  } {
    return this.resourceManager.getResourceStats();
  }

  // IAuthenticationManager implementation
  async authenticateWithPassword(
    username: string,
    password: string,
    clientContext: ClientContext
  ): Promise<AuthenticationResult> {
    return this.authenticationManager.authenticateWithPassword(
      username,
      password,
      clientContext
    );
  }

  async authenticateWithCode(
    code: string,
    redirectUri: string,
    clientContext: ClientContext,
    codeVerifier?: string
  ): Promise<AuthenticationResult> {
    return this.authenticationManager.authenticateWithCode(
      code,
      redirectUri,
      clientContext,
      codeVerifier
    );
  }

  // ISessionValidator implementation
  async validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<{
    valid: boolean;
    session?: any;
    refreshed?: boolean;
    error?: string;
  }> {
    return this.sessionValidator.validateSession(sessionId, context);
  }

  async logout(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    },
    options?: {
      logoutFromKeycloak?: boolean;
      destroyAllSessions?: boolean;
    }
  ): Promise<LogoutResult> {
    return this.sessionValidator.logout(sessionId, context, options);
  }

  // ISessionManager implementation (additional methods beyond ISessionValidator)
  async createSession(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
      expiresAt: Date;
      refreshExpiresAt?: Date;
    },
    requestContext: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: Record<string, string>;
    }
  ): Promise<{
    success: boolean;
    sessionId?: string;
    sessionData?: any;
    error?: string;
  }> {
    try {
      this.logger.info("Creating session", {
        userId,
        ipAddress: requestContext.ipAddress,
      });

      const result = await this.sessionManager.createSession(
        userId,
        tokens,
        requestContext
      );

      if (result.success && result.sessionId) {
        // Retrieve the full session data
        const sessionData = await (
          this.sessionManager as any
        ).sessionStore.retrieveSession(result.sessionId);

        return {
          success: true,
          sessionId: result.sessionId,
          sessionData,
        };
      }

      return {
        success: false,
        error: result.reason || "Failed to create session",
      };
    } catch (error) {
      this.logger.error("Failed to create session", { error, userId });
      this.metrics?.recordCounter(
        "keycloak.integration.session_create_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getSession(sessionId: string): Promise<{
    success: boolean;
    session?: any;
    error?: string;
  }> {
    try {
      // Access the session store through the session manager
      const session = await (
        this.sessionManager as any
      ).sessionStore.retrieveSession(sessionId);

      if (!session) {
        return {
          success: false,
          error: "Session not found",
        };
      }

      return {
        success: true,
        session,
      };
    } catch (error) {
      this.logger.error("Failed to get session", { error, sessionId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateSession(
    sessionId: string,
    updates: {
      lastActivity?: Date;
      metadata?: Record<string, any>;
    }
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      this.logger.info("Updating session", { sessionId, updates });

      // Update last activity through session store
      if (updates.lastActivity) {
        await (this.sessionManager as any).sessionStore.updateSessionAccess(
          sessionId
        );
      }

      // For metadata updates, would need to extend SessionStore
      // For now, just update access time
      return { success: true };
    } catch (error) {
      this.logger.error("Failed to update session", { error, sessionId });
      this.metrics?.recordCounter(
        "keycloak.integration.session_update_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async refreshSessionTokens(sessionId: string): Promise<{
    success: boolean;
    tokens?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
    };
    error?: string;
  }> {
    try {
      this.logger.info("Refreshing session tokens", { sessionId });

      // Get session data first
      const session = await (
        this.sessionManager as any
      ).sessionStore.retrieveSession(sessionId);

      if (!session) {
        return {
          success: false,
          error: "Session not found",
        };
      }

      // Refresh tokens through session manager
      const result = await this.sessionManager.refreshSessionTokens(session);

      if (
        result.success &&
        result.sessionData?.accessToken &&
        result.sessionData?.expiresAt
      ) {
        const tokens: {
          accessToken: string;
          refreshToken?: string;
          expiresAt: Date;
        } = {
          accessToken: result.sessionData.accessToken,
          expiresAt: result.sessionData.expiresAt,
        };

        if (result.sessionData.refreshToken) {
          tokens.refreshToken = result.sessionData.refreshToken;
        }

        return {
          success: true,
          tokens,
        };
      }

      return {
        success: false,
        error: result.reason || "Failed to refresh tokens",
      };
    } catch (error) {
      this.logger.error("Failed to refresh session tokens", {
        error,
        sessionId,
      });
      this.metrics?.recordCounter(
        "keycloak.integration.session_refresh_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async invalidateSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      this.logger.info("Invalidating session", { sessionId });

      await this.sessionManager.destroySession(sessionId, "invalidated");

      return { success: true };
    } catch (error) {
      this.logger.error("Failed to invalidate session", { error, sessionId });
      this.metrics?.recordCounter(
        "keycloak.integration.session_invalidate_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async listUserSessions(userId: string): Promise<{
    success: boolean;
    sessions?: any[];
    error?: string;
  }> {
    try {
      const sessions = await (
        this.sessionManager as any
      ).sessionStore.getUserSessions(userId);

      return {
        success: true,
        sessions,
      };
    } catch (error) {
      this.logger.error("Failed to list user sessions", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getSessionStats(): Promise<any> {
    try {
      return await this.sessionManager.getSessionStats();
    } catch (error) {
      this.logger.error("Failed to get session stats", { error });
      throw error;
    }
  }

  // IUserManager implementation
  async createUser(userData: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<{
    success: boolean;
    userId?: string;
    error?: string;
  }> {
    return this.userManager.createUser(userData);
  }

  async getUser(userId: string): Promise<{
    success: boolean;
    user?: any;
    error?: string;
  }> {
    return this.userManager.getUser(userId);
  }

  // IAPIKeyManager implementation
  async createAPIKey(options: {
    userId: string;
    name: string;
    scopes?: string[];
    permissions?: string[];
    expiresAt?: Date;
    storeId?: string;
    prefix?: string;
  }): Promise<{
    success: boolean;
    apiKey?: any;
    rawKey?: string;
    error?: string;
  }> {
    try {
      this.logger.info("Creating API key", {
        userId: options.userId,
        name: options.name,
        scopes: options.scopes,
      });

      const apiKey = await this.apiKeyManager.createAPIKey(options);

      return {
        success: true,
        apiKey,
        rawKey: (apiKey as any).rawKey, // The raw key is returned once
      };
    } catch (error) {
      this.logger.error("Failed to create API key", { error, options });
      this.metrics?.recordCounter(
        "keycloak.integration.api_key_create_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async validateAPIKey(apiKey: string): Promise<{
    valid: boolean;
    keyData?: any;
    error?: string;
  }> {
    try {
      const result = await this.apiKeyManager.validateAPIKey(apiKey);

      return {
        valid: result.success,
        keyData: result.keyData,
        ...(result.error && { error: result.error }),
      };
    } catch (error) {
      this.logger.error("Failed to validate API key", { error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async revokeAPIKey(
    keyId: string,
    reason: string
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      this.logger.info("Revoking API key", { keyId, reason });

      await this.apiKeyManager.revokeAPIKey(keyId, reason);

      return { success: true };
    } catch (error) {
      this.logger.error("Failed to revoke API key", { error, keyId });
      this.metrics?.recordCounter(
        "keycloak.integration.api_key_revoke_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async listAPIKeys(userId: string): Promise<{
    success: boolean;
    keys?: any[];
    error?: string;
  }> {
    try {
      const keys = await this.apiKeyManager.listAPIKeys(userId);

      return {
        success: true,
        keys,
      };
    } catch (error) {
      this.logger.error("Failed to list API keys", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getAPIKey(keyId: string): Promise<{
    success: boolean;
    key?: any;
    error?: string;
  }> {
    try {
      const key = await this.apiKeyManager.getAPIKey(keyId);

      if (!key) {
        return {
          success: false,
          error: "API key not found",
        };
      }

      return {
        success: true,
        key,
      };
    } catch (error) {
      this.logger.error("Failed to get API key", { error, keyId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateAPIKey(
    keyId: string,
    updates: {
      name?: string;
      scopes?: string[];
      permissions?: string[];
      expiresAt?: Date;
    }
  ): Promise<{
    success: boolean;
    key?: any;
    error?: string;
  }> {
    try {
      this.logger.info("Updating API key", { keyId, updates });

      const key = await this.apiKeyManager.updateAPIKey(keyId, updates);

      return {
        success: true,
        key,
      };
    } catch (error) {
      this.logger.error("Failed to update API key", { error, keyId });
      this.metrics?.recordCounter(
        "keycloak.integration.api_key_update_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async rotateAPIKey(
    keyId: string,
    options?: { expiresAt?: Date }
  ): Promise<{
    success: boolean;
    newKey?: any;
    rawKey?: string;
    error?: string;
  }> {
    try {
      this.logger.info("Rotating API key", { keyId });

      // Get existing key to preserve metadata
      const existingKey = await this.apiKeyManager.getAPIKey(keyId);
      if (!existingKey) {
        return {
          success: false,
          error: "API key not found",
        };
      }

      // Revoke old key
      await this.apiKeyManager.revokeAPIKey(keyId, "Rotated");

      // Create new key with same metadata
      const createOptions: any = {
        userId: existingKey.userId,
        name: existingKey.name,
        scopes: existingKey.scopes,
      };

      if (Array.isArray(existingKey.permissions)) {
        createOptions.permissions = existingKey.permissions;
      }

      if (options?.expiresAt || existingKey.expiresAt) {
        createOptions.expirationDate =
          options?.expiresAt || existingKey.expiresAt;
      }

      if (existingKey.storeId) {
        createOptions.storeId = existingKey.storeId;
      }

      const newKey = await this.apiKeyManager.createAPIKey(createOptions);

      return {
        success: true,
        newKey,
        rawKey: (newKey as any).rawKey,
      };
    } catch (error) {
      this.logger.error("Failed to rotate API key", { error, keyId });
      this.metrics?.recordCounter(
        "keycloak.integration.api_key_rotate_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async deleteAPIKey(keyId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      this.logger.info("Deleting API key", { keyId });

      // Revoke first (soft delete)
      await this.apiKeyManager.revokeAPIKey(keyId, "Deleted");

      return { success: true };
    } catch (error) {
      this.logger.error("Failed to delete API key", { error, keyId });
      this.metrics?.recordCounter(
        "keycloak.integration.api_key_delete_failed",
        1
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getAPIKeyStats(): Promise<{
    totalKeys: number;
    activeKeys: number;
    revokedKeys: number;
    expiredKeys: number;
    validationCount: number;
    cacheHitRate: number;
  }> {
    try {
      const health = await this.apiKeyManager.getHealthStatus();

      if (!health) {
        return {
          totalKeys: 0,
          activeKeys: 0,
          revokedKeys: 0,
          expiredKeys: 0,
          validationCount: 0,
          cacheHitRate: 0,
        };
      }

      return {
        totalKeys: 0, // Would need to query database for total count
        activeKeys: 0, // Would need to query database for active count
        revokedKeys: 0, // Would need additional tracking
        expiredKeys: 0, // Would need additional tracking
        validationCount: health.metrics.totalValidations || 0,
        cacheHitRate: health.metrics.cacheHitRate || 0,
      };
    } catch (error) {
      this.logger.error("Failed to get API key stats", { error });
      return {
        totalKeys: 0,
        activeKeys: 0,
        revokedKeys: 0,
        expiredKeys: 0,
        validationCount: 0,
        cacheHitRate: 0,
      };
    }
  }

  // IStatisticsCollector implementation
  async getStats(): Promise<IntegrationStats> {
    const baseStats = await this.statisticsCollector.getStats();

    // Add API key statistics if available
    try {
      const apiKeyStats = await this.getAPIKeyStats();
      return {
        ...baseStats,
        apiKey: apiKeyStats,
      };
    } catch (error) {
      this.logger.warn("Failed to include API key stats", { error });
      return baseStats;
    }
  }

  // ==================== Enhanced User Management (Phase 4) ====================

  /**
   * Batch register multiple users
   * @param users - Array of user registration data
   * @returns BatchOperationResult with success/failure details for each user
   */
  async batchRegisterUsers(
    users: Array<{
      username: string;
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      attributes?: Record<string, any>;
    }>
  ): Promise<{
    success: boolean;
    successCount: number;
    failureCount: number;
    results: Array<{
      success: boolean;
      data?: any;
      error?: string;
      index: number;
    }>;
  }> {
    const startTime = Date.now();
    const results: Array<{
      success: boolean;
      data?: any;
      error?: string;
      index: number;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      this.logger.info("Starting batch user registration", {
        count: users.length,
      });

      for (let i = 0; i < users.length; i++) {
        try {
          const userData = users[i];
          if (!userData) {
            results.push({
              success: false,
              error: "Invalid user data",
              index: i,
            });
            failureCount++;
            continue;
          }

          const user = await this.userFacade.registerUser(userData);
          results.push({
            success: true,
            data: user,
            index: i,
          });
          successCount++;
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            index: i,
          });
          failureCount++;
          this.logger.warn("Failed to register user in batch", {
            index: i,
            error,
          });
        }
      }

      const duration = Date.now() - startTime;
      this.metrics?.recordTimer(
        "keycloak.integration.batch_register_users_duration",
        duration
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_register_users_success",
        successCount
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_register_users_failure",
        failureCount
      );

      this.logger.info("Batch user registration completed", {
        successCount,
        failureCount,
        duration,
      });

      return {
        success: successCount > 0,
        successCount,
        failureCount,
        results,
      };
    } catch (error) {
      this.logger.error("Batch user registration failed", { error });
      return {
        success: false,
        successCount: 0,
        failureCount: users.length,
        results: users.map((_, index) => ({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          index,
        })),
      };
    }
  }

  /**
   * Batch update multiple users
   * @param updates - Array of user updates with userId and data
   * @returns BatchOperationResult with success/failure details
   */
  async batchUpdateUsers(
    updates: Array<{
      userId: string;
      data: {
        email?: string;
        firstName?: string;
        lastName?: string;
        enabled?: boolean;
        attributes?: Record<string, any>;
      };
    }>
  ): Promise<{
    success: boolean;
    successCount: number;
    failureCount: number;
    results: Array<{
      success: boolean;
      data?: any;
      error?: string;
      index: number;
    }>;
  }> {
    const startTime = Date.now();
    const results: Array<{
      success: boolean;
      data?: any;
      error?: string;
      index: number;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      this.logger.info("Starting batch user updates", {
        count: updates.length,
      });

      for (let i = 0; i < updates.length; i++) {
        try {
          const update = updates[i];
          if (!update) {
            results.push({
              success: false,
              error: "Invalid update data",
              index: i,
            });
            failureCount++;
            continue;
          }

          const { userId, data } = update;
          const user = await this.userFacade.updateUser(userId, data);
          results.push({
            success: true,
            data: user,
            index: i,
          });
          successCount++;
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            index: i,
          });
          failureCount++;
          this.logger.warn("Failed to update user in batch", {
            index: i,
            error,
          });
        }
      }

      const duration = Date.now() - startTime;
      this.metrics?.recordTimer(
        "keycloak.integration.batch_update_users_duration",
        duration
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_update_users_success",
        successCount
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_update_users_failure",
        failureCount
      );

      this.logger.info("Batch user updates completed", {
        successCount,
        failureCount,
        duration,
      });

      return {
        success: successCount > 0,
        successCount,
        failureCount,
        results,
      };
    } catch (error) {
      this.logger.error("Batch user updates failed", { error });
      return {
        success: false,
        successCount: 0,
        failureCount: updates.length,
        results: updates.map((_, index) => ({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          index,
        })),
      };
    }
  }

  /**
   * Batch delete multiple users
   * @param userIds - Array of user IDs to delete
   * @param deletedBy - ID of user performing deletion
   * @returns BatchOperationResult with success/failure details
   */
  async batchDeleteUsers(
    userIds: string[],
    deletedBy: string
  ): Promise<{
    success: boolean;
    successCount: number;
    failureCount: number;
    results: Array<{
      success: boolean;
      data?: void;
      error?: string;
      index: number;
    }>;
  }> {
    const startTime = Date.now();
    const results: Array<{
      success: boolean;
      data?: void;
      error?: string;
      index: number;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      this.logger.info("Starting batch user deletion", {
        count: userIds.length,
        deletedBy,
      });

      for (let i = 0; i < userIds.length; i++) {
        try {
          const userId = userIds[i];
          if (!userId) {
            results.push({
              success: false,
              error: "Invalid user ID",
              index: i,
            });
            failureCount++;
            continue;
          }

          await this.userFacade.deleteUser(userId, deletedBy);
          results.push({
            success: true,
            index: i,
          });
          successCount++;
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            index: i,
          });
          failureCount++;
          this.logger.warn("Failed to delete user in batch", {
            index: i,
            userId: userIds[i],
            error,
          });
        }
      }

      const duration = Date.now() - startTime;
      this.metrics?.recordTimer(
        "keycloak.integration.batch_delete_users_duration",
        duration
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_delete_users_success",
        successCount
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_delete_users_failure",
        failureCount
      );

      this.logger.info("Batch user deletion completed", {
        successCount,
        failureCount,
        duration,
      });

      return {
        success: successCount > 0,
        successCount,
        failureCount,
        results,
      };
    } catch (error) {
      this.logger.error("Batch user deletion failed", { error });
      return {
        success: false,
        successCount: 0,
        failureCount: userIds.length,
        results: userIds.map((_, index) => ({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          index,
        })),
      };
    }
  }

  /**
   * Batch assign roles to multiple users
   * @param assignments - Array of user IDs with their role assignments
   * @returns BatchOperationResult with success/failure details
   */
  async batchAssignRoles(
    assignments: Array<{
      userId: string;
      roleNames: string[];
    }>
  ): Promise<{
    success: boolean;
    successCount: number;
    failureCount: number;
    results: Array<{
      success: boolean;
      data?: void;
      error?: string;
      index: number;
    }>;
  }> {
    const startTime = Date.now();
    const results: Array<{
      success: boolean;
      data?: void;
      error?: string;
      index: number;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      this.logger.info("Starting batch role assignments", {
        count: assignments.length,
      });

      for (let i = 0; i < assignments.length; i++) {
        try {
          const assignment = assignments[i];
          if (!assignment) {
            results.push({
              success: false,
              error: "Invalid assignment data",
              index: i,
            });
            failureCount++;
            continue;
          }

          const { userId, roleNames } = assignment;
          await this.userFacade.assignRealmRoles(userId, roleNames);
          results.push({
            success: true,
            index: i,
          });
          successCount++;
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            index: i,
          });
          failureCount++;
          this.logger.warn("Failed to assign roles in batch", {
            index: i,
            error,
          });
        }
      }

      const duration = Date.now() - startTime;
      this.metrics?.recordTimer(
        "keycloak.integration.batch_assign_roles_duration",
        duration
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_assign_roles_success",
        successCount
      );
      this.metrics?.recordCounter(
        "keycloak.integration.batch_assign_roles_failure",
        failureCount
      );

      this.logger.info("Batch role assignments completed", {
        successCount,
        failureCount,
        duration,
      });

      return {
        success: successCount > 0,
        successCount,
        failureCount,
        results,
      };
    } catch (error) {
      this.logger.error("Batch role assignments failed", { error });
      return {
        success: false,
        successCount: 0,
        failureCount: assignments.length,
        results: assignments.map((_, index) => ({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          index,
        })),
      };
    }
  }

  /**
   * Get user attributes from Keycloak
   * @param userId - User ID
   * @returns User attributes object
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async getUserAttributes(userId: string): Promise<{
    success: boolean;
    attributes?: Record<string, any>;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // const user = await this.keycloakClient.getUser(userId);
      // return { success: true, attributes: user.attributes || {} };

      this.logger.warn("getUserAttributes not yet implemented", { userId });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Failed to get user attributes", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Set user attributes (replaces all attributes)
   * @param userId - User ID
   * @param attributes - Attributes object to set
   * @returns Success status
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async setUserAttributes(
    userId: string,
    _attributes: Record<string, any>
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // await this.keycloakClient.updateUser(userId, { attributes: _attributes });

      this.logger.warn("setUserAttributes not yet implemented", { userId });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Failed to set user attributes", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Update user attributes (merges with existing)
   * @param userId - User ID
   * @param attributes - Partial attributes to merge
   * @returns Success status
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async updateUserAttributes(
    userId: string,
    attributes: Partial<Record<string, any>>
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      const existingResult = await this.getUserAttributes(userId);
      if (!existingResult.success) {
        const errorMsg =
          existingResult.error || "Failed to get existing attributes";
        return { success: false, error: errorMsg };
      }

      const merged = {
        ...(existingResult.attributes || {}),
        ...attributes,
      };

      return await this.setUserAttributes(userId, merged);
    } catch (error) {
      this.logger.error("Failed to update user attributes", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Delete specific user attributes
   * @param userId - User ID
   * @param attributeKeys - Array of attribute keys to delete
   * @returns Success status
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async deleteUserAttributes(
    userId: string,
    attributeKeys: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      const existingResult = await this.getUserAttributes(userId);
      if (!existingResult.success) {
        const errorMsg =
          existingResult.error || "Failed to get existing attributes";
        return { success: false, error: errorMsg };
      }

      const updated = { ...(existingResult.attributes || {}) };
      for (const key of attributeKeys) {
        delete updated[key];
      }

      return await this.setUserAttributes(userId, updated);
    } catch (error) {
      this.logger.error("Failed to delete user attributes", {
        error,
        userId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Advanced user search with multiple filters
   * @param filters - Search filters (username, email, attributes, etc.)
   * @returns Filtered users array
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async searchUsersAdvanced(filters: {
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    attributes?: Record<string, string>;
    roleNames?: string[];
    groupNames?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{
    success: boolean;
    users?: any[];
    totalCount?: number;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // Build query params using bracket notation for index signatures
      // const queryParams: Record<string, any> = {};
      // if (filters.username) queryParams['username'] = filters.username;
      // ... etc
      // const users = await this.keycloakClient.searchUsers(queryParams);

      this.logger.warn("searchUsersAdvanced not yet implemented", { filters });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Advanced user search failed", { error, filters });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get user groups
   * @param userId - User ID
   * @returns Array of groups user belongs to
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async getUserGroups(userId: string): Promise<{
    success: boolean;
    groups?: Array<{ id: string; name: string; path: string }>;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // const groups = await this.keycloakClient.getUserGroups(userId);
      // return { success: true, groups: groups.map(g => ({ id: g.id, name: g.name, path: g.path })) };

      this.logger.warn("getUserGroups not yet implemented", { userId });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Failed to get user groups", { error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Add user to groups
   * @param userId - User ID
   * @param groupIds - Array of group IDs to add user to
   * @returns Success status
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async addUserToGroups(
    userId: string,
    groupIds: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // for (const groupId of groupIds) {
      //   await this.keycloakClient.addUserToGroup(userId, groupId);
      // }

      this.logger.warn("addUserToGroups not yet implemented", {
        userId,
        groupIds,
      });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Failed to add user to groups", {
        error,
        userId,
        groupIds,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Remove user from groups
   * @param userId - User ID
   * @param groupIds - Array of group IDs to remove user from
   * @returns Success status
   * @note Requires Keycloak Admin API integration - TO BE IMPLEMENTED
   */
  async removeUserFromGroups(
    userId: string,
    groupIds: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // TODO: Implement when Keycloak Admin API is integrated
      // for (const groupId of groupIds) {
      //   await this.keycloakClient.removeUserFromGroup(userId, groupId);
      // }

      this.logger.warn("removeUserFromGroups not yet implemented", {
        userId,
        groupIds,
      });
      return {
        success: false,
        error:
          "Method not yet implemented - requires Keycloak Admin API integration",
      };
    } catch (error) {
      this.logger.error("Failed to remove user from groups", {
        error,
        userId,
        groupIds,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ==================== Additional Methods ====================

  /**
   * Check system health across all components
   */
  async checkHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: Record<string, any>;
    timestamp: Date;
  }> {
    return this.resourceManager.checkHealth();
  }

  /**
   * Clear all caches across components
   */
  clearCaches(): void {
    this.statisticsCollector.clearCache();
    this.logger.info("All integration service caches cleared");
    this.metrics?.recordCounter("keycloak.integration.caches_cleared", 1);
  }

  /**
   * Get comprehensive system information
   */
  getSystemInfo(): {
    version: string;
    components: string[];
    configuration: {
      realm: string;
      serverUrl: string;
      clientId: string;
      hasMetrics: boolean;
    };
    architecture: string;
  } {
    return {
      version: "2.0.0", // Integration service version
      components: [
        "InputValidator",
        "ConfigurationManager",
        "StatisticsCollector",
        "AuthenticationManager",
        "SessionValidator",
        "UserManager",
        "ResourceManager",
      ],
      configuration: {
        realm: this.keycloakOptions.realm,
        serverUrl: this.keycloakOptions.serverUrl,
        clientId: this.keycloakOptions.clientId,
        hasMetrics: !!this.metrics,
      },
      architecture: "SOLID-Compliant Modular Architecture",
    };
  }

  /**
   * Get detailed cache statistics across all components
   */
  getCacheStatistics(): Record<string, any> {
    return {
      statistics: this.statisticsCollector.getCacheStats(),
      // Additional cache stats could be added from other components
    };
  }
}
