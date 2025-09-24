/**
 * KeycloakSessionManager - Single Responsibility: Orchestration
 *
 * Orchestrates:
 * - All session management components
 * - Component lifecycle and dependencies
 * - Unified session management API
 * - Cross-component error handling
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles orchestration and coordination
 * - Open/Closed: Extensible through component interfaces
 * - Liskov Substitution: Components are interchangeable through interfaces
 * - Interface Segregation: Clean component interfaces
 * - Dependency Inversion: Depends on component abstractions
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient, CacheService } from "@libs/database";

// Component imports
import { SessionStore, type SessionStoreConfig } from "./SessionStore";
import {
  SessionTokenManager as TokenManager,
  type SessionTokenManagerConfig as TokenManagerConfig,
} from "./SessionTokenManager";
import {
  SessionValidator,
  type SessionValidatorConfig,
} from "./SessionValidator";
import { SessionSecurity, type SessionSecurityConfig } from "./SessionSecurity";
import { SessionMetrics, type SessionMetricsConfig } from "./SessionMetrics";
import { SessionCleaner, type SessionCleanerConfig } from "./SessionCleaner";

// Type imports
import type {
  KeycloakSessionData,
  SessionValidationResult,
  SessionStats,
  AuthResult,
  HealthCheckResult,
  SessionFingerprint,
} from "./sessionTypes";

/**
 * Unified session manager configuration
 */
export interface KeycloakSessionManagerConfig {
  readonly sessionStore?: Partial<SessionStoreConfig>;
  readonly tokenManager?: Partial<TokenManagerConfig>;
  readonly sessionValidator?: Partial<SessionValidatorConfig>;
  readonly sessionSecurity?: Partial<SessionSecurityConfig>;
  readonly sessionMetrics?: Partial<SessionMetricsConfig>;
  readonly sessionCleaner?: Partial<SessionCleanerConfig>;
  readonly keycloak: {
    serverUrl: string;
    realm: string;
    clientId: string;
    clientSecret?: string;
  };
  readonly enableComponents: {
    metrics: boolean;
    security: boolean;
    cleanup: boolean;
    validation: boolean;
  };
}

const DEFAULT_SESSION_CONFIG: Required<KeycloakSessionManagerConfig> = {
  sessionStore: {},
  tokenManager: {},
  sessionValidator: {},
  sessionSecurity: {},
  sessionMetrics: {},
  sessionCleaner: {},
  keycloak: {
    serverUrl: process.env["KEYCLOAK_SERVER_URL"] || "http://localhost:8080",
    realm: process.env["KEYCLOAK_REALM"] || "master",
    clientId: process.env["KEYCLOAK_CLIENT_ID"] || "app",
    ...(process.env["KEYCLOAK_CLIENT_SECRET"] && {
      clientSecret: process.env["KEYCLOAK_CLIENT_SECRET"],
    }),
  },
  enableComponents: {
    metrics: true,
    security: true,
    cleanup: true,
    validation: true,
  },
};

/**
 * Session operation context
 */
interface SessionOperationContext {
  operationId: string;
  sessionId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  startTime: number;
}

/**
 * Unified session management orchestrator
 */
export class KeycloakSessionManager {
  private readonly logger: ILogger;
  private readonly config: Required<KeycloakSessionManagerConfig>;

  // Core components
  private readonly sessionStore: SessionStore;
  private readonly tokenManager: TokenManager;
  private readonly sessionValidator?: SessionValidator;
  private readonly sessionSecurity?: SessionSecurity;
  private readonly sessionMetrics?: SessionMetrics;
  private readonly sessionCleaner?: SessionCleaner;

  // Component state
  private isInitialized = false;
  private isShuttingDown = false;

  constructor(
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    config: Partial<KeycloakSessionManagerConfig> = {}
  ) {
    this.logger = createLogger("KeycloakSessionManager");
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      ...config,
    } as Required<KeycloakSessionManagerConfig>;

