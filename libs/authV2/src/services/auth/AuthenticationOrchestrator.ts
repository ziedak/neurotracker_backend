/**
 * @fileoverview AuthenticationOrchestrator - Coordinated authentication flow management
 * @module services/auth/AuthenticationOrchestrator
 * @author Enterprise Development Team
 * @since 1.0.0 - Phase 2.1 Service Architecture Refactoring
 */

import { IAuthenticationResult, createTimestamp } from "../../types/core";

import { IServiceHealth } from "../../types/enhanced";

import {
  IJWTService,
  ISessionService,
  IPermissionService,
  IAPIKeyService,
  ICacheService,
  IAuditService,
  IUserService,
  IAuthenticationCredentials,
  IRegistrationData,
  IRegistrationResult,
  type IRoleService,
} from "../../contracts/services";

import { AuthenticationError } from "../../errors/core";

import { CredentialsValidator } from "./CredentialsValidator";
import {
  RateLimitManager,
  type AuthenticationMethod,
} from "./RateLimitManager";
import { AuthenticationFlowManager } from "./AuthenticationFlowManager";
import { AuthenticationMetrics } from "./AuthenticationMetrics";
import { SecurityAuditor } from "./SecurityAuditor";

/**
 * Authentication orchestrator configuration
 */
export interface IAuthenticationOrchestratorConfig {
  readonly validation: {
    readonly strictMode: boolean;
    readonly maxRetries: number;
    readonly timeoutMs: number;
  };
  readonly rateLimit: {
    readonly enabled: boolean;
    readonly windowMs: number;
    readonly maxAttempts: number;
    readonly progressivePenalty: boolean;
  };
  readonly cache: {
    readonly enabled: boolean;
    readonly ttlMs: number;
    readonly maxSize: number;
  };
  readonly audit: {
    readonly enabled: boolean;
    readonly logLevel: "basic" | "detailed" | "comprehensive";
    readonly persistToDisk: boolean;
  };
  readonly metrics: {
    readonly enabled: boolean;
    readonly detailedTiming: boolean;
    readonly performanceThresholds: {
      readonly warningMs: number;
      readonly errorMs: number;
    };
  };
  readonly security: {
    readonly enableDeviceFingerprinting: boolean;
    readonly enableLocationTracking: boolean;
    readonly enableBehaviorAnalysis: boolean;
    readonly suspiciousActivityThreshold: number;
  };
}

/**
 * Authentication Orchestrator
 *
 * Coordinates authentication flows between specialized services while maintaining
 * single responsibility for each component. This orchestrator replaces the monolithic
 * AuthenticationService following enterprise architecture patterns.
 *
 * **Responsibilities:**
 * - Coordinate authentication flows between specialized services
 * - Manage configuration and dependency injection
 * - Provide unified API for authentication operations
 * - Handle cross-cutting concerns (caching, metrics, audit)
 *
 * **Services Coordinated:**
 * - CredentialsValidator: Input validation and sanitization
 * - RateLimitManager: Request rate limiting and abuse prevention
 * - AuthenticationFlowManager: Core authentication logic
 * - AuthenticationMetrics: Performance and usage metrics
 * - SecurityAuditor: Security event logging and analysis
 */
export class AuthenticationOrchestrator {
  private readonly credentialsValidator: CredentialsValidator;
  private readonly rateLimitManager: RateLimitManager;
  private readonly flowManager: AuthenticationFlowManager;
  private readonly metrics: AuthenticationMetrics;
  private readonly securityAuditor: SecurityAuditor;
  private readonly config: IAuthenticationOrchestratorConfig;
  private readonly defaultConfig: IAuthenticationOrchestratorConfig;

  constructor(
    private readonly jwtService: IJWTService,
    private readonly sessionService: ISessionService,
    private readonly permissionService: IPermissionService,
    private readonly apiKeyService: IAPIKeyService,
    private readonly cacheService: ICacheService,
    private readonly auditService: IAuditService,
    private readonly userService: IUserService,
    private readonly roleService: IRoleService,
    config?: Partial<IAuthenticationOrchestratorConfig>
  ) {
    // Initialize default configuration
    this.defaultConfig = this.createDefaultConfig();

    // Merge configuration with enterprise defaults
    this.config = {
      validation: { ...this.defaultConfig.validation, ...config?.validation },
      rateLimit: { ...this.defaultConfig.rateLimit, ...config?.rateLimit },
      cache: { ...this.defaultConfig.cache, ...config?.cache },
      audit: { ...this.defaultConfig.audit, ...config?.audit },
      metrics: { ...this.defaultConfig.metrics, ...config?.metrics },
      security: { ...this.defaultConfig.security, ...config?.security },
    };

    // Initialize specialized components
    this.credentialsValidator = new CredentialsValidator();
    this.rateLimitManager = new RateLimitManager(cacheService);
    this.flowManager = new AuthenticationFlowManager(
      jwtService,
      sessionService,
      permissionService,
      apiKeyService,
      auditService,
      userService,
      roleService
    );
    this.metrics = new AuthenticationMetrics(cacheService);
    this.securityAuditor = new SecurityAuditor(auditService);
  }

