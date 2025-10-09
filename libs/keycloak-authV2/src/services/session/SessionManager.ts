/**
 * SessionManager - Single Responsibility: Orchestration
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
import {
  CacheService,
  UserSessionRepository,
  SessionLogRepository,
  SessionActivityRepository,
} from "@libs/database";

// Component imports
import { SessionStore, type SessionStoreConfig } from "./SessionStore";
import {
  SessionValidator,
  type SessionValidatorConfig,
} from "./SessionValidator";
import { SessionSecurity, type SessionSecurityConfig } from "./SessionSecurity";
import { SessionMetrics, type SessionMetricsConfig } from "./SessionMetrics";
import { SessionCleaner, type SessionCleanerConfig } from "./SessionCleaner";
import { SessionTokenCoordinator } from "./SessionTokenCoordinator";

// Type imports
import { UserSession } from "@libs/database";
import type {
  SessionValidationResult,
  SessionStats,
  AuthResult,
  HealthCheckResult,
  SessionFingerprint,
} from "./sessionTypes";
import type { ITokenManager } from "../token/TokenManager";
// Note: EncryptionManager import removed - tokens stored plaintext (already signed)
import type { KeycloakClient } from "../../client";

/**
 * Unified session manager configuration
 */
export interface SessionManagerConfig {
  encryptionKey: string; // 32+ char secret key for encryption
  readonly sessionStore?: Partial<SessionStoreConfig>;
  readonly sessionValidator?: Partial<SessionValidatorConfig>;
  readonly sessionSecurity?: Partial<SessionSecurityConfig>;
  readonly sessionMetrics?: Partial<SessionMetricsConfig>;
  readonly sessionCleaner?: Partial<SessionCleanerConfig>;
  readonly tokenRefreshBuffer?: number; // Seconds before expiry to refresh tokens (default: 300)

  readonly enableComponents: {
    metrics: boolean;
    security: boolean;
    cleanup: boolean;
    validation: boolean;
  };
}

