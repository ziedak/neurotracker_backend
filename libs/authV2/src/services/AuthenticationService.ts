import {
  IAuthenticationResult,
  IAuthenticationContext,
  EntityId,
  SessionId,
  JWTToken,
  APIKey,
  createTimestamp,
} from "../types/core";

import {
  IEnhancedUser,
  IEnhancedSession,
  EnhancedTypeGuards,
} from "../types/enhanced";

import {
  IJWTService,
  ISessionService,
  IPermissionService,
  IAPIKeyService,
  ICacheService,
  IAuditService,
  IUserService,
  IAuthenticationService,
  IAuthenticationCredentials,
  IRegistrationData,
  IRegistrationResult,
  IPasswordChangeData,
} from "../contracts/services";

import { AuthenticationError } from "../errors/core";

// Import specialized components
import { CredentialsValidator } from "./auth/CredentialsValidator";
import { RateLimitManager } from "./auth/RateLimitManager";
import { AuthenticationFlowManager } from "./auth/AuthenticationFlowManager";
import { AuthenticationMetrics } from "./auth/AuthenticationMetrics";

/**
 * Simple authentication flow result interface
 */
interface IAuthFlowResult {
  success: boolean;
  user?: any;
  session?: any;
  token?: JWTToken;
  permissions?: string[];
  method?: string;
  userId?: string;
  sessionId?: string;
  expiresAt?: number;
  metadata?: Record<string, any>;
  error?: Error;
}

/**
 * Enterprise Authentication Service Configuration
 */
interface IAuthenticationServiceConfig {
  validation: {
    strictMode: boolean;
    passwordComplexity: boolean;
    deviceValidation: boolean;
  };
  rateLimit: {
    enabled: boolean;
    maxAttempts: number;
    windowMs: number;
    progressivePenalty: boolean;
  };
  cache: {
    enabled: boolean;
    authenticationResultTTL: number;
    validationResultTTL: number;
  };
  audit: {
    enabled: boolean;
    detailedLogging: boolean;
  };
  metrics: {
    enabled: boolean;
    responseTimeTracking: boolean;
  };
  security: {
    sessionTimeout: number;
    tokenRefreshThreshold: number;
  };
}

/**
 * AuthenticationServiceV2 - Enterprise Authentication Orchestrator
 */
export class AuthenticationServiceV2 implements IAuthenticationService {
  // Core service dependencies
  private readonly jwtService: IJWTService;
  private readonly sessionService: ISessionService;
  private readonly permissionService: IPermissionService;
  private readonly apiKeyService: IAPIKeyService;
  private readonly cacheService: ICacheService;
  private readonly auditService: IAuditService;
  private readonly userService: IUserService;

  // Specialized authentication components
  private readonly credentialsValidator: CredentialsValidator;
  private readonly rateLimitManager: RateLimitManager;
  private readonly flowManager: AuthenticationFlowManager;
  private readonly metrics: AuthenticationMetrics;

  // Enterprise configuration
  private readonly config: IAuthenticationServiceConfig;

  // Default enterprise configuration
  private readonly defaultConfig: IAuthenticationServiceConfig = {
    validation: {
      strictMode: true,
      passwordComplexity: true,
      deviceValidation: true,
    },
    rateLimit: {
      enabled: true,
      maxAttempts: 5,
      windowMs: 900000, // 15 minutes
      progressivePenalty: true,
    },
    cache: {
      enabled: true,
      authenticationResultTTL: 300, // 5 minutes
      validationResultTTL: 60, // 1 minute
    },
    audit: {
      enabled: true,
      detailedLogging: true,
    },
    metrics: {
      enabled: true,
      responseTimeTracking: true,
    },
    security: {
      sessionTimeout: 86400000, // 24 hours
      tokenRefreshThreshold: 300000, // 5 minutes
    },
  };

