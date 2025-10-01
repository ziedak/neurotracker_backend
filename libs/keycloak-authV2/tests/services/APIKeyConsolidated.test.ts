/**
 * Test suite for consolidated API key components
 * Tests the new APIKeyOperations and APIKeyStorage components
 */

import { APIKeyOperations } from "../../src/services/apikey/APIKeyOperations";
import { APIKeyStorage } from "../../src/services/apikey/APIKeyStorage";
import { createLogger } from "@libs/utils";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

const mockDbClient = {
  executeRaw: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
};

const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
};

const mockConfig = {
  enableCache: true,
  cacheTTL: 300,
  maxRetries: 3,
  retryDelay: 1000,
  keyLength: 32,
  hashRounds: 12,
  keyPreviewLength: 8,
  permissions: {
    defaults: ["read"],
    admin: ["read", "write", "delete"],
  },
};

describe("Consolidated API Key Components", () => {
  let operations: APIKeyOperations;
  let storage: APIKeyStorage;

  beforeEach(() => {
    jest.clearAllMocks();

    operations = new APIKeyOperations(
      mockConfig,
      mockMetrics,
      createLogger("test")
    );
    storage = new APIKeyStorage(
      mockDbClient,
      mockCacheService,
      mockConfig,
      mockMetrics,
      createLogger("test")
    );
  });

  describe("APIKeyOperations", () => {
    test("should validate API key format", async () => {
      // Test valid key format
      const validResult = await operations.validateAPIKey(
        "sk_test_1234567890abcdef"
      );
      expect(validResult.success).toBe(true);
      expect(validResult.error).toBe(false);

      // Test invalid key format
      const invalidResult = await operations.validateAPIKey("invalid-key");
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBe(true);
    });

    test("should revoke API key", async () => {
      const result = await operations.revokeKey({
        keyId: "key123",
        reason: "Security breach",
        revokedBy: "user123",
      });

      expect(result.success).toBe(true);
      expect(result.data.revoked).toBe(true);
      expect(result.data.reason).toBe("Security breach");
    });
  });

  describe("APIKeyStorage", () => {
    test("should create API key in storage", async () => {
      const keyData = {
        id: "key123",
        name: "Test Key",
        keyHash: "hashed_key_value",
        keyPreview: "sk_test_",
        userId: "user123",
        storeId: "store456",
        permissions: ["read"],
        scopes: ["api"],
        usageCount: 0,
        isActive: true,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { purpose: "testing" },
      };

      const result = await storage.createAPIKey(keyData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(keyData);
      expect(mockDbClient.executeRaw).toHaveBeenCalled();
    });

    test("should handle cache operations", async () => {
      mockCacheService.get.mockResolvedValue({ data: null });

      const result = await storage.getAPIKeyById("key123");

      expect(mockCacheService.get).toHaveBeenCalledWith("apikey:key:key123");
      expect(mockDbClient.executeRaw).toHaveBeenCalled();
    });

    test("should delete API key from storage", async () => {
      mockDbClient.executeRaw.mockResolvedValue({ rowsAffected: 1 });

      const result = await storage.deleteAPIKey("key123", "user456");

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
      expect(mockDbClient.executeRaw).toHaveBeenCalled();
      expect(mockCacheService.invalidate).toHaveBeenCalled();
    });
  });


});
