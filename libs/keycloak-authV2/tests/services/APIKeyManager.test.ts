/**
 * Real APIKeyManager unit tests
 * Covers all public methods with proper dependency mocks
 */
import { APIKeyManager } from "../../src/services/APIKeyManager";
import type { AuthV2Config } from "../../src/services/config";

jest.mock("@libs/database", () => ({
  PostgreSQLClient: jest.fn(() => mockDbClient),
  CacheService: { create: jest.fn(() => null) },
}));

jest.mock("bcrypt", () => ({
  hash: jest.fn(async (val: string) => `hashed_${val}`),
  compare: jest.fn(
    async (val: string, hash: string) => hash === `hashed_${val}`
  ),
}));

import * as crypto from "crypto";
jest
  .spyOn(crypto, "randomUUID")
  .mockReturnValue("uuid-1234-5678-9abc-def0-123456789abc" as any);
jest.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.from("a".repeat(32)));

const mockDbClient = {
  executeRaw: jest.fn(async () => true),
  cachedQuery: jest.fn(async () => []) as any,
};
const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
};
const mockConfig: AuthV2Config = {
  jwt: {},
  cache: {
    enabled: false,
    ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
  },
  security: {
    constantTimeComparison: true,
    apiKeyHashRounds: 12,
    sessionRotationInterval: 86400,
  },
  session: {
    maxConcurrentSessions: 10,
    enforceIpConsistency: false,
    enforceUserAgentConsistency: false,
    tokenEncryption: true,
  },
  encryption: { key: "test-key" },
};

describe("APIKeyManager", () => {
  let manager: APIKeyManager;

  beforeEach(() => {
    manager = new APIKeyManager(mockConfig, mockMetrics);
    jest.clearAllMocks();
  });

  it("should generate an API key", async () => {
    const result = await manager.generateAPIKey({
      userId: "user1",
      scopes: ["read"],
    });
    expect(result.success).toBe(true);
    expect(result.apiKey).toBeDefined();
    expect(result.keyData).toBeDefined();
    expect(mockDbClient.executeRaw).toHaveBeenCalled();
  });

  it("should validate an API key", async () => {
    mockDbClient.cachedQuery.mockResolvedValueOnce([
      {
        id: "uuid-123",
        name: "Test Key",
        keyHash: "hashed_testkey",
        keyPreview: "testkey",
        userId: "user1",
        scopes: ["read"],
        permissions: JSON.stringify(["read"]),
        usageCount: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await manager.validateAPIKey("testkey");
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.keyData).toBeDefined();
  });

  it("should revoke an API key", async () => {
    mockDbClient.executeRaw.mockResolvedValueOnce(true);
    const result = await manager.revokeAPIKey(
      "uuid-123",
      "admin",
      "test reason"
    );
    expect(result.success).toBe(true);
    expect(mockDbClient.executeRaw).toHaveBeenCalled();
  });

  it("should get user API keys", async () => {
    mockDbClient.cachedQuery.mockResolvedValueOnce([
      {
        id: "uuid-123",
        name: "Test Key",
        keyHash: "hashed_testkey",
        keyPreview: "testkey",
        userId: "user1",
        scopes: ["read"],
        permissions: JSON.stringify(["read"]),
        usageCount: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const keys = await manager.getUserAPIKeys("user1");
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBe(1);
    expect(keys[0].id).toBe("uuid-123");
  });

  it("should return stats", () => {
    const stats = manager.getStats();
    expect(stats).toHaveProperty("totalKeys");
    expect(stats).toHaveProperty("activeKeys");
  });

  it("should perform health check (healthy)", async () => {
    mockDbClient.executeRaw.mockResolvedValueOnce(true);
    const result = await manager.healthCheck();
    expect(result.status).toBe("healthy");
    expect(result.details.database).toBe("connected");
  });

  it("should perform health check (unhealthy)", async () => {
    mockDbClient.executeRaw.mockRejectedValueOnce(new Error("fail"));
    const result = await manager.healthCheck();
    expect(result.status).toBe("unhealthy");
    expect(result.details.database).toBe("disconnected");
  });
});