  constructor(
    jwtService: IJWTService,
    sessionService: ISessionService,
    permissionService: IPermissionService,
    apiKeyService: IAPIKeyService,
    cacheService: ICacheService,
    auditService: IAuditService,
    userService: IUserService,
    config?: Partial<IAuthenticationServiceConfig>
  ) {
    this.jwtService = jwtService;
    this.sessionService = sessionService;
    this.permissionService = permissionService;
    this.apiKeyService = apiKeyService;
    this.cacheService = cacheService;
    this.auditService = auditService;
    this.userService = userService;

    // Merge configuration with enterprise defaults
    this.config = {
      validation: { ...this.defaultConfig.validation, ...config?.validation },
      rateLimit: { ...this.defaultConfig.rateLimit, ...config?.rateLimit },
      cache: { ...this.defaultConfig.cache, ...config?.cache },
      audit: { ...this.defaultConfig.audit, ...config?.audit },
      metrics: { ...this.defaultConfig.metrics, ...config?.metrics },
      security: { ...this.defaultConfig.security, ...config?.security },
    };

    // Initialize specialized authentication components
    this.credentialsValidator = new CredentialsValidator();

    this.rateLimitManager = new RateLimitManager(cacheService);

    this.flowManager = new AuthenticationFlowManager(
      jwtService,
      sessionService,
      permissionService,
      apiKeyService,
      auditService,
      userService
    );

    this.metrics = new AuthenticationMetrics(cacheService);
  }

  /**
   * Comprehensive authentication with enterprise security validation
   */
  async authenticate(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Check cached authentication result for performance
      if (this.config.cache.enabled) {
        const cachedResult = await this.getCachedAuthResult(credentials);
        if (cachedResult) {
          if (this.config.metrics.enabled) {
            await this.metrics.recordResponseTime(
              Date.now() - startTime,
              "password",
              true
            );
          }
          return cachedResult;
        }
      }

      // Step 2: Comprehensive credential validation with security analysis
      if (this.config.validation.strictMode) {
        this.credentialsValidator.validateAuthenticationCredentials(
          credentials
        );
      }

      // Step 3: Advanced rate limiting with progressive penalties
      if (this.config.rateLimit.enabled) {
        const identifier = this.extractIdentifier(credentials);
        const method = this.determineAuthMethod(credentials);

        await this.rateLimitManager.enforceRateLimit(identifier, method);
      }

      // Step 4: Execute sophisticated authentication flow
      const flowResult = await this.executeAuthenticationFlow(credentials);

      if (!flowResult.success) {
        throw (
          flowResult.error || new AuthenticationError("Authentication failed")
        );
      }

      // Step 5: Build comprehensive authentication result
      const authResult = await this.buildAuthenticationResult(flowResult);

      // Step 6: Cache successful authentication result
      if (this.config.cache.enabled) {
        await this.cacheAuthResult(authResult, credentials);
      }

      // Step 7: Record detailed metrics and performance
      if (this.config.metrics.enabled) {
        const method = this.determineAuthMethod(credentials);
        await this.metrics.recordAttempt(
          method,
          "success",
          flowResult.userId || "unknown"
        );
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          method,
          true
        );
      }

      // Step 8: Comprehensive audit logging
      if (this.config.audit.enabled) {
        await this.auditService.logAuthEvent(
          flowResult.userId! as EntityId,
          "authentication_success",
          "success",
          {
            method: flowResult.method,
            sessionId: flowResult.sessionId,
            responseTime: Date.now() - startTime,
            permissions: flowResult.permissions?.length || 0,
            ...flowResult.metadata,
          }
        );
      }

