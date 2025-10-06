/**
 * User Data Conversion Utilities Tests
 *
 * Tests for the simplified utility functions that replace UserInfoConverter class
 */

import {
  keycloakUserToUserInfo,
  userInfoToKeycloakUser,
} from "../../../src/services/user/user-converters";
import type { KeycloakUser } from "../../../src/services/user/interfaces";
import type { UserInfo } from "../../../src/types";

describe("User Data Conversion Utilities", () => {
  describe("keycloakUserToUserInfo", () => {
    it("should convert Keycloak user with all fields to UserInfo", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-123",
        username: "johndoe",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        enabled: true,
        emailVerified: true,
        createdTimestamp: 1234567890,
        attributes: {
          department: ["Engineering"],
          location: ["San Francisco"],
        },
      };

      const roles = ["realm:admin", "client:app:user"];
      const permissions = ["user:read", "user:write"];

      const result = keycloakUserToUserInfo(keycloakUser, roles, permissions);

      expect(result).toEqual({
        id: "user-123",
        username: "johndoe",
        email: "john@example.com",
        name: "John Doe",
        roles: ["client:app:user", "realm:admin"], // Sorted
        permissions: ["user:read", "user:write"], // Sorted
        metadata: {
          enabled: true,
          emailVerified: true,
          createdTimestamp: 1234567890,
          attributes: {
            department: ["Engineering"],
            location: ["San Francisco"],
          },
        },
      });
    });

    it("should handle Keycloak user with only required fields", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-456",
        username: "janedoe",
      };

      const result = keycloakUserToUserInfo(keycloakUser);

      expect(result).toEqual({
        id: "user-456",
        username: "janedoe",
        email: undefined,
        name: undefined,
        roles: [],
        permissions: [],
        metadata: {
          enabled: undefined,
          emailVerified: undefined,
          createdTimestamp: undefined,
          attributes: undefined,
        },
      });
    });

    it("should handle user with only firstName", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-789",
        username: "alice",
        firstName: "Alice",
      };

      const result = keycloakUserToUserInfo(keycloakUser);

      expect(result.name).toBe("Alice");
    });

    it("should handle user with only lastName", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-101",
        username: "bob",
        lastName: "Smith",
      };

      const result = keycloakUserToUserInfo(keycloakUser);

      expect(result.name).toBe("Smith");
    });

    it("should normalize roles by removing duplicates and sorting", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-123",
        username: "test",
      };

      const roles = ["admin", "user", "admin", "moderator"]; // Duplicate 'admin'

      const result = keycloakUserToUserInfo(keycloakUser, roles);

      expect(result.roles).toEqual(["admin", "moderator", "user"]); // Sorted, no duplicates
    });

    it("should normalize permissions by removing duplicates and sorting", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-123",
        username: "test",
      };

      const permissions = ["read", "write", "read", "delete"]; // Duplicate 'read'

      const result = keycloakUserToUserInfo(keycloakUser, [], permissions);

      expect(result.permissions).toEqual(["delete", "read", "write"]); // Sorted, no duplicates
    });

    it("should filter out empty/falsy roles and permissions", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-123",
        username: "test",
      };

      const roles = ["admin", "", "user", null as any, undefined as any];
      const permissions = ["read", "", null as any, "write"];

      const result = keycloakUserToUserInfo(keycloakUser, roles, permissions);

      expect(result.roles).toEqual(["admin", "user"]);
      expect(result.permissions).toEqual(["read", "write"]);
    });
  });

  describe("userInfoToKeycloakUser", () => {
    it("should convert UserInfo with all fields to Keycloak user", () => {
      const userInfo: UserInfo = {
        id: "user-123",
        username: "johndoe",
        email: "john@example.com",
        name: "John Doe",
        roles: ["admin"],
        permissions: ["read"],
        metadata: {
          enabled: true,
          emailVerified: true,
          attributes: {
            department: ["Engineering"],
          },
        },
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "johndoe",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        enabled: true,
        emailVerified: true,
        attributes: {
          department: ["Engineering"],
        },
      });
    });

    it("should handle UserInfo with only required fields", () => {
      const userInfo: UserInfo = {
        id: "user-456",
        username: "janedoe",
        email: undefined,
        name: undefined,
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "janedoe",
      });
    });

    it("should parse single-word name as firstName", () => {
      const userInfo: UserInfo = {
        id: "user-789",
        username: "alice",
        email: undefined,
        name: "Alice",
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "alice",
        firstName: "Alice",
      });
    });

    it("should parse two-word name as firstName and lastName", () => {
      const userInfo: UserInfo = {
        id: "user-101",
        username: "bob",
        email: undefined,
        name: "Bob Smith",
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "bob",
        firstName: "Bob",
        lastName: "Smith",
      });
    });

    it("should parse multi-word name with first as firstName and rest as lastName", () => {
      const userInfo: UserInfo = {
        id: "user-202",
        username: "carlos",
        email: undefined,
        name: "Carlos De La Cruz",
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "carlos",
        firstName: "Carlos",
        lastName: "De La Cruz",
      });
    });

    it("should handle name with extra whitespace", () => {
      const userInfo: UserInfo = {
        id: "user-303",
        username: "test",
        email: undefined,
        name: "  John   Doe  ",
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "test",
        firstName: "John",
        lastName: "Doe",
      });
    });

    it("should handle undefined name", () => {
      const userInfo: UserInfo = {
        id: "user-404",
        username: "test",
        email: undefined,
        name: undefined,
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "test",
      });
      expect(result.firstName).toBeUndefined();
      expect(result.lastName).toBeUndefined();
    });

    it("should handle empty name", () => {
      const userInfo: UserInfo = {
        id: "user-505",
        username: "test",
        email: undefined,
        name: "",
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "test",
      });
      expect(result.firstName).toBeUndefined();
      expect(result.lastName).toBeUndefined();
    });

    it("should handle metadata with boolean false values", () => {
      const userInfo: UserInfo = {
        id: "user-606",
        username: "test",
        email: undefined,
        name: undefined,
        roles: [],
        permissions: [],
        metadata: {
          enabled: false,
          emailVerified: false,
        },
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "test",
        enabled: false,
        emailVerified: false,
      });
    });

    it("should not include metadata fields if undefined", () => {
      const userInfo: UserInfo = {
        id: "user-707",
        username: "test",
        email: undefined,
        name: undefined,
        roles: [],
        permissions: [],
        metadata: {
          someOtherField: "value",
        },
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result).toEqual({
        username: "test",
      });
      expect(result.enabled).toBeUndefined();
      expect(result.emailVerified).toBeUndefined();
      expect(result.attributes).toBeUndefined();
    });
  });

  describe("Round-trip conversion", () => {
    it("should preserve data through round-trip conversion", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-999",
        username: "roundtrip",
        email: "roundtrip@example.com",
        firstName: "Round",
        lastName: "Trip",
        enabled: true,
        emailVerified: false,
        createdTimestamp: 1234567890,
        attributes: {
          custom: ["value"],
        },
      };

      const roles = ["admin", "user"];
      const permissions = ["read", "write"];

      // Keycloak -> UserInfo
      const userInfo = keycloakUserToUserInfo(keycloakUser, roles, permissions);

      // UserInfo -> Keycloak
      const backToKeycloak = userInfoToKeycloakUser(userInfo);

      // Verify core fields are preserved
      expect(backToKeycloak.username).toBe(keycloakUser.username);
      expect(backToKeycloak.email).toBe(keycloakUser.email);
      expect(backToKeycloak.firstName).toBe(keycloakUser.firstName);
      expect(backToKeycloak.lastName).toBe(keycloakUser.lastName);
      expect(backToKeycloak.enabled).toBe(keycloakUser.enabled);
      expect(backToKeycloak.emailVerified).toBe(keycloakUser.emailVerified);
      expect(backToKeycloak.attributes).toEqual(keycloakUser.attributes);

      // Note: roles, permissions, and createdTimestamp are not in the Keycloak update format
      // because they're managed through separate APIs
    });
  });

  describe("Edge cases", () => {
    it("should handle user with very long name", () => {
      const longName = "A".repeat(50) + " " + "B".repeat(50);
      const userInfo: UserInfo = {
        id: "user-long",
        username: "test",
        email: undefined,
        name: longName,
        roles: [],
        permissions: [],
      };

      const result = userInfoToKeycloakUser(userInfo);

      expect(result.firstName).toBe("A".repeat(50));
      expect(result.lastName).toBe("B".repeat(50));
    });

    it("should handle roles with special characters", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-special",
        username: "test",
      };

      const roles = [
        "role:with:colons",
        "role-with-dashes",
        "role_with_underscores",
      ];

      const result = keycloakUserToUserInfo(keycloakUser, roles);

      expect(result.roles).toContain("role:with:colons");
      expect(result.roles).toContain("role-with-dashes");
      expect(result.roles).toContain("role_with_underscores");
    });

    it("should handle large arrays of roles and permissions", () => {
      const keycloakUser: KeycloakUser = {
        id: "user-large",
        username: "test",
      };

      const roles = Array.from({ length: 100 }, (_, i) => `role-${i}`);
      const permissions = Array.from({ length: 200 }, (_, i) => `perm-${i}`);

      const result = keycloakUserToUserInfo(keycloakUser, roles, permissions);

      expect(result.roles).toHaveLength(100);
      expect(result.permissions).toHaveLength(200);
      expect(result.roles).toEqual([...roles].sort()); // Should be sorted
      expect(result.permissions).toEqual([...permissions].sort());
    });
  });
});