  /**
   * Orchestrate comprehensive authentication with enterprise security validation
   *
   * @param credentials - Authentication credentials
   * @returns Promise resolving to authentication result
   */
  async authenticate(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      // Step 1: Security audit - log authentication attempt
      await this.securityAuditor.logAuthenticationAttempt(
        credentials,
        operationId
      );

      // Step 2: Check cached authentication result for performance
      if (this.config.cache.enabled) {
        const cachedResult = await this.getCachedAuthResult(credentials);
        if (cachedResult) {
          await this.metrics.recordResponseTime(
            Date.now() - startTime,
            "cache",
            true
          );
          await this.securityAuditor.logAuthenticationSuccess(
            credentials,
            operationId,
            "cache"
          );
          return cachedResult;
        }
      }

      // Step 3: Comprehensive credential validation with security analysis
      if (this.config.validation.strictMode) {
        await this.credentialsValidator.validateAuthenticationCredentials(
          credentials
        );
      }

      // Step 4: Advanced rate limiting with progressive penalties
      if (this.config.rateLimit.enabled) {
        const identifier = this.extractIdentifier(credentials);
        const method = this.determineAuthMethod(credentials);
        await this.rateLimitManager.enforceRateLimit(identifier, method);
      }

      // Step 5: Execute sophisticated authentication flow
      const authMethod = this.determineAuthMethod(credentials);
      let flowResult;

      switch (authMethod) {
        case "password":
          flowResult = await this.flowManager.executePasswordFlow(credentials);
          break;
        case "jwt":
          flowResult = await this.flowManager.executeJWTFlow(credentials);
          break;
        case "apikey":
          flowResult = await this.flowManager.executeAPIKeyFlow(credentials);
          break;
        default:
          throw new AuthenticationError("Unsupported authentication method");
      }

      // Step 6: Build comprehensive authentication result
      const authResult = await this.buildAuthenticationResult(flowResult);

      // Step 7: Cache successful authentication for performance
      if (this.config.cache.enabled && authResult.success) {
        await this.cacheAuthResult(credentials, authResult);
      }

      // Step 8: Record comprehensive metrics and audit trail
      if (this.config.metrics.enabled) {
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          authMethod,
          true
        );
      }

      await this.securityAuditor.logAuthenticationSuccess(
        credentials,
        operationId,
        authMethod
      );

