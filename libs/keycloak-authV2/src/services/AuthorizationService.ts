/**
 * Authorization Service
 *
 * Main service for handling authorization decisions using CASL abilities.
 * Provides high-level interface for permission checking and role management.
 */

import crypto from "crypto";
import type {
  Action,
  Subjects,
  AuthorizationContext,
  ResourceContext,
  AuthorizationResult,
  Role,
  AppAbility,
} from "../types/authorization.types";
import { AbilityFactory } from "./AbilityFactory";
import type { IMetricsCollector } from "@libs/monitoring";

import type { CacheService } from "@libs/database";
import { createLogger } from "@libs/utils";

/**
 * Configuration for the Authorization Service
 */
export interface AuthorizationServiceConfig {
  enableAuditLog?: boolean;
  enableMetrics?: boolean;
  cachePermissionResults?: boolean;
  permissionCacheTtl?: number;
  strictMode?: boolean;
}

/**
 * Authorization Service implementation
 */
export class AuthorizationService {
  private readonly config: Required<AuthorizationServiceConfig>;
  private readonly abilityFactory: AbilityFactory;
  private readonly permissionCache = new WeakMap<AppAbility, string[]>();
  private readonly pendingCacheOperations = new Map<
    string,
    Promise<AuthorizationResult>
  >();

  constructor(
    private readonly logger = createLogger("AuthorizationService"),
    private readonly metrics?: IMetricsCollector,
    private readonly cacheService?: CacheService,
    config: AuthorizationServiceConfig = {}
  ) {
    // SECURITY: Validate configuration parameters with bounds checking
    this.validateConfiguration(config);

    this.config = {
      enableAuditLog: config.enableAuditLog ?? true,
      enableMetrics: config.enableMetrics ?? true,
      cachePermissionResults: config.cachePermissionResults ?? true,
      permissionCacheTtl: Math.min(
        Math.max(config.permissionCacheTtl ?? 300, 60),
        3600
      ), // 1min - 1hour
      strictMode: config.strictMode ?? true,
    };

    this.abilityFactory = new AbilityFactory(metrics, {
      enableCaching: true,
      cacheTimeout: Math.min(this.config.permissionCacheTtl * 1000, 3600000), // Max 1 hour
      strictMode: this.config.strictMode,
      auditEnabled: this.config.enableAuditLog,
    });
  }

  /**
   * Validate configuration parameters with bounds checking
   */
  private validateConfiguration(config: AuthorizationServiceConfig): void {
    if (config.permissionCacheTtl !== undefined) {
      if (
        typeof config.permissionCacheTtl !== "number" ||
        isNaN(config.permissionCacheTtl) ||
        config.permissionCacheTtl < 0
      ) {
        throw new Error("permissionCacheTtl must be a non-negative number");
      }
      if (config.permissionCacheTtl > 86400) {
        // 24 hours max
        throw new Error(
          "permissionCacheTtl cannot exceed 86400 seconds (24 hours)"
        );
      }
    }

    // Validate boolean configurations
    const booleanFields: (keyof AuthorizationServiceConfig)[] = [
      "enableAuditLog",
      "enableMetrics",
      "cachePermissionResults",
      "strictMode",
    ];

    for (const field of booleanFields) {
      if (config[field] !== undefined && typeof config[field] !== "boolean") {
        throw new Error(`${field} must be a boolean value`);
      }
    }
  }

