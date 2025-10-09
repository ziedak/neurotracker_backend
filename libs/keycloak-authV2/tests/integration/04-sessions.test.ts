/**
 * Integration Tests: Session Management
 * Tests session creation, validation, refresh, and lifecycle
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - Session Management", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];
  const testSessionIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: true });
  }, 60000);

  afterAll(async () => {
    // Cleanup sessions
    for (const sessionId of testSessionIds) {
      try {
        await env.service.invalidateSession(sessionId);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("Session Creation", () => {
    it("should create session for authenticated user", async () => {
      // Register and authenticate user
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const authResult = await env.service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(authResult.success).toBe(true);
      expect(authResult.session).toBeDefined();
      expect(authResult.session?.id).toBeDefined();

      const sessionId = authResult.session!.id;
      testSessionIds.push(sessionId);

      console.log("✅ Session created successfully", { sessionId });
    }, 30000);

    it("should create multiple sessions for same user", async () => {
      // Register user
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create multiple sessions
      const sessions: string[] = [];
      for (let i = 0; i < 3; i++) {
        const authResult = await env.service.authenticateWithPassword(
          userData.username,
          userData.password,
          {
            ipAddress: `127.0.0.${i + 1}`,
            userAgent: `Integration-Test-${i}`,
          }
        );

        const sessionId = authResult.session?.id;
        expect(sessionId).toBeDefined();
        sessions.push(sessionId!);
        testSessionIds.push(sessionId!);
      }

      expect(sessions).toHaveLength(3);
      expect(new Set(sessions).size).toBe(3); // All unique

      console.log("✅ Multiple sessions created", {
        count: sessions.length,
      });
    }, 40000);
  });

  describe("Session Retrieval", () => {
    it("should get session by ID", async () => {
      // Create session
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const authResult = await env.service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      const sessionId = authResult.session!.id;
      testSessionIds.push(sessionId);

      // Get session
      const getResult = await env.service.getSession(sessionId);

      expect(getResult.success).toBe(true);
      expect(getResult.session).toBeDefined();
      expect(getResult.session?.userId).toBe(userId);

      console.log("✅ Session retrieved successfully", { sessionId });
    }, 30000);

    it("should list all user sessions", async () => {
      // Create user with multiple sessions
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create 2 sessions
      for (let i = 0; i < 2; i++) {
        const authResult = await env.service.authenticateWithPassword(
          userData.username,
          userData.password,
          {
            ipAddress: `127.0.0.${i + 1}`,
            userAgent: `Test-${i}`,
          }
        );
        testSessionIds.push(authResult.session!.id);
      }

      // List sessions
      const listResult = await env.service.listUserSessions(userId);

      expect(listResult.success).toBe(true);
      expect(listResult.sessions).toBeDefined();
      expect(listResult.sessions!.length).toBeGreaterThanOrEqual(2);

      console.log("✅ User sessions listed", {
        count: listResult.sessions!.length,
      });
    }, 40000);
  });

  describe("Session Update", () => {
    it("should update session metadata", async () => {
      // Create session
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const authResult = await env.service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      const sessionId = authResult.session!.id;
      testSessionIds.push(sessionId);

      // Update session
      const updateResult = await env.service.updateSession(sessionId, {
        lastActivity: new Date(),
        metadata: { test: "data" },
      });

      expect(updateResult.success).toBe(true);

      console.log("✅ Session updated successfully", { sessionId });
    }, 30000);
  });

  describe("Session Invalidation", () => {
    it("should invalidate session", async () => {
      // Create session
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const authResult = await env.service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      const sessionId = authResult.session!.id;

      // Invalidate session
      const invalidateResult = await env.service.invalidateSession(sessionId);

      expect(invalidateResult.success).toBe(true);

      // Verify session is invalid
      const validation = await env.service.validateSession(sessionId, {
        ipAddress: "127.0.0.1",
        userAgent: "Integration-Test",
      });

      expect(validation.valid).toBe(false);

      console.log("✅ Session invalidated successfully", { sessionId });
    }, 30000);
  });

  describe("Session Statistics", () => {
    it("should get session statistics", async () => {
      const stats = await env.service.getSessionStats();

      expect(stats).toBeDefined();
      expect(typeof stats.active).toBe("number");
      expect(typeof stats.total).toBe("number");

      console.log("✅ Session statistics retrieved", stats);
    }, 10000);
  });
});
