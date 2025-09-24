/**
 * RoleManager - Single Responsibility: Role assignment and management
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles role operations
 * - Open/Closed: Extensible for new role types and operations
 * - Liskov Substitution: Can be replaced with different role management implementations
 * - Interface Segregation: Focused on role operations only
 * - Dependency Inversion: Depends on abstractions (IKeycloakApiClient)
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  IRoleManager,
  IKeycloakApiClient,
  KeycloakRole,
} from "./interfaces";

export class RoleManager implements IRoleManager {
  private readonly logger: ILogger = createLogger("RoleManager");

  constructor(
    private readonly apiClient: IKeycloakApiClient,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Get user's realm roles
   */
  async getUserRealmRoles(userId: string): Promise<KeycloakRole[]> {
    const startTime = performance.now();

    try {
      const roles = await this.apiClient.getUserRealmRoles(userId);

      this.recordMetrics("get_user_realm_roles", performance.now() - startTime);

      return roles;
    } catch (error) {
      this.recordError("get_user_realm_roles", error);
      throw error;
    }
  }

  /**
   * Assign realm roles to user
   */
  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const startTime = performance.now();

    try {
      if (roleNames.length === 0) {
        this.logger.warn("No roles specified for assignment", { userId });
        return;
      }

      // Get available realm roles
      const allRoles = await this.apiClient.getRealmRoles();
      const rolesToAssign = this.filterRolesByNames(allRoles, roleNames);

      if (rolesToAssign.length === 0) {
        this.logger.warn("No matching roles found", { roleNames });
        return;
      }

      // Check for roles that don't exist
      const foundRoleNames = rolesToAssign.map((r) => r.name);
      const missingRoles = roleNames.filter(
        (name) => !foundRoleNames.includes(name)
      );

      if (missingRoles.length > 0) {
        this.logger.warn("Some roles not found", { missingRoles, userId });
      }

      if (rolesToAssign.length > 0) {
        await this.apiClient.assignRealmRoles(userId, rolesToAssign);
      }

      this.recordMetrics("assign_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles assigned", {
        userId,
        assignedRoles: rolesToAssign.map((r) => r.name),
        missingRoles,
      });
    } catch (error) {
      this.recordError("assign_realm_roles", error);
      throw error;
    }
  }

  /**
   * Remove realm roles from user
   */
  async removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const startTime = performance.now();

    try {
      if (roleNames.length === 0) {
        this.logger.warn("No roles specified for removal", { userId });
        return;
      }

      // Get user's current realm roles
      const userRoles = await this.getUserRealmRoles(userId);
      const rolesToRemove = this.filterRolesByNames(userRoles, roleNames);

      if (rolesToRemove.length === 0) {
        this.logger.warn("No matching roles found to remove", {
          roleNames,
          userId,
        });
        return;
      }

      await this.apiClient.removeRealmRoles(userId, rolesToRemove);

      this.recordMetrics("remove_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles removed", {
        userId,
        removedRoles: rolesToRemove.map((r) => r.name),
      });
    } catch (error) {
      this.recordError("remove_realm_roles", error);
      throw error;
    }
  }

  /**
   * Assign client roles to user
   */
  async assignClientRoles(
    userId: string,
    clientId: string,
    roleNames: string[]
  ): Promise<void> {
    const startTime = performance.now();

    try {
      if (roleNames.length === 0) {
        this.logger.warn("No client roles specified for assignment", {
          userId,
          clientId,
        });
        return;
      }

      // Get available client roles
      const allRoles = await this.apiClient.getClientRoles(clientId);
      const rolesToAssign = this.filterRolesByNames(allRoles, roleNames);

      if (rolesToAssign.length === 0) {
        this.logger.warn("No matching client roles found", {
          clientId,
          roleNames,
          userId,
        });
        return;
      }

      // Check for roles that don't exist
      const foundRoleNames = rolesToAssign.map((r) => r.name);
      const missingRoles = roleNames.filter(
        (name) => !foundRoleNames.includes(name)
      );

      if (missingRoles.length > 0) {
        this.logger.warn("Some client roles not found", {
          missingRoles,
          userId,
          clientId,
        });
      }

      if (rolesToAssign.length > 0) {
        await this.apiClient.assignClientRoles(userId, clientId, rolesToAssign);
      }

      this.recordMetrics("assign_client_roles", performance.now() - startTime);
      this.logger.info("Client roles assigned", {
        userId,
        clientId,
        assignedRoles: rolesToAssign.map((r) => r.name),
        missingRoles,
      });
    } catch (error) {
      this.recordError("assign_client_roles", error);
      throw error;
    }
  }

  /**
   * Get effective roles for a user (realm + client roles formatted)
   */
  async getEffectiveRoles(userId: string): Promise<string[]> {
    const startTime = performance.now();

    try {
      const realmRoles = await this.getUserRealmRoles(userId);
      const effectiveRoles = realmRoles.map((role) => `realm:${role.name}`);

      // Note: Client roles would require additional API calls per client
      // This could be extended to include client roles if needed

      this.recordMetrics("get_effective_roles", performance.now() - startTime);

      return effectiveRoles;
    } catch (error) {
      this.recordError("get_effective_roles", error);
      throw error;
    }
  }

  /**
   * Check if user has specific realm role
   */
  async hasRealmRole(userId: string, roleName: string): Promise<boolean> {
    try {
      const userRoles = await this.getUserRealmRoles(userId);
      return userRoles.some((role) => role.name === roleName);
    } catch (error) {
      this.recordError("has_realm_role", error);
      throw error;
    }
  }

  /**
   * Bulk role assignment with validation
   */
  async bulkAssignRealmRoles(
    assignments: Array<{ userId: string; roleNames: string[] }>
  ): Promise<Array<{ userId: string; success: boolean; error?: string }>> {
    const results: Array<{ userId: string; success: boolean; error?: string }> =
      [];

    // Pre-fetch all available roles for efficiency
    const allRoles = await this.apiClient.getRealmRoles();

    for (const assignment of assignments) {
      try {
        const rolesToAssign = this.filterRolesByNames(
          allRoles,
          assignment.roleNames
        );

        if (rolesToAssign.length > 0) {
          await this.apiClient.assignRealmRoles(
            assignment.userId,
            rolesToAssign
          );
        }

        results.push({ userId: assignment.userId, success: true });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          userId: assignment.userId,
          success: false,
          error: errorMessage,
        });

        this.logger.error("Bulk role assignment failed for user", {
          userId: assignment.userId,
          roleNames: assignment.roleNames,
          error,
        });
      }
    }

    this.logger.info("Bulk role assignment completed", {
      total: assignments.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    return results;
  }

  // Private utility methods

  private filterRolesByNames(
    roles: KeycloakRole[],
    roleNames: string[]
  ): KeycloakRole[] {
    return roles.filter((role) => roleNames.includes(role.name));
  }

  private recordMetrics(operation: string, duration?: number): void {
    this.metrics?.recordCounter(`role_manager.${operation}`, 1);
    if (duration !== undefined) {
      this.metrics?.recordTimer(`role_manager.${operation}_duration`, duration);
    }
  }

  private recordError(operation: string, error: unknown): void {
    this.metrics?.recordCounter(`role_manager.${operation}_error`, 1);
    this.logger.error(`${operation} failed`, { error });
  }
}