    // Initialize core components (always required)
    this.sessionStore = new SessionStore(
      this.dbClient,
      this.cacheService,
      this.logger.child({ component: "SessionStore" }),
      this.metrics,
      this.config.sessionStore
    );

    this.tokenManager = new TokenManager(
      this.logger.child({ component: "TokenManager" }),
      this.metrics,
      this.config.tokenManager
    );

    // Initialize optional components based on configuration
    if (this.config.enableComponents.validation) {
      this.sessionValidator = new SessionValidator(
        this.logger.child({ component: "SessionValidator" }),
        this.metrics,
        this.config.sessionValidator
      );
    }

    if (this.config.enableComponents.security) {
      this.sessionSecurity = new SessionSecurity(
        this.cacheService,
        this.logger.child({ component: "SessionSecurity" }),
        this.metrics,
        this.config.sessionSecurity
      );
    }

    if (this.config.enableComponents.metrics) {
      this.sessionMetrics = new SessionMetrics(
        this.logger.child({ component: "SessionMetrics" }),
        this.metrics,
        this.config.sessionMetrics
      );
    }

    if (this.config.enableComponents.cleanup) {
      this.sessionCleaner = new SessionCleaner(
        this.dbClient,
        this.cacheService,
        this.logger.child({ component: "SessionCleaner" }),
        this.metrics,
        this.config.sessionCleaner
      );
    }

    this.logger.info("KeycloakSessionManager initialized", {
      enabledComponents: this.config.enableComponents,
      keycloakRealm: this.config.keycloak.realm,
      keycloakClientId: this.config.keycloak.clientId,
    });

