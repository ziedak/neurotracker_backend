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

// ===================================================================
// AUTHENTICATION SERVICE CLASS
// ===================================================================

export class AuthenticationService {
  private jwtService: JWTService;
  private keycloakService: KeycloakService;
  private permissionService: PermissionService;
  private sessionService: SessionService;
  private apiKeyService: ApiKeyService;

  // Enhanced Services (optional)
  private monitoringService?: EnhancedMonitoringService;
  private configValidator?: ConfigValidationService;
  private permissionCache?: EnhancedPermissionCacheService;
  private threatDetector?: AdvancedThreatDetectionService;

  constructor(private config: AuthConfig, private deps: ServiceDependencies) {
    this.jwtService = new JWTService(this.config, deps);
    this.keycloakService = new KeycloakService(this.config, deps);
    this.permissionService = new PermissionService(deps);
    this.sessionService = new SessionService(this.config, deps);
    this.apiKeyService = new ApiKeyService(this.config, deps);
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
   */
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    let sanitizedEmail = credentials.email; // Default fallback

    try {
      // Input validation and sanitization
      const validationResult = this.validateLoginCredentials(credentials);
      if (!validationResult.valid) {
        this.deps.monitoring.logger.warn("Login failed - invalid input", {
          email: credentials.email,
          errors: validationResult.errors,
        });

        return {
          success: false,
          error: "Invalid input provided",
          code: "VALIDATION_ERROR",
        };
      }

      // Sanitize email for database queries
      sanitizedEmail = this.sanitizeEmail(credentials.email);
      // Check if account is locked (threat detection)
      if (this.threatDetector?.isAccountLocked(sanitizedEmail)) {
        this.monitoringService?.recordAuthEvent(
          "login_failure",
          sanitizedEmail,
          {
            reason: "account_locked",
            ipAddress: credentials.deviceInfo?.name,
          }
        );
        return {
          success: false,
          error: "Account is temporarily locked due to security policy",
          code: "ACCOUNT_LOCKED",
        };
      }

      // Check if IP is blocked
      if (
        credentials.deviceInfo?.name &&
        this.threatDetector?.isIPBlocked(credentials.deviceInfo.name)
      ) {
        this.monitoringService?.recordAuthEvent(
          "login_failure",
          credentials.email,
          {
            reason: "ip_blocked",
            ipAddress: credentials.deviceInfo.name,
          }
        );
        return {
          success: false,
          error: "Access denied from this location",
          code: "IP_BLOCKED",
        };
      }

      // Authenticate with Keycloak (enhanced version)
      const authOptions: {
        validateAccountStatus: true;
        recordLoginAttempt: true;
        ipAddress?: string;
        userAgent?: string;
      } = {
        validateAccountStatus: true,
        recordLoginAttempt: true,
      };

      if (credentials.deviceInfo?.name) {
        authOptions.ipAddress = credentials.deviceInfo.name;
      }

      if (credentials.deviceInfo?.browser) {
        authOptions.userAgent = credentials.deviceInfo.browser;
      }

      // Authenticate directly with database using real password verification
      const user = await this.jwtService.authenticateUser(
        sanitizedEmail,
        credentials.password
      );

      if (!user) {
        // Record failed attempt
        if (credentials.deviceInfo?.name) {
          await this.threatDetector?.recordFailedAttempt(
            sanitizedEmail,
            credentials.deviceInfo.name,
            credentials.deviceInfo.os,
            { userAgent: credentials.deviceInfo.browser }
          );
        }

        this.monitoringService?.recordAuthEvent(
          "login_failure",
          sanitizedEmail,
          {
            reason: "invalid_credentials",
            ipAddress: credentials.deviceInfo?.name,
          }
        );

        return {
          success: false,
          error: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        };
      }

      // Record successful login
      if (credentials.deviceInfo?.name) {
        await this.threatDetector?.recordSuccessfulAuth(
          user.id,
          credentials.deviceInfo.name,
          credentials.deviceInfo.os
        );
      }

      this.monitoringService?.recordAuthEvent("login_success", user.id, {
        ipAddress: credentials.deviceInfo?.name,
        userAgent: credentials.deviceInfo?.browser,
      });

      // Get user permissions (with caching)
      const userWithPermissions = await this.enrichUserWithPermissions(user);

      // Generate JWT tokens
      const tokens = await this.jwtService.generateTokens(userWithPermissions);

      return {
        success: true,
        user: userWithPermissions,
        tokens,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Login failed", {
        email: sanitizedEmail,
        error,
      });

      // Record monitoring event
      this.monitoringService?.recordAuthEvent("login_failure", sanitizedEmail, {
        reason: "system_error",
        error: error instanceof Error ? error.message : "Unknown error",
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
   */
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      // Register with Keycloak
      const keycloakResult = await this.keycloakService.registerUser(data);

      if (!keycloakResult.success || !keycloakResult.user) {
        return keycloakResult;
      }

      // Get user permissions
      const userWithPermissions = await this.enrichUserWithPermissions(
        keycloakResult.user
      );

      // Generate JWT tokens
      const tokens = await this.jwtService.generateTokens(userWithPermissions);

      return {
        success: true,
        user: userWithPermissions,
        tokens,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Registration failed", {
        email: data.email,
        error,
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
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const tokens = await this.jwtService.refreshToken(refreshToken);

      // Get user from token
      const user = await this.jwtService.verifyToken(tokens.accessToken!);

      return {
        success: true,
        user,
        tokens,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Token refresh failed", { error });

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
  async logout(userId: string, token?: string): Promise<boolean> {
    try {
      if (token) {
        // Revoke specific token
        await this.jwtService.revokeToken(token);
      } else {
        // Revoke all user tokens
        await this.jwtService.revokeAllUserTokens(userId);
      }

      this.deps.monitoring.logger.info("User logged out", { userId });
      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Logout failed", { userId, error });
      return false;
    }
  }

  /**
   * Verify JWT token and return user
   */
  async verifyToken(token: string): Promise<User | null> {
    try {
      const user = await this.jwtService.verifyToken(token);
      return await this.enrichUserWithPermissions(user);
    } catch (error) {
      this.deps.monitoring.logger.error("Token verification failed", { error });
      return null;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const user = await this.keycloakService.getUserById(userId);
      if (user) {
        return await this.enrichUserWithPermissions(user);
      }
      return null;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get user", {
        userId,
        error,
      });
      return null;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<boolean> {
    try {
      return await this.keycloakService.updateUser(userId, updates);
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to update user", {
        userId,
        error,
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

  /**
   * Validate login credentials with comprehensive input validation
   */
  private validateLoginCredentials(credentials: LoginCredentials): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Email validation
    if (!credentials.email || typeof credentials.email !== "string") {
      errors.push("Email is required");
    } else {
      // Trim and normalize email
      const email = credentials.email.trim().toLowerCase();

      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push("Invalid email format");
      }

      // Email length validation
      if (email.length > 254) {
        errors.push("Email is too long");
      }
    }

    // Password validation
    if (!credentials.password || typeof credentials.password !== "string") {
      errors.push("Password is required");
    } else {
      // Password length validation
      if (credentials.password.length < 1) {
        errors.push("Password cannot be empty");
      }
      if (credentials.password.length > 128) {
        errors.push("Password is too long");
      }
    }

    // Device info validation (optional)
    if (credentials.deviceInfo) {
      if (
        credentials.deviceInfo.name &&
        typeof credentials.deviceInfo.name !== "string"
      ) {
        errors.push("Invalid device name");
      }
      if (
        credentials.deviceInfo.type &&
        typeof credentials.deviceInfo.type !== "string"
      ) {
        errors.push("Invalid device type");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Sanitize email input to prevent common attacks
   */
  private sanitizeEmail(email: string): string {
    return email
      .trim()
      .toLowerCase()
      .replace(/[<>\"'&]/g, "") // Remove potentially dangerous characters
      .substring(0, 254); // Limit length
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
