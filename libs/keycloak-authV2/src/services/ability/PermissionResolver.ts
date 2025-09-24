/**
 * Permission resolver for role-based permissions
 * Handles role-to-permission resolution and conflict management
 */

import type { Role, Permission } from "../../types/authorization.types";
import {
  ROLE_DEFINITIONS,
  getEffectivePermissions,
} from "../../config/roles.config";

export class PermissionResolver {
  /**
   * Get effective permissions for multiple roles
   */
  getEffectivePermissionsForRoles(roles: Role[]): Permission[] {
    const allPermissions: Permission[] = [];

    for (const role of roles) {
      if (ROLE_DEFINITIONS[role]) {
        allPermissions.push(...getEffectivePermissions(role));
      }
    }

    // Remove duplicates and resolve conflicts
    return this.deduplicatePermissions(allPermissions);
  }

  /**
   * Remove duplicate permissions and resolve conflicts
   */
  private deduplicatePermissions(permissions: Permission[]): Permission[] {
    const seen = new Map<string, Permission>();

    for (const permission of permissions) {
      const existing = seen.get(permission.id);

      if (!existing) {
        seen.set(permission.id, permission);
      } else {
        // Handle conflicts - more permissive wins unless explicitly denied
        if (permission.inverted && !existing.inverted) {
          seen.set(permission.id, permission); // Denial takes precedence
        } else if (!permission.inverted && !existing.inverted) {
          // Merge fields if both are grants
          const mergedFields = [
            ...(existing.fields || []),
            ...(permission.fields || []),
          ];
          const uniqueFields =
            mergedFields.length > 0 ? [...new Set(mergedFields)] : undefined;

          seen.set(permission.id, {
            ...existing,
            fields: uniqueFields,
          });
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Get permission changes for granular cache updates
   */
  getPermissionChanges(
    oldPermissions: Permission[],
    newPermissions: Permission[]
  ): {
    added: Permission[];
    removed: Permission[];
    modified: Permission[];
  } {
    const oldMap = new Map(oldPermissions.map((p) => [p.id, p]));
    const newMap = new Map(newPermissions.map((p) => [p.id, p]));

    const added: Permission[] = [];
    const removed: Permission[] = [];
    const modified: Permission[] = [];

    // Find added and modified permissions
    for (const [id, newPerm] of newMap) {
      const oldPerm = oldMap.get(id);
      if (!oldPerm) {
        added.push(newPerm);
      } else if (JSON.stringify(oldPerm) !== JSON.stringify(newPerm)) {
        modified.push(newPerm);
      }
    }

    // Find removed permissions
    for (const [id, oldPerm] of oldMap) {
      if (!newMap.has(id)) {
        removed.push(oldPerm);
      }
    }

    return { added, removed, modified };
  }
}
