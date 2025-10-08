/**
 * Integration Tests: End-to-End Scenarios
 * Tests complete user lifecycle and real-world scenarios
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  waitFor,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - E2E Scenarios", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({
      withCache: true,
      withMetrics: true,
      withSync: true,
    });
  }, 60000);

  afterAll(async () => {
    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("Complete User Lifecycle", () => {
    it("should handle complete user journey: register → auth → update → delete", async () => {
      const userData = createTestUser();

      // 1. Register user
      console.log("1️⃣ Registering user...");
      const registerResult = await env.service.batchRegisterUsers([userData]);
      expect(registerResult.success).toBe(true);

      const userId = registerResult.results[0]?.data?.id!;
      testUserIds.push(userId);

      // Wait for Keycloak sync
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 2. Authenticate user
      console.log("2️⃣ Authenticating user...");
      const authResult = await env.service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "E2E-Test",
        }
      );
      expect(authResult.success).toBe(true);

      const sessionId = authResult.session!.sessionId;
      const accessToken = authResult.tokens!.access_token;

      // 3. Validate session
      console.log("3️⃣ Validating session...");
      const validation = await env.service.validateSession(sessionId, {
        ipAddress: "127.0.0.1",
        userAgent: "E2E-Test",
      });
      expect(validation.valid).toBe(true);

      // 4. Update user
      console.log("4️⃣ Updating user...");
      const updateResult = await env.service.batchUpdateUsers([
        {
          userId,
          data: {
            firstName: "Updated",
            lastName: "Name",
          },
        },
      ]);
      expect(updateResult.success).toBe(true);

      // 5. Get updated user
      console.log("5️⃣ Retrieving updated user...");
      const getResult = await env.service.getUser(userId);
      expect(getResult.success).toBe(true);
      expect(getResult.user?.firstName).toBe("Updated");

      // 6. Logout
      console.log("6️⃣ Logging out...");
      const logoutResult = await env.service.logout(
        sessionId,
        {
          ipAddress: "127.0.0.1",
          userAgent: "E2E-Test",
        },
        { logoutFromKeycloak: true }
      );
      expect(logoutResult.success).toBe(true);

      // 7. Delete user
      console.log("7️⃣ Deleting user...");
      const deleteResult = await env.service.batchDeleteUsers(
        [userId],
        "test-admin"
      );
      expect(deleteResult.success).toBe(true);

      console.log("✅ Complete user lifecycle successful");
    }, 60000);
  });

  describe("Multi-User Concurrent Operations", () => {
    it("should handle concurrent user registrations", async () => {
      const userCount = 10;
      const users = Array.from({ length: userCount }, (_, i) =>
        createTestUser(`_concurrent_${i}`)
      );

      // Register all users concurrently
      const result = await env.service.batchRegisterUsers(users);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(userCount);

      result.results.forEach((r) => {
        if (r.success && r.data) {
          testUserIds.push(r.data.id);
        }
      });

      console.log("✅ Concurrent registrations successful", {
        count: result.successCount,
      });
    }, 45000);

    it("should handle concurrent API key validations", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Concurrent Test Key",
      });

      const rawKey = createResult.rawKey!;

      // Validate concurrently 20 times
      const validations = await Promise.all(
        Array.from({ length: 20 }, () => env.service.validateAPIKey(rawKey))
      );

      // All should succeed
      expect(validations.every((v) => v.valid)).toBe(true);

      console.log("✅ Concurrent validations successful", {
        count: validations.length,
      });
    }, 30000);
  });

  describe("API Key Full Lifecycle", () => {
    it("should handle API key: create → validate → update → rotate → revoke", async () => {
      // Create user
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      // 1. Create API key
      console.log("1️⃣ Creating API key...");
      const createResult = await env.service.createAPIKey({
        userId,
        name: "Lifecycle Test Key",
        scopes: ["read"],
      });
      expect(createResult.success).toBe(true);

      const keyId1 = createResult.apiKey!.id;
      const rawKey1 = createResult.rawKey!;

      // 2. Validate API key
      console.log("2️⃣ Validating API key...");
      const validation1 = await env.service.validateAPIKey(rawKey1);
      expect(validation1.valid).toBe(true);

      // 3. Update API key
      console.log("3️⃣ Updating API key...");
      const updateResult = await env.service.updateAPIKey(keyId1, {
        scopes: ["read", "write"],
      });
      expect(updateResult.success).toBe(true);

      // 4. Rotate API key
      console.log("4️⃣ Rotating API key...");
      const rotateResult = await env.service.rotateAPIKey(keyId1);
      expect(rotateResult.success).toBe(true);

      const keyId2 = rotateResult.newKey!.id;
      const rawKey2 = rotateResult.rawKey!;

      // Old key should be invalid
      const validation2 = await env.service.validateAPIKey(rawKey1);
      expect(validation2.valid).toBe(false);

      // New key should be valid
      const validation3 = await env.service.validateAPIKey(rawKey2);
      expect(validation3.valid).toBe(true);

      // 5. Revoke new key
      console.log("5️⃣ Revoking API key...");
      const revokeResult = await env.service.revokeAPIKey(
        keyId2,
        "Test complete"
      );
      expect(revokeResult.success).toBe(true);

      // Key should now be invalid
      const validation4 = await env.service.validateAPIKey(rawKey2);
      expect(validation4.valid).toBe(false);

      console.log("✅ API key full lifecycle successful");
    }, 45000);
  });

  describe("Session Management Scenarios", () => {
    it("should handle multiple active sessions per user", async () => {
      // Register user
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create 3 sessions from different devices
      const sessions: string[] = [];
      const devices = ["Web", "Mobile", "Tablet"];

      for (const device of devices) {
        const authResult = await env.service.authenticateWithPassword(
          userData.username,
          userData.password,
          {
            ipAddress: "127.0.0.1",
            userAgent: `E2E-Test-${device}`,
          }
        );
        sessions.push(authResult.session!.sessionId);
      }

      // List all sessions
      const listResult = await env.service.listUserSessions(userId);
      expect(listResult.success).toBe(true);
      expect(listResult.sessions!.length).toBeGreaterThanOrEqual(3);

      // Invalidate one session
      await env.service.invalidateSession(sessions[0]!);

      // Other sessions should still be valid
      const validation = await env.service.validateSession(sessions[1]!, {
        ipAddress: "127.0.0.1",
        userAgent: "E2E-Test-Mobile",
      });
      expect(validation.valid).toBe(true);

      console.log("✅ Multiple sessions managed successfully", {
        created: sessions.length,
      });
    }, 50000);
  });

  describe("Error Recovery Scenarios", () => {
    it("should recover from temporary failures", async () => {
      // This tests the resilience of the system
      const userData = createTestUser();

      // Try to authenticate non-existent user (should fail gracefully)
      const authResult = await env.service.authenticateWithPassword(
        "nonexistent_user",
        "password",
        {
          ipAddress: "127.0.0.1",
          userAgent: "E2E-Test",
        }
      );

      expect(authResult.success).toBe(false);
      expect(authResult.error).toBeDefined();

      // System should still work after failure
      const registerResult = await env.service.batchRegisterUsers([userData]);
      expect(registerResult.success).toBe(true);

      testUserIds.push(registerResult.results[0]?.data?.id!);

      console.log("✅ System recovered from error gracefully");
    }, 30000);
  });
});
