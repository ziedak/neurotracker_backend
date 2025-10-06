/**
 * Keycloak Integration Service - SOLID Architecture
 * Main facade orchestrating all integration components
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
import { KeycloakClient } from "../../client/KeycloakClient";
import { KeycloakUserService } from "../user/KeycloakUserService";
import { SessionManager } from "../session";

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
  private readonly sessionManager: SessionManager;

  /**
   * Factory method for creating KeycloakIntegrationService
   * Handles all dependency injection and component setup
   */
  static create(
    keycloakOptions: KeycloakConnectionOptions,
    dbClient: PostgreSQLClient,
    metrics?: IMetricsCollector
  ): KeycloakIntegrationService {
    return new KeycloakIntegrationService(keycloakOptions, dbClient, metrics);
  }

  constructor(
    private readonly keycloakOptions: KeycloakConnectionOptions,
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector
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

    // Initialize session manager
    this.sessionManager = new SessionManager(undefined, metrics);

    // Initialize component managers (following dependency inversion)
    this.statisticsCollector = new StatisticsCollector(
      this.keycloakClient,
      this.sessionManager,
      metrics
    );

    this.authenticationManager = new AuthenticationManager(
      this.keycloakClient,
      this.sessionManager,
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
      "Keycloak Integration Service created with SOLID architecture"
    );
  }

  // IResourceManager implementation
  async initialize(): Promise<void> {
    return this.resourceManager.initialize();
  }

  async cleanup(): Promise<void> {
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

  // IStatisticsCollector implementation
  async getStats(): Promise<IntegrationStats> {
    return this.statisticsCollector.getStats();
  }

  // Additional methods for enhanced functionality

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