      return authResult;
    } catch (error) {
      // Comprehensive error handling and security logging
      const authMethod = this.determineAuthMethod(credentials);

      if (this.config.metrics.enabled) {
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          authMethod,
          false
        );
      }

      await this.securityAuditor.logAuthenticationFailure(
        credentials,
        operationId,
        error instanceof Error ? error : new Error("Unknown error")
      );

      return {
        success: false,
        user: null,
        session: null,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        permissions: [],
        roles: [],
        errors: [
          error instanceof Error ? error.message : "Authentication failed",
        ],
        metadata: {
          operationId,
          timestamp: Date.now(),
          method: authMethod,
        },
      };
    }
  }

  /**
   * Orchestrate user registration with comprehensive validation
   */
  async register(
    registrationData: IRegistrationData
  ): Promise<IRegistrationResult> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      await this.securityAuditor.logRegistrationAttempt(
        registrationData,
        operationId
      );

      // Comprehensive validation
      await this.credentialsValidator.validateRegistrationData(
        registrationData
      );

      // Rate limiting for registration attempts
      if (this.config.rateLimit.enabled) {
        const identifier = registrationData.email || registrationData.username;
        await this.rateLimitManager.enforceRateLimit(
          identifier,
          "registration"
        );
      }

      // Execute registration flow
      const registrationResult = await this.flowManager.executeRegistrationFlow(
        registrationData
      );

      if (this.config.metrics.enabled) {
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          "registration",
          true
        );
      }

      await this.securityAuditor.logRegistrationSuccess(
        registrationData,
        operationId
      );

      return registrationResult;
    } catch (error) {
      if (this.config.metrics.enabled) {
        await this.metrics.recordResponseTime(
          Date.now() - startTime,
          "registration",
          false
        );
      }

      await this.securityAuditor.logRegistrationFailure(
        registrationData,
        operationId,
        error instanceof Error ? error : new Error("Unknown error")
      );

      throw error;
    }
  }

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<IServiceHealth> {
    const componentHealth = await Promise.allSettled([
      this.flowManager.getHealth?.() || Promise.resolve({ status: "unknown" }),
      this.metrics.getHealth?.() || Promise.resolve({ status: "unknown" }),
      this.rateLimitManager.getHealth?.() ||
        Promise.resolve({ status: "unknown" }),
    ]);

    const allHealthy = componentHealth.every(
      (result) =>
        result.status === "fulfilled" && result.value.status === "healthy"
    );

    return {
      service: "AuthenticationOrchestrator",
      status: allHealthy ? "healthy" : "degraded",
      uptime: Date.now(),
      lastCheck: createTimestamp(),
      dependencies: componentHealth.map((result, index) => ({
        name: ["FlowManager", "Metrics", "RateLimitManager"][index]!,
        status:
          result.status === "fulfilled"
            ? (result.value.status as "healthy" | "degraded" | "unhealthy")
            : "unhealthy",
        responseTime: 0, // TODO: Add actual response time measurement
        lastCheck: createTimestamp(),
        error:
          result.status === "rejected"
            ? result.reason?.message || "Service check failed"
            : null,
      })),
      metrics: {}, // Simplified for now - will be populated from actual metrics
    };
  }

  /**
   * Private helper methods
   */
  private createDefaultConfig(): IAuthenticationOrchestratorConfig {
    return {
      validation: {
        strictMode: true,
        maxRetries: 3,
        timeoutMs: 30000,
      },
      rateLimit: {
        enabled: true,
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxAttempts: 10,
        progressivePenalty: true,
      },
      cache: {
        enabled: true,
        ttlMs: 5 * 60 * 1000, // 5 minutes
        maxSize: 10000,
      },
      audit: {
        enabled: true,
        logLevel: "comprehensive",
        persistToDisk: true,
      },
      metrics: {
        enabled: true,
        detailedTiming: true,
        performanceThresholds: {
          warningMs: 500,
          errorMs: 2000,
        },
      },
      security: {
        enableDeviceFingerprinting: true,
        enableLocationTracking: true,
        enableBehaviorAnalysis: true,
        suspiciousActivityThreshold: 0.7,
      },
    };
  }

  private generateOperationId(): string {
    return `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private determineAuthMethod(
    credentials: IAuthenticationCredentials
  ): AuthenticationMethod {
    if ("email" in credentials && "password" in credentials) {
      return "password";
    }
    if ("token" in credentials) {
      return "jwt";
    }
    if ("apiKey" in credentials) {
      return "apikey";
    }
    // Default to password method for unknown credential types
    return "password";
  }

  private extractIdentifier(credentials: IAuthenticationCredentials): string {
    if ("email" in credentials) {
      return credentials.email as string;
    }
    if ("username" in credentials) {
      return credentials.username as string;
    }
    if ("apiKey" in credentials) {
      return (credentials.apiKey as string).substring(0, 8); // Partial key for identification
    }
    return "anonymous";
  }

  private async getCachedAuthResult(
    _credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult | null> {
    // TODO: Implement caching strategy in Phase 2.3
    // For now, return null to indicate no cache hit
    return null;
  }

  private async cacheAuthResult(
    _credentials: IAuthenticationCredentials,
    _result: IAuthenticationResult
  ): Promise<void> {
    // TODO: Implement cache storage in Phase 2.3
    // Cache key would be based on credentials hash
  }

  private async buildAuthenticationResult(
    flowResult: any
  ): Promise<IAuthenticationResult> {
    // This would be moved from the original AuthenticationService
    // For now, basic implementation
    return {
      success: flowResult.success,
      user: flowResult.user || null,
      session: flowResult.session || null,
      accessToken: flowResult.token || null,
      refreshToken: null,
      expiresAt: flowResult.expiresAt ? createTimestamp() : null,
      permissions: flowResult.permissions || [],
      roles: flowResult.roles || [],
      errors: flowResult.errors || [],
      metadata: flowResult.metadata || {},
    };
  }
}
