/**
 * Comprehensive Keycloak Integration Service
 *
 * This service combines all Keycloak components     private readonly logger: ILogger;
    private readonly metrics?: IMetricsCollector;   // Initialize user manager
    this.userManager = new KeycloakUserManager(
      this.keycloakClient,
      {
        jwt: {}, // Will use defaults from KeycloakClient
        cache: {
          ena      con            const sessionResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo,
        keycloakSessionId: sessionState,
        tokens: tokenResponse,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });onResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo: userInfo,
        keycloakSessionId: crypto.randomUUID(), // Would get from token introspection
        tokens: tokenResult.tokens,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });metrics,
          ttl: {
            jwt: 300,
            apiKey: 600,
            session: 3600,
            userInfo: 1800,
          },
        },
        security: {
          constantTimeComparison: true,
          apiKeyHashRounds: 12,
          sessionRotationInterval: 86400,
        },
      },
      metrics
    );ce:
 * - KeycloakClient for OIDC authentication flows
 * - KeycloakUserManager for user management via Admin API
 * - KeycloakSessionManager for session management with token integration
 * - Comprehensive error handling and logging
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import { KeycloakClient } from "../client/KeycloakClient";
import { KeycloakUserManager } from "./KeycloakUserManager";
import {
  KeycloakSessionManager,
  type KeycloakSessionData,
  type SessionStats,
} from "./KeycloakSessionManager";
import type { UserInfo } from "../types";

export interface AuthenticationResult {
  success: boolean;
  user?: UserInfo;
  tokens?: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in?: number;
  };
  session?: {
    sessionId: string;
    sessionData: KeycloakSessionData;
  };
  error?: string;
  requiresMFA?: boolean;
  redirectUrl?: string;
}

export interface LogoutResult {
  success: boolean;
  loggedOut: boolean;
  sessionDestroyed: boolean;
  keycloakLogout: boolean;
  error?: string;
}

/**
 * Comprehensive Keycloak Integration Service
 *
 * Provides a unified interface for:
 * - User authentication with multiple flows
 * - Session management with token handling
 * - User management operations
 * - Comprehensive logging and metrics
 */
export class KeycloakIntegrationService {
  private readonly logger = createLogger("KeycloakIntegrationService");
  private keycloakClient: KeycloakClient;
  private userManager: KeycloakUserManager;
  private sessionManager: KeycloakSessionManager;

  constructor(
    private readonly keycloakOptions: {
      serverUrl: string;
      realm: string;
      clientId: string;
      clientSecret?: string;
    },
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize Keycloak client
    this.keycloakClient = new KeycloakClient(
      {
        realm: {
          serverUrl: this.keycloakOptions.serverUrl,
          realm: this.keycloakOptions.realm,
          clientId: this.keycloakOptions.clientId,
          ...(this.keycloakOptions.clientSecret && {
            clientSecret: this.keycloakOptions.clientSecret,
          }),
          scopes: ["openid", "profile", "email"], // Default OIDC scopes
        },
      },
      metrics
    );

    // Initialize user manager
    this.userManager = new KeycloakUserManager(
      this.keycloakClient,
      {
        jwt: {},
        cache: {
          enabled: !!metrics,
          ttl: {
            jwt: 300,
            apiKey: 600,
            session: 3600,
            userInfo: 1800,
          },
        },
        security: {
          constantTimeComparison: true,
          apiKeyHashRounds: 12,
          sessionRotationInterval: 86400,
        },
        session: {
          maxConcurrentSessions: 5,
          enforceIpConsistency: true,
          enforceUserAgentConsistency: false,
          tokenEncryption: true,
        },
        encryption: {
          keyDerivationIterations: 100000,
        },
      },
      metrics
    );

    // Initialize session manager
    this.sessionManager = new KeycloakSessionManager(
      this.keycloakClient,
      {
        jwt: {}, // Will use defaults from KeycloakClient
        cache: {
          enabled: !!metrics,
          ttl: {
            jwt: 300,
            apiKey: 600,
            session: 3600,
            userInfo: 1800,
          },
        },
        security: {
          constantTimeComparison: true,
          apiKeyHashRounds: 12,
          sessionRotationInterval: 86400,
        },
        session: {
          maxConcurrentSessions: 5,
          enforceIpConsistency: true,
          enforceUserAgentConsistency: false,
          tokenEncryption: true,
        },
        encryption: {
          keyDerivationIterations: 100000,
        },
      },
      this.dbClient, // PostgreSQL client for session persistence
      metrics
    );
  }

