/**
 * CASL ability builder with contextual permissions
 * Handles creation of CASL abilities from resolved permissions
 */

import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { createLogger } from "@libs/utils";
import type {
  AppAbility,
  AuthorizationContext,
} from "../../types/authorization.types";
import type { IMetricsCollector } from "@libs/monitoring";
import { TemplateProcessor } from "./TemplateProcessor";
import { PermissionResolver } from "./PermissionResolver";
import type { AbilityFactoryConstants } from "./AbilityFactoryConfig";

export class AbilityBuilderService {
  private readonly logger = createLogger("AbilityBuilderService");
  private readonly templateProcessor: TemplateProcessor;
  private readonly permissionResolver: PermissionResolver;

  constructor(
    private readonly metrics: IMetricsCollector | undefined,
    constants: AbilityFactoryConstants,
    private readonly strictMode: boolean = true
  ) {
    this.templateProcessor = new TemplateProcessor(constants);
    this.permissionResolver = new PermissionResolver();
  }

  /**
   * Build ability from user context
   */
  buildAbility(context: AuthorizationContext): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility
    );

    try {
      // Get all effective permissions for user roles
      const permissions =
        this.permissionResolver.getEffectivePermissionsForRoles(context.roles);

      // Apply permissions to ability builder
      for (const permission of permissions) {
        const conditions = this.templateProcessor.resolveConditions(
          permission.conditions,
          context
        );

        if (permission.inverted) {
          cannot(permission.action, permission.subject, conditions);
        } else {
          if (permission.fields) {
            can(
              permission.action,
              permission.subject,
              permission.fields,
              conditions
            );
          } else {
            can(permission.action, permission.subject, conditions);
          }
        }
      }

      // Apply additional context-based permissions
      this.applyContextualPermissions(can, context);

      return build() as AppAbility;
    } catch (error) {
      this.metrics?.recordCounter("authorization.ability.build_error", 1, {
        userId: context.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      this.logger.error("Failed to build ability", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
        roles: context.roles,
      });

      // Return restrictive ability on error
      return build() as AppAbility;
    }
  }

  /**
   * Apply additional contextual permissions
   */
  private applyContextualPermissions(
    can: any,
    context: AuthorizationContext
  ): void {
    // Apply session-based permissions
    if (context.sessionId) {
      can("read", "Session", { id: context.sessionId });
      can("delete", "Session", { userId: context.userId });
    }

    // Apply IP-based restrictions if needed
    if (this.strictMode && context.ipAddress) {
      // Add IP-based restrictions for sensitive operations
      // This is an example - implement based on your security requirements
    }
  }

  /**
   * Serialize ability to storable format with validation
   */
  serializeAbility(ability: AppAbility): string {
    try {
      if (!ability || !ability.rules) {
        this.logger.warn("Invalid ability provided for serialization");
        return "[]";
      }
      return JSON.stringify(ability.rules);
    } catch (error) {
      this.logger.error("Failed to serialize ability", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return "[]";
    }
  }

  /**
   * Create a restrictive ability for error cases
   */
  createRestrictiveAbility(): AppAbility {
    const { build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    return build() as AppAbility;
  }
}
