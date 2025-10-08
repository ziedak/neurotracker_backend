/**
 * Integration Tests: API Key Management
 * Tests API key creation, validation, rotation, and lifecycle
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - API Key Management", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];
  const testApiKeyIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: true });
  }, 60000);

  afterAll(async () => {
    // Cleanup API keys
    for (const keyId of testApiKeyIds) {
      try {
        await env.service.deleteAPIKey(keyId);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("API Key Creation", () => {
    it("should create API key for user", async () => {
      // Register user first
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      // Create API key
      const result = await env.service.createAPIKey({
        userId,
        name: "Test API Key",
        scopes: ["read", "write"],
        permissions: ["user:read", "user:write"],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      expect(result.success).toBe(true);
      expect(result.apiKey).toBeDefined();
      expect(result.rawKey).toBeDefined();
      expect(result.apiKey?.name).toBe("Test API Key");
      expect(result.apiKey?.scopes).toContain("read");
      expect(result.apiKey?.scopes).toContain("write");

      testApiKeyIds.push(result.apiKey!.id);

      console.log("✅ API key created successfully", {
        keyId: result.apiKey!.id,
        rawKey: result.rawKey?.substring(0, 20) + "...",
      });
    }, 30000);

    it("should create API key with custom prefix", async () => {
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const result = await env.service.createAPIKey({
        userId,
        name: "Custom Prefix Key",
        prefix: "custom",
      });

      expect(result.success).toBe(true);
      expect(result.rawKey).toBeDefined();
      expect(result.rawKey).toMatch(/^custom_/);

      testApiKeyIds.push(result.apiKey!.id);

      console.log("✅ API key with custom prefix created", {
        rawKey: result.rawKey?.substring(0, 30) + "...",
      });
    }, 30000);
  });

  describe("API Key Validation", () => {
    it("should validate valid API key", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Validation Test Key",
        scopes: ["test"],
      });

      const rawKey = createResult.rawKey!;
      testApiKeyIds.push(createResult.apiKey!.id);

      // Validate API key
      const validation = await env.service.validateAPIKey(rawKey);

      expect(validation.valid).toBe(true);
      expect(validation.keyData).toBeDefined();
      expect(validation.keyData?.userId).toBe(userId);
      expect(validation.keyData?.scopes).toContain("test");

      console.log("✅ API key validation successful", {
        keyId: validation.keyData?.id,
      });
    }, 30000);

    it("should reject invalid API key", async () => {
      const validation = await env.service.validateAPIKey("invalid_key_12345");

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();

      console.log("✅ Invalid API key rejected");
    }, 10000);

    it("should reject revoked API key", async () => {
      // Create and revoke API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Revoked Key Test",
      });

      const rawKey = createResult.rawKey!;
      const keyId = createResult.apiKey!.id;
      testApiKeyIds.push(keyId);

      // Revoke the key
      await env.service.revokeAPIKey(keyId, "Testing revocation");

      // Try to validate revoked key
      const validation = await env.service.validateAPIKey(rawKey);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("revoked");

      console.log("✅ Revoked API key rejected");
    }, 30000);
  });

  describe("API Key Rotation", () => {
    it("should rotate API key", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Rotation Test Key",
        scopes: ["rotate"],
      });

      const oldKeyId = createResult.apiKey!.id;
      const oldRawKey = createResult.rawKey!;
      testApiKeyIds.push(oldKeyId);

      // Rotate the key
      const rotateResult = await env.service.rotateAPIKey(oldKeyId);

      expect(rotateResult.success).toBe(true);
      expect(rotateResult.newKey).toBeDefined();
      expect(rotateResult.rawKey).toBeDefined();
      expect(rotateResult.rawKey).not.toBe(oldRawKey);

      testApiKeyIds.push(rotateResult.newKey!.id);

      // Old key should be invalid
      const oldValidation = await env.service.validateAPIKey(oldRawKey);
      expect(oldValidation.valid).toBe(false);

      // New key should be valid
      const newValidation = await env.service.validateAPIKey(
        rotateResult.rawKey!
      );
      expect(newValidation.valid).toBe(true);

      console.log("✅ API key rotation successful", {
        oldKeyId,
        newKeyId: rotateResult.newKey!.id,
      });
    }, 30000);
  });

  describe("API Key Listing and Retrieval", () => {
    it("should list user API keys", async () => {
      // Create user and multiple API keys
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      // Create 3 API keys
      for (let i = 1; i <= 3; i++) {
        const result = await env.service.createAPIKey({
          userId,
          name: `List Test Key ${i}`,
        });
        testApiKeyIds.push(result.apiKey!.id);
      }

      // List API keys
      const listResult = await env.service.listAPIKeys(userId);

      expect(listResult.success).toBe(true);
      expect(listResult.keys).toBeDefined();
      expect(listResult.keys!.length).toBeGreaterThanOrEqual(3);

      console.log("✅ API key listing successful", {
        count: listResult.keys!.length,
      });
    }, 30000);

    it("should get specific API key", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Get Test Key",
      });

      const keyId = createResult.apiKey!.id;
      testApiKeyIds.push(keyId);

      // Get API key
      const getResult = await env.service.getAPIKey(keyId);

      expect(getResult.success).toBe(true);
      expect(getResult.key).toBeDefined();
      expect(getResult.key?.id).toBe(keyId);
      expect(getResult.key?.name).toBe("Get Test Key");

      console.log("✅ API key retrieval successful", { keyId });
    }, 30000);
  });

  describe("API Key Update", () => {
    it("should update API key metadata", async () => {
      // Create user and API key
      const userData = createTestUser();
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      const createResult = await env.service.createAPIKey({
        userId,
        name: "Update Test Key",
        scopes: ["read"],
      });

      const keyId = createResult.apiKey!.id;
      testApiKeyIds.push(keyId);

      // Update API key
      const updateResult = await env.service.updateAPIKey(keyId, {
        name: "Updated Key Name",
        scopes: ["read", "write"],
        permissions: ["admin"],
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.key).toBeDefined();
      expect(updateResult.key?.name).toBe("Updated Key Name");
      expect(updateResult.key?.scopes).toContain("write");

      console.log("✅ API key update successful", { keyId });
    }, 30000);
  });

  describe("API Key Statistics", () => {
    it("should get API key statistics", async () => {
      const stats = await env.service.getAPIKeyStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalKeys).toBe("number");
      expect(typeof stats.validationCount).toBe("number");

      console.log("✅ API key statistics retrieved", stats);
    }, 10000);
  });
});
