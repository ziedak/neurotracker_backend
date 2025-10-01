/**
 * Resource cleanup integration tests
 * Ensures proper cleanup to prevent Jest from hanging
 */

import { TokenManager } from "../../src/services/token/TokenManager";
import { KeycloakClient } from "../../src/client/KeycloakClient";
import type { AuthV2Config } from "../../src/services/token/config";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: {
    create: jest.fn(() => ({
      get: jest.fn(() => ({ data: null, source: "miss" })),
      set: jest.fn(),
      invalidate: jest.fn(),
    })),
  },
}));

describe("Resource Cleanup Integration", () => {
  let tokenManager: TokenManager;
  let mockKeycloakClient: jest.Mocked<KeycloakClient>;
  let mockConfig: AuthV2Config;

  beforeEach(() => {
    mockKeycloakClient = {
      validateToken: jest.fn(),
      introspectToken: jest.fn(),
      refreshToken: jest.fn(),
    } as any;

    mockConfig = {
      jwt: {
        issuer: "https://test.keycloak.com/auth/realms/test",
        audience: "test-client",
      },
      cache: {
        enabled: true,
        ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
      },
      security: {
        constantTimeComparison: true,
        apiKeyHashRounds: 12,
        sessionRotationInterval: 86400,
      },
      session: {
        maxConcurrentSessions: 5,
        enforceIpConsistency: true,
        enforceUserAgentConsistency: false,
        tokenEncryption: true,
      },
      encryption: {
        key: "this-is-a-valid-32-character-encryption-key-for-testing",
        keyDerivationIterations: 100000,
      },
    };
  });

  afterEach(async () => {
    // Always dispose to prevent resource leaks
    if (tokenManager) {
      await tokenManager.dispose();
    }
  });

  it("should create and dispose TokenManager without resource leaks", async () => {
    tokenManager = new TokenManager(mockKeycloakClient, mockConfig);
    await tokenManager.initialize();

    // Verify it was created
    expect(tokenManager).toBeDefined();
    expect(tokenManager.hasRefreshTokenSupport()).toBe(false);

    // Dispose should complete without issues
    await tokenManager.dispose();

    // Should be safe to dispose multiple times
    await tokenManager.dispose();
  });

  it("should create and dispose TokenManager with refresh token support", async () => {
    const refreshConfig = {
      refreshBuffer: 300,
      enableEncryption: true,
      cleanupInterval: 60000,
    };

    tokenManager = new TokenManager(mockKeycloakClient, mockConfig);
    await tokenManager.initialize(refreshConfig);

    // Verify it was created with refresh support
    expect(tokenManager).toBeDefined();
    expect(tokenManager.hasRefreshTokenSupport()).toBe(true);

    // Get stats to verify refresh manager is active
    const stats = tokenManager.getRefreshTokenStats();
    expect(stats).toBeDefined();
    expect(stats?.enabled).toBe(true);

    // Dispose should clean up all resources including timers
    await tokenManager.dispose();

    // Should be safe to dispose multiple times
    await tokenManager.dispose();
  });
});
