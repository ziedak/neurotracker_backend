/**
 * Authorization Service - Refactored
 *
 * Clean orchestrator following Single Responsibility Principle
 * Delegates specific concerns to focused components
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type {
  Action,
  Subjects,
  AuthorizationContext,
  ResourceContext,
  AuthorizationResult,
  Role,
} from "../types/authorization.types";

// Modular components
import {
  AuthorizationConfigManager,
  type AuthorizationServiceConfig,
} from "./authorization/AuthorizationConfigManager";
import { AuthorizationValidator } from "./authorization/AuthorizationValidator";
import { PendingOperationTracker } from "./authorization/PendingOperationTracker";
import { AuthorizationCacheManager } from "./authorization/AuthorizationCacheManager";
import { AuthorizationMetrics } from "./authorization/AuthorizationMetrics";
import { AuthorizationAuditor } from "./authorization/AuthorizationAuditor";
import { AuthorizationEngine } from "./authorization/AuthorizationEngine";
import { AbilityFactory } from "./ability";

/**
 * Refactored AuthorizationService - Clean orchestrator
 *
 * Responsibilities:
 * - Orchestrate authorization workflow
 * - Input validation coordination
 * - Error handling and response formatting
 * - Component lifecycle management
 */
export class AuthorizationService {
  private readonly logger = createLogger("AuthorizationService");
  private readonly configManager: AuthorizationConfigManager;
  private readonly validator: AuthorizationValidator;
  private readonly pendingTracker: PendingOperationTracker;
  private readonly cacheManager?: AuthorizationCacheManager;
  private readonly metricsCollector: AuthorizationMetrics;
  private readonly auditor: AuthorizationAuditor;
  private readonly engine: AuthorizationEngine;

  constructor(
    config: AuthorizationServiceConfig = {},
    logger = createLogger("AuthorizationService"),
    metrics?: IMetricsCollector,
    cacheService?: CacheService
  ) {
    this.logger = logger;

    // Initialize configuration
    this.configManager = new AuthorizationConfigManager(config);
    const finalConfig = this.configManager.getConfig();

    // Initialize core components
    this.validator = new AuthorizationValidator();
    this.pendingTracker = new PendingOperationTracker();
    this.metricsCollector = new AuthorizationMetrics(
      metrics,
      finalConfig.enableMetrics
    );
    this.auditor = new AuthorizationAuditor(finalConfig.enableAuditLog, logger);

    // Initialize cache manager if caching enabled
    if (finalConfig.cachePermissionResults && cacheService) {
      this.cacheManager = new AuthorizationCacheManager(
        cacheService,
        finalConfig.permissionCacheTtl
      );
    }

    // Initialize ability factory and authorization engine
    const abilityFactory = new AbilityFactory(metrics, cacheService, {
      enableCaching: true,
      cacheTimeout: Math.min(finalConfig.permissionCacheTtl * 1000, 3600000), // Max 1 hour
      strictMode: finalConfig.strictMode,
      auditEnabled: finalConfig.enableAuditLog,
    });
    this.engine = new AuthorizationEngine(abilityFactory);

    this.logger.debug("AuthorizationService initialized", {
      enableCaching: finalConfig.cachePermissionResults,
      cacheTtl: finalConfig.permissionCacheTtl,
      hasCacheService: !!cacheService,
      components: {
        configManager: true,
        validator: true,
        pendingTracker: true,
        cacheManager: !!this.cacheManager,
        metricsCollector: true,
        auditor: true,
        engine: true,
      },
    });
  }