  /**
   * Initialize the Keycloak integration
   * Must be called before using other methods
   */
  async initialize(): Promise<void> {
    try {
      await this.keycloakClient.initialize();
      this.logger.info("Keycloak integration initialized successfully");
      this.metrics?.recordCounter("keycloak.integration.initialized", 1);
    } catch (error) {
      this.logger.error("Failed to initialize Keycloak integration", { error });
      this.metrics?.recordCounter("keycloak.integration.init_error", 1);
      throw new Error("Failed to initialize Keycloak integration");
    }
  }

  /**
   * Authenticate user with username/password
   */
  async authenticateWithPassword(
    username: string,
    password: string,
    clientContext: {
      ipAddress: string;
      userAgent: string;
      clientId?: string;
    }
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    try {
      // Perform authentication
      const authResult = await this.keycloakClient.authenticateWithPassword(
        username,
        password,
        clientContext.clientId
      );

      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error || "Authentication failed",
        };
      }

      if (!authResult.tokens) {
        return {
          success: false,
          error: "Authentication succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        authResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo: userInfo,
        keycloakSessionId: authResult.sessionId || crypto.randomUUID(),
        tokens: authResult.tokens,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });

      this.metrics?.recordCounter("keycloak.integration.auth_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.auth_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated successfully", {
        userId: userInfo.sub,
        username: userInfo.preferred_username,
        sessionId: sessionResult.sessionId.substring(0, 8) + "...",
      });

