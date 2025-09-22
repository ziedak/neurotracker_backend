/**
 * PKCE Manager Tests
 * Comprehensive test suite for PKCE Manager using battle-tested package integration
 */

import {
  PKCEManager,
  PKCEUtils,
  DEFAULT_PKCE_CONFIG,
} from "../../src/services/PKCEManager";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: {
    create: jest.fn(() => ({
      set: jest.fn(),
      get: jest.fn(() => ({ data: null })),
      invalidate: jest.fn(),
    })),
  },
}));

// Mock the battle-tested package to ensure it's being called
jest.mock("pkce-challenge", () => {
  const actualCrypto = jest.requireActual("crypto");
  return jest.fn((options: any) => {
    if (options.code_verifier) {
      // Generate challenge from provided verifier
      const hash = actualCrypto
        .createHash("sha256")
        .update(options.code_verifier)
        .digest("base64url");
      return {
        code_verifier: options.code_verifier,
        code_challenge: hash,
      };
    } else {
      // Generate new pair
      const buffer = actualCrypto.randomBytes(
        Math.ceil(((options.length || 128) * 3) / 4)
      );
      const code_verifier = buffer
        .toString("base64url")
        .substring(0, options.length || 128);
      const code_challenge = actualCrypto
        .createHash("sha256")
        .update(code_verifier)
        .digest("base64url");
      return {
        code_verifier,
        code_challenge,
      };
    }
  });
});

interface MockMetricsCollector {
  recordCounter: jest.Mock;
  recordTimer: jest.Mock;
  recordGauge: jest.Mock;
  recordHistogram: jest.Mock;
  recordSummary: jest.Mock;
  getMetrics: jest.Mock;
  recordApiRequest: jest.Mock;
  recordDatabaseOperation: jest.Mock;
  recordAuthOperation: jest.Mock;
  recordWebSocketActivity: jest.Mock;
  recordNodeMetrics: jest.Mock;
  measureEventLoopLag: jest.Mock;
}

