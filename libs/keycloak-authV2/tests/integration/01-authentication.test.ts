/**
 * Integration Tests: Authentication Flows
 * Tests user authentication with password, token refresh, and logout
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  TEST_CONFIG,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - Authentication", () => {
  let env: TestEnvironment | undefined;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: true });
  }, 60000);

  afterAll(async () => {
    if (env) {
      await cleanupTestUsers(env.dbClient, testUserIds);
      await env.cleanup();
    }
  }, 30000);

  // Helper to ensure env is defined
  const getEnv = (): TestEnvironment => {
    if (!env) {
      throw new Error("Test environment not initialized");
    }
    return env;
  };

  describe("Password Authentication Flow", () => {
    it("should register and authenticate user with password", async () => {
      const { service } = getEnv();
      const userData = createTestUser();

      // 1. Register user
      const users = await service.batchRegisterUsers([userData]);
      expect(users.success).toBe(true);
      expect(users.successCount).toBe(1);
      expect(users.results[0]?.data).toBeDefined();

      const userId = users.results[0]?.data?.id;
      expect(userId).toBeDefined();
      testUserIds.push(userId!);

      // NOTE: With sync service enabled, user is immediately available
      // No waiting needed - sync happens in background

      // 2. Authenticate with password
      const authResult = await getEnv().service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      // 3. Verify authentication result
      expect(authResult.success).toBe(true);
      expect(authResult.user).toBeDefined();
      expect(authResult.user?.username).toBe(userData.username);
      expect(authResult.tokens).toBeDefined();
      expect(authResult.tokens?.access_token).toBeDefined();
      expect(authResult.tokens?.refresh_token).toBeDefined();
      expect(authResult.session).toBeDefined();
      expect(authResult.session?.id).toBeDefined();

      console.log("✅ Password authentication successful", {
        userId,
        sessionId: authResult.session?.id,
      });
    }, 30000);

    it("should reject authentication with wrong password", async () => {
      const userData = createTestUser();

      // Register user
      const users = await getEnv().service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id;
      testUserIds.push(userId!);

      // Try wrong password (no wait needed)
      const authResult = await getEnv().service.authenticateWithPassword(
        userData.username,
        "WrongPassword123!",
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(authResult.success).toBe(false);
      expect(authResult.error).toBeDefined();

      console.log("✅ Wrong password rejected correctly");
    }, 30000);

    it("should reject authentication for non-existent user", async () => {
      const authResult = await getEnv().service.authenticateWithPassword(
        "nonexistent_user",
        "AnyPassword123!",
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(authResult.success).toBe(false);
      expect(authResult.error).toBeDefined();

      console.log("✅ Non-existent user rejected correctly");
    }, 10000);
  });

  describe("Session Validation", () => {
    it("should validate active session", async () => {
      const userData = createTestUser();

      // Register and authenticate
      const users = await getEnv().service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id;
      testUserIds.push(userId!);

      // Performance optimization: Removed unnecessary 2s delay - sync service handles this

      const authResult = await getEnv().service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(authResult.success).toBe(true);
      const sessionId = authResult.session?.id;
      expect(sessionId).toBeDefined();

      // Validate session
      const validation = await getEnv().service.validateSession(sessionId!, {
        ipAddress: "127.0.0.1",
        userAgent: "Integration-Test",
      });

      expect(validation.valid).toBe(true);
      expect(validation.session).toBeDefined();
      expect(validation.session?.userId).toBe(userId);

      console.log("✅ Session validation successful", { sessionId });
    }, 30000);

    it("should reject invalid session ID", async () => {
      const validation = await getEnv().service.validateSession(
        "invalid-session-id",
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();

      console.log("✅ Invalid session rejected correctly");
    }, 10000);
  });

  describe("Token Refresh", () => {
    it("should refresh session tokens", async () => {
      const userData = createTestUser();

      // Register and authenticate
      const users = await getEnv().service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id;
      testUserIds.push(userId!);

      // Performance optimization: Removed unnecessary 2s delay - sync service handles this

      const authResult = await getEnv().service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      expect(authResult.success).toBe(true);
      const sessionId = authResult.session?.id;
      const originalAccessToken = authResult.tokens?.access_token;

      // Refresh tokens
      const refreshResult = await getEnv().service.refreshSessionTokens(
        sessionId!
      );

      expect(refreshResult.success).toBe(true);
      expect(refreshResult.tokens).toBeDefined();
      expect(refreshResult.tokens?.accessToken).toBeDefined();
      expect(refreshResult.tokens?.accessToken).not.toBe(originalAccessToken);

      console.log("✅ Token refresh successful", {
        sessionId,
        tokensRefreshed: true,
      });
    }, 30000);
  });

  describe("Logout Flow", () => {
    it("should logout user and invalidate session", async () => {
      const userData = createTestUser();

      // Register and authenticate
      const users = await getEnv().service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id;
      testUserIds.push(userId!);

      // Performance optimization: Removed unnecessary 2s delay - sync service handles this

      const authResult = await getEnv().service.authenticateWithPassword(
        userData.username,
        userData.password,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        }
      );

      const sessionId = authResult.session?.id;
      expect(sessionId).toBeDefined();

      // Logout
      const logoutResult = await getEnv().service.logout(
        sessionId!,
        {
          ipAddress: "127.0.0.1",
          userAgent: "Integration-Test",
        },
        {
          logoutFromKeycloak: true,
        }
      );

      expect(logoutResult.success).toBe(true);
      expect(logoutResult.loggedOut).toBe(true);
      expect(logoutResult.sessionDestroyed).toBe(true);

      // Verify session is invalid after logout
      const validation = await getEnv().service.validateSession(sessionId!, {
        ipAddress: "127.0.0.1",
        userAgent: "Integration-Test",
      });

      expect(validation.valid).toBe(false);

      console.log("✅ Logout successful and session invalidated", {
        sessionId,
      });
    }, 30000);
  });
});
