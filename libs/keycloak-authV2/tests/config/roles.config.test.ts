/**
 * Roles Configuration Tests
 *
 * Tests for role definitions and permission hierarchies
 */

import {
  ROLE_DEFINITIONS,
  getRolesInHierarchicalOrder,
  getEffectivePermissions,
  roleInheritsFrom,
} from "../../src/config/roles.config";
import type { Role } from "../../src/types/authorization.types";

describe("Roles Configuration", () => {
  describe("ROLE_DEFINITIONS", () => {
    it("should have all required roles defined", () => {
      const requiredRoles: Role[] = [
        "guest",
        "api_consumer",
        "user",
        "analyst",
        "manager",
        "admin",
      ];

      for (const role of requiredRoles) {
        expect(ROLE_DEFINITIONS[role]).toBeDefined();
        expect(ROLE_DEFINITIONS[role].name).toBe(role);
      }
    });

    it("should have valid permission structures", () => {
      Object.values(ROLE_DEFINITIONS).forEach((roleDefinition) => {
        expect(roleDefinition.name).toBeDefined();
        expect(Array.isArray(roleDefinition.permissions)).toBe(true);

        roleDefinition.permissions.forEach((permission) => {
          expect(permission.id).toBeDefined();
          expect(permission.action).toBeDefined();
          expect(permission.subject).toBeDefined();
        });
      });
    });

    it("should have proper inheritance chains", () => {
      // Manager should inherit from analyst
      expect(ROLE_DEFINITIONS.manager.inherits).toContain("analyst");

      // Analyst should inherit from user
      expect(ROLE_DEFINITIONS.analyst.inherits).toContain("user");

      // Admin should not inherit (has manage all)
      expect(ROLE_DEFINITIONS.admin.inherits).toBeUndefined();

      // Guest should not inherit
      expect(ROLE_DEFINITIONS.guest.inherits).toBeUndefined();
    });

    it("should mark system roles correctly", () => {
      expect(ROLE_DEFINITIONS.admin.isSystem).toBe(true);
      expect(ROLE_DEFINITIONS.api_consumer.isSystem).toBe(true);
      expect(ROLE_DEFINITIONS.user.isSystem).toBe(false);
      expect(ROLE_DEFINITIONS.manager.isSystem).toBe(false);
    });
  });

  describe("getRolesInHierarchicalOrder", () => {
    it("should return roles in dependency order", () => {
      const roles = getRolesInHierarchicalOrder();

      expect(roles).toEqual([
        "guest",
        "api_consumer",
        "user",
        "analyst",
        "manager",
        "admin",
      ]);

      // User should come before analyst
      expect(roles.indexOf("user")).toBeLessThan(roles.indexOf("analyst"));

      // Analyst should come before manager
      expect(roles.indexOf("analyst")).toBeLessThan(roles.indexOf("manager"));
    });

    it("should include all defined roles", () => {
      const roles = getRolesInHierarchicalOrder();
      const definedRoles = Object.keys(ROLE_DEFINITIONS) as Role[];

      expect(roles.length).toBe(definedRoles.length);
      definedRoles.forEach((role) => {
        expect(roles).toContain(role);
      });
    });
  });

  describe("getEffectivePermissions", () => {
    it("should return base permissions for guest role", () => {
      const permissions = getEffectivePermissions("guest");

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBe(0); // Guest has no permissions
    });

    it("should return user permissions for user role", () => {
      const permissions = getEffectivePermissions("user");

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);

      // Should include base user permissions
      const permissionIds = permissions.map((p) => p.id);
      expect(permissionIds).toContain("read_User");
      expect(permissionIds).toContain("create_Project");
    });

    it("should include inherited permissions for analyst role", () => {
      const userPermissions = getEffectivePermissions("user");
      const analystPermissions = getEffectivePermissions("analyst");

      expect(analystPermissions.length).toBeGreaterThan(userPermissions.length);

      // Should include user permissions
      const analystPermissionIds = analystPermissions.map((p) => p.id);
      const userPermissionIds = userPermissions.map((p) => p.id);

      userPermissionIds.forEach((permissionId) => {
        expect(analystPermissionIds).toContain(permissionId);
      });

      // Should include analyst-specific permissions
      expect(analystPermissionIds).toContain("read_Dashboard");
    });

    it("should include all inherited permissions for manager role", () => {
      const userPermissions = getEffectivePermissions("user");
      const analystPermissions = getEffectivePermissions("analyst");
      const managerPermissions = getEffectivePermissions("manager");

      expect(managerPermissions.length).toBeGreaterThan(
        analystPermissions.length
      );

      const managerPermissionIds = managerPermissions.map((p) => p.id);

      // Should include user and analyst permissions
      userPermissions.forEach((permission) => {
        expect(managerPermissionIds).toContain(permission.id);
      });

      analystPermissions.forEach((permission) => {
        expect(managerPermissionIds).toContain(permission.id);
      });

      // Should include manager-specific permissions
      expect(managerPermissionIds).toContain("approve_Report");
    });

    it("should handle admin role with manage all permission", () => {
      const permissions = getEffectivePermissions("admin");

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);

      const permissionIds = permissions.map((p) => p.id);
      expect(permissionIds).toContain("manage_all");
    });

    it("should deduplicate permissions across inheritance", () => {
      const managerPermissions = getEffectivePermissions("manager");
      const permissionIds = managerPermissions.map((p) => p.id);

      // Should not have duplicates
      const uniqueIds = [...new Set(permissionIds)];
      expect(permissionIds.length).toBe(uniqueIds.length);
    });

    it("should handle unknown roles gracefully", () => {
      const permissions = getEffectivePermissions("unknown_role" as Role);

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBe(0);
    });

    it("should handle api_consumer role separately", () => {
      const permissions = getEffectivePermissions("api_consumer");

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);

      const permissionIds = permissions.map((p) => p.id);
      expect(permissionIds).toContain("read_User");
      expect(permissionIds).toContain("read_Project");
    });
  });

  describe("roleInheritsFrom", () => {
    it("should return true for direct inheritance", () => {
      expect(roleInheritsFrom("analyst", "user")).toBe(true);
      expect(roleInheritsFrom("manager", "analyst")).toBe(true);
    });

    it("should return true for indirect inheritance", () => {
      expect(roleInheritsFrom("manager", "user")).toBe(true);
    });

    it("should return false for no inheritance", () => {
      expect(roleInheritsFrom("user", "analyst")).toBe(false);
      expect(roleInheritsFrom("admin", "user")).toBe(false);
      expect(roleInheritsFrom("guest", "user")).toBe(false);
    });

    it("should return false for self-check", () => {
      expect(roleInheritsFrom("user", "user")).toBe(false);
      expect(roleInheritsFrom("admin", "admin")).toBe(false);
    });

    it("should handle roles with no inheritance", () => {
      expect(roleInheritsFrom("admin", "user")).toBe(false);
      expect(roleInheritsFrom("guest", "user")).toBe(false);
      expect(roleInheritsFrom("api_consumer", "user")).toBe(false);
    });
  });

  describe("permission structure validation", () => {
    it("should have valid actions in all permissions", () => {
      const validActions = [
        "create",
        "read",
        "update",
        "delete",
        "manage",
        "execute",
        "approve",
        "publish",
        "archive",
      ];

      Object.values(ROLE_DEFINITIONS).forEach((roleDefinition) => {
        getEffectivePermissions(roleDefinition.name).forEach((permission) => {
          expect(validActions).toContain(permission.action);
        });
      });
    });

    it("should have valid subjects in all permissions", () => {
      const validSubjects = [
        "User",
        "Project",
        "Report",
        "Dashboard",
        "Settings",
        "ApiKey",
        "Session",
        "all",
      ];

      Object.values(ROLE_DEFINITIONS).forEach((roleDefinition) => {
        getEffectivePermissions(roleDefinition.name).forEach((permission) => {
          expect(validSubjects).toContain(permission.subject);
        });
      });
    });

    it("should have unique permission IDs within each role", () => {
      Object.values(ROLE_DEFINITIONS).forEach((roleDefinition) => {
        const permissions = getEffectivePermissions(roleDefinition.name);
        const permissionIds = permissions.map((p) => p.id);
        const uniqueIds = [...new Set(permissionIds)];

        expect(permissionIds.length).toBe(uniqueIds.length);
      });
    });

    it("should have meaningful reasons for permissions", () => {
      Object.values(ROLE_DEFINITIONS).forEach((roleDefinition) => {
        roleDefinition.permissions.forEach((permission) => {
          if (permission.reason) {
            expect(typeof permission.reason).toBe("string");
            expect(permission.reason.length).toBeGreaterThan(10);
          }
        });
      });
    });
  });
});