describe("PKCEManager", () => {
  let mockMetrics: MockMetricsCollector;
  let mockCacheService: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    };

    mockCacheService = {
      set: jest.fn(),
      get: jest.fn(() => ({ data: null })),
      invalidate: jest.fn(),
    };

    // Mock CacheService.create to return our mock
    const mockDatabase = jest.requireMock("@libs/database");
    mockDatabase.CacheService.create.mockReturnValue(mockCacheService);
  });

  describe("Constructor and Configuration", () => {
    it("should initialize with default configuration", () => {
      const manager = new PKCEManager({}, mockMetrics);
      const stats = manager.getStats();

      expect(stats.config.codeVerifierLength).toBe(
        DEFAULT_PKCE_CONFIG.codeVerifierLength
      );
      expect(stats.config.codeChallengeMethod).toBe("S256");
      expect(stats.config.cacheTTL).toBe(600);
    });

    it("should initialize with custom configuration", () => {
      const customConfig = {
        codeVerifierLength: 64,
        cacheTTL: 300,
        maxConcurrentSessions: 10,
      };

      const manager = new PKCEManager(customConfig, mockMetrics);
      const stats = manager.getStats();

      expect(stats.config.codeVerifierLength).toBe(64);
      expect(stats.config.cacheTTL).toBe(300);
      expect(stats.config.maxConcurrentSessions).toBe(10);
    });

    it("should initialize cache service when metrics provided", () => {
      const mockDatabase = jest.requireMock("@libs/database");
      new PKCEManager({}, mockMetrics);
      expect(mockDatabase.CacheService.create).toHaveBeenCalledWith(
        mockMetrics
      );
    });
  });

  describe("Code Verifier Generation", () => {
    let manager: PKCEManager;

    beforeEach(() => {
      manager = new PKCEManager({}, mockMetrics);
    });

    it("should generate code verifier using battle-tested package", () => {
      const pkceMock = require("pkce-challenge");
      const codeVerifier = manager.generateCodeVerifier();

      expect(pkceMock).toHaveBeenCalledWith({
        length: DEFAULT_PKCE_CONFIG.codeVerifierLength,
        method: "S256",
      });
      expect(codeVerifier).toBeDefined();
      expect(typeof codeVerifier).toBe("string");
      expect(codeVerifier.length).toBe(DEFAULT_PKCE_CONFIG.codeVerifierLength);
    });

    it("should generate valid code verifier format", () => {
      const codeVerifier = manager.generateCodeVerifier();
      const validPattern = /^[A-Za-z0-9\-._~]{43,128}$/;
      expect(validPattern.test(codeVerifier)).toBe(true);
    });

    it("should generate unique code verifiers", () => {
      const verifiers = Array.from({ length: 10 }, () =>
        manager.generateCodeVerifier()
      );
      const uniqueVerifiers = new Set(verifiers);
      expect(uniqueVerifiers.size).toBe(10);
    });
  });

  describe("Code Challenge Generation", () => {
    let manager: PKCEManager;

    beforeEach(() => {
      manager = new PKCEManager({}, mockMetrics);
    });

    it("should generate code challenge using battle-tested package", () => {
      const pkceMock = require("pkce-challenge");
      const codeVerifier = manager.generateCodeVerifier();
      const codeChallenge = manager.generateCodeChallenge(codeVerifier);

      expect(pkceMock).toHaveBeenCalledWith({
        code_verifier: codeVerifier,
        method: "S256",
      });
      expect(codeChallenge).toBeDefined();
      expect(typeof codeChallenge).toBe("string");
    });

    it("should reject invalid code verifier", () => {
      expect(() => manager.generateCodeChallenge("invalid")).toThrow(
        'Invalid code verifier: must be 43-128 characters using [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"'
      );
    });

    it("should generate consistent challenges for same verifier", () => {
      const codeVerifier = manager.generateCodeVerifier();
      const challenge1 = manager.generateCodeChallenge(codeVerifier);
      const challenge2 = manager.generateCodeChallenge(codeVerifier);

      expect(challenge1).toBe(challenge2);
    });
  });

  describe("PKCE Pair Generation", () => {
    let manager: PKCEManager;

    beforeEach(() => {
      manager = new PKCEManager({}, mockMetrics);
    });

    it("should generate complete PKCE pair with metadata", async () => {
      const pkcePair = await manager.generatePKCEPair({
        userId: "user123",
        clientId: "client456",
      });

      expect(pkcePair).toMatchObject({
        codeVerifier: expect.any(String),
        codeChallenge: expect.any(String),
        codeChallengeMethod: "S256",
        state: expect.any(String),
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
        userId: "user123",
        clientId: "client456",
        sessionId: expect.any(String),
      });
    });

    it("should cache PKCE pair when cache service available", async () => {
      const pkcePair = await manager.generatePKCEPair();

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^pkce:[a-f0-9]{32}$/),
        pkcePair,
        DEFAULT_PKCE_CONFIG.cacheTTL
      );
    });

    it("should record metrics for pair generation", async () => {
      await manager.generatePKCEPair();

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.pair_generated",
        1
      );
      expect(mockMetrics.recordTimer).toHaveBeenCalledWith(
        "pkce.generation_duration",
        expect.any(Number)
      );
    });

    it("should use custom TTL when provided", async () => {
      const customTTL = 1200;
      const pkcePair = await manager.generatePKCEPair({ customTTL });

      const expectedExpiry = new Date(
        pkcePair.createdAt.getTime() + customTTL * 1000
      );
      const actualExpiry = pkcePair.expiresAt;
      const timeDiff = Math.abs(
        actualExpiry.getTime() - expectedExpiry.getTime()
      );

      expect(timeDiff).toBeLessThan(1000); // Allow 1 second tolerance
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        pkcePair,
        customTTL
      );
    });
  });

  describe("PKCE Validation", () => {
    let manager: PKCEManager;
    let testPKCEPair: any;

    beforeEach(async () => {
      manager = new PKCEManager({}, mockMetrics);
      testPKCEPair = await manager.generatePKCEPair();
    });

    it("should validate correct PKCE pair", async () => {
      // Mock cache to return our test pair
      mockCacheService.get.mockResolvedValueOnce({ data: testPKCEPair });

      const result = await manager.validatePKCE(
        testPKCEPair.state,
        testPKCEPair.codeVerifier
      );

      expect(result.valid).toBe(true);
      expect(result.pkce).toEqual(testPKCEPair);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.validation_success",
        1
      );
    });

    it("should reject missing parameters", async () => {
      const result1 = await manager.validatePKCE("", "verifier");
      const result2 = await manager.validatePKCE("state", "");

      expect(result1.valid).toBe(false);
      expect(result1.errorCode).toBe("invalid_request");
      expect(result2.valid).toBe(false);
      expect(result2.errorCode).toBe("invalid_request");
    });

    it("should reject when PKCE pair not found", async () => {
      mockCacheService.get.mockResolvedValueOnce({ data: null });

      const result = await manager.validatePKCE("invalid_state", "verifier");

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_grant");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.validation_not_found",
        1
      );
    });

    it("should reject expired PKCE pair", async () => {
      const expiredPair = {
        ...testPKCEPair,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };
      mockCacheService.get.mockResolvedValueOnce({ data: expiredPair });

      const result = await manager.validatePKCE(
        expiredPair.state,
        expiredPair.codeVerifier
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_grant");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.validation_expired",
        1
      );
    });

    it("should reject invalid code verifier using battle-tested package", async () => {
      mockCacheService.get.mockResolvedValueOnce({ data: testPKCEPair });

      const result = await manager.validatePKCE(
        testPKCEPair.state,
        "invalid_verifier_that_wont_match"
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_grant");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.validation_failed",
        1
      );
    });

    it("should clean up valid PKCE pair after successful validation", async () => {
      mockCacheService.get.mockResolvedValueOnce({ data: testPKCEPair });

      const result = await manager.validatePKCE(
        testPKCEPair.state,
        testPKCEPair.codeVerifier
      );

      expect(result.valid).toBe(true);
      expect(mockCacheService.invalidate).toHaveBeenCalledWith(
        expect.stringMatching(/^pkce:[a-f0-9]{32}$/)
      );
    });
  });

  describe("Authorization URL Enhancement", () => {
    let manager: PKCEManager;
    let testPKCEPair: any;

    beforeEach(async () => {
      manager = new PKCEManager({}, mockMetrics);
      testPKCEPair = await manager.generatePKCEPair();
    });

    it("should add PKCE parameters to authorization URL", () => {
      const baseUrl = "https://auth.example.com/authorize?client_id=test";
      const enhancedUrl = manager.addPKCEToAuthorizationUrl(
        baseUrl,
        testPKCEPair
      );

      const url = new URL(enhancedUrl);
      expect(url.searchParams.get("code_challenge")).toBe(
        testPKCEPair.codeChallenge
      );
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")).toBe(testPKCEPair.state);
      expect(url.searchParams.get("client_id")).toBe("test"); // Preserve existing params
    });

    it("should add additional parameters", () => {
      const baseUrl = "https://auth.example.com/authorize";
      const additionalParams = {
        response_type: "code",
        scope: "openid profile",
        redirect_uri: "https://app.example.com/callback",
      };

      const enhancedUrl = manager.addPKCEToAuthorizationUrl(
        baseUrl,
        testPKCEPair,
        additionalParams
      );

      const url = new URL(enhancedUrl);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("openid profile");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://app.example.com/callback"
      );
    });

    it("should reject invalid base URL", () => {
      expect(() => {
        manager.addPKCEToAuthorizationUrl("invalid-url", testPKCEPair);
      }).toThrow("Invalid authorization URL format");
    });
  });

  describe("PKCEUtils", () => {
    it("should generate code verifier using battle-tested package", () => {
      const pkceMock = require("pkce-challenge");
      const verifier = PKCEUtils.generateCodeVerifier(64);

      expect(pkceMock).toHaveBeenCalledWith({
        length: 64,
        method: "S256",
      });
      expect(verifier).toBeDefined();
      expect(typeof verifier).toBe("string");
    });

    it("should generate code challenge using battle-tested package", () => {
      const pkceMock = require("pkce-challenge");
      const verifier = PKCEUtils.generateCodeVerifier();
      const challenge = PKCEUtils.generateCodeChallenge(verifier);

      expect(pkceMock).toHaveBeenCalledWith({
        code_verifier: verifier,
        method: "S256",
      });
      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe("string");
    });

    it("should validate code verifier format", () => {
      const validVerifier = PKCEUtils.generateCodeVerifier();
      expect(PKCEUtils.isValidCodeVerifier(validVerifier)).toBe(true);
      expect(PKCEUtils.isValidCodeVerifier("invalid")).toBe(false);
      expect(PKCEUtils.isValidCodeVerifier("")).toBe(false);
    });

    it("should generate complete PKCE pair using battle-tested package", () => {
      const pkceMock = require("pkce-challenge");
      const pair = PKCEUtils.generatePKCEPair();

      expect(pkceMock).toHaveBeenCalledWith({
        length: 128,
        method: "S256",
      });
      expect(pair).toMatchObject({
        codeVerifier: expect.any(String),
        codeChallenge: expect.any(String),
        state: expect.any(String),
      });
    });
  });

  describe("Error Handling", () => {
    let manager: PKCEManager;

    beforeEach(() => {
      manager = new PKCEManager({}, mockMetrics);
    });

    it("should handle PKCE pair generation errors gracefully", async () => {
      const pkceMock = require("pkce-challenge");
      pkceMock.mockImplementationOnce(() => {
        throw new Error("PKCE generation failed");
      });

      await expect(manager.generatePKCEPair()).rejects.toThrow(
        "PKCE pair generation failed"
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.generation_error",
        1
      );
    });

    it("should handle validation errors gracefully", async () => {
      mockCacheService.get.mockRejectedValueOnce(new Error("Cache error"));

      const result = await manager.validatePKCE("state", "verifier");

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("server_error");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "pkce.validation_error",
        1
      );
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should provide comprehensive statistics", () => {
      const manager = new PKCEManager({}, mockMetrics);
      const stats = manager.getStats();

      expect(stats).toMatchObject({
        cacheEnabled: true,
        config: expect.objectContaining({
          codeVerifierLength: expect.any(Number),
          codeChallengeMethod: "S256",
          cacheTTL: expect.any(Number),
        }),
        uptime: expect.any(Number),
      });
    });
  });
});
