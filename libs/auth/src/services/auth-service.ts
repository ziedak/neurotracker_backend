/**
 * Main Authentication Service
 * Orchestrates JWT, Keycloak, and Permission services for comprehensive authentication
 * Provides unified interface for all authentication operations
 */

import {
  User,
  AuthResult,
  LoginCredentials,
  RegisterData,
  AuthConfig,
  ServiceDependencies,
  AuthError,
} from "../types";
import { JWTService } from "./jwt-service";
import { KeycloakService } from "./keycloak-service";
import { PermissionService } from "./permission-service";
import { SessionService } from "./session-service";
import { ApiKeyService } from "./api-key-service";

// ===================================================================
// ENHANCED SERVICES INTEGRATION
// ===================================================================

import { EnhancedMonitoringService } from "./enhanced-monitoring-service";
import { ConfigValidationService } from "./config-validation-service";
import { EnhancedPermissionCacheService } from "./enhanced-permission-cache-service";
import { AdvancedThreatDetectionService } from "./advanced-threat-detection-service";
import { PasswordPolicyService } from "./password-policy-service";

// Phase 2: Focused Services Integration
import {
  UserAuthenticationService,
  type IUserAuthenticationService,
} from "./user-authentication-service";
import {
  TokenManagementService,
  type ITokenManagementService,
} from "./token-management-service";
import {
  UserManagementService,
  type IUserManagementService,
} from "./user-management-service";

// ===================================================================
// AUTHENTICATION SERVICE CLASS
// ===================================================================

export class AuthenticationService {
  private jwtService: JWTService;
  private keycloakService: KeycloakService;
  private permissionService: PermissionService;
  private sessionService: SessionService;
  private apiKeyService: ApiKeyService;

  // Phase 2: Focused Services (Single Responsibility Principle)
  private userAuthService: IUserAuthenticationService;
  private tokenManagementService: ITokenManagementService;
  private userManagementService: IUserManagementService;

  // Enhanced Services (optional)
  private monitoringService?: EnhancedMonitoringService;
  private configValidator?: ConfigValidationService;
  private permissionCache?: EnhancedPermissionCacheService;
  private threatDetector?: AdvancedThreatDetectionService;
  private passwordPolicyService?: PasswordPolicyService;

  constructor(private config: AuthConfig, private deps: ServiceDependencies) {
    this.jwtService = new JWTService(this.config, deps);
    this.keycloakService = new KeycloakService(this.config, deps);
    this.permissionService = new PermissionService(deps);
    this.sessionService = new SessionService(this.config, deps);
    this.apiKeyService = new ApiKeyService(this.config, deps);

    // Initialize password policy service if configuration is provided
    if (this.config.passwordPolicy) {
      this.passwordPolicyService = new PasswordPolicyService(this.config, deps);
    }

    // Initialize Phase 2 focused services
    this.userAuthService = new UserAuthenticationService(deps, {
      keycloakService: this.keycloakService,
      jwtService: this.jwtService,
      sessionService: this.sessionService,
      ...(this.passwordPolicyService && {
        passwordPolicyService: this.passwordPolicyService,
      }),
    });

    this.tokenManagementService = new TokenManagementService(deps, {
      jwtService: this.jwtService,
    });

    this.userManagementService = new UserManagementService(deps, {
      keycloakService: this.keycloakService,
      sessionService: this.sessionService,
    });
  }

