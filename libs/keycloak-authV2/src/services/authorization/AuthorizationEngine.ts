/**
 * Core authorization engine
 * Handles CASL ability integration and permission checking logic
 */

import { createLogger } from "@libs/utils";
import { AbilityFactory } from "../ability";
import type {
  AuthorizationContext,
  Action,
  Subjects,
  ResourceContext,
  AuthorizationResult,
  AppAbility,
  Role,
} from "../../types/authorization.types";
import { ResourceSanitizer } from "./ResourceSanitizer";

export class AuthorizationEngine {
  private readonly logger = createLogger("AuthorizationEngine");
  private readonly resourceSanitizer: ResourceSanitizer;

  constructor(private readonly abilityFactory: AbilityFactory) {
    this.resourceSanitizer = new ResourceSanitizer();
  }

  /**
   * Create ability for user context
   */
  async createUserAbility(context: AuthorizationContext): Promise<AppAbility> {
    return this.abilityFactory.createAbilityForUser(context);
  }

  /**
   * Perform the actual authorization check with proper type safety
   */
  checkPermissionWithAbility(
    ability: AppAbility,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    context: AuthorizationContext
  ): AuthorizationResult {
    // Create subject instance with resource data if available
    const subjectInstance = resource
      ? {
          ...this.resourceSanitizer.sanitizeResourceContext(resource),
          __type: subject,
        }
      : subject;

    // TYPE SAFETY: Properly handle different subject types for CASL
    let granted: boolean;
    try {
      if (typeof subjectInstance === "object" && subjectInstance !== null) {
        // For object subjects with resource data - cast to any for CASL compatibility
        granted = ability.can(action, subjectInstance as any);
      } else {
        // For string subjects - use the subject directly
        granted = ability.can(action, subject);
      }
    } catch (abilityError) {
      // Handle CASL errors gracefully
      this.logger.warn("CASL ability check failed", {
        error:
          abilityError instanceof Error
            ? abilityError.message
            : "Unknown error",
        action,
        subject,
        userId: context.userId,
      });
      granted = false; // Fail secure
    }

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
   * Extract permissions from ability
   */
  extractPermissionsFromAbility(ability: AppAbility): string[] {
    try {
      // Extract rules from ability and convert to readable permissions
      const rules = ability.rules;
      const permissionsSet = new Set<string>(); // Use Set for O(1) deduplication

      // Single loop with flat mapping instead of nested loops
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
          this.logger.warn("Failed to process authorization rule", {
            rule,
            error:
              ruleError instanceof Error ? ruleError.message : "Unknown error",
          });
        }
      }

      // Convert Set back to array
      return Array.from(permissionsSet);
    } catch (error) {
      this.logger.error("Failed to extract permissions from ability", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return [];
    }
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

    // Empty role array should return true (vacuous truth)
    // "User has all roles in empty set" = true by mathematical definition
    if (!Array.isArray(roles) || roles.length === 0) {
      return true;
    }

    return roles.every((role) => context.roles.includes(role));
  }

  /**
   * Cleanup authorization engine
   */
  async cleanup(): Promise<void> {
    if (
      this.abilityFactory &&
      typeof this.abilityFactory.cleanup === "function"
    ) {
      await this.abilityFactory.cleanup();
    }
  }
}