  /**
   * Check if user can perform an action on a subject - Main entry point
   */
  async can(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult> {
    const startTime = Date.now();

    // Input validation
    const validationResult = this.validateInputs(
      context,
      action,
      subject,
      resource
    );
    if (!validationResult.granted) {
      return validationResult;
    }

    try {
      // Check cache and race conditions if enabled
      if (this.configManager.isCacheEnabled() && this.cacheManager) {
        return this.processWithCaching(
          context,
          action,
          subject,
          resource,
          startTime
        );
      }

      // Direct computation without caching
      return this.processWithoutCaching(context, action, subject, resource);
    } catch (error) {
      return this.handleSystemError(error, context, action, subject, startTime);
    }
  }

  /**
   * Comprehensive input validation
   */
  private validateInputs(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): AuthorizationResult {
    // Validate authorization context
    const contextValidation =
      this.validator.validateAuthorizationContext(context);
    if (!contextValidation.valid) {
      return {
        granted: false,
        reason: `Invalid authorization context: ${contextValidation.reason}`,
        context: {
          action,
          subject,
          userId: context?.userId || "unknown",
          timestamp: new Date(),
        },
      };
    }

    // Validate action
    const actionValidation = this.validator.validateAction(action);
    if (!actionValidation.valid) {
      return {
        granted: false,
        reason: actionValidation.reason!,
        context: {
          action: (action || "unknown") as Action,
          subject,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    // Validate subject
    const subjectValidation = this.validator.validateSubject(subject);
    if (!subjectValidation.valid) {
      return {
        granted: false,
        reason: subjectValidation.reason!,
        context: {
          action,
          subject: (subject || "unknown") as Subjects,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    // Validate resource context if provided
    const resourceValidation = this.validator.validateResourceContext(resource);
    if (!resourceValidation.valid) {
      return {
        granted: false,
        reason: resourceValidation.reason!,
        context: {
          action,
          subject,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    return { granted: true } as AuthorizationResult;
  }

  /**
   * Process authorization with caching strategy
   */
  private async processWithCaching(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    startTime: number
  ): Promise<AuthorizationResult> {
    const cacheKey = this.cacheManager!.generateCacheKey(
      context,
      action,
      subject,
      resource
    );

    // Check for pending computation to prevent race conditions
    const pendingOperation = this.pendingTracker.getPendingOperation(cacheKey);
    if (pendingOperation) {
      this.metricsCollector.recordCachePending(
        context,
        action,
        subject,
        Date.now() - startTime
      );
      return pendingOperation;
    }

    // Try cache first
    try {
      const cachedResult = await this.cacheManager!.getCachedResult(
        context,
        action,
        subject,
        resource
      );
      if (cachedResult) {
        this.metricsCollector.recordCacheHit(
          context,
          action,
          subject,
          Date.now() - startTime
        );
        return cachedResult;
      }
    } catch (cacheError) {
      this.logger.warn("Cache retrieval failed, computing fresh result", {
        error:
          cacheError instanceof Error ? cacheError.message : "Unknown error",
        userId: context.userId,
      });
    }

    // Create computation promise and track it
    const computationPromise = this.computeAuthorizationResult(
      context,
      action,
      subject,
      resource
    );
    return this.pendingTracker.trackOperation(cacheKey, computationPromise);
  }

  /**
   * Process authorization without caching
   */
  private async processWithoutCaching(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined
  ): Promise<AuthorizationResult> {
    return this.computeAuthorizationResult(context, action, subject, resource);
  }

  /**
   * Compute authorization result with audit logging and metrics
   */
  private async computeAuthorizationResult(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult> {
    const startTime = Date.now();

    // Create ability for user
    const ability = await this.engine.createUserAbility(context);

    // Perform authorization check
    const result = this.engine.checkPermissionWithAbility(
      ability,
      action,
      subject,
      resource,
      context
    );

    // Cache the result if caching enabled
    if (this.configManager.isCacheEnabled() && this.cacheManager) {
      await this.cacheManager.cacheResult(
        context,
        action,
        subject,
        resource,
        result
      );
    }

    // Audit and metrics with error boundaries
    await this.auditAndRecord(
      context,
      action,
      subject,
      resource,
      result,
      startTime
    );

    return result;
  }

  /**
   * Handle system errors with proper logging and fail-secure response
   */
  private handleSystemError(
    error: unknown,
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    startTime: number
  ): AuthorizationResult {
    const errorResult: AuthorizationResult = {
      granted: false,
      reason: "Authorization check failed due to system error", // Sanitized error message
      context: {
        action,
        subject,
        userId: context.userId,
        timestamp: new Date(),
      },
    };

    const systemError =
      error instanceof Error ? error : new Error(String(error));
    this.auditor.auditSystemError(systemError, context, "authorization_check");
    this.metricsCollector.recordAuthorizationError(
      context,
      action,
      subject,
      Date.now() - startTime
    );

    return errorResult;
  }

  /**
   * Audit decision and record metrics with error boundaries
   */
  private async auditAndRecord(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    result: AuthorizationResult,
    startTime: number
  ): Promise<void> {
    try {
      await this.auditor.auditAuthorizationDecision(
        context,
        action,
        subject,
        resource,
        result
      );
    } catch (auditError) {
      // Audit failures should not break authorization
      this.logger.warn("Failed to audit authorization decision", {
        auditError,
        userId: context.userId,
        action,
        subject,
      });
    }

    try {
      this.metricsCollector.recordAuthorizationCheck(
        context,
        action,
        subject,
        Date.now() - startTime
      );
    } catch (metricsError) {
      // Metrics failures should not break authorization
      this.logger.warn("Failed to record authorization metrics", {
        metricsError,
        userId: context.userId,
        action,
        subject,
      });
    }
  }

  /**
   * Check if user cannot perform an action (explicit denial)
   */
  async cannot(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult> {
    const result = await this.can(context, action, subject, resource);
    return {
      ...result,
      granted: !result.granted,
      reason: result.granted
        ? `Access denied: Action ${action} on ${subject} is not permitted`
        : result.reason ||
          `Access denied: Action ${action} on ${subject} is not permitted`,
    };
  }

  /**
   * Check multiple permissions at once
   */
  async canAll(
    context: AuthorizationContext,
    checks: Array<{
      action: Action;
      subject: Subjects;
      resource?: ResourceContext;
    }>
  ): Promise<AuthorizationResult> {
    // Validate inputs
    const contextValidation =
      this.validator.validateAuthorizationContext(context);
    if (!contextValidation.valid) {
      return {
        granted: false,
        reason: `Invalid authorization context: ${contextValidation.reason}`,
        context: {
          action: "multiple" as Action,
          subject: "multiple" as Subjects,
          userId: context?.userId || "unknown",
          timestamp: new Date(),
        },
      };
    }

    const checksValidation = this.validator.validatePermissionChecks(checks);
    if (!checksValidation.valid) {
      return {
        granted: false,
        reason: checksValidation.reason!,
        context: {
          action: "multiple" as Action,
          subject: "multiple" as Subjects,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    const results = await Promise.all(
      checks.map((check) =>
        this.can(context, check.action, check.subject, check.resource)
      )
    );

    const allGranted = results.every((result) => result.granted);
    const deniedChecks = results.filter((result) => !result.granted);

    return {
      granted: allGranted,
      reason: allGranted
        ? "All permissions granted"
        : `Access denied: ${deniedChecks.length} of ${results.length} checks failed`,
      missingPermissions: deniedChecks.flatMap(
        (result) =>
          result.requiredPermissions || [
            `${result.context?.action}_${result.context?.subject}`,
          ]
      ),
      context: {
        action: "multiple" as Action,
        subject: "multiple" as Subjects,
        userId: context.userId,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Check if user has any of the specified roles
   */
  hasAnyRole(context: AuthorizationContext, roles: Role[]): boolean {
    return this.engine.hasAnyRole(context, roles);
  }

  /**
   * Check if user has all specified roles
   */
  hasAllRoles(context: AuthorizationContext, roles: Role[]): boolean {
    return this.engine.hasAllRoles(context, roles);
  }

  /**
   * Get user's effective permissions with caching optimization
   */
  async getUserPermissions(context: AuthorizationContext): Promise<string[]> {
    try {
      // Input validation
      if (!context || !context.userId || !Array.isArray(context.roles)) {
        this.logger.warn("Invalid context provided to getUserPermissions", {
          context,
        });
        return [];
      }

      const ability = await this.engine.createUserAbility(context);

      // Check cache first
      if (this.cacheManager) {
        const cachedPermissions =
          this.cacheManager.getCachedUserPermissions(ability);
        if (cachedPermissions) {
          return cachedPermissions;
        }
      }

      // Extract permissions from ability
      const permissions = this.engine.extractPermissionsFromAbility(ability);

      // Cache permissions if caching enabled
      if (this.cacheManager) {
        this.cacheManager.cacheUserPermissions(ability, permissions);
      }

      return permissions;
    } catch (error) {
      this.logger.error("Failed to get user permissions", {
        userId: context?.userId,
        roles: context?.roles,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return [];
    }
  }

  /**
   * Clear authorization cache for user
   */
  async clearUserCache(userId: string): Promise<void> {
    if (!userId || typeof userId !== "string") {
      this.logger.warn("Cannot clear cache: valid userId is required");
      return;
    }

    try {
      if (this.cacheManager) {
        const clearedCount = await this.cacheManager.clearUserCache(userId);
        this.auditor.auditCacheOperation("clear", userId, { clearedCount });
      }

      this.logger.info("Authorization cache clearing completed", {
        userId: userId.substring(0, 8) + "***",
      });
    } catch (error) {
      this.logger.error("Failed to clear authorization cache", {
        userId: userId.substring(0, 8) + "***",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Cleanup method for proper lifecycle management
   */
  async cleanup(): Promise<void> {
    try {
      // Cleanup pending operation tracker
      this.pendingTracker.cleanup();

      // Cleanup authorization engine
      await this.engine.cleanup();

      this.logger.info("AuthorizationService cleanup completed");
    } catch (error) {
      this.logger.error("Failed to cleanup AuthorizationService", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

// Re-export types for backward compatibility
export type { AuthorizationServiceConfig };
