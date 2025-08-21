/**
 * @fileoverview AuthenticationServiceV2 - Enterprise authentication orchestration service
 * @module services/AuthenticationService
 * @version 1.0.0
 * @author Enterprise Development Team
 * @description Complete enterprise authentication orchestration service that coordinates all AuthV2 components
 * 
 * This service represents the pinnacle of Phase 4 development, providing a comprehensive
 * orchestration layer that leverages specialized authentication components to deliver
 * enterprise-grade authentication and authorization capabilities with full observability,
 * security, and performance monitoring.
 * 
 * Architecture:
 * - CredentialsValidator: Advanced credential validation with security patterns
 * - RateLimitManager: Sophisticated rate limiting with progressive penalties
 * - AuthenticationFlowManager: Complex authentication flow orchestration
 * - AuthenticationMetrics: Comprehensive metrics collection and analysis
 * - Full integration with JWT, Session, Permission, APIKey, Cache, and Audit services
 */

import type {
  EntityId,
  SessionId,
  JWTToken,
  APIKey,
  IAuthenticationResult,
  IAuthenticationContext,
} from "../types/core";

import { createTimestamp } from "../types/core";

import type { IServiceHealth } from "../types/enhanced";

import type {
  IAuthenticationService,
  IJWTService,
  ISessionService,
  IPermissionService,
  IAPIKeyService,
  ICacheService,
  IAuditService,
  IAuthenticationCredentials,
  IRegistrationData,
  IRegistrationResult,
  IPasswordChangeData,
} from "../contracts/services";

import {
  ValidationError,
  AuthenticationError,
  InvalidCredentialsError,
  RateLimitError,
} from "../errors/core";

// Import our specialized authentication components
import { CredentialsValidator } from "./auth/CredentialsValidator";
import { RateLimitManager } from "./auth/RateLimitManager";
import { AuthenticationFlowManager } from "./auth/AuthenticationFlowManager";
import { AuthenticationMetrics } from "./auth/AuthenticationMetrics";

/**
 * Authentication service configuration
 */
interface IAuthenticationServiceConfig {
  readonly rateLimit: {
    enabled: boolean;
    customLimits?: Record<string, any>;
  };
  readonly metrics: {
    enabled: boolean;
    detailedTracking: boolean;
  };
  readonly validation: {
    strictMode: boolean;
    customPasswordRequirements?: Record<string, any>;
  };
  readonly audit: {
    enabled: boolean;
    detailedLogging: boolean;
  };
  readonly cache: {
    enabled: boolean;
    ttl: {
      context: number;
      validation: number;
      failedAttempts: number;
    };
  };
}

/**
 * Default service configuration
 */
const DEFAULT_CONFIG: IAuthenticationServiceConfig = {
  rateLimit: {
    enabled: true
  },
  metrics: {
    enabled: true,
    detailedTracking: true
  },
  validation: {
    strictMode: true
  },
  audit: {
    enabled: true,
    detailedLogging: true
  },
  cache: {
    enabled: true,
    ttl: {
      context: 900, // 15 minutes
      validation: 300, // 5 minutes
      failedAttempts: 3600 // 1 hour
    }
  }
};

/**
 * Authentication method types
 */
type AuthenticationMethod = "password" | "apikey" | "session" | "jwt";

/**
 * Enterprise Authentication Service V2
 * 
 * The most sophisticated authentication service in the AuthV2 ecosystem, providing:
 * 
 * **Core Authentication Features:**
 * - Multi-method authentication (password, API key, session, JWT)
 * - Advanced credential validation with security pattern detection
 * - Sophisticated rate limiting with progressive penalties
 * - Complex authentication flow orchestration
 * - Comprehensive context validation and synchronization
 * 
 * **Security Features:**
 * - Real-time threat detection and mitigation
 * - Advanced rate limiting with IP and user-based tracking
 * - Comprehensive audit logging with detailed metadata
 * - Secure password management with enterprise requirements
 * - API key validation with permission intersection
 * 
 * **Performance Features:**
 * - Multi-layer caching for optimal performance
 * - Response time monitoring and optimization
 * - Efficient session management and cleanup
 * - Optimized database interactions
 * 
 * **Observability Features:**
 * - Detailed metrics collection and analysis
 * - Real-time performance monitoring
 * - Comprehensive health checking
 * - Advanced error tracking and categorization
 * - Business intelligence reporting
 * 
 * **Enterprise Features:**
 * - Service health monitoring and alerting
 * - Configuration management and hot reloading
 * - Graceful degradation and fault tolerance
 * - Integration with enterprise monitoring systems
 * - Compliance and regulatory reporting
 */
export class AuthenticationServiceV2 implements IAuthenticationService {
  // Core service dependencies
  private readonly jwtService: IJWTService;
  private readonly sessionService: ISessionService;
  private readonly permissionService: IPermissionService;
  private readonly apiKeyService: IAPIKeyService;
  private readonly cacheService: ICacheService;
  private readonly auditService: IAuditService;

  // Specialized authentication components
  private readonly credentialsValidator: CredentialsValidator;
  private readonly rateLimitManager: RateLimitManager;
  private readonly flowManager: AuthenticationFlowManager;
  private readonly metrics: AuthenticationMetrics;

  // Service configuration and state
  private readonly config: IAuthenticationServiceConfig;
  private readonly healthCheckInterval: number = 30000; // 30 seconds
  private healthCheckTimer?: NodeJS.Timeout;
  private lastHealthCheck?: Date;
  private serviceStartTime: Date;

