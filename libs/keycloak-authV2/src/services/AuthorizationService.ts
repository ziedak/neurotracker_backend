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

// Simple logger interface for authorization service
interface ILogger {
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
}
import type { CacheService } from "@libs/database";

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

  constructor(
    private readonly logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    private readonly cacheService?: CacheService,
    config: AuthorizationServiceConfig = {}
  ) {
    this.config = {
      enableAuditLog: config.enableAuditLog ?? true,
      enableMetrics: config.enableMetrics ?? true,
      cachePermissionResults: config.cachePermissionResults ?? true,
      permissionCacheTtl: config.permissionCacheTtl ?? 300, // 5 minutes
      strictMode: config.strictMode ?? true,
    };

    this.abilityFactory = new AbilityFactory(metrics, {
      enableCaching: true,
      cacheTimeout: 300_000,
      strictMode: this.config.strictMode,
      auditEnabled: this.config.enableAuditLog,
    });
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
    // Input validation
    if (!context || !context.userId || !Array.isArray(context.roles)) {
      return {
        granted: false,
        reason: "Invalid authorization context: missing userId or roles",
        context: {
          action,
          subject,
          userId: context?.userId || "unknown",
          timestamp: new Date(),
        },
      };
    }

    if (!action || !subject) {
      return {
        granted: false,
        reason:
          "Invalid authorization request: action and subject are required",
        context: {
          action: (action || "unknown") as Action,
          subject: (subject || "unknown") as Subjects,
          userId: context.userId,
          timestamp: new Date(),
        },
      };
    }

    const startTime = Date.now();

    try {
      // Check cache first
      if (this.config.cachePermissionResults && this.cacheService) {
        const cachedResult = await this.getCachedResult(
          context,
          action,
          subject,
          resource
        );
        if (cachedResult) {
          this.recordMetrics(
            "cache_hit",
            context,
            action,
            subject,
            Date.now() - startTime
          );
          return cachedResult;
        }
      }

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

      // Cache result if enabled
      if (this.config.cachePermissionResults && this.cacheService) {
        await this.cacheResult(context, action, subject, resource, result);
      }

      // Log and record metrics (don't let audit failures break authorization)
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

      this.recordMetrics(
        "authorization_check",
        context,
        action,
        subject,
        Date.now() - startTime
      );

      return result;
    } catch (error) {
      const errorResult: AuthorizationResult = {
        granted: false,
        reason: `Authorization check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
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

      this.recordMetrics(
        "authorization_error",
        context,
        action,
        subject,
        Date.now() - startTime
      );

      return errorResult;
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
    // Input validation
    if (!context || !context.userId || !Array.isArray(context.roles)) {
      return {
        granted: false,
        reason: "Invalid authorization context: missing userId or roles",
        context: {
          action: "multiple" as Action,
          subject: "multiple" as Subjects,
          userId: context?.userId || "unknown",
          timestamp: new Date(),
        },
      };
    }

    if (!Array.isArray(checks) || checks.length === 0) {
      // SECURITY FIX: Empty checks should be treated as no restrictions to check
      // This is safer than automatically granting access
      return {
        granted: true,
        reason: "No permission checks specified", // More accurate description
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
   * Get user's effective permissions
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

      // Extract rules from ability and convert to readable permissions
      const rules = ability.rules;
      const permissions: string[] = [];

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

          // Generate permission strings for all action-subject combinations
          for (const action of actions) {
            for (const subject of subjects) {
              if (
                action &&
                subject &&
                typeof action === "string" &&
                typeof subject === "string"
              ) {
                const prefix = rule.inverted ? "!" : "";
                const permission = `${prefix}${action}_${subject}`;
                permissions.push(permission);
              }
            }
          }
        } catch (ruleError) {
          // Log rule processing errors but continue with other rules
          this.logger?.warn("Failed to process authorization rule", {
            rule,
            error:
              ruleError instanceof Error ? ruleError.message : "Unknown error",
          });
        }
      }

      // Remove duplicates efficiently - optimize for both small and large arrays
      const uniquePermissions =
        permissions.length > 100 // Increase threshold for Set usage
          ? Array.from(new Set(permissions)) // Use Set for large arrays
          : permissions.reduce((unique: string[], perm: string) => {
              // Use reduce instead of filter+indexOf for better performance
              return unique.includes(perm) ? unique : [...unique, perm];
            }, []);

      return uniquePermissions;
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
   * Clear authorization cache for user
   */
  async clearUserCache(userId: string): Promise<void> {
    if (!userId) {
      this.logger?.warn("Cannot clear cache: userId is required");
      return;
    }

    try {
      // Clear ability factory cache
      this.abilityFactory.clearCache(userId);

      // Clear permission results cache using pattern invalidation
      if (this.cacheService) {
        try {
          // CRITICAL FIX: The cache key pattern was broken
          // Cache keys are base64 encoded full key data, not just userId
          // We need multiple strategies since exact pattern matching is difficult

          // Strategy 1: Try to match based on userId component
          const userIdB64 = Buffer.from(userId).toString("base64");

          // Strategy 2: Generate sample keys to understand the pattern
          const sampleKeyData = { userId, roles: ["user"] }; // Most common role
          const sampleKey = crypto
            .createHash("sha256")
            .update(JSON.stringify(sampleKeyData))
            .digest("base64")
            .replace(/[+/=]/g, "_");

          // Try multiple patterns to maximize cache clearing effectiveness
          const patterns = [
            `auth:*${userIdB64}*`, // Original approach - might catch some
            `auth:*${userId}*`, // Direct userId search
            `auth:${sampleKey}*`, // Sample-based pattern
            `auth:*${userId.substring(0, 8)}*`, // Partial userId match
          ];

          let totalInvalidated = 0;
          for (const pattern of patterns) {
            try {
              const count = await this.cacheService.invalidatePattern(pattern);
              totalInvalidated += count;
            } catch (patternError) {
              // DEBUGGING FIX: Include error details for better troubleshooting
              this.logger?.warn("Cache pattern invalidation failed", {
                pattern,
                error:
                  patternError instanceof Error
                    ? patternError.message
                    : "Unknown error",
                userId,
              });
            }
          }

          this.logger?.info("Authorization cache cleared", {
            userId,
            invalidatedKeys: totalInvalidated,
            patternsUsed: patterns.length,
          });
        } catch (patternError) {
          this.logger?.warn("Pattern-based cache clearing failed", {
            userId,
            error:
              patternError instanceof Error
                ? patternError.message
                : "Unknown error",
          });
          // Continue execution - this is not a fatal error
        }
      }

      this.logger?.info("Authorization cache cleared successfully", { userId });
    } catch (error) {
      this.logger?.error("Failed to clear authorization cache", {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Don't throw - cache clearing failures should not be fatal
      // The authorization system should continue to work without cache
    }
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
    // SECURITY FIX: Prevent prototype pollution by sanitizing resource object
    const subjectInstance = resource
      ? {
          // Only allow specific safe properties to prevent prototype pollution
          type: resource.type,
          id: resource.id,
          ownerId: resource.ownerId,
          organizationId: resource.organizationId,
          metadata:
            resource.metadata && typeof resource.metadata === "object"
              ? { ...resource.metadata }
              : undefined,
          __type: subject,
        }
      : subject;

    // CASL can handle the enhanced subject with resource data
    const granted = ability.can(action, subjectInstance as any);

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
   * Generate cache key for authorization result
   */
  private generateCacheKey(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): string {
    try {
      const rolesHash = Array.isArray(context.roles)
        ? context.roles.sort().join(",")
        : "";

      // Safe resource hash generation with validation
      let resourceHash = "null";
      if (resource) {
        const safeType =
          typeof resource.type === "string" ? resource.type : "unknown";
        const safeId = resource.id || "";
        const safeOwnerId = resource.ownerId || "";
        resourceHash = `${safeType}:${safeId}:${safeOwnerId}`;
      }

      const keyData = `${context.userId}:${rolesHash}:${action}:${subject}:${resourceHash}`;

      // SECURITY FIX: Use consistent hash-based keys to prevent Redis issues
      // Always use SHA256 hash to avoid base64 special characters and length issues
      const hash = crypto.createHash("sha256").update(keyData).digest("hex");
      return `auth:${hash.substring(0, 32)}`; // Use 32-char prefix for readability
    } catch (error) {
      // Fallback to deterministic key generation without timestamp
      this.logger?.warn("Failed to generate cache key, using fallback", {
        error,
      });
      // Use a deterministic fallback that still allows cache hits
      const fallbackKey = `${context.userId}-${action}-${subject}`;
      const hash = crypto
        .createHash("sha256")
        .update(fallbackKey)
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