const DEFAULT_SESSION_CONFIG: Required<SessionManagerConfig> = {
  encryptionKey: crypto.randomBytes(32).toString("hex"), // Default random key (should be overridden)
  sessionStore: {},
  sessionValidator: {},
  sessionSecurity: {},
  sessionMetrics: {},
  sessionCleaner: {},
  tokenRefreshBuffer: 300, // 5 minutes

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
export class SessionManager {
  private readonly logger: ILogger;
  private readonly config: Required<SessionManagerConfig>;

  // Core components
  private readonly sessionStore: SessionStore;
  private readonly tokenCoordinator: SessionTokenCoordinator;

  // Optional components
  private readonly sessionValidator?: SessionValidator;
  private readonly sessionSecurity?: SessionSecurity;
  private readonly sessionMetrics?: SessionMetrics;
  private readonly sessionCleaner?: SessionCleaner;

  // Component state
  private isInitialized = false;
  private isShuttingDown = false;
  // Note: EncryptionManager removed - tokens stored plaintext (already signed by Keycloak)

  constructor(
    private readonly tokenManager: ITokenManager,
    private readonly userSessionRepo: UserSessionRepository,
    private readonly sessionLogRepo: SessionLogRepository,
    private readonly sessionActivityRepo: SessionActivityRepository,
    private readonly keycloakClient: KeycloakClient,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionManagerConfig> = {}
  ) {
    this.logger = createLogger("SessionManager");
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      ...config,
    } as Required<SessionManagerConfig>;

    // Note: Encryption manager removed - not needed for signed JWT tokens

    // Initialize core components (always required)
    // REFACTORED: Now uses repository pattern
    this.sessionStore = new SessionStore(
      this.userSessionRepo,
      this.cacheService,
      this.logger.child({ component: "SessionStore" }),
      this.metrics,
      this.config.sessionStore
    );

    // Initialize token coordinator (delegates to KeycloakClient)
    this.tokenCoordinator = new SessionTokenCoordinator(
      this.keycloakClient,
      this.sessionStore,
      { refreshBuffer: this.config.tokenRefreshBuffer },
      this.metrics
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

    // Initialize SessionCleaner with repository pattern (Phase 4 complete)
    if (this.config.enableComponents.cleanup) {
      this.sessionCleaner = new SessionCleaner(
        this.userSessionRepo,
        this.sessionLogRepo,
        this.sessionActivityRepo,
        this.cacheService,
        this.logger.child({ component: "SessionCleaner" }),
        this.metrics,
        this.config.sessionCleaner
      );
    }

    this.logger.info("SessionManager initialized with repository pattern", {
      enabledComponents: this.config.enableComponents,
    });

    this.isInitialized = true;
  }

  /**
   * Create a new session
   * Delegates to: SessionSecurity, SessionValidator, SessionTokenCoordinator, SessionStore
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

      // Step 1: Security - Check concurrent session limits (delegate to SessionSecurity)
      // Step 1: Check concurrent session limit (OPTIMIZED with caching)
      if (this.sessionSecurity) {
        const deviceFingerprint = requestContext.fingerprint?.[
          "deviceFingerprint"
        ] as string | undefined;

        // Fast cached count check (5ms instead of 1000ms)
        const activeSessionCount =
          await this.sessionStore.getActiveSessionCount(
            userId,
            deviceFingerprint
          );

        const maxConcurrentSessions =
          this.config.sessionSecurity?.maxConcurrentSessions || 5;

        if (activeSessionCount >= maxConcurrentSessions) {
          this.logger.info(
            "Concurrent session limit reached, terminating oldest",
            {
              userId,
              activeCount: activeSessionCount,
              maxAllowed: maxConcurrentSessions,
            }
          );

          // Terminate oldest session to make room
          const oldestSession = await this.sessionStore.getOldestSession(
            userId
          );
          if (oldestSession) {
            await this.sessionStore.markSessionInactive(
              oldestSession.id,
              "concurrent_limit_exceeded"
            );
          }
        }
      }

      // Step 2: Generate fingerprint (delegate to SessionValidator)
      let fingerprint = "";
      if (this.sessionValidator && requestContext.fingerprint) {
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
          this.sessionValidator.generateFingerprint(sessionFingerprint) || "";
      }

      // Step 3: Create session data using SessionCreationOptions
      // NOTE: Tokens stored plaintext (they're already cryptographically signed by Keycloak)
      // No encryption needed - JWT tokens are tamper-proof and short-lived
      const sessionOptions: any = {
        userId,
        accessToken: tokens.accessToken,
        tokenExpiresAt: tokens.expiresAt,
        expiresAt: tokens.expiresAt,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        fingerprint,
        metadata: {},
      };

      // Only add optional fields if they are defined
      if (tokens.refreshToken) {
        sessionOptions.refreshToken = tokens.refreshToken;
      }
      if (tokens.idToken) {
        sessionOptions.idToken = tokens.idToken;
      }
      if (tokens.refreshExpiresAt) {
        sessionOptions.refreshExpiresAt = tokens.refreshExpiresAt;
      }

      // Step 4: Store session (delegate to SessionStore) and get the created session
      const sessionData = await this.sessionStore.storeSession(sessionOptions);

      if (!sessionData || !sessionData.id) {
        return {
          success: false,
          reason: "Failed to create session in database",
        };
      }

      // Step 6: Validate device fingerprint (delegate to SessionSecurity)
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

      // Step 7: Record metrics (delegate to SessionMetrics)
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
        expiresAt: sessionData.expiresAt || undefined,
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
   * Delegates to: SessionStore, SessionValidator, SessionSecurity, SessionTokenCoordinator
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

      // Step 1: Retrieve session (delegate to SessionStore)
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

      // Step 2: Basic session validation (delegate to SessionValidator)
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

        // Step 3: Check if token refresh is needed (delegate to SessionTokenCoordinator)
        if (validationResult.shouldRefreshToken && sessionData.refreshToken) {
          try {
            // No decryption needed - tokens stored plaintext
            // Delegate to SessionTokenCoordinator
            await this.tokenCoordinator.refreshSessionTokens(sessionData);

            // Retrieve updated session
            const updatedSession = await this.sessionStore.retrieveSession(
              sessionId
            );
            if (updatedSession) {
              sessionData = updatedSession;
            }
          } catch (refreshError) {
            this.logger.warn("Token refresh failed during validation", {
              error: refreshError,
              sessionId: this.hashSessionId(sessionId),
            });
            // Continue with validation using existing token
          }
        }
      }

      // Step 4: Security checks (delegate to SessionSecurity)
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

      // Step 5: Update session access time (delegate to SessionStore)
      await this.sessionStore.updateSessionAccess(sessionId);

      // Step 6: Record metrics (delegate to SessionMetrics)
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
   * Delegates to: SessionTokenCoordinator (which handles KeycloakClient and SessionStore)
   */
  async refreshSessionTokens(sessionData: UserSession): Promise<{
    success: boolean;
    sessionData?: UserSession;
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

      // No decryption needed - tokens stored plaintext
      // Delegate to SessionTokenCoordinator
      // This handles: KeycloakClient.refreshToken() + SessionStore.updateSessionTokens()
      await this.tokenCoordinator.refreshSessionTokens(sessionData);

      // Retrieve updated session data
      const updatedSessionData = await this.sessionStore.retrieveSession(
        sessionData.id
      );

      if (!updatedSessionData) {
        await this.recordMetrics(
          "token_refresh",
          context,
          false,
          "session_not_found_after_refresh"
        );
        return {
          success: false,
          reason: "Session not found after refresh",
        };
      }

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
   * Delegates to: SessionStore, SessionTokenCoordinator, SessionMetrics
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

      // Step 1: Cancel automatic token refresh (delegate to SessionTokenCoordinator)
      this.tokenCoordinator.cancelAutomaticRefresh(sessionId);

      // Step 2: Mark session as inactive (delegate to SessionStore)
      await this.sessionStore.markSessionInactive(sessionId, reason);

      // Step 3: Clear cache entries (delegate to SessionStore)
      await this.sessionStore.invalidateSessionCache(sessionId);

      // Step 4: Update metrics (delegate to SessionMetrics)
      if (this.sessionMetrics) {
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
   * Delegates to: SessionMetrics, SessionStore
   */
  async getSessionStats(): Promise<SessionStats> {
    try {
      // Delegate to SessionMetrics if available
      if (this.sessionMetrics) {
        return this.sessionMetrics.getSessionStats();
      }

      // Fallback: basic stats from SessionStore
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
   * Retrieve session by ID
   * Delegates to: SessionStore
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session data or null if not found
   */
  async getSession(sessionId: string): Promise<UserSession | null> {
    try {
      return await this.sessionStore.retrieveSession(sessionId);
    } catch (error) {
      this.logger.error("Failed to get session", { error, sessionId });
      return null;
    }
  }

  /**
   * Get all active sessions for a user
   * Delegates to: SessionStore
   *
   * @param userId - User ID
   * @returns Array of active sessions
   */
  async getUserSessions(userId: string): Promise<UserSession[]> {
    try {
      return await this.sessionStore.getUserSessions(userId);
    } catch (error) {
      this.logger.error("Failed to get user sessions", { error, userId });
      return [];
    }
  }

  /**
   * Update session last access time
   * Delegates to: SessionStore
   *
   * @param sessionId - Session ID to update
   */
  async updateSessionAccess(sessionId: string): Promise<void> {
    try {
      await this.sessionStore.updateSessionAccess(sessionId);
    } catch (error) {
      this.logger.error("Failed to update session access", {
        error,
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Perform comprehensive health check
   * Delegates to all managed components
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      this.logger.debug("Performing session manager health check");

      const healthResults: Record<string, any> = {};

      // Core component health checks
      healthResults["tokenCoordinator"] =
        await this.tokenCoordinator.healthCheck();

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
        (result: any) => result.status || result.coordinator
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
   * Delegates cleanup to all managed components
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

      // Shutdown token coordinator
      await this.tokenCoordinator.dispose();

      // Shutdown token manager
      await this.tokenManager.dispose();

      // Shutdown session store
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
              {} as UserSession,
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

  /**
   * Terminate multiple sessions (batch operation)
   * Delegates to: SessionStore
   *
   * DISABLED FOR PERFORMANCE OPTIMIZATION
   * This method was used for concurrent session limiting, but getUserSessions()
   * was causing significant performance issues. Re-enable with caching if needed.
   */
  // private async terminateSessionsBatch(sessionIds: string[]): Promise<void> {
  //   try {
  //     // Batch terminate sessions (delegate to SessionStore)
  //     await Promise.allSettled(
  //       sessionIds.map((sessionId) =>
  //         this.sessionStore.markSessionInactive(
  //           sessionId,
  //           "concurrent_limit_exceeded"
  //         )
  //       )
  //     );

  //     this.logger.info("Batch session termination completed", {
  //       terminatedSessions: sessionIds.length,
  //     });
  //   } catch (error) {
  //     this.logger.error("Batch session termination failed", { error });
  //   }
  // }

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