    this.isInitialized = true;
  }

  /**
   * Create a new session
   */
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
  ): Promise<AuthResult> {
    const context = this.createOperationContext("create_session", { userId });

    try {
      this.logger.debug("Creating new session", {
        operationId: context.operationId,
        userId,
        ipAddress: this.hashIp(requestContext.ipAddress),
      });

      // Check concurrent session limits if security is enabled
      if (this.sessionSecurity) {
        const activeSessions = await this.sessionStore.getUserSessions(userId);
        const sessionId = crypto.randomUUID();

        const concurrentResult =
          await this.sessionSecurity.enforceConcurrentSessionLimits(
            userId,
            sessionId,
            activeSessions
          );

        if (!concurrentResult.allowed) {
          await this.recordMetrics(
            "session_creation",
            context,
            false,
            concurrentResult.reason
          );
          return {
            success: false,
            ...(concurrentResult.reason && { reason: concurrentResult.reason }),
          };
        }

        // Terminate excess sessions if needed
        if (concurrentResult.sessionsToTerminate.length > 0) {
          await this.terminateSessionsBatch(
            concurrentResult.sessionsToTerminate
          );
        }
      }

      // Generate session fingerprint if security is enabled
      let fingerprint = "";
      if (this.sessionSecurity && requestContext.fingerprint) {
        const sessionFingerprint: SessionFingerprint = {
          userAgent:
            requestContext.fingerprint["userAgent"] || requestContext.userAgent,
          acceptLanguage:
            requestContext.fingerprint["acceptLanguage"] || "en-US",
          acceptEncoding:
            requestContext.fingerprint["acceptEncoding"] || "gzip, deflate",
          ...(requestContext.fingerprint["screenResolution"] && {
            screenResolution: requestContext.fingerprint["screenResolution"],
          }),
          ...(requestContext.fingerprint["timezone"] && {
            timezone: requestContext.fingerprint["timezone"],
          }),
          ...(requestContext.fingerprint["platform"] && {
            platform: requestContext.fingerprint["platform"],
          }),
        };
        fingerprint =
          this.sessionValidator?.generateFingerprint(sessionFingerprint) || "";
      }

      // Encrypt tokens before storage
      const encryptedTokens = {
        accessToken: await this.tokenManager.encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken
          ? await this.tokenManager.encryptToken(tokens.refreshToken)
          : undefined,
        idToken: tokens.idToken
          ? await this.tokenManager.encryptToken(tokens.idToken)
          : undefined,
      };

      // Create session data
      const sessionData: KeycloakSessionData = {
        id: crypto.randomUUID(),
        userId,
        userInfo: {
          id: userId,
          username: "",
          email: "",
          name: "",
          roles: [],
          permissions: [],
        },
        keycloakSessionId: crypto.randomUUID(),
        accessToken: encryptedTokens.accessToken,
        refreshToken: encryptedTokens.refreshToken,
        idToken: encryptedTokens.idToken,
        tokenExpiresAt: tokens.expiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        expiresAt: tokens.expiresAt,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        isActive: true,
        fingerprint,
        metadata: {},
      };

      // Store session
      await this.sessionStore.storeSession(sessionData);

      // Validate device fingerprint if security is enabled
      if (this.sessionSecurity) {
        const deviceResult =
          await this.sessionSecurity.validateDeviceFingerprint(
            sessionData,
            requestContext
          );

        if (!deviceResult.isValid) {
          // Clean up the session and fail
          await this.sessionStore.markSessionInactive(
            sessionData.id,
            "device_validation_failed"
          );
          await this.recordMetrics(
            "session_creation",
            context,
            false,
            deviceResult.reason
          );
          return {
            success: false,
            reason: deviceResult.message,
          };
        }
      }

      // Record successful creation metrics
      await this.recordMetrics("session_creation", context, true);

      this.logger.info("Session created successfully", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId,
        duration: performance.now() - context.startTime,
      });

      return {
        success: true,
        sessionId: sessionData.id,
        expiresAt: sessionData.expiresAt,
        userInfo: sessionData.userInfo,
      };
    } catch (error) {
      this.logger.error("Session creation failed", {
        operationId: context.operationId,
        error,
        userId,
      });

      await this.recordMetrics(
        "session_creation",
        context,
        false,
        "creation_error"
      );
      return {
        success: false,
        reason: "Session creation failed",
      };
    }
  }

  /**
   * Validate an existing session
   */
  async validateSession(
    sessionId: string,
    requestContext?: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: Record<string, string>;
    }
  ): Promise<SessionValidationResult> {
    const context = this.createOperationContext("validate_session", {
      sessionId,
    });

    try {
      this.logger.debug("Validating session", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionId),
      });

      // Retrieve session from storage
      let sessionData = await this.sessionStore.retrieveSession(sessionId);
      if (!sessionData) {
        await this.recordMetrics(
          "session_validation",
          context,
          false,
          "session_not_found"
        );
        return {
          isValid: false,
          reason: "Session not found",
          timestamp: new Date(),
        };
      }

      // Basic session validation
      if (this.sessionValidator) {
        // Transform requestContext to match expected interface
        const transformedContext = requestContext
          ? {
              ipAddress: requestContext.ipAddress,
              userAgent: requestContext.userAgent,
              ...(requestContext.fingerprint && {
                fingerprint: {
                  userAgent:
                    requestContext.fingerprint["userAgent"] ||
                    requestContext.userAgent,
                  acceptLanguage:
                    requestContext.fingerprint["acceptLanguage"] || "en-US",
                  acceptEncoding:
                    requestContext.fingerprint["acceptEncoding"] ||
                    "gzip, deflate",
                  ...(requestContext.fingerprint["screenResolution"] && {
                    screenResolution:
                      requestContext.fingerprint["screenResolution"],
                  }),
                  ...(requestContext.fingerprint["timezone"] && {
                    timezone: requestContext.fingerprint["timezone"],
                  }),
                  ...(requestContext.fingerprint["platform"] && {
                    platform: requestContext.fingerprint["platform"],
                  }),
                },
              }),
            }
          : undefined;

        const validationResult = await this.sessionValidator.validateSession(
          sessionData,
          transformedContext
        );

        if (!validationResult.isValid) {
          await this.recordMetrics(
            "session_validation",
            context,
            false,
            validationResult.reason
          );
          return validationResult;
        }

        // Check if token refresh is needed
        if (validationResult.shouldRefreshToken && sessionData.refreshToken) {
          const refreshResult = await this.refreshSessionTokens(sessionData);
          if (refreshResult.success && refreshResult.sessionData) {
            sessionData.accessToken = refreshResult.sessionData.accessToken;
            sessionData.refreshToken = refreshResult.sessionData.refreshToken;
            sessionData.tokenExpiresAt =
              refreshResult.sessionData.tokenExpiresAt;
          }
        }
      }

      // Security checks if enabled
      if (this.sessionSecurity && requestContext) {
        const securityResult =
          await this.sessionSecurity.detectSuspiciousActivity(
            sessionData,
            requestContext
          );

        if (!securityResult.isValid) {
          // Mark session as inactive for security violations
          await this.sessionStore.markSessionInactive(
            sessionData.id,
            "security_violation"
          );
          await this.recordMetrics(
            "session_validation",
            context,
            false,
            securityResult.reason
          );
          return {
            isValid: false,
            ...(securityResult.message !== undefined && {
              reason: securityResult.message,
            }),
            timestamp: new Date(),
            shouldTerminate: securityResult.shouldTerminate,
          };
        }
      }

      // Update session access time
      await this.sessionStore.updateSessionAccess(sessionId);

      // Record successful validation
      await this.recordMetrics("session_validation", context, true);

      this.logger.debug("Session validation successful", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionId),
        duration: performance.now() - context.startTime,
      });

      return {
        isValid: true,
        sessionData,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Session validation failed", {
        operationId: context.operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
      });

      await this.recordMetrics(
        "session_validation",
        context,
        false,
        "validation_error"
      );
      return {
        isValid: false,
        reason: "Validation error occurred",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Refresh session tokens
   */
  async refreshSessionTokens(sessionData: KeycloakSessionData): Promise<{
    success: boolean;
    sessionData?: KeycloakSessionData;
    reason?: string;
  }> {
    const context = this.createOperationContext("refresh_tokens", {
      sessionId: sessionData.id,
      userId: sessionData.userId,
    });

    try {
      this.logger.debug("Refreshing session tokens", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId: sessionData.userId,
      });

      if (!sessionData.refreshToken) {
        return {
          success: false,
          reason: "No refresh token available",
        };
      }

      // Decrypt refresh token
      const decryptedRefreshToken = await this.tokenManager.decryptToken(
        sessionData.refreshToken
      );

      // Refresh tokens via Keycloak
      const refreshResult = await this.tokenManager.refreshAccessToken(
        decryptedRefreshToken,
        this.config.keycloak.serverUrl +
          "/realms/" +
          this.config.keycloak.realm,
        this.config.keycloak.clientId,
        this.config.keycloak.clientSecret
      );

      if (!refreshResult.success || !refreshResult.tokens) {
        await this.recordMetrics(
          "token_refresh",
          context,
          false,
          refreshResult.error
        );
        return {
          success: false,
          ...(refreshResult.error !== undefined && {
            reason: refreshResult.error,
          }),
        };
      }

      // Encrypt new tokens
      const encryptedTokens = {
        accessToken: await this.tokenManager.encryptToken(
          refreshResult.tokens.accessToken
        ),
        refreshToken: refreshResult.tokens.refreshToken
          ? await this.tokenManager.encryptToken(
              refreshResult.tokens.refreshToken
            )
          : sessionData.refreshToken,
        idToken: refreshResult.tokens.idToken
          ? await this.tokenManager.encryptToken(refreshResult.tokens.idToken)
          : sessionData.idToken,
      };

      // Update session data
      const updatedSessionData: KeycloakSessionData = {
        ...sessionData,
        accessToken: encryptedTokens.accessToken,
        refreshToken: encryptedTokens.refreshToken,
        idToken: encryptedTokens.idToken,
        tokenExpiresAt: refreshResult.tokens.expiresAt,
        refreshExpiresAt: refreshResult.tokens.refreshExpiresAt,
        lastAccessedAt: new Date(),
      };

      // Store updated session
      await this.sessionStore.storeSession(updatedSessionData);

      // Record successful refresh
      await this.recordMetrics("token_refresh", context, true);

      this.logger.info("Session tokens refreshed successfully", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionData.id),
        duration: performance.now() - context.startTime,
      });

      return {
        success: true,
        sessionData: updatedSessionData,
      };
    } catch (error) {
      this.logger.error("Token refresh failed", {
        operationId: context.operationId,
        error,
        sessionId: this.hashSessionId(sessionData.id),
      });

      await this.recordMetrics(
        "token_refresh",
        context,
        false,
        "refresh_error"
      );
      return {
        success: false,
        reason: "Token refresh error",
      };
    }
  }

  /**
   * Destroy a session
   */
  async destroySession(
    sessionId: string,
    reason: string = "logout"
  ): Promise<{ success: boolean; reason?: string }> {
    const context = this.createOperationContext("destroy_session", {
      sessionId,
    });

    try {
      this.logger.debug("Destroying session", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionId),
        reason,
      });

      // Mark session as inactive in storage
      await this.sessionStore.markSessionInactive(sessionId, reason);

      // Clear cache entries
      await this.sessionStore.invalidateSessionCache(sessionId);

      // Record session destruction
      if (this.sessionMetrics) {
        // Update session statistics
        const currentStats = this.sessionMetrics.getSessionStats();
        await this.sessionMetrics.updateSessionStats({
          activeSessions: Math.max(0, currentStats.activeSessions - 1),
        });
      }

      this.logger.info("Session destroyed successfully", {
        operationId: context.operationId,
        sessionId: this.hashSessionId(sessionId),
        reason,
        duration: performance.now() - context.startTime,
      });

      return { success: true };
    } catch (error) {
      this.logger.error("Session destruction failed", {
        operationId: context.operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
        reason,
      });

      return {
        success: false,
        reason: "Session destruction failed",
      };
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<SessionStats> {
    try {
      if (this.sessionMetrics) {
        return this.sessionMetrics.getSessionStats();
      }

      // Fallback: basic stats from storage
      const storageStats = await this.sessionStore.getStorageStats();
      return {
        activeSessions: storageStats.activeSessions,
        totalSessions: storageStats.totalSessions,
        sessionsCreated: 0,
        sessionsExpired: 0,
        averageSessionDuration: 0,
        peakConcurrentSessions: 0,
        successfulLogins: 0,
        failedLogins: 0,
        tokenRefreshCount: 0,
        securityViolations: 0,
      };
    } catch (error) {
      this.logger.error("Failed to get session statistics", { error });
      return {
        activeSessions: 0,
        totalSessions: 0,
        sessionsCreated: 0,
        sessionsExpired: 0,
        averageSessionDuration: 0,
        peakConcurrentSessions: 0,
        successfulLogins: 0,
        failedLogins: 0,
        tokenRefreshCount: 0,
        securityViolations: 0,
      };
    }
  }

  /**
   * Perform comprehensive health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      this.logger.debug("Performing session manager health check");

      const healthResults: Record<string, any> = {};

      // Core component health checks
      healthResults["sessionStore"] = await this.sessionStore.healthCheck();
      healthResults["tokenManager"] = await this.tokenManager.healthCheck();

      // Optional component health checks
      if (this.sessionValidator) {
        healthResults["sessionValidator"] =
          await this.sessionValidator.healthCheck();
      }

      if (this.sessionSecurity) {
        healthResults["sessionSecurity"] =
          await this.sessionSecurity.healthCheck();
      }

      if (this.sessionMetrics) {
        healthResults["sessionMetrics"] =
          await this.sessionMetrics.healthCheck();
      }

      if (this.sessionCleaner) {
        healthResults["sessionCleaner"] =
          await this.sessionCleaner.healthCheck();
      }

      // Determine overall status
      const componentStatuses = Object.values(healthResults).map(
        (result: any) => result.status
      );

      let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
      if (componentStatuses.some((status) => status === "unhealthy")) {
        overallStatus = "unhealthy";
      } else if (componentStatuses.some((status) => status === "degraded")) {
        overallStatus = "degraded";
      }

      const responseTime = performance.now() - startTime;

      return {
        status: overallStatus,
        details: {
          components: healthResults,
          isInitialized: this.isInitialized,
          isShuttingDown: this.isShuttingDown,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Health check failed", { error });
      return {
        status: "unhealthy",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Gracefully shutdown all components
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn("Shutdown already in progress");
      return;
    }

    this.isShuttingDown = true;
    this.logger.info("Starting session manager shutdown");

    try {
      // Shutdown components in reverse dependency order
      if (this.sessionCleaner) {
        await this.sessionCleaner.cleanup();
      }

      if (this.sessionMetrics) {
        await this.sessionMetrics.cleanup();
      }

      if (this.sessionSecurity) {
        await this.sessionSecurity.cleanup();
      }

      if (this.sessionValidator) {
        await this.sessionValidator.cleanup();
      }

      await this.tokenManager.cleanup();
      await this.sessionStore.cleanup();

      this.logger.info("Session manager shutdown completed");
    } catch (error) {
      this.logger.error("Error during shutdown", { error });
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private createOperationContext(
    operation: string,
    additionalData: Partial<SessionOperationContext> = {}
  ): SessionOperationContext {
    return {
      operationId: `${operation}_${Date.now()}_${crypto
        .randomBytes(4)
        .toString("hex")}`,
      startTime: performance.now(),
      ...additionalData,
    };
  }

  private async recordMetrics(
    operation: string,
    context: SessionOperationContext,
    success: boolean,
    reason?: string
  ): Promise<void> {
    try {
      const duration = performance.now() - context.startTime;

      if (this.sessionMetrics) {
        switch (operation) {
          case "session_creation":
            // Session data would be passed in a real implementation
            await this.sessionMetrics.recordSessionCreation(
              {} as KeycloakSessionData,
              duration,
              success
            );
            break;
          case "session_validation":
            await this.sessionMetrics.recordSessionValidation(
              context.sessionId || "",
              duration,
              success,
              reason
            );
            break;
          case "token_refresh":
            await this.sessionMetrics.recordTokenRefresh(
              context.sessionId || "",
              duration,
              success,
              reason
            );
            break;
        }
      }

      // Export to external metrics collector
      if (this.metrics) {
        this.metrics.recordTimer(`session.${operation}.duration`, duration);
        this.metrics.recordCounter(`session.${operation}.total`, 1, {
          success: success.toString(),
          reason: reason || "success",
        });
      }
    } catch (error) {
      this.logger.warn("Failed to record metrics", { error, operation });
    }
  }

  private async terminateSessionsBatch(sessionIds: string[]): Promise<void> {
    try {
      await Promise.allSettled(
        sessionIds.map((sessionId) =>
          this.sessionStore.markSessionInactive(
            sessionId,
            "concurrent_limit_exceeded"
          )
        )
      );

      this.logger.info("Batch session termination completed", {
        terminatedSessions: sessionIds.length,
      });
    } catch (error) {
      this.logger.error("Batch session termination failed", { error });
    }
  }

  private hashSessionId(sessionId: string): string {
    return (
      crypto
        .createHash("sha256")
        .update(sessionId)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }

  private hashIp(ipAddress: string): string {
    return (
      crypto
        .createHash("sha256")
        .update(ipAddress)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }
}