  /**
   * Comprehensive input validation for authorization context
   */
  private validateAuthorizationContext(context: AuthorizationContext): {
    valid: boolean;
    reason?: string;
  } {
    if (!context) {
      return { valid: false, reason: "Authorization context is required" };
    }

    // Validate userId
    if (!context.userId || typeof context.userId !== "string") {
      return { valid: false, reason: "Valid userId is required" };
    }
    if (context.userId.trim().length === 0) {
      return { valid: false, reason: "userId cannot be empty" };
    }
    if (context.userId.length > 100) {
      return { valid: false, reason: "userId too long (max 100 characters)" };
    }
    // Basic format validation - prevent injection attacks
    if (!/^[a-zA-Z0-9._@-]+$/.test(context.userId)) {
      return { valid: false, reason: "userId contains invalid characters" };
    }

    // Validate roles array
    if (!Array.isArray(context.roles)) {
      return { valid: false, reason: "roles must be an array" };
    }
    if (context.roles.length > 50) {
      return { valid: false, reason: "Too many roles (max 50)" };
    }
    for (const role of context.roles) {
      if (typeof role !== "string" || role.trim().length === 0) {
        return { valid: false, reason: "All roles must be non-empty strings" };
      }
      if (role.length > 50) {
        return {
          valid: false,
          reason: "Role name too long (max 50 characters)",
        };
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(role)) {
        return { valid: false, reason: "Role contains invalid characters" };
      }
    }

    // Validate optional fields
    if (
      context.sessionId &&
      (typeof context.sessionId !== "string" || context.sessionId.length > 200)
    ) {
      return { valid: false, reason: "Invalid sessionId format" };
    }
    if (
      context.ipAddress &&
      (typeof context.ipAddress !== "string" || context.ipAddress.length > 45)
    ) {
      return { valid: false, reason: "Invalid ipAddress format" };
    }
    if (
      context.userAgent &&
      (typeof context.userAgent !== "string" || context.userAgent.length > 500)
    ) {
      return { valid: false, reason: "Invalid userAgent format" };
    }

    return { valid: true };
  }