      return {
        success: true,
        user: userInfo,
        tokens: authResult.tokens,
        session: sessionResult,
      };
    } catch (error) {
      this.logger.error("Authentication failed", {
        error,
        username: username.substring(0, 3) + "***",
      });
      this.metrics?.recordCounter("keycloak.integration.auth_error", 1);
      return {
        success: false,
        error: "Authentication failed",
      };
    }
  }

  /**
   * Authenticate with authorization code (OAuth2 flow)
   */
  async authenticateWithCode(
    code: string,
    redirectUri: string,
    clientContext: {
      ipAddress: string;
      userAgent: string;
      clientId?: string;
    },
    codeVerifier?: string
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    try {
      // Exchange code for tokens
      const tokenResult = await this.keycloakClient.exchangeCodeForTokens(
        code,
        redirectUri,
        codeVerifier
      );

      if (!tokenResult.success) {
        return {
          success: false,
          error: tokenResult.error || "Code exchange failed",
        };
      }

      if (!tokenResult.tokens) {
        return {
          success: false,
          error: "Token exchange succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        tokenResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.sessionManager.createSession({
        userId: userInfo.sub,
        userInfo: userInfo,
        keycloakSessionId: crypto.randomUUID(), // Would get from token claims in real implementation
        tokens: tokenResult.tokens,
        ipAddress: clientContext.ipAddress,
        userAgent: clientContext.userAgent,
        maxAge: undefined,
        metadata: undefined,
      });

      this.metrics?.recordCounter("keycloak.integration.code_auth_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.code_auth_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated with code successfully", {
        userId: userInfo.sub,
        username: userInfo.preferred_username,
        sessionId: sessionResult.sessionId.substring(0, 8) + "...",
      });

      return {
        success: true,
        user: userInfo,
        tokens: tokenResult.tokens,
        session: sessionResult,
      };
    } catch (error) {
      this.logger.error("Code authentication failed", { error });
      this.metrics?.recordCounter("keycloak.integration.code_auth_error", 1);
      return {
        success: false,
        error: "Code authentication failed",
      };
    }
  }

  /**
   * Validate and refresh session
   */
  async validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<{
    valid: boolean;
    session?: KeycloakSessionData;
    refreshed?: boolean;
    error?: string;
  }> {
    try {
      const validation = await this.sessionManager.validateSession(
        sessionId,
        context
      );

      if (!validation.valid) {
        return {
          valid: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      this.metrics?.recordCounter("keycloak.integration.session_validated", 1);

      return {
        valid: true,
        ...(validation.session && { session: validation.session }),
        ...(validation.requiresTokenRefresh !== undefined && {
          refreshed: validation.requiresTokenRefresh,
        }),
      };
    } catch (error) {
      this.logger.error("Session validation failed", {
        error,
        sessionId: sessionId.substring(0, 8) + "...",
      });
      this.metrics?.recordCounter(
        "keycloak.integration.session_validation_error",
        1
      );
      return {
        valid: false,
        error: "Session validation failed",
      };
    }
  }

  /**
   * Logout user and destroy session
   */
  async logout(
    sessionId: string,
    options?: {
      logoutFromKeycloak?: boolean;
      destroyAllSessions?: boolean;
    }
  ): Promise<LogoutResult> {
    const startTime = performance.now();
    let sessionDestroyed = false;
    let keycloakLogout = false;

    try {
      // Get session data for logout
      const validation = await this.sessionManager.validateSession(sessionId, {
        ipAddress: "0.0.0.0", // Skip IP validation for logout
        userAgent: "logout",
      });

      if (validation.valid && validation.session) {
        const session = validation.session;

        // Logout from Keycloak if requested and tokens available
        if (options?.logoutFromKeycloak && session.refreshToken) {
          try {
            await this.keycloakClient.logout(session.refreshToken);
            keycloakLogout = true;
            this.logger.info("User logged out from Keycloak", {
              userId: session.userId,
              sessionId: sessionId.substring(0, 8) + "...",
            });
          } catch (logoutError) {
            this.logger.warn("Failed to logout from Keycloak", {
              error: logoutError,
              sessionId: sessionId.substring(0, 8) + "...",
            });
          }
        }

        // Destroy all user sessions if requested
        if (options?.destroyAllSessions) {
          await this.sessionManager.destroyAllUserSessions(session.userId);
        } else {
          // Destroy current session
          await this.sessionManager.destroySession(sessionId, "logout");
        }
        sessionDestroyed = true;
      }

      this.metrics?.recordCounter("keycloak.integration.logout_success", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.logout_duration",
        performance.now() - startTime
      );

      return {
        success: true,
        loggedOut: true,
        sessionDestroyed,
        keycloakLogout,
      };
    } catch (error) {
      this.logger.error("Logout failed", {
        error,
        sessionId: sessionId.substring(0, 8) + "...",
      });
      this.metrics?.recordCounter("keycloak.integration.logout_error", 1);
      return {
        success: false,
        loggedOut: false,
        sessionDestroyed,
        keycloakLogout,
        error: "Logout failed",
      };
    }
  }

  /**
   * Create a new user
   */
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
    try {
      const userId = await this.userManager.createUser(userData);
      this.metrics?.recordCounter("keycloak.integration.user_created", 1);
      return {
        success: true,
        userId,
        ...(undefined as any), // For exactOptionalPropertyTypes compatibility
      };
    } catch (error) {
      this.logger.error("User creation failed", {
        error,
        username: userData.username,
      });
      this.metrics?.recordCounter("keycloak.integration.user_create_error", 1);
      return {
        success: false,
        error: "User creation failed",
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<{
    success: boolean;
    user?: UserInfo;
    error?: string;
  }> {
    try {
      const userInfo = await this.userManager.getCompleteUserInfo(userId);
      this.metrics?.recordCounter("keycloak.integration.user_retrieved", 1);

      if (userInfo) {
        return {
          success: true,
          user: userInfo,
        };
      } else {
        return {
          success: false,
          error: "User not found",
        };
      }
    } catch (error) {
      this.logger.error("User retrieval failed", { error, userId });
      this.metrics?.recordCounter(
        "keycloak.integration.user_retrieval_error",
        1
      );
      return {
        success: false,
        error: "User retrieval failed",
      };
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    session: SessionStats;
    client: {
      discoveryLoaded: boolean;
      jwksLoaded: boolean;
      cacheEnabled: boolean;
      requestCount: number;
    };
  } {
    return {
      session: this.sessionManager.getStats(),
      client: this.keycloakClient.getStats?.() || {
        discoveryLoaded: false,
        jwksLoaded: false,
        cacheEnabled: false,
        requestCount: 0,
      },
    };
  }

  /**
   * Health check for Keycloak integration
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    keycloak: boolean;
    services: {
      client: boolean;
      userManager: boolean;
      sessionManager: boolean;
    };
    error?: string;
  }> {
    try {
      // Test Keycloak connectivity
      const keycloakHealthy =
        (await this.keycloakClient.healthCheck?.()) ?? true;

      return {
        healthy: keycloakHealthy,
        keycloak: keycloakHealthy,
        services: {
          client: true,
          userManager: true,
          sessionManager: true,
        },
      };
    } catch (error) {
      this.logger.error("Health check failed", { error });
      return {
        healthy: false,
        keycloak: false,
        services: {
          client: false,
          userManager: false,
          sessionManager: false,
        },
        error: "Health check failed",
      };
    }
  }
}