      return authResult;
    } catch (error) {
      // Comprehensive error handling with detailed audit trail
      const authError =
        error instanceof Error
          ? error
          : new AuthenticationError("Authentication failed");

      if (this.config.metrics.enabled) {
        const method = this.determineAuthMethod(credentials);
        const identifier = this.extractIdentifier(credentials);
        await this.metrics.recordAttempt(
          method,
          "failure",
          identifier,
          authError.message
        );
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          method,
          false
        );
      }

      if (this.config.audit.enabled) {
        await this.auditService.logAuthEvent(
          null,
          "authentication_failure",
          "failure",
          {
            error: authError.message,
            method: this.determineAuthMethod(credentials),
            identifier: this.extractIdentifier(credentials),
            responseTime: Date.now() - startTime,
          }
        );
      }

      throw authError;
    }
  }

  // Implement required interface methods
  async register(
    registrationData: IRegistrationData
  ): Promise<IRegistrationResult> {
    return await this.flowManager.executeRegistrationFlow(registrationData);
  }

  async validateContext(
    context: IAuthenticationContext
  ): Promise<IAuthenticationResult> {
    // Validate user has permission for context validation
    if (context.user?.id) {
      const hasPermission = await this.permissionService.hasPermission(
        context.user.id as EntityId,
        "authentication",
        "validate"
      );

      if (!hasPermission) {
        throw new Error("Insufficient permissions for context validation");
      }
    }

    const flowResult = await this.flowManager.executeContextValidationFlow(
      context
    );
    return await this.buildAuthenticationResult(flowResult);
  }

  async refresh(refreshToken: JWTToken): Promise<IAuthenticationResult> {
    const flowResult = await this.flowManager.executeRefreshFlow(refreshToken);
    return await this.buildAuthenticationResult(flowResult);
  }

  async logout(context: IAuthenticationContext): Promise<boolean> {
    return await this.sessionService.end(context.session!.id as SessionId);
  }

  async changePassword(
    context: IAuthenticationContext,
    passwordData: IPasswordChangeData
  ): Promise<boolean> {
    return await this.flowManager.executePasswordChangeFlow(
      context,
      passwordData
    );
  }

  async getContextBySession(
    sessionId: SessionId
  ): Promise<IAuthenticationContext | null> {
    try {
      const session = await this.sessionService.findById(sessionId);
      if (!session) return null;

      // Get user details
      const user = await this.userService.findById(session.userId);
      if (!user) return null;

      // User is already enhanced from UserService
      if (!EnhancedTypeGuards.isEnhancedUser(user)) {
        console.warn(
          "User from UserService is not enhanced - this should not happen"
        );
        return null;
      }

      // Get user permissions
      const permissions = await this.permissionService.getUserPermissions(
        user.id
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          password: "", // Never expose password in context
          username: user.username,
          status: user.status,
          emailVerified: user.emailVerified || false,
          phoneVerified: user.phoneVerified || false,
          loginCount: user.loginCount || 0,
          createdAt: new Date(user.createdAt), // Convert Timestamp to Date
          updatedAt: new Date(user.updatedAt), // Convert Timestamp to Date
          isDeleted: user.isDeleted || false,
          // Core user fields (ensuring compatibility)
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          phone: user.phone || null,
          lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
          deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
          metadata: user.metadata || null,
          // Enterprise fields
          roleId: user.roleId || null,
          storeId: user.storeId || null,
          organizationId: user.organizationId || null,
          roleAssignedAt: user.roleAssignedAt
            ? new Date(user.roleAssignedAt)
            : null,
          roleRevokedAt: user.roleRevokedAt
            ? new Date(user.roleRevokedAt)
            : null,
          roleAssignedBy: user.roleAssignedBy || null,
          roleRevokedBy: user.roleRevokedBy || null,
          roleExpiresAt: user.roleExpiresAt
            ? new Date(user.roleExpiresAt)
            : null,
          createdBy: user.createdBy || null,
          updatedBy: user.updatedBy || null,
          auditLog: user.auditLog || null,
        },
        session: {
          id: session.id,
          userId: session.userId,
          sessionId: session.sessionId,
          isActive: session.isActive,
          ipAddress: session.ipAddress || null,
          userAgent: session.userAgent || null,
          createdAt: new Date(session.createdAt), // Convert Timestamp to Date
          updatedAt: new Date(session.updatedAt), // Convert Timestamp to Date
          expiresAt: session.expiresAt ? new Date(session.expiresAt) : null, // Convert Timestamp to Date
          metadata: session.metadata || null,
          endedAt: session.endedAt || null,
        },
        permissions: permissions.map((p) => p.name),
        roles: [], // TODO: Get user roles
        ipAddress:
          (session.metadata?.["ipAddress"] as string) ||
          session.ipAddress ||
          "0.0.0.0",
        userAgent:
          (session.metadata?.["userAgent"] as string) ||
          session.userAgent ||
          "unknown",
        timestamp: createTimestamp(),
        metadata: {
          ...(session.metadata || {}),
          // Add enhanced user security metadata
          enhancedSecurity: {
            failedLoginAttempts: user.securityMetadata.failedLoginAttempts,
            mfaEnabled: user.securityMetadata.mfaEnabled,
            trustedDevicesCount: user.securityMetadata.trustedDevices.length,
            suspiciousActivitiesCount:
              user.securityMetadata.suspiciousActivities.length,
          },
          userPreferences: {
            theme: user.preferences.theme,
            language: user.preferences.language,
            timezone: user.preferences.timezone,
          },
        },
      };
    } catch (error) {
      return null;
    }
  }

  async getContextByJWT(
    token: JWTToken
  ): Promise<IAuthenticationContext | null> {
    try {
      const validation = await this.jwtService.verify(token);
      if (!validation.isValid || !validation.payload) return null;

      // Get user details from payload
      const userId = validation.payload.sub || validation.payload.userId;
      if (!userId) return null;

      const user = await this.userService.findById(userId as EntityId);
      if (!user) return null;

      // User is already enhanced from UserService
      if (!EnhancedTypeGuards.isEnhancedUser(user)) {
        console.warn(
          "User from UserService is not enhanced - this should not happen"
        );
        return null;
      }

      // Get user permissions (either from token or service)
      const permissions =
        validation.payload.permissions ||
        (await this.permissionService.getUserPermissions(user.id)).map(
          (p) => p.name
        );

      return {
        user: {
          id: user.id,
          email: user.email,
          password: "", // Never expose password
          username: user.username,
          status: user.status,
          emailVerified: user.emailVerified || false,
          phoneVerified: user.phoneVerified || false,
          loginCount: user.loginCount || 0,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
          isDeleted: user.isDeleted || false,
          // Core user fields (ensuring compatibility)
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          phone: user.phone || null,
          lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
          deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
          metadata: user.metadata || null,
          // Enterprise fields
          roleId: user.roleId || null,
          storeId: user.storeId || null,
          organizationId: user.organizationId || null,
          roleAssignedAt: user.roleAssignedAt
            ? new Date(user.roleAssignedAt)
            : null,
          roleRevokedAt: user.roleRevokedAt
            ? new Date(user.roleRevokedAt)
            : null,
          roleAssignedBy: user.roleAssignedBy || null,
          roleRevokedBy: user.roleRevokedBy || null,
          roleExpiresAt: user.roleExpiresAt
            ? new Date(user.roleExpiresAt)
            : null,
          createdBy: user.createdBy || null,
          updatedBy: user.updatedBy || null,
          auditLog: user.auditLog || null,
        },
        session: null, // JWT doesn't have session context
        permissions: permissions,
        roles: [], // TODO: Get user roles from JWT payload or service
        ipAddress: "0.0.0.0", // Not available from JWT
        userAgent: "unknown", // Not available from JWT
        timestamp: createTimestamp(),
        metadata: {
          jwtUsed: true,
          tokenIssuer: validation.payload.iss,
          tokenSubject: validation.payload.sub,
          tokenExpires: validation.payload.exp,
          // Add enhanced user security metadata
          enhancedSecurity: {
            failedLoginAttempts: user.securityMetadata.failedLoginAttempts,
            mfaEnabled: user.securityMetadata.mfaEnabled,
            trustedDevicesCount: user.securityMetadata.trustedDevices.length,
            suspiciousActivitiesCount:
              user.securityMetadata.suspiciousActivities.length,
          },
          userPreferences: {
            theme: user.preferences.theme,
            language: user.preferences.language,
            timezone: user.preferences.timezone,
          },
        },
      };
    } catch (error) {
      return null;
    }
  }

  async getContextByAPIKey(
    apiKey: APIKey
  ): Promise<IAuthenticationContext | null> {
    try {
      const validation = await this.apiKeyService.validate(apiKey);
      if (!validation || !validation.isValid || !validation.keyInfo)
        return null;

      // Get full user details from user service
      const user = await this.userService.findById(validation.keyInfo.userId);
      if (!user) return null;

      // Get user permissions from the permission service
      const userPermissions = await this.permissionService.getUserPermissions(
        user.id
      );
      const permissions = userPermissions.map((p) => p.name);

      // Merge API key scopes with user permissions
      const combinedPermissions = Array.from(
        new Set([...permissions, ...(validation.keyInfo.scopes as string[])])
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          password: "", // Never expose password
          username: user.username,
          status: user.status,
          emailVerified: user.emailVerified || false,
          phoneVerified: user.phoneVerified || false,
          loginCount: user.loginCount || 0,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
          isDeleted: user.isDeleted || false,
        },
        session: null, // API Key doesn't have session context
        permissions: combinedPermissions,
        roles: [], // API Key doesn't typically have role context
        ipAddress: "0.0.0.0", // Not available from API Key
        userAgent: "unknown", // Not available from API Key
        timestamp: createTimestamp(),
        metadata: {
          apiKeyUsed: true,
          apiKeyId: validation.keyInfo.id,
          apiKeyScopes: validation.keyInfo.scopes,
          keyName: validation.keyInfo.name,
        },
      };
    } catch (error) {
      return null;
    }
  }

  async getHealth(): Promise<any> {
    return {
      status: "healthy",
      lastChecked: createTimestamp(),
      services: {
        jwt: "healthy",
        session: "healthy",
        permission: "healthy",
        apiKey: "healthy",
        cache: "healthy",
        audit: "healthy",
      },
    };
  }

  /**
   * Enhanced tenant context validation for multi-tenancy
   * Phase 4: Enterprise multi-tenancy support
   */
  async validateTenantContext(
    context: IAuthenticationContext,
    requiredTenantId?: string
  ): Promise<boolean> {
    if (!context.user) {
      return false;
    }

    // Validate enhanced user structure for enterprise features
    if (!EnhancedTypeGuards.isEnhancedUser(context.user as any)) {
      console.warn(
        "User in context is not enhanced - this should not happen in Phase 4"
      );
      return false;
    }

    const user = context.user as any; // We know it's enhanced from the guard above

    // Multi-tenant validation: Check store/organization boundaries
    if (requiredTenantId) {
      // Check if user has access to the required tenant (store or organization)
      const hasStoreAccess = user.storeId === requiredTenantId;
      const hasOrgAccess = user.organizationId === requiredTenantId;

      if (!hasStoreAccess && !hasOrgAccess) {
        // Audit failed tenant access attempt
        if (this.config.audit.enabled) {
          await this.auditService.logAuthEvent(
            user.id as EntityId,
            "tenant_access_denied",
            "failure",
            {
              requiredTenantId,
              userStoreId: user.storeId,
              userOrgId: user.organizationId,
              timestamp: createTimestamp(),
            }
          );
        }
        return false;
      }
    }

    // Validate user is active and not deleted
    if (!user.isActive || user.isDeleted) {
      return false;
    }

    // Enhanced security validation using security metadata
    const securityMetadata = user.securityMetadata;
    if (securityMetadata) {
      // Check for excessive failed login attempts
      if (securityMetadata.failedLoginAttempts > 10) {
        console.warn(
          `User ${user.id} has excessive failed login attempts: ${securityMetadata.failedLoginAttempts}`
        );
        return false;
      }

      // Check for critical suspicious activities
      const criticalActivities = securityMetadata.suspiciousActivities.filter(
        (activity: any) =>
          activity.severity === "critical" && !activity.resolved
      );
      if (criticalActivities.length > 0) {
        console.warn(
          `User ${user.id} has unresolved critical suspicious activities`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Enhanced authentication with multi-tenant context
   * Phase 4: Enterprise multi-tenancy integration
   */
  async authenticateWithTenantContext(
    credentials: IAuthenticationCredentials,
    tenantId?: string
  ): Promise<IAuthenticationResult> {
    // First perform standard authentication
    const authResult = await this.authenticate(credentials);

    if (!authResult.success) {
      return authResult;
    }

    // Get the authenticated context for tenant validation
    const context = await this.getContextBySession(
      authResult.session?.id as SessionId
    );

    if (!context) {
      return {
        success: false,
        user: null,
        session: null,
        accessToken: null,
        refreshToken: null,
        permissions: [],
        roles: [],
        expiresAt: null,
        errors: ["Failed to create authentication context"],
        metadata: { error: "context_creation_failed" },
      };
    }

    // Validate tenant context
    const isValidTenant = await this.validateTenantContext(context, tenantId);

    if (!isValidTenant) {
      // Revoke the session since tenant validation failed
      if (context.session) {
        await this.sessionService.end(context.session.id as SessionId);
      }

      return {
        success: false,
        user: null,
        session: null,
        accessToken: null,
        refreshToken: null,
        permissions: [],
        roles: [],
        expiresAt: null,
        errors: ["Tenant access denied"],
        metadata: {
          error: "tenant_access_denied",
          tenantId,
          timestamp: createTimestamp(),
        },
      };
    }

    // Enhance the result with tenant context information
    return {
      ...authResult,
      metadata: {
        ...authResult.metadata,
        tenantId,
        tenantValidated: true,
        enhancedSecurity: true,
        validatedAt: createTimestamp(),
      },
    };
  }

  /**
   * Enhanced runtime validation for authentication inputs
   * Phase 4: Runtime schema validation for enterprise security
   */
  private validateAuthenticationInput(
    credentials: IAuthenticationCredentials
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic structure validation
    if (!credentials || typeof credentials !== "object") {
      errors.push("Invalid credentials structure");
      return { isValid: false, errors };
    }

    // Password-based authentication validation
    if ("email" in credentials && "password" in credentials) {
      if (!credentials.email || typeof credentials.email !== "string") {
        errors.push("Invalid email format");
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email)) {
        errors.push("Invalid email format");
      }

      if (!credentials.password || typeof credentials.password !== "string") {
        errors.push("Invalid password");
      } else if (credentials.password.length < 8) {
        errors.push("Password too short - minimum 8 characters required");
      }
    }

    // API Key authentication validation
    else if ("apiKey" in credentials) {
      if (!credentials.apiKey || typeof credentials.apiKey !== "string") {
        errors.push("Invalid API key format");
      } else if (credentials.apiKey.length < 32) {
        errors.push("Invalid API key length");
      }
    }

    // JWT token authentication validation
    else if ("token" in credentials) {
      if (!credentials.token || typeof credentials.token !== "string") {
        errors.push("Invalid JWT token format");
      } else if (!credentials.token.includes(".")) {
        errors.push("Invalid JWT token structure");
      }
    }

    // Unknown authentication method
    else {
      errors.push("Unsupported authentication method");
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Enhanced authentication with comprehensive input validation
   * Phase 4: Runtime validation and security hardening
   */
  async authenticateSecure(
    credentials: IAuthenticationCredentials,
    options?: {
      tenantId?: string;
      validateInput?: boolean;
      securityLevel?: "basic" | "standard" | "enhanced" | "maximum";
    }
  ): Promise<IAuthenticationResult> {
    const {
      tenantId,
      validateInput = true,
      securityLevel = "enhanced",
    } = options || {};

    // Phase 4: Runtime input validation
    if (validateInput) {
      const validation = this.validateAuthenticationInput(credentials);
      if (!validation.isValid) {
        // Audit invalid input attempts
        if (this.config.audit.enabled) {
          await this.auditService.logAuthEvent(
            null,
            "invalid_authentication_input",
            "failure",
            {
              errors: validation.errors,
              securityLevel,
              timestamp: createTimestamp(),
            }
          );
        }

        return {
          success: false,
          user: null,
          session: null,
          accessToken: null,
          refreshToken: null,
          permissions: [],
          roles: [],
          expiresAt: null,
          errors: validation.errors,
          metadata: {
            error: "input_validation_failed",
            securityLevel,
            validationErrors: validation.errors,
          },
        };
      }
    }

    // Use tenant-aware authentication if tenantId provided
    if (tenantId) {
      return await this.authenticateWithTenantContext(credentials, tenantId);
    }

    // Standard authentication with enhanced security
    const authResult = await this.authenticate(credentials);

    // Enhance result with security metadata
    if (authResult.success) {
      return {
        ...authResult,
        metadata: {
          ...authResult.metadata,
          securityLevel,
          inputValidated: validateInput,
          enhancedSecurity: true,
          phase4Features: true,
          validatedAt: createTimestamp(),
        },
      };
    }

    return authResult;
  }

  /**
   * Private Utility Methods
   */

  private async executeAuthenticationFlow(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthFlowResult> {
    // Simplified authentication flow execution
    try {
      if ("password" in credentials) {
        return await this.executePasswordAuthentication(credentials);
      } else if ("apiKey" in credentials) {
        return await this.executeAPIKeyAuthentication(credentials);
      } else if ("token" in credentials) {
        return await this.executeJWTAuthentication(
          credentials as { token: JWTToken }
        );
      }

      throw new AuthenticationError("Unsupported authentication method");
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error : new Error("Authentication failed"),
      };
    }
  }

  private async executePasswordAuthentication(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthFlowResult> {
    try {
      const flowResult = await this.flowManager.executePasswordFlow(
        credentials
      );

      if (!flowResult.success) {
        throw new AuthenticationError(
          flowResult.error?.message || "Password authentication failed"
        );
      }

      return {
        success: true,
        user: { id: flowResult.userId },
        userId: flowResult.userId as string,
        sessionId: flowResult.sessionId as string,
        method: "password",
        ...(flowResult.tokens && {
          token: flowResult.tokens.accessToken,
          expiresAt: flowResult.tokens.expiresAt,
        }),
        permissions: flowResult.permissions || [],
        ...(flowResult.metadata && { metadata: flowResult.metadata }),
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("Authentication failed"),
      };
    }
  }

  private async executeAPIKeyAuthentication(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthFlowResult> {
    try {
      const flowResult = await this.flowManager.executeAPIKeyFlow(credentials);

      if (!flowResult.success) {
        throw new AuthenticationError(
          flowResult.error?.message || "API key authentication failed"
        );
      }

      return {
        success: true,
        user: { id: flowResult.userId },
        userId: flowResult.userId as string,
        sessionId: flowResult.sessionId as string,
        method: "apikey",
        ...(flowResult.tokens && {
          token: flowResult.tokens.accessToken,
          expiresAt: flowResult.tokens.expiresAt,
        }),
        permissions: flowResult.permissions || [],
        metadata: {
          ...flowResult.metadata,
          apiKey: credentials.apiKey,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("API key authentication failed"),
      };
    }
  }

  private async executeJWTAuthentication(credentials: {
    token: JWTToken;
  }): Promise<IAuthFlowResult> {
    try {
      const jwtResult = await this.jwtService.verify(credentials.token);

      if (!jwtResult.isValid) {
        throw new AuthenticationError(
          jwtResult.failureReason || "Invalid JWT token"
        );
      }

      // Build context from JWT payload
      const authContext = {
        userId: jwtResult.payload?.userId,
        sessionId: jwtResult.payload?.sessionId,
        permissions: jwtResult.payload?.permissions,
      };

      return {
        success: true,
        user: { id: authContext.userId },
        userId: authContext.userId as string,
        sessionId: authContext.sessionId as string,
        method: "jwt",
        token: credentials.token,
        ...(jwtResult.expiresAt && {
          expiresAt: jwtResult.expiresAt.getTime(),
        }),
        permissions: authContext.permissions || [],
        metadata: {
          tokenIssued: jwtResult.payload?.iat,
          tokenExpires: jwtResult.payload?.exp,
          isBlacklisted: jwtResult.isBlacklisted,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("JWT authentication failed"),
      };
    }
  }

  private determineAuthMethod(
    credentials: IAuthenticationCredentials
  ): "password" | "apikey" | "jwt" {
    if ("password" in credentials) {
      return "password";
    } else if ("apiKey" in credentials) {
      return "apikey";
    } else if ("token" in credentials) {
      return "jwt";
    }

    throw new AuthenticationError("Unknown authentication method");
  }

  private extractIdentifier(credentials: IAuthenticationCredentials): string {
    if ("email" in credentials) {
      return String(credentials.email);
    } else if ("username" in credentials) {
      return String(credentials.username);
    } else if ("apiKey" in credentials) {
      return String(credentials.apiKey);
    } else if ("token" in credentials) {
      return String(credentials.token);
    }

    throw new AuthenticationError("Cannot extract identifier from credentials");
  }

  private async buildAuthenticationResult(
    flowResult: IAuthFlowResult
  ): Promise<IAuthenticationResult> {
    if (!flowResult.success) {
      throw (
        flowResult.error || new AuthenticationError("Authentication failed")
      );
    }

    return {
      success: true,
      user: flowResult.user!,
      session: flowResult.session || null,
      accessToken: flowResult.token || null,
      refreshToken: null,
      permissions: flowResult.permissions || [],
      roles: [],
      expiresAt: flowResult.expiresAt ? createTimestamp() : null,
      errors: [],
      metadata: {
        method: flowResult.method,
        loginTime: createTimestamp(),
        ...flowResult.metadata,
      },
    };
  }

  private async getCachedAuthResult(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult | null> {
    if (!this.config.cache.enabled) {
      return null;
    }

    const identifier = this.extractIdentifier(credentials);
    const method = this.determineAuthMethod(credentials);
    const cacheKey = `auth:authentication:${method}:${identifier}`;

    return await this.cacheService.get(cacheKey);
  }

  private async cacheAuthResult(
    result: IAuthenticationResult,
    credentials: IAuthenticationCredentials
  ): Promise<void> {
    if (!this.config.cache.enabled || !result.success) {
      return;
    }

    const identifier = this.extractIdentifier(credentials);
    const method = this.determineAuthMethod(credentials);
    const cacheKey = `auth:authentication:${method}:${identifier}`;

    await this.cacheService.set(
      cacheKey,
      result,
      this.config.cache.authenticationResultTTL
    );
  }
}