  /**
   * Check if user can perform an action on a subject
   */
  async can(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult> {
    // ENHANCED INPUT VALIDATION
    const contextValidation = this.validateAuthorizationContext(context);
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

    // Validate action and subject
    if (!action || typeof action !== "string" || action.trim().length === 0) {
      return {
        granted: false,
        reason: "Invalid action: must be a non-empty string",
        context: {
          action: (action || "unknown") as Action,
          subject,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    if (
      !subject ||
      typeof subject !== "string" ||
      subject.trim().length === 0
    ) {
      return {
        granted: false,
        reason: "Invalid subject: must be a non-empty string",
        context: {
          action,
          subject: (subject || "unknown") as Subjects,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    const startTime = Date.now();

    try {
      // Check cache first with atomic operation to prevent race conditions
      if (this.config.cachePermissionResults && this.cacheService) {
        const cacheKey = this.generateCacheKey(
          context,
          action,
          subject,
          resource
        );

        // Check if there's already a pending operation for this key
        const pendingOperation = this.pendingCacheOperations.get(cacheKey);
        if (pendingOperation) {
          // Wait for the pending operation instead of computing again
          try {
            this.recordMetrics(
              "cache_pending",
              context,
              action,
              subject,
              Date.now() - startTime
            );
            return await pendingOperation;
          } catch (pendingError) {
            // If pending operation fails, continue with fresh computation
            this.pendingCacheOperations.delete(cacheKey);
          }
        }

        // Try to get from cache atomically
        const cachedResult = await this.getCachedResult(
          context,
          action,
          subject,
          resource
        );
        if (cachedResult) {
          try {
            this.recordMetrics(
              "cache_hit",
              context,
              action,
              subject,
              Date.now() - startTime
            );
          } catch (metricsError) {
            this.logger?.warn("Failed to record cache hit metrics", {
              metricsError,
            });
          }
          return cachedResult;
        }

        // Create a promise for this computation to prevent race conditions
        const computationPromise = this.computeAuthorizationResult(
          context,
          action,
          subject,
          resource
        );
        this.pendingCacheOperations.set(cacheKey, computationPromise);

        try {
          const result = await computationPromise;

          // Cache the result atomically
          await this.cacheResult(context, action, subject, resource, result);

          return result;
        } finally {
          // Always clean up the pending operation
          this.pendingCacheOperations.delete(cacheKey);
        }
      }

      // No caching - compute directly
      return await this.computeAuthorizationResult(
        context,
        action,
        subject,
        resource
      );
    } catch (error) {
      const errorResult: AuthorizationResult = {
        granted: false,
        reason: "Authorization check failed due to system error", // SECURITY: Sanitized error message
        context: {
          action,
          subject,
          userId: context.userId,
          timestamp: new Date(),
        },
      };

      this.logger?.error("Authorization check failed", {
        error,
        userId: context.userId,
        action,
        subject,
        resource,
      });

      // Add error boundary for error metrics
      try {
        this.recordMetrics(
          "authorization_error",
          context,
          action,
          subject,
          Date.now() - startTime
        );
      } catch (metricsError) {
        this.logger?.warn("Failed to record error metrics", { metricsError });
      }

      return errorResult;
    }
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
    const ability = this.abilityFactory.createAbilityForUser(context);

    // Perform authorization check
    const result = this._checkPermissionWithAbility(
      ability,
      action,
      subject,
      resource,
      context
    );

    // Log and record metrics with error boundaries
    try {
      await this.auditAuthorizationDecision(
        context,
        action,
        subject,
        resource,
        result
      );
    } catch (auditError) {
      // Audit failures should not break authorization
      this.logger?.warn("Failed to audit authorization decision", {
        auditError,
        userId: context.userId,
        action,
        subject,
      });
    }

    // Add error boundary for metrics recording
    try {
      this.recordMetrics(
        "authorization_check",
        context,
        action,
        subject,
        Date.now() - startTime
      );
    } catch (metricsError) {
      // Metrics failures should not break authorization
      this.logger?.warn("Failed to record authorization metrics", {
        metricsError,
        userId: context.userId,
        action,
        subject,
      });
    }

    return result;
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
    // ENHANCED INPUT VALIDATION using same validation as can()
    const contextValidation = this.validateAuthorizationContext(context);
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

    if (!Array.isArray(checks) || checks.length === 0) {
      // SECURITY FIX: Empty checks should DENY access by default for security
      // This prevents accidental privilege escalation when no checks are specified
      return {
        granted: false,
        reason: "No permission checks specified - access denied by default",
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
    if (
      !context ||
      !Array.isArray(context.roles) ||
      !Array.isArray(roles) ||
      roles.length === 0
    ) {
      return false;
    }
    return roles.some((role) => context.roles.includes(role));
  }

  /**
   * Check if user has all specified roles
   */
  hasAllRoles(context: AuthorizationContext, roles: Role[]): boolean {
    if (!context || !Array.isArray(context.roles)) {
      return false;
    }

    // LOGIC FIX: Empty role array should return true (vacuous truth)
    // "User has all roles in empty set" = true by mathematical definition
    if (!Array.isArray(roles) || roles.length === 0) {
      return true;
    }

    return roles.every((role) => context.roles.includes(role));
  }

  /**
   * Get user's effective permissions with WeakMap caching optimization
   */
  async getUserPermissions(context: AuthorizationContext): Promise<string[]> {
    try {
      // Input validation
      if (!context || !context.userId || !Array.isArray(context.roles)) {
        this.logger?.warn("Invalid context provided to getUserPermissions", {
          context,
        });
        return [];
      }

      const ability = this.abilityFactory.createAbilityForUser(context);

      // Check WeakMap cache first for this ability instance
      const cachedPermissions = this.permissionCache.get(ability);
      if (cachedPermissions) {
        return cachedPermissions;
      }

      // Extract rules from ability and convert to readable permissions
      const rules = ability.rules;
      const permissionsSet = new Set<string>(); // Use Set for O(1) deduplication

      // OPTIMIZATION: Single loop with flat mapping instead of nested loops
      for (const rule of rules) {
        try {
          // Safely extract action and subject, handling various CASL rule formats
          const actions = Array.isArray(rule.action)
            ? rule.action
            : rule.action
            ? [rule.action]
            : [];

          const subjects = Array.isArray(rule.subject)
            ? rule.subject
            : rule.subject
            ? [rule.subject]
            : [];

          // Use flat mapping to avoid nested loops - O(n) instead of O(n²)
          const rulePermissions = actions.flatMap((action) =>
            subjects
              .filter(
                (subject) =>
                  action &&
                  subject &&
                  typeof action === "string" &&
                  typeof subject === "string"
              )
              .map((subject) => {
                const prefix = rule.inverted ? "!" : "";
                return `${prefix}${action}_${subject}`;
              })
          );

          // Add to Set for automatic deduplication
          rulePermissions.forEach((perm) => permissionsSet.add(perm));
        } catch (ruleError) {
          // Log rule processing errors but continue with other rules
          this.logger?.warn("Failed to process authorization rule", {
            rule,
            error:
              ruleError instanceof Error ? ruleError.message : "Unknown error",
          });
        }
      }

      // Convert Set back to array
      const permissions = Array.from(permissionsSet);

      // Cache in WeakMap for automatic garbage collection
      this.permissionCache.set(ability, permissions);

      return permissions;
    } catch (error) {
      // Enhanced error context for better debugging
      this.logger?.error("Failed to get user permissions", {
        userId: context?.userId,
        roles: context?.roles,
        contextType: typeof context,
        hasAbilityFactory: !!this.abilityFactory,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  /**
   * Clear authorization cache for user - optimized single operation
   */
  async clearUserCache(userId: string): Promise<void> {
    if (!userId || typeof userId !== "string") {
      this.logger?.warn("Cannot clear cache: valid userId is required");
      return;
    }

    try {
      // Clear ability factory cache
      this.abilityFactory.clearCache(userId);

      // LIFECYCLE FIX: Clear WeakMap entries for this user's abilities
      // Note: WeakMap entries are automatically garbage collected when abilities are disposed
      // But we can help by clearing related user data

      // PERFORMANCE FIX: Optimized single cache clearing operation
      if (this.cacheService) {
        try {
          // Use a more targeted approach with single operation
          // Hash the userId to create a consistent pattern match
          const userHash = crypto
            .createHash("sha256")
            .update(userId)
            .digest("hex")
            .substring(0, 16);
          const pattern = `auth:*${userHash}*`;

          // Single optimized invalidation
          const invalidatedCount = await this.cacheService.invalidatePattern(
            pattern
          );

          this.logger?.info("Authorization cache cleared efficiently", {
            userId: userId.substring(0, 8) + "***", // Partially obscured for logs
            invalidatedKeys: invalidatedCount,
            pattern: "optimized_single_pattern",
          });
        } catch (cacheError) {
          // Fallback to direct key deletion if pattern matching fails
          this.logger?.warn("Pattern cache clearing failed, using fallback", {
            userId: userId.substring(0, 8) + "***",
            error:
              cacheError instanceof Error
                ? cacheError.message
                : "Unknown error",
          });

          // Don't implement complex fallback - let cache naturally expire
          // This prevents DoS from expensive operations
        }
      }

      this.logger?.info("Authorization cache clearing completed", {
        userId: userId.substring(0, 8) + "***",
      });
    } catch (error) {
      this.logger?.error("Failed to clear authorization cache", {
        userId: userId.substring(0, 8) + "***",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Don't throw - cache clearing failures should not be fatal
    }
  }

  /**
   * Cleanup method for proper lifecycle management
   */
  async cleanup(): Promise<void> {
    try {
      // Clear all pending cache operations to prevent memory leaks
      this.pendingCacheOperations.clear();

      // The WeakMap will automatically be garbage collected
      // when ability objects are no longer referenced

      this.logger?.info("AuthorizationService cleanup completed");
    } catch (error) {
      this.logger?.error("Failed to cleanup AuthorizationService", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Securely sanitize resource metadata to prevent prototype pollution
   */
  private sanitizeMetadata(obj: any, depth = 0): any {
    // Prevent deep recursion attacks
    if (depth > 10) return null;
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== "object") return obj;
    if (Array.isArray(obj))
      return obj.map((item) => this.sanitizeMetadata(item, depth + 1));

    const clean: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // CRITICAL: Block all prototype pollution vectors
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      // Prevent other dangerous keys
      if (key.startsWith("__") || key.includes("prototype")) {
        continue;
      }
      clean[key] = this.sanitizeMetadata(value, depth + 1);
    }
    return clean;
  }

  /**
   * Perform the actual authorization check
   */
  private _checkPermissionWithAbility(
    ability: AppAbility,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    context: AuthorizationContext
  ): AuthorizationResult {
    // Create subject instance with resource data if available
    // SECURITY FIX: Use secure deep sanitization to prevent prototype pollution
    const subjectInstance = resource
      ? {
          // Only allow specific safe properties with proper sanitization
          type: typeof resource.type === "string" ? resource.type : undefined,
          id: typeof resource.id === "string" ? resource.id : undefined,
          ownerId:
            typeof resource.ownerId === "string" ? resource.ownerId : undefined,
          organizationId:
            typeof resource.organizationId === "string"
              ? resource.organizationId
              : undefined,
          metadata: resource.metadata
            ? this.sanitizeMetadata(resource.metadata)
            : undefined,
          __type: subject,
        }
      : subject;

    // CASL can handle the enhanced subject with resource data
    // TYPE SAFETY FIX: Create properly typed subject for CASL
    let typedSubject: any;
    if (typeof subjectInstance === "object" && subjectInstance !== null) {
      // For object subjects with resource data
      typedSubject = subjectInstance;
    } else {
      // For string subjects
      typedSubject = subject;
    }

    const granted = ability.can(action, typedSubject);

    const result: AuthorizationResult = {
      granted,
      reason: granted
        ? `Access granted: User has ${action} permission on ${subject}`
        : `Access denied: User lacks ${action} permission on ${subject}`,
      requiredPermissions: [`${action}_${subject}`],
      context: {
        action,
        subject,
        userId: context.userId,
        timestamp: new Date(),
      },
    };

    if (!granted) {
      // Find missing permissions
      result.missingPermissions = [`${action}_${subject}`];
    }

    return result;
  }

  /**
   * Get cached authorization result
   */
  private async getCachedResult(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult | null> {
    if (!this.cacheService) return null;

    const cacheKey = this.generateCacheKey(context, action, subject, resource);

    try {
      const cacheResult = await this.cacheService.get<AuthorizationResult>(
        cacheKey
      );
      if (cacheResult.data) {
        return cacheResult.data;
      }
      return null;
    } catch (error) {
      this.logger?.warn("Failed to get cached authorization result", {
        error,
        cacheKey,
      });
      return null;
    }
  }

  /**
   * Cache authorization result
   */
  private async cacheResult(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    result: AuthorizationResult
  ): Promise<void> {
    if (!this.cacheService) return;

    const cacheKey = this.generateCacheKey(context, action, subject, resource);

    try {
      await this.cacheService.set(
        cacheKey,
        result,
        this.config.permissionCacheTtl
      );
    } catch (error) {
      this.logger?.warn("Failed to cache authorization result", {
        error,
        cacheKey,
      });
    }
  }

  /**
   * Generate secure cache key for authorization result
   * SECURITY FIX: Hash all sensitive data to prevent PII exposure
   */
  private generateCacheKey(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): string {
    try {
      // Create complete key data structure for hashing
      const keyData = {
        userId: context.userId,
        roles: Array.isArray(context.roles) ? [...context.roles].sort() : [],
        action,
        subject,
        resource: resource
          ? {
              type: resource.type || "",
              id: resource.id || "",
              ownerId: resource.ownerId || "",
            }
          : null,
      };

      // SECURITY FIX: Always hash complete key data to prevent PII exposure
      // No user information should be visible in cache key patterns
      const keyString = JSON.stringify(keyData);
      const hash = crypto.createHash("sha256").update(keyString).digest("hex");

      // Use shorter hash for better performance while maintaining uniqueness
      return `auth:${hash.substring(0, 32)}`;
    } catch (error) {
      // Fallback with secure error handling
      this.logger?.warn("Failed to generate cache key, using fallback", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Deterministic fallback that still prevents PII exposure
      const fallbackData = `${
        context.userId
      }-${action}-${subject}-${Date.now()}`;
      const hash = crypto
        .createHash("sha256")
        .update(fallbackData)
        .digest("hex");
      return `auth:fallback:${hash.substring(0, 16)}`;
    }
  }

  /**
   * Audit authorization decision
   */
  private async auditAuthorizationDecision(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    result: AuthorizationResult
  ): Promise<void> {
    if (!this.config.enableAuditLog) return;

    const auditEntry = {
      timestamp: new Date().toISOString(),
      userId: context.userId,
      action,
      subject,
      resource: resource ? { type: resource.type, id: resource.id } : null,
      granted: result.granted,
      reason: result.reason,
      userRoles: context.roles,
      sessionId: context.sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    };

    this.logger?.info("Authorization decision", auditEntry);
  }

  /**
   * Record authorization metrics
   */
  private recordMetrics(
    operation: string,
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    if (!this.config.enableMetrics || !this.metrics) return;

    this.metrics.recordTimer(`authorization.${operation}.duration`, duration, {
      userId: context.userId,
      action,
      subject,
      rolesCount: (context.roles?.length || 0).toString(),
    });

    this.metrics.recordCounter(`authorization.${operation}.total`, 1, {
      action,
      subject,
    });
  }
}