  /**
   * Initialize all authentication services
   */
  async initialize(): Promise<void> {
    try {
      await this.keycloakService.initialize();

      // Validate configuration if validator is available
      if (this.configValidator) {
        const validation = this.configValidator.validateConfig(this.config);
        if (!validation.isValid) {
          throw new Error(
            `Configuration validation failed: ${validation.errors
              .map((e) => e.message)
              .join(", ")}`
          );
        }
      }

      this.deps.monitoring.logger.info(
        "Authentication service initialized successfully"
      );
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to initialize authentication service",
        { error }
      );
      throw new AuthError(
        "Authentication service initialization failed",
        "AUTH_INIT_FAILED"
      );
    }
  }

  /**
   * Initialize enhanced services
   */
  async initializeEnhancedServices(): Promise<void> {
    // Services are initialized as optional dependencies
    this.deps.monitoring.logger.info(
      "Enhanced authentication services initialized"
    );
  }

  /**
   * Login user with email and password
   * Delegates to UserAuthenticationService for focused responsibility
   */
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Delegate to focused UserAuthenticationService
      const result = await this.userAuthService.login(credentials);

      // Enrich with permissions if successful
      if (result.success && result.user) {
        const userWithPermissions = await this.enrichUserWithPermissions(
          result.user
        );
        return {
          ...result,
          user: userWithPermissions,
        };
      }

      return result;
    } catch (error) {
      this.deps.monitoring.logger.error("Login delegation failed", {
        email: credentials.email,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Login failed",
        code: "LOGIN_FAILED",
      };
    }
  }

  /**
   * Register new user
   * Delegates to UserAuthenticationService for focused responsibility
   */
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      // Delegate to focused UserAuthenticationService
      const result = await this.userAuthService.register(data);

      // Enrich with permissions if successful
      if (result.success && result.user) {
        const userWithPermissions = await this.enrichUserWithPermissions(
          result.user
        );
        return {
          ...result,
          user: userWithPermissions,
        };
      }

      return result;
    } catch (error) {
      this.deps.monitoring.logger.error("Registration delegation failed", {
        email: data.email,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Registration failed",
        code: "REGISTRATION_FAILED",
      };
    }
  }

  /**
   * Refresh access token
   */
  /**
   * Refresh access token
   * Delegates to TokenManagementService for focused responsibility
   */
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      // Delegate to focused TokenManagementService
      const result = await this.tokenManagementService.refreshToken(
        refreshToken
      );

      // Enrich with permissions if successful
      if (result.success && result.user) {
        const userWithPermissions = await this.enrichUserWithPermissions(
          result.user
        );
        return {
          ...result,
          user: userWithPermissions,
        };
      }

      return result;
    } catch (error) {
      this.deps.monitoring.logger.error("Token refresh delegation failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: "Token refresh failed",
        code: "TOKEN_REFRESH_FAILED",
      };
    }
  }

  /**
   * Logout user (revoke tokens)
   */
  /**
   * Logout user and revoke tokens
   * Delegates to UserAuthenticationService for focused responsibility
   */
  async logout(userId: string, token?: string): Promise<boolean> {
    try {
      // Delegate to focused UserAuthenticationService
      return await this.userAuthService.logout(userId, token);
    } catch (error) {
      this.deps.monitoring.logger.error("Logout delegation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Verify JWT token and return user
   */
  /**
   * Verify JWT token and return user
   * Delegates to TokenManagementService for focused responsibility
   */
  async verifyToken(token: string): Promise<User | null> {
    try {
      // Delegate to focused TokenManagementService
      const user = await this.tokenManagementService.verifyToken(token);

      if (user) {
        return await this.enrichUserWithPermissions(user);
      }

      return null;
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Token verification delegation failed",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Get user by ID
   */
  /**
   * Get user by ID
   * Delegates to UserManagementService for focused responsibility
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      // Delegate to focused UserManagementService
      const user = await this.userManagementService.getUserById(userId);

      if (user) {
        return await this.enrichUserWithPermissions(user);
      }

      return null;
    } catch (error) {
      this.deps.monitoring.logger.error("Get user delegation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update user
   * Delegates to UserManagementService for focused responsibility
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<boolean> {
    try {
      // Delegate to focused UserManagementService
      return await this.userManagementService.updateUser(userId, updates);
    } catch (error) {
      this.deps.monitoring.logger.error("Update user delegation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<boolean> {
    try {
      // Revoke all tokens first
      await this.jwtService.revokeAllUserTokens(userId);

      // Delete from Keycloak
      return await this.keycloakService.deleteUser(userId);
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to delete user", {
        userId,
        error,
      });
      return false;
    }
  }

  /**
   * Check if user has permission
   */
  can(user: User, action: string, resource: string, subject?: any): boolean {
    return this.permissionService.can(
      user,
      action as any,
      resource as any,
      subject
    );
  }

  /**
   * Get user's permissions
   */
  getUserPermissions(user: User): string[] {
    return this.permissionService.getUserPermissions(user);
  }

  /**
   * Get permission service instance
   */
  getPermissionService(): PermissionService {
    return this.permissionService;
  }

  /**
   * Get JWT service instance
   */
  getJWTService(): JWTService {
    return this.jwtService;
  }

  /**
   * Get Keycloak service instance
   */
  getKeycloakService(): KeycloakService {
    return this.keycloakService;
  }

  /**
   * Get Session service instance
   */
  getSessionService(): SessionService {
    return this.sessionService;
  }

  /**
   * Get API Key service instance
   */
  getApiKeyService(): ApiKeyService {
    return this.apiKeyService;
  }

  /**
   * Get Enhanced Monitoring service instance
   */
  getMonitoringService(): EnhancedMonitoringService | undefined {
    return this.monitoringService;
  }

  /**
   * Get Configuration Validation service instance
   */
  getConfigValidator(): ConfigValidationService | undefined {
    return this.configValidator;
  }

  /**
   * Get Permission Cache service instance
   */
  getPermissionCache(): EnhancedPermissionCacheService | undefined {
    return this.permissionCache;
  }

  /**
   * Set Enhanced Monitoring service
   */
  setMonitoringService(service: EnhancedMonitoringService): void {
    this.monitoringService = service;
  }

  /**
   * Set Configuration Validation service
   */
  setConfigValidator(service: ConfigValidationService): void {
    this.configValidator = service;
  }

  /**
   * Set Permission Cache service
   */
  setPermissionCache(service: EnhancedPermissionCacheService): void {
    this.permissionCache = service;
  }

  /**
   * Set Threat Detection service
   */
  setThreatDetector(service: AdvancedThreatDetectionService): void {
    this.threatDetector = service;
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{
    jwt: boolean;
    keycloak: boolean;
    permissions: boolean;
    overall: boolean;
    monitoring?: boolean | undefined;
    cache?: boolean | undefined;
    threatDetection?: boolean | undefined;
  }> {
    try {
      const jwtHealth = true; // JWT service doesn't have external dependencies
      const keycloakHealth = await this.keycloakService.healthCheck();
      const permissionsHealth = true; // Permission service is internal
      const monitoringHealth = this.monitoringService ? true : undefined;
      const cacheHealth = this.permissionCache ? true : undefined;
      const threatDetectionHealth = this.threatDetector ? true : undefined;

      const overall = jwtHealth && keycloakHealth && permissionsHealth;

      return {
        jwt: jwtHealth,
        keycloak: keycloakHealth,
        permissions: permissionsHealth,
        monitoring: monitoringHealth,
        cache: cacheHealth,
        threatDetection: threatDetectionHealth,
        overall,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Health check failed", { error });
      return {
        jwt: false,
        keycloak: false,
        permissions: false,
        monitoring: false,
        cache: false,
        threatDetection: false,
        overall: false,
      };
    }
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private async enrichUserWithPermissions(user: User): Promise<User> {
    try {
      // Try to get from cache first
      if (this.permissionCache) {
        const cachedPermissions = await this.permissionCache.getUserPermissions(
          user.id
        );
        if (cachedPermissions) {
          return {
            ...user,
            permissions: cachedPermissions,
          };
        }
      }

      // Get permissions from permission service
      const permissions = this.permissionService.getUserPermissions(user);

      // Cache the permissions
      if (this.permissionCache) {
        await this.permissionCache.setUserPermissions(
          user.id,
          permissions,
          user.roles
        );
      }

      return {
        ...user,
        permissions,
      };
    } catch (error) {
      this.deps.monitoring.logger.warn(
        "Failed to enrich user with permissions",
        {
          userId: user.id,
          error,
        }
      );
      return user;
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create authentication service instance
 */
export function createAuthenticationService(
  config: AuthConfig,
  deps: ServiceDependencies,
  enhancedServices?: {
    monitoring?: EnhancedMonitoringService;
    configValidator?: ConfigValidationService;
    permissionCache?: EnhancedPermissionCacheService;
    threatDetector?: AdvancedThreatDetectionService;
  }
): AuthenticationService {
  const service = new AuthenticationService(config, deps);

  // Attach enhanced services if provided
  if (enhancedServices?.monitoring) {
    service.setMonitoringService(enhancedServices.monitoring);
  }
  if (enhancedServices?.configValidator) {
    service.setConfigValidator(enhancedServices.configValidator);
  }
  if (enhancedServices?.permissionCache) {
    service.setPermissionCache(enhancedServices.permissionCache);
  }
  if (enhancedServices?.threatDetector) {
    service.setThreatDetector(enhancedServices.threatDetector);
  }

  return service;
}

/**
 * Initialize authentication service
 */
export async function initializeAuthenticationService(
  service: AuthenticationService
): Promise<void> {
  await service.initialize();
}
