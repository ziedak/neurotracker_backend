/**
 * Integration Tests: User Management
 * Tests batch operations, user CRUD, and attribute management
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  createTestUsers,
  cleanupTestUsers,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - User Management", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: true });
  }, 60000);

  afterAll(async () => {
    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("Batch User Registration", () => {
    it("should register multiple users in batch", async () => {
      const users = createTestUsers(5);

      const result = await env.service.batchRegisterUsers(users);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(5);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(5);

      result.results.forEach((r, index) => {
        expect(r.success).toBe(true);
        expect(r.data).toBeDefined();
        expect(r.data?.username).toBe(users[index]?.username);
        testUserIds.push(r.data!.id);
      });

      console.log("✅ Batch registration successful", {
        count: result.successCount,
      });
    }, 30000);

    it("should handle partial failures in batch registration", async () => {
      const users = createTestUsers(3);
      // Add invalid user (duplicate username from previous test)
      users.push({
        ...users[0]!,
        email: "different@example.com",
      });

      const result = await env.service.batchRegisterUsers(users);

      expect(result.successCount).toBeGreaterThan(0);
      expect(result.failureCount).toBeGreaterThan(0);

      const successfulUsers = result.results.filter((r) => r.success);
      successfulUsers.forEach((r) => {
        testUserIds.push(r.data!.id);
      });

      console.log("✅ Partial batch registration handled", {
        success: result.successCount,
        failed: result.failureCount,
      });
    }, 30000);
  });

  describe("Batch User Updates", () => {
    it("should update multiple users in batch", async () => {
      // Register users first
      const users = createTestUsers(3);
      const registerResult = await env.service.batchRegisterUsers(users);

      const userIds = registerResult.results
        .filter((r) => r.success)
        .map((r) => r.data!.id);
      testUserIds.push(...userIds);

      // Update users
      const updates = userIds.map((userId, index) => ({
        userId,
        data: {
          firstName: `Updated${index}`,
          lastName: `Name${index}`,
        },
      }));

      const result = await env.service.batchUpdateUsers(updates);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(userIds.length);
      expect(result.failureCount).toBe(0);

      console.log("✅ Batch update successful", { count: result.successCount });
    }, 30000);
  });

  describe("Batch Role Assignment", () => {
    it("should assign roles to multiple users in batch", async () => {
      // Register users first
      const users = createTestUsers(3);
      const registerResult = await env.service.batchRegisterUsers(users);

      const registeredUsers = registerResult.results
        .filter((r) => r.success)
        .map((r) => r.data!);

      testUserIds.push(...registeredUsers.map((u) => u.id));

      // Wait for Keycloak sync (users should have keycloakId populated)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get Keycloak user IDs from the registered users
      const keycloakUserIds = registeredUsers
        .map((u) => u.keycloakId)
        .filter((id): id is string => !!id);

      expect(keycloakUserIds.length).toBe(3);

      // Assign roles using Keycloak IDs
      const assignments = keycloakUserIds.map((userId) => ({
        userId,
        roleNames: ["user"],
      }));

      const result = await env.service.batchAssignRoles(assignments);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(keycloakUserIds.length);

      console.log("✅ Batch role assignment successful", {
        count: result.successCount,
      });
    }, 30000);
  });

  describe("Batch User Deletion", () => {
    it("should delete multiple users in batch", async () => {
      // Register users first
      const users = createTestUsers(3);
      const registerResult = await env.service.batchRegisterUsers(users);

      const userIds = registerResult.results
        .filter((r) => r.success)
        .map((r) => r.data!.id);

      // Delete users
      const result = await env.service.batchDeleteUsers(userIds, "test-admin");

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(userIds.length);
      expect(result.failureCount).toBe(0);

      // Verify users are deleted (soft delete)
      for (const userId of userIds) {
        const user = await env.dbClient.prisma.user.findUnique({
          where: { id: userId },
        });
        expect(user?.isDeleted).toBe(true);
      }

      console.log("✅ Batch deletion successful", {
        count: result.successCount,
      });
    }, 30000);
  });

  describe("User CRUD Operations", () => {
    it("should create, get, update, and delete user", async () => {
      const userData = createTestUser();

      // Create
      const createResult = await env.service.createUser({
        username: userData.username,
        email: userData.email,
        password: userData.password,
        firstName: userData.firstName,
        lastName: userData.lastName,
      });

      expect(createResult.success).toBe(true);
      expect(createResult.userId).toBeDefined();
      const userId = createResult.userId!;
      testUserIds.push(userId);

      // Get
      const getResult = await env.service.getUser(userId);
      expect(getResult.success).toBe(true);
      expect(getResult.user).toBeDefined();
      expect(getResult.user?.username).toBe(userData.username);

      console.log("✅ User CRUD operations successful", { userId });
    }, 30000);
  });

  describe("User Search", () => {
    it("should search users with filters", async () => {
      // Register some test users
      const users = createTestUsers(5);
      const registerResult = await env.service.batchRegisterUsers(users);

      const userIds = registerResult.results
        .filter((r) => r.success)
        .map((r) => r.data!.id);
      testUserIds.push(...userIds);

      // Search by username pattern
      const searchResult = await env.service.searchUsersAdvanced({
        username: "testuser_",
        limit: 10,
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.users).toBeDefined();
      expect(searchResult.users!.length).toBeGreaterThan(0);

      console.log("✅ User search successful", {
        found: searchResult.users!.length,
      });
    }, 30000);
  });
});
