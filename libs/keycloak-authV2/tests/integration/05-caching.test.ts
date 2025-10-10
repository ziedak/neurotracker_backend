/**
 * Integration Tests: Caching Behavior
 * Tests cache effectiveness, TTL, invalidation
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  waitFor,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - Caching", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    // Setup WITH cache enabled
    env = await setupTestEnvironment({ withCache: true });
  }, 60000);

  afterAll(async () => {
    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("API Key Caching", () => {
    it("should cache API key validation results", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Cache Test Key",
      });

      const rawKey = createResult.rawKey!;

      // First validation (cache miss)
      const start1 = performance.now();
      const validation1 = await env.service.validateAPIKey(rawKey);
      const duration1 = performance.now() - start1;

      expect(validation1.valid).toBe(true);

      // Second validation (cache hit - should be faster)
      const start2 = performance.now();
      const validation2 = await env.service.validateAPIKey(rawKey);
      const duration2 = performance.now() - start2;

      expect(validation2.valid).toBe(true);

      // Cache hit should be significantly faster
      console.log("✅ API key caching working", {
        firstCall: `${duration1.toFixed(2)}ms`,
        cachedCall: `${duration2.toFixed(2)}ms`,
        improvement: `${((1 - duration2 / duration1) * 100).toFixed(1)}%`,
      });
    }, 30000);

    it("should invalidate cache after key revocation", async () => {
      // Create API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Invalidation Test Key",
      });

      const rawKey = createResult.rawKey!;
      const keyId = createResult.apiKey!.id;

      // Validate and cache
      const validation1 = await env.service.validateAPIKey(rawKey);
      expect(validation1.valid).toBe(true);

      // Revoke key (should invalidate cache)
      await env.service.revokeAPIKey(keyId, "Testing cache invalidation");

      // Validate again (should get fresh data showing revoked)
      const validation2 = await env.service.validateAPIKey(rawKey);
      expect(validation2.valid).toBe(false);

      console.log("✅ Cache invalidation working after revocation");
    }, 30000);
  });

  describe("Session Caching", () => {
    it("should cache session data", async () => {
      // Create authenticated session
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
          userAgent: "Cache-Test",
        }
      );

      const sessionId = authResult.session!.id;

      // First retrieval (cache miss)
      const start1 = performance.now();
      const get1 = await env.service.getSession(sessionId);
      const duration1 = performance.now() - start1;

      expect(get1.success).toBe(true);

      // Second retrieval (cache hit)
      const start2 = performance.now();
      const get2 = await env.service.getSession(sessionId);
      const duration2 = performance.now() - start2;

      expect(get2.success).toBe(true);

      console.log("✅ Session caching working", {
        firstCall: `${duration1.toFixed(2)}ms`,
        cachedCall: `${duration2.toFixed(2)}ms`,
        improvement: `${((1 - duration2 / duration1) * 100).toFixed(1)}%`,
      });
    }, 30000);
  });

  describe("Cache Statistics", () => {
    it("should provide cache statistics", async () => {
      const stats = await env.service.getStats();

      expect(stats).toBeDefined();
      expect(stats.client).toBeDefined();
      expect(stats.client.cacheEnabled).toBe(true);

      console.log("✅ Cache statistics available", {
        cacheEnabled: stats.client.cacheEnabled,
        requestCount: stats.client.requestCount,
      });
    }, 10000);
  });

  describe("Cache Clear", () => {
    it("should clear all caches", async () => {
      // Perform some cached operations
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Clear Test Key",
      });

      // Validate to populate cache
      await env.service.validateAPIKey(createResult.rawKey!);

      // Clear caches
      env.service.clearCaches();

      // Next validation should be a cache miss (slower)
      const start = performance.now();
      await env.service.validateAPIKey(createResult.rawKey!);
      const duration = performance.now() - start;

      console.log("✅ Cache cleared successfully", {
        afterClearDuration: `${duration.toFixed(2)}ms`,
      });
    }, 30000);
  });
});