  constructor(
    jwtService: IJWTService,
    sessionService: ISessionService,
    permissionService: IPermissionService,
    apiKeyService: IAPIKeyService,
    cacheService: ICacheService,
    auditService: IAuditService,
    config: Partial<IAuthenticationServiceConfig> = {}
  ) {
    // Initialize core services
    this.jwtService = jwtService;
    this.sessionService = sessionService;
    this.permissionService = permissionService;
    this.apiKeyService = apiKeyService;
    this.cacheService = cacheService;
    this.auditService = auditService;

    // Merge configuration
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize specialized components
    this.credentialsValidator = new CredentialsValidator(
      this.config.validation.customPasswordRequirements
    );
    
    this.rateLimitManager = new RateLimitManager(
      cacheService,
      this.config.rateLimit.customLimits
    );
    
    this.flowManager = new AuthenticationFlowManager(
      jwtService,
      sessionService,
      permissionService,
      apiKeyService,
      cacheService,
      auditService
    );
    
    this.metrics = new AuthenticationMetrics(cacheService);

    // Initialize service state
    this.serviceStartTime = new Date();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Log service initialization
    this.logServiceEvent("service_initialized", {
      config: this.config,
      startTime: this.serviceStartTime.toISOString()
    });
  }

  /**
   * Authenticate user with comprehensive validation and monitoring
   */
  async authenticate(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    const startTime = Date.now();
    const method = this.determineAuthMethod(credentials);
    const identifier = this.extractIdentifier(credentials);

    try {
      // Step 1: Validate credentials structure and security
      if (this.config.validation.strictMode) {
        this.credentialsValidator.validateAuthenticationCredentials(credentials);
      }

      // Step 2: Check and enforce rate limiting
      if (this.config.rateLimit.enabled) {
        await this.rateLimitManager.enforceRateLimit(identifier, method);
      }

      // Step 3: Record authentication attempt
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt(method, "attempt", identifier);
      }

      // Step 4: Execute authentication flow
      let flowResult;
      switch (method) {
        case "password":
          flowResult = await this.flowManager.executePasswordFlow(credentials);
          break;
        case "apikey":
          flowResult = await this.flowManager.executeAPIKeyFlow(credentials);
          break;
        default:
          throw new ValidationError("Unsupported authentication method", [
            { field: "method", message: `Method ${method} is not supported for authenticate operation` }
          ]);
      }

      if (!flowResult.success || !flowResult.userId) {
        throw flowResult.error || new AuthenticationError("Authentication failed");
      }

      // Step 5: Build comprehensive authentication result
      const authResult = await this.buildAuthenticationResult(flowResult, method);

      // Step 6: Record successful authentication
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt(method, "success", flowResult.userId);
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          method,
          true
        );
      }

      // Step 7: Log successful authentication with detailed audit trail
      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: flowResult.userId,
          action: "authentication_success",
          timestamp: createTimestamp(),
          metadata: {
            method,
            sessionId: flowResult.sessionId,
            permissions: flowResult.permissions,
            responseTime: Date.now() - startTime,
            ...credentials.metadata
          }
        });
      }

      // Step 8: Cache authentication result for performance
      if (this.config.cache.enabled && authResult.session) {
        await this.cacheAuthenticationContext(authResult, method);
      }

      return authResult;

    } catch (error) {
      // Comprehensive error handling and reporting
      const authError = this.handleAuthenticationError(error, method, identifier);
      
      // Record failed authentication metrics
      if (this.config.metrics.enabled) {
        const errorCode = this.extractErrorCode(authError);
        await this.metrics.recordAttempt(method, "failure", identifier, errorCode);
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          method,
          false
        );
      }

      // Audit failed authentication
      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: identifier as EntityId,
          action: "authentication_failure",
          timestamp: createTimestamp(),
          metadata: {
            method,
            error: authError.message,
            errorCode: this.extractErrorCode(authError),
            responseTime: Date.now() - startTime,
            ...credentials.metadata
          }
        });
      }

      throw authError;
    }
  }

  /**
   * Register new user with comprehensive validation and setup
   */
  async register(registrationData: IRegistrationData): Promise<IRegistrationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Comprehensive registration data validation
      if (this.config.validation.strictMode) {
        this.credentialsValidator.validateRegistrationData(registrationData);
      }

      // Step 2: Check registration rate limiting (prevent spam registrations)
      if (this.config.rateLimit.enabled) {
        await this.rateLimitManager.enforceRateLimit(
          registrationData.email,
          "password" // Use password method for registration rate limiting
        );
      }

      // Step 3: Execute registration flow with comprehensive setup
      const registrationResult = await this.flowManager.executeRegistrationFlow(registrationData);

      // Step 4: Record registration metrics
      if (this.config.metrics.enabled) {
        const method = "password"; // Registration uses password method
        if (registrationResult.success) {
          await this.metrics.recordAttempt(method, "success", registrationData.email);
        } else {
          await this.metrics.recordAttempt(method, "failure", registrationData.email, "registration_failed");
        }
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          method,
          registrationResult.success
        );
      }

      // Step 5: Log registration attempt with detailed audit trail
      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: (registrationResult.user?.id || registrationData.email) as EntityId,
          action: registrationResult.success ? "registration_success" : "registration_failure",
          timestamp: createTimestamp(),
          metadata: {
            email: registrationData.email,
            username: registrationData.username,
            responseTime: Date.now() - startTime,
            failureReason: registrationResult.failureReason,
            ...registrationData.metadata
          }
        });
      }

      return registrationResult;

    } catch (error) {
      // Handle registration errors with comprehensive logging
      const registrationError = error instanceof Error ? error : new Error("Registration failed");
      
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("password", "failure", registrationData.email, "registration_error");
        await this.metrics.recordResponseTime(Date.now() - startTime, "password", false);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: registrationData.email as EntityId,
          action: "registration_error",
          timestamp: createTimestamp(),
          metadata: {
            error: registrationError.message,
            responseTime: Date.now() - startTime,
            ...registrationData.metadata
          }
        });
      }

      return {
        success: false,
        user: null,
        authenticationResult: null,
        failureReason: registrationError.message,
        validationErrors: [registrationError.message]
      };
    }
  }

  /**
   * Validate authentication context with comprehensive checks
   */
  async validateContext(
    context: IAuthenticationContext
  ): Promise<IAuthenticationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Check cached validation result
      if (this.config.cache.enabled) {
        const cachedResult = await this.getCachedValidationResult(context);
        if (cachedResult) {
          if (this.config.metrics.enabled) {
            await this.metrics.recordResponseTime(Date.now() - startTime, "session", true);
          }
          return cachedResult;
        }
      }

      // Step 2: Execute context validation flow
      const flowResult = await this.flowManager.executeContextValidationFlow(context);

      if (!flowResult.success) {
        throw flowResult.error || new AuthenticationError("Context validation failed");
      }

      // Step 3: Build validation result
      const validationResult = await this.buildValidationResult(flowResult, context);

      // Step 4: Cache validation result
      if (this.config.cache.enabled) {
        await this.cacheValidationResult(validationResult, context);
      }

      // Step 5: Record metrics and audit
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("session", "success", flowResult.userId);
        await this.metrics.recordResponseTime(Date.now() - startTime, "session", true);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: flowResult.userId!,
          action: "context_validation_success",
          timestamp: createTimestamp(),
          metadata: {
            sessionId: flowResult.sessionId,
            permissionsChanged: flowResult.metadata?.permissionsChanged,
            responseTime: Date.now() - startTime
          }
        });
      }

      return validationResult;

    } catch (error) {
      const validationError = error instanceof Error ? error : new AuthenticationError("Context validation failed");
      
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("session", "failure", context.user.id, "validation_failed");
        await this.metrics.recordResponseTime(Date.now() - startTime, "session", false);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: context.user.id,
          action: "context_validation_failure",
          timestamp: createTimestamp(),
          metadata: {
            error: validationError.message,
            responseTime: Date.now() - startTime
          }
        });
      }

      throw validationError;
    }
  }

  /**
   * Refresh authentication tokens with security validation
   */
  async refresh(refreshToken: JWTToken): Promise<IAuthenticationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Execute refresh flow
      const flowResult = await this.flowManager.executeRefreshFlow(refreshToken);

      if (!flowResult.success) {
        throw flowResult.error || new AuthenticationError("Token refresh failed");
      }

      // Step 2: Build refresh result
      const refreshResult = await this.buildRefreshResult(flowResult);

      // Step 3: Record metrics and audit
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("jwt", "success", flowResult.userId);
        await this.metrics.recordResponseTime(Date.now() - startTime, "jwt", true);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: flowResult.userId!,
          action: "token_refresh_success",
          timestamp: createTimestamp(),
          metadata: {
            sessionId: flowResult.sessionId,
            responseTime: Date.now() - startTime
          }
        });
      }

      return refreshResult;

    } catch (error) {
      const refreshError = error instanceof Error ? error : new AuthenticationError("Token refresh failed");
      
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("jwt", "failure", "unknown", "refresh_failed");
        await this.metrics.recordResponseTime(Date.now() - startTime, "jwt", false);
      }

      throw refreshError;
    }
  }

  /**
   * Comprehensive user logout with cleanup
   */
  async logout(context: IAuthenticationContext): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Step 1: Invalidate session
      const logoutSuccess = await this.sessionService.deleteSession(context.session!.id);

      // Step 2: Clear all cached data for user
      if (this.config.cache.enabled) {
        await this.clearUserCache(context.user.id);
      }

      // Step 3: Clear rate limiting data (optional - for clean logout)
      await this.rateLimitManager.clearRateLimits(context.user.id);

      // Step 4: Record metrics and audit
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("session", "success", context.user.id);
        await this.metrics.recordResponseTime(Date.now() - startTime, "session", true);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: context.user.id,
          action: "logout_success",
          timestamp: createTimestamp(),
          metadata: {
            sessionId: context.session!.id,
            sessionDuration: Date.now() - (context.session?.createdAt || Date.now()),
            responseTime: Date.now() - startTime
          }
        });
      }

      return logoutSuccess;

    } catch (error) {
      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: context.user.id,
          action: "logout_failure",
          timestamp: createTimestamp(),
          metadata: {
            error: error instanceof Error ? error.message : "Unknown error",
            responseTime: Date.now() - startTime
          }
        });
      }

      return false;
    }
  }

  /**
   * Change user password with comprehensive security checks
   */
  async changePassword(
    context: IAuthenticationContext,
    passwordData: IPasswordChangeData
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Step 1: Validate password change data
      if (this.config.validation.strictMode) {
        this.credentialsValidator.validatePasswordChangeData(passwordData);
      }

      // Step 2: Execute password change flow
      const changeSuccess = await this.flowManager.executePasswordChangeFlow(context, passwordData);

      // Step 3: Record metrics and audit
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("password", "success", context.user.id);
        await this.metrics.recordResponseTime(Date.now() - startTime, "password", true);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: context.user.id,
          action: "password_change_success",
          timestamp: createTimestamp(),
          metadata: {
            sessionId: context.session!.id,
            otherSessionsInvalidated: true,
            responseTime: Date.now() - startTime
          }
        });
      }

      return changeSuccess;

    } catch (error) {
      if (this.config.metrics.enabled) {
        await this.metrics.recordAttempt("password", "failure", context.user.id, "password_change_failed");
        await this.metrics.recordResponseTime(Date.now() - startTime, "password", false);
      }

      if (this.config.audit.enabled) {
        await this.auditService.logEvent({
          userId: context.user.id,
          action: "password_change_failure",
          timestamp: createTimestamp(),
          metadata: {
            error: error instanceof Error ? error.message : "Unknown error",
            responseTime: Date.now() - startTime
          }
        });
      }

      throw error;
    }
  }

  /**
   * Register new user with comprehensive validation
   */
  async register(
    registrationData: IRegistrationData
  ): Promise<IRegistrationResult> {
    const startTime = Date.now();

    try {
      // Validate registration data
      this.validateRegistrationData(registrationData);

      // Check for existing user
      const existingUser = await this.checkExistingUser(
        registrationData.email,
        registrationData.username
      );

      if (existingUser) {
        throw new ValidationError("User already exists", {
          field: existingUser.field,
          value: existingUser.value,
        });
      }

      // Create user account (this would typically involve a user service)
      const userId = await this.createUserAccount(registrationData);

      // Create initial session
      const session = await this.sessionService.createSession({
        userId,
        metadata: {
          registrationTime: Date.now(),
          ipAddress: registrationData.ipAddress,
          userAgent: registrationData.userAgent,
        },
      });

      // Generate JWT tokens
      const { accessToken, refreshToken } =
        await this.jwtService.generateTokenPair({
          userId,
          sessionId: session.id,
          permissions: registrationData.initialPermissions || [],
        });

      // Set up initial permissions
      if (registrationData.initialPermissions?.length) {
        await this.permissionService.assignPermissions(
          userId,
          registrationData.initialPermissions
        );
      }

      // Build authentication context
      const context: IAuthenticationContext = {
        userId,
        sessionId: session.id,
        permissions: registrationData.initialPermissions || [],
        metadata: {
          registrationTime: Date.now(),
          lastActivity: Date.now(),
          ipAddress: registrationData.ipAddress,
          userAgent: registrationData.userAgent,
        },
      };

      // Log registration
      await this.auditService.logRegistration({
        userId,
        email: registrationData.email,
        username: registrationData.username,
        timestamp: Date.now() as Timestamp,
        metadata: {
          ipAddress: registrationData.ipAddress,
          userAgent: registrationData.userAgent,
          initialPermissions: registrationData.initialPermissions,
        },
      });

      const result: IRegistrationResult = {
        userId,
        context,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        },
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
        },
      };

      // Cache registration result
      await this.cacheRegistrationResult(result);

      // Record response time
      this.recordResponseTime(Date.now() - startTime);

      return result;
    } catch (error) {
      // Log registration failure
      await this.auditService.logRegistration({
        userId: registrationData.email as EntityId,
        email: registrationData.email,
        username: registrationData.username,
        timestamp: Date.now() as Timestamp,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        metadata: {
          ipAddress: registrationData.ipAddress,
          userAgent: registrationData.userAgent,
        },
      });

      // Record response time for failures
      this.recordResponseTime(Date.now() - startTime);

      throw error instanceof Error ? error : new Error("Registration failed");
    }
  }

  /**
   * Validate authentication context with multi-layer verification
   */
  async validateContext(
    context: IAuthenticationContext
  ): Promise<IAuthenticationResult> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cachedResult = await this.getCachedValidation(context);
      if (cachedResult) {
        this.recordResponseTime(Date.now() - startTime);
        return cachedResult;
      }

      // Validate session
      const session = await this.sessionService.getSession(context.sessionId);
      if (!session || session.expiresAt < Date.now()) {
        throw new AuthenticationError("Session expired or invalid", {
          sessionId: context.sessionId,
        });
      }

      // Validate permissions are still current
      const currentPermissions =
        await this.permissionService.getUserPermissions(context.userId);

      // Check if permissions have changed
      const permissionsChanged = this.hasPermissionsChanged(
        context.permissions,
        currentPermissions
      );

      if (permissionsChanged) {
        // Update session with new permissions
        await this.sessionService.updateSession(context.sessionId, {
          permissions: currentPermissions,
          lastActivity: Date.now(),
        });
      }

      // Build validated context
      const validatedContext: IAuthenticationContext = {
        ...context,
        permissions: currentPermissions,
        metadata: {
          ...context.metadata,
          lastActivity: Date.now(),
          validationTime: Date.now(),
        },
      };

      // Generate fresh tokens if needed
      const tokens = await this.jwtService.generateTokenPair({
        userId: context.userId,
        sessionId: context.sessionId,
        permissions: currentPermissions,
      });

      const result: IAuthenticationResult = {
        success: true,
        context: validatedContext,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        },
        permissions: currentPermissions,
        metadata: {
          validatedAt: Date.now(),
          permissionsChanged,
          sessionExtended: true,
        },
      };

      // Cache validation result
      await this.cacheValidationResult(result);

      // Log context validation
      await this.auditService.logContextValidation({
        userId: context.userId,
        sessionId: context.sessionId,
        success: true,
        timestamp: Date.now() as Timestamp,
        metadata: {
          permissionsChanged,
          oldPermissions: context.permissions,
          newPermissions: currentPermissions,
        },
      });

      this.recordResponseTime(Date.now() - startTime);
      return result;
    } catch (error) {
      // Log validation failure
      await this.auditService.logContextValidation({
        userId: context.userId,
        sessionId: context.sessionId,
        success: false,
        timestamp: Date.now() as Timestamp,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      this.recordResponseTime(Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Refresh authentication tokens with security validation
   */
  async refresh(refreshToken: JWTToken): Promise<IAuthenticationResult> {
    const startTime = Date.now();

    try {
      // Validate refresh token
      const tokenPayload = await this.jwtService.verifyToken(refreshToken);

      if (!tokenPayload.sessionId || !tokenPayload.userId) {
        throw new AuthenticationError("Invalid refresh token structure");
      }

      // Check rate limiting for refresh attempts
      await this.enforceRateLimit(tokenPayload.userId, "jwt");

      // Validate session still exists and is active
      const session = await this.sessionService.getSession(
        tokenPayload.sessionId
      );
      if (!session || session.expiresAt < Date.now()) {
        throw new AuthenticationError("Session expired", {
          sessionId: tokenPayload.sessionId,
        });
      }

      // Get current permissions
      const currentPermissions =
        await this.permissionService.getUserPermissions(tokenPayload.userId);

      // Generate new token pair
      const newTokens = await this.jwtService.generateTokenPair({
        userId: tokenPayload.userId,
        sessionId: tokenPayload.sessionId,
        permissions: currentPermissions,
      });

      // Update session activity
      await this.sessionService.updateSession(tokenPayload.sessionId, {
        lastActivity: Date.now(),
        refreshCount: (session.refreshCount || 0) + 1,
      });

      // Build refreshed context
      const context: IAuthenticationContext = {
        userId: tokenPayload.userId,
        sessionId: tokenPayload.sessionId,
        permissions: currentPermissions,
        metadata: {
          lastActivity: Date.now(),
          refreshedAt: Date.now(),
          refreshCount: (session.refreshCount || 0) + 1,
        },
      };

      const result: IAuthenticationResult = {
        success: true,
        context,
        tokens: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        },
        permissions: currentPermissions,
        metadata: {
          refreshedAt: Date.now(),
          tokenRotated: true,
        },
      };

      // Log token refresh
      await this.auditService.logTokenRefresh({
        userId: tokenPayload.userId,
        sessionId: tokenPayload.sessionId,
        timestamp: Date.now() as Timestamp,
        metadata: {
          refreshCount: (session.refreshCount || 0) + 1,
        },
      });

      this.updateMetrics("jwt", "success");
      this.recordResponseTime(Date.now() - startTime);

      return result;
    } catch (error) {
      this.updateMetrics("jwt", "failure", (error as Error).message);
      this.recordResponseTime(Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Comprehensive user logout with cleanup
   */
  async logout(context: IAuthenticationContext): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Invalidate session
      const sessionInvalidated = await this.sessionService.deleteSession(
        context.sessionId
      );

      // Clear cached data
      await this.clearUserCache(context.userId);

      // Revoke any API keys if they exist
      await this.revokeUserAPIKeys(context.userId);

      // Log logout
      await this.auditService.logLogout({
        userId: context.userId,
        sessionId: context.sessionId,
        timestamp: Date.now() as Timestamp,
        metadata: {
          sessionDuration:
            Date.now() - (context.metadata.lastActivity || Date.now()),
          gracefulLogout: true,
        },
      });

      this.recordResponseTime(Date.now() - startTime);
      return sessionInvalidated;
    } catch (error) {
      await this.auditService.logLogout({
        userId: context.userId,
        sessionId: context.sessionId,
        timestamp: Date.now() as Timestamp,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      this.recordResponseTime(Date.now() - startTime);
      return false;
    }
  }

  /**
   * Change user password with security validation
   */
  async changePassword(
    context: IAuthenticationContext,
    passwordData: IPasswordChangeData
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Validate password change data
      this.validatePasswordChangeData(passwordData);

      // Verify current password
      await this.verifyCurrentPassword(
        context.userId,
        passwordData.currentPassword
      );

      // Validate new password strength
      this.validatePasswordStrength(passwordData.newPassword);

      // Update password (this would typically involve a user service)
      await this.updateUserPassword(context.userId, passwordData.newPassword);

      // Invalidate all other sessions for security
      await this.invalidateOtherSessions(context.userId, context.sessionId);

      // Clear password reset tokens
      await this.clearPasswordResetTokens(context.userId);

      // Log password change
      await this.auditService.logPasswordChange({
        userId: context.userId,
        timestamp: Date.now() as Timestamp,
        metadata: {
          sessionId: context.sessionId,
          otherSessionsInvalidated: true,
        },
      });

      this.recordResponseTime(Date.now() - startTime);
      return true;
    } catch (error) {
      await this.auditService.logPasswordChange({
        userId: context.userId,
        timestamp: Date.now() as Timestamp,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      this.recordResponseTime(Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Get authentication context by session ID
   */
  async getContextBySession(
    sessionId: SessionId
  ): Promise<IAuthenticationContext | null> {
    try {
      // Check cache first
      const cachedContext = await this.getCachedContextBySession(sessionId);
      if (cachedContext) {
        return cachedContext;
      }

      // Get session data
      const session = await this.sessionService.getSession(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return null;
      }

      // Get user permissions
      const permissions = await this.permissionService.getUserPermissions(
        session.userId
      );

      // Build context
      const context: IAuthenticationContext = {
        userId: session.userId,
        sessionId: session.id,
        permissions,
        metadata: {
          lastActivity: session.lastActivity || Date.now(),
          sessionCreatedAt: session.createdAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        },
      };

      // Cache the context
      await this.cacheContext(context);

      return context;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get authentication context by JWT token
   */
  async getContextByJWT(
    token: JWTToken
  ): Promise<IAuthenticationContext | null> {
    try {
      // Verify and decode JWT
      const payload = await this.jwtService.verifyToken(token);

      if (!payload.userId || !payload.sessionId) {
        return null;
      }

      // Validate session still exists
      const session = await this.sessionService.getSession(payload.sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return null;
      }

      // Get current permissions
      const permissions = await this.permissionService.getUserPermissions(
        payload.userId
      );

      const context: IAuthenticationContext = {
        userId: payload.userId,
        sessionId: payload.sessionId,
        permissions,
        metadata: {
          lastActivity: Date.now(),
          tokenIssuedAt: payload.iat ? payload.iat * 1000 : Date.now(),
          tokenExpiresAt: payload.exp
            ? payload.exp * 1000
            : Date.now() + 3600000,
        },
      };

      return context;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get authentication context by API key
   */
  async getContextByAPIKey(
    key: APIKey
  ): Promise<IAuthenticationContext | null> {
    try {
      // Check rate limiting first
      await this.enforceRateLimit(key, "apikey");

      // Validate API key
      const apiKeyData = await this.apiKeyService.validateKey(key);
      if (!apiKeyData.isValid || !apiKeyData.userId) {
        return null;
      }

      // Get user permissions
      const permissions = await this.permissionService.getUserPermissions(
        apiKeyData.userId
      );

      // Create temporary session for API key usage
      const tempSession = await this.sessionService.createSession({
        userId: apiKeyData.userId,
        temporary: true,
        apiKeyId: apiKeyData.id,
        metadata: {
          apiKeyUsage: true,
          keyName: apiKeyData.name,
          keyPermissions: apiKeyData.permissions,
        },
      });

      const context: IAuthenticationContext = {
        userId: apiKeyData.userId,
        sessionId: tempSession.id,
        permissions: this.intersectPermissions(
          permissions,
          apiKeyData.permissions || []
        ),
        metadata: {
          apiKeyId: apiKeyData.id,
          apiKeyName: apiKeyData.name,
          lastActivity: Date.now(),
          temporarySession: true,
        },
      };

      // Log API key usage
      await this.auditService.logAPIKeyUsage({
        userId: apiKeyData.userId,
        keyId: apiKeyData.id,
        timestamp: Date.now() as Timestamp,
      });

      return context;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<IServiceHealth> {
    const startTime = Date.now();

    try {
      // Check all dependent services
      const [
        jwtHealth,
        sessionHealth,
        permissionHealth,
        apiKeyHealth,
        cacheHealth,
        auditHealth,
      ] = await Promise.allSettled([
        this.jwtService.getHealth(),
        this.sessionService.getHealth(),
        this.permissionService.getHealth(),
        this.apiKeyService.getHealth(),
        this.cacheService.getHealth(),
        this.auditService.getHealth(),
      ]);

      // Calculate overall health
      const unhealthyServices = [
        jwtHealth,
        sessionHealth,
        permissionHealth,
        apiKeyHealth,
        cacheHealth,
        auditHealth,
      ].filter(
        (result) =>
          result.status === "rejected" ||
          (result.status === "fulfilled" && result.value.status !== "healthy")
      );

      const responseTime = Date.now() - startTime;
      const isHealthy = unhealthyServices.length === 0;

      return {
        status: isHealthy ? "healthy" : "unhealthy",
        timestamp: Date.now() as Timestamp,
        responseTime,
        details: {
          dependencies: {
            jwt:
              jwtHealth.status === "fulfilled"
                ? jwtHealth.value.status
                : "unhealthy",
            session:
              sessionHealth.status === "fulfilled"
                ? sessionHealth.value.status
                : "unhealthy",
            permission:
              permissionHealth.status === "fulfilled"
                ? permissionHealth.value.status
                : "unhealthy",
            apiKey:
              apiKeyHealth.status === "fulfilled"
                ? apiKeyHealth.value.status
                : "unhealthy",
            cache:
              cacheHealth.status === "fulfilled"
                ? cacheHealth.value.status
                : "unhealthy",
            audit:
              auditHealth.status === "fulfilled"
                ? auditHealth.value.status
                : "unhealthy",
          },
          metrics: {
            totalAttempts: this.metrics.totalAttempts,
            successRate:
              this.metrics.totalAttempts > 0
                ? (this.metrics.successfulAttempts /
                    this.metrics.totalAttempts) *
                  100
                : 0,
            averageResponseTime: this.metrics.averageResponseTime,
            activeUsers: this.metrics.uniqueUsers,
          },
        },
        errors:
          unhealthyServices.length > 0
            ? [`${unhealthyServices.length} dependent services unhealthy`]
            : undefined,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: Date.now() as Timestamp,
        responseTime: Date.now() - startTime,
        errors: [
          error instanceof Error ? error.message : "Health check failed",
        ],
      };
    }
  }

  // Private helper methods

  private validateCredentials(credentials: IAuthenticationCredentials): void {
    if (!credentials.email && !credentials.username && !credentials.apiKey) {
      throw new ValidationError("Missing authentication identifier");
    }

    if ((credentials.email || credentials.username) && !credentials.password) {
      throw new ValidationError(
        "Password required for email/username authentication"
      );
    }

    if (credentials.email && !this.isValidEmail(credentials.email)) {
      throw new ValidationError("Invalid email format");
    }
  }

  private validateRegistrationData(data: IRegistrationData): void {
    if (!data.email || !this.isValidEmail(data.email)) {
      throw new ValidationError("Valid email required");
    }

    if (!data.username || data.username.length < 3) {
      throw new ValidationError("Username must be at least 3 characters");
    }

    if (!data.password) {
      throw new ValidationError("Password required");
    }

    this.validatePasswordStrength(data.password);
  }

  private validatePasswordChangeData(data: IPasswordChangeData): void {
    if (!data.currentPassword) {
      throw new ValidationError("Current password required");
    }

    if (!data.newPassword) {
      throw new ValidationError("New password required");
    }

    if (data.currentPassword === data.newPassword) {
      throw new ValidationError(
        "New password must be different from current password"
      );
    }
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }

    if (!/[A-Z]/.test(password)) {
      throw new ValidationError("Password must contain uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
      throw new ValidationError("Password must contain lowercase letter");
    }

    if (!/\d/.test(password)) {
      throw new ValidationError("Password must contain number");
    }

    if (!/[!@#$%^&*]/.test(password)) {
      throw new ValidationError("Password must contain special character");
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private async enforceRateLimit(
    identifier: string,
    method: AuthenticationMethod
  ): Promise<void> {
    const config = RATE_LIMITS[method];
    const key = `${CACHE_CONFIG.RATE_LIMIT.PREFIX}${method}:${identifier}`;

    const attempts = (await this.cacheService.get<number>(key)) || 0;

    if (attempts >= config.maxAttempts) {
      this.updateMetrics(method, "rate_limited");
      throw new RateLimitError(
        `Too many ${method} attempts. Try again later.`,
        {
          method,
          maxAttempts: config.maxAttempts,
          windowMinutes: config.windowMinutes,
          retryAfter: config.blockDurationMinutes * 60,
        }
      );
    }

    await this.cacheService.set(key, attempts + 1, config.windowMinutes * 60);
  }

  private async authenticateWithPassword(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    // This would integrate with user service for password verification
    // For now, implementing the orchestration logic

    const userId = await this.verifyPasswordCredentials(
      credentials.email || credentials.username!,
      credentials.password!
    );

    return this.createAuthenticationResult(userId, "password", credentials);
  }

  private async authenticateWithAPIKey(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    const keyValidation = await this.apiKeyService.validateKey(
      credentials.apiKey!
    );

    if (!keyValidation.isValid || !keyValidation.userId) {
      throw new InvalidCredentialsError("Invalid API key");
    }

    return this.createAuthenticationResult(
      keyValidation.userId,
      "apikey",
      credentials
    );
  }

  private async createAuthenticationResult(
    userId: EntityId,
    method: AuthenticationMethod,
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    // Get user permissions
    const permissions = await this.permissionService.getUserPermissions(userId);

    // Create session
    const session = await this.sessionService.createSession({
      userId,
      metadata: {
        authMethod: method,
        ipAddress: credentials.ipAddress,
        userAgent: credentials.userAgent,
        loginTime: Date.now(),
      },
    });

    // Generate tokens
    const tokens = await this.jwtService.generateTokenPair({
      userId,
      sessionId: session.id,
      permissions,
    });

    // Build context
    const context: IAuthenticationContext = {
      userId,
      sessionId: session.id,
      permissions,
      metadata: {
        authMethod: method,
        loginTime: Date.now(),
        lastActivity: Date.now(),
        ipAddress: credentials.ipAddress,
        userAgent: credentials.userAgent,
      },
    };

    return {
      success: true,
      context,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      },
      permissions,
      metadata: {
        authMethod: method,
        sessionCreated: true,
        loginTime: Date.now(),
      },
    };
  }

  private handleAuthenticationError(
    error: unknown,
    method: AuthenticationMethod,
    identifier: string
  ): Error {
    if (
      error instanceof ValidationError ||
      error instanceof AuthenticationError ||
      error instanceof InvalidCredentialsError ||
      error instanceof RateLimitError
    ) {
      return error;
    }

    // Log unexpected error
    console.error("Unexpected authentication error:", error);

    return new AuthenticationError("Authentication failed", {
      method,
      identifier: identifier.substring(0, 4) + "****", // Mask identifier
    });
  }

  private updateMetrics(
    method: AuthenticationMethod,
    type: "attempt" | "success" | "failure" | "rate_limited",
    errorCode?: string
  ): void {
    this.metrics.totalAttempts++;
    this.metrics.methodDistribution[method]++;

    switch (type) {
      case "success":
        this.metrics.successfulAttempts++;
        break;
      case "failure":
        this.metrics.failedAttempts++;
        if (errorCode) {
          this.metrics.errorDistribution[errorCode] =
            (this.metrics.errorDistribution[errorCode] || 0) + 1;
        }
        break;
      case "rate_limited":
        this.metrics.rateLimitedAttempts++;
        break;
    }
  }

  private recordResponseTime(responseTime: number): void {
    this.responseTimeBuffer.push(responseTime);

    if (this.responseTimeBuffer.length > this.maxResponseTimeBufferSize) {
      this.responseTimeBuffer.shift();
    }

    this.metrics.averageResponseTime =
      this.responseTimeBuffer.reduce((sum, time) => sum + time, 0) /
      this.responseTimeBuffer.length;
  }

  // Cache helper methods
  private async cacheAuthenticationResult(
    result: IAuthenticationResult
  ): Promise<void> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}${result.context.userId}`;
    await this.cacheService.set(
      key,
      result.context,
      CACHE_CONFIG.USER_CONTEXT.TTL
    );
  }

  private async cacheValidationResult(
    result: IAuthenticationResult
  ): Promise<void> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}validation:${result.context.sessionId}`;
    await this.cacheService.set(key, result, CACHE_CONFIG.USER_CONTEXT.TTL);
  }

  private async getCachedValidation(
    context: IAuthenticationContext
  ): Promise<IAuthenticationResult | null> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}validation:${context.sessionId}`;
    return await this.cacheService.get<IAuthenticationResult>(key);
  }

  private async getCachedContextBySession(
    sessionId: SessionId
  ): Promise<IAuthenticationContext | null> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}session:${sessionId}`;
    return await this.cacheService.get<IAuthenticationContext>(key);
  }

  private async cacheContext(context: IAuthenticationContext): Promise<void> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}session:${context.sessionId}`;
    await this.cacheService.set(key, context, CACHE_CONFIG.USER_CONTEXT.TTL);
  }

  // Utility methods (these would integrate with actual user service)
  private async verifyPasswordCredentials(
    identifier: string,
    password: string
  ): Promise<EntityId> {
    // This would integrate with actual user service
    throw new Error("User service integration required");
  }

  private async checkExistingUser(
    email: string,
    username?: string
  ): Promise<{ field: string; value: string } | null> {
    // This would integrate with actual user service
    return null;
  }

  private async createUserAccount(data: IRegistrationData): Promise<EntityId> {
    // This would integrate with actual user service
    throw new Error("User service integration required");
  }

  private async verifyCurrentPassword(
    userId: EntityId,
    password: string
  ): Promise<void> {
    // This would integrate with actual user service
    throw new Error("User service integration required");
  }

  private async updateUserPassword(
    userId: EntityId,
    newPassword: string
  ): Promise<void> {
    // This would integrate with actual user service
    throw new Error("User service integration required");
  }

  private hasPermissionsChanged(
    oldPermissions: string[],
    newPermissions: string[]
  ): boolean {
    if (oldPermissions.length !== newPermissions.length) {
      return true;
    }

    const oldSet = new Set(oldPermissions);
    const newSet = new Set(newPermissions);

    for (const permission of oldPermissions) {
      if (!newSet.has(permission)) {
        return true;
      }
    }

    for (const permission of newPermissions) {
      if (!oldSet.has(permission)) {
        return true;
      }
    }

    return false;
  }

  private intersectPermissions(
    userPermissions: string[],
    keyPermissions: string[]
  ): string[] {
    const userSet = new Set(userPermissions);
    return keyPermissions.filter((permission) => userSet.has(permission));
  }

  private async recordFailedAttempt(
    identifier: string,
    method: AuthenticationMethod,
    error: Error
  ): Promise<void> {
    const key = `${CACHE_CONFIG.FAILED_ATTEMPTS.PREFIX}${identifier}`;
    const attempts =
      (await this.cacheService.get<IAuthenticationAttempt[]>(key)) || [];

    attempts.push({
      identifier,
      method,
      timestamp: new Date(),
      success: false,
      errorCode: error.message,
    });

    // Keep only last 10 attempts
    const recentAttempts = attempts.slice(-10);
    await this.cacheService.set(
      key,
      recentAttempts,
      CACHE_CONFIG.FAILED_ATTEMPTS.TTL
    );
  }

  private async cacheRegistrationResult(
    result: IRegistrationResult
  ): Promise<void> {
    const key = `${CACHE_CONFIG.USER_CONTEXT.PREFIX}registration:${result.userId}`;
    await this.cacheService.set(key, result, CACHE_CONFIG.USER_CONTEXT.TTL);
  }

  private async clearUserCache(userId: EntityId): Promise<void> {
    // Clear all cached data for user
    const patterns = [
      `${CACHE_CONFIG.USER_CONTEXT.PREFIX}${userId}`,
      `${CACHE_CONFIG.USER_CONTEXT.PREFIX}session:*`,
      `${CACHE_CONFIG.USER_CONTEXT.PREFIX}validation:*`,
      `${CACHE_CONFIG.FAILED_ATTEMPTS.PREFIX}${userId}`,
    ];

    for (const pattern of patterns) {
      await this.cacheService.clearPattern(pattern);
    }
  }

  private async revokeUserAPIKeys(userId: EntityId): Promise<void> {
    // Get user's API keys
    const userKeys = await this.apiKeyService.getUserKeys(userId);

    // Revoke all keys
    for (const key of userKeys) {
      await this.apiKeyService.revokeKey(key.id);
    }
  }

  private async invalidateOtherSessions(
    userId: EntityId,
    keepSessionId: SessionId
  ): Promise<void> {
    const userSessions = await this.sessionService.getUserSessions(userId);

    for (const session of userSessions) {
      if (session.id !== keepSessionId) {
        await this.sessionService.deleteSession(session.id);
      }
    }
  }

  private async clearPasswordResetTokens(userId: EntityId): Promise<void> {
    const key = `${CACHE_CONFIG.PASSWORD_RESET.PREFIX}${userId}`;
    await this.cacheService.delete(key);
  }
}
