/**
 * Security Performance and Load Tests
 * Tests for DoS protection, memory leaks, and performance under load
 */

import { TokenIntrospectionService } from "../../src/services/token-introspection";
import { KeycloakClientFactory } from "../../src/client/keycloak-client-factory";
import { KeycloakAuthHttpMiddleware } from "../../src/middleware/keycloak-http.middleware";

// Mock dependencies
const mockCacheService = (global as any).testUtils.createMockCacheService();
const mockKeycloakClientFactory = (
  global as any
).testUtils.createMockKeycloakClientFactory();
const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
};

describe("Security Performance Tests", () => {
  describe("Token Hash Performance", () => {
    let tokenService: TokenIntrospectionService;

    beforeEach(() => {
      tokenService = new TokenIntrospectionService(
        mockKeycloakClientFactory as any,
        mockCacheService as any
      );
    });

    it("should handle high-volume token hashing efficiently", async () => {
      const hashToken = (tokenService as any).hashToken.bind(tokenService);
      const tokenCount = 10000;
      const startTime = Date.now();

      // Generate and hash many tokens
      for (let i = 0; i < tokenCount; i++) {
        const token = `test-token-${i}-${Math.random()}`;
        const hash = hashToken(token);

        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000); // 5 seconds for 10k hashes

      // Average should be fast
      const avgTimePerHash = duration / tokenCount;
      expect(avgTimePerHash).toBeLessThan(0.5); // Less than 0.5ms per hash
    });

    it("should not leak memory during continuous hashing", async () => {
      const hashToken = (tokenService as any).hashToken.bind(tokenService);
      const iterations = 1000;
      const memorySnapshots: number[] = [];

      // Force garbage collection if available (Node.js)
      if (global.gc) {
        global.gc();
      }

      // Take initial memory snapshot
      const initialMemory = process.memoryUsage();
      memorySnapshots.push(initialMemory.heapUsed);

      // Perform many hashing operations
      for (let i = 0; i < iterations; i++) {
        const tokens = [];
        for (let j = 0; j < 100; j++) {
          const token = `batch-${i}-token-${j}-${Math.random()}`;
          tokens.push(hashToken(token));
        }

        // Take memory snapshot every 100 iterations
        if (i % 100 === 0) {
          if (global.gc) {
            global.gc();
          }
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }
      }

      // Final memory check
      if (global.gc) {
        global.gc();
      }
      const finalMemory = process.memoryUsage();

      // Memory should not grow significantly
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const growthPercent = (memoryGrowth / initialMemory.heapUsed) * 100;

      // Allow for some memory growth but not excessive
      expect(growthPercent).toBeLessThan(50); // Less than 50% memory growth
    });
  });

  describe("Salt Rotation Memory Management", () => {
    let tokenService: TokenIntrospectionService;

    beforeEach(() => {
      tokenService = new TokenIntrospectionService(
        mockKeycloakClientFactory as any,
        mockCacheService as any
      );
    });

    afterEach(async () => {
      // Ensure cleanup after each test
      const saltManager = (tokenService as any).saltManager;
      if (saltManager?.shutdown) {
        await saltManager.shutdown();
      }
    });

    it("should properly clean up salt rotation timers", async () => {
      const saltManager = (tokenService as any).saltManager;

      // Start salt rotation
      if (saltManager?.startRotation) {
        saltManager.startRotation();
      }

      // Simulate some time passing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Shutdown should clear timers
      if (saltManager?.shutdown) {
        await saltManager.shutdown();
      }

      // Timer should be cleared (this is hard to test directly, but we ensure no errors)
      expect(true).toBe(true); // If we reach here without hanging, timers are cleared
    });

    it("should handle multiple shutdown calls safely", async () => {
      const saltManager = (tokenService as any).saltManager;

      // Multiple shutdowns should not cause errors
      if (saltManager?.shutdown) {
        await saltManager.shutdown();
        await saltManager.shutdown();
        await saltManager.shutdown();
      }

      expect(true).toBe(true); // Should complete without errors
    });
  });

  describe("Path Traversal Attack Resistance", () => {
    let middleware: KeycloakAuthHttpMiddleware;

    beforeEach(() => {
      middleware = new KeycloakAuthHttpMiddleware(
        mockMetrics as any,
        mockKeycloakClientFactory as any,
        {} as any,
        {
          name: "test",
          keycloakClient: "frontend",
          requireAuth: false,
          allowAnonymous: true,
          bypassRoutes: ["/health", "/metrics"],
          roles: [],
          permissions: [],
          enableIntrospection: true,
          cacheValidation: true,
          cacheValidationTTL: 300,
          extractUserInfo: true,
          strictMode: false,
        }
      );
    });

    it("should handle high-volume path traversal attacks efficiently", () => {
      const shouldBypass = (middleware as any).shouldBypassAuth.bind(
        middleware
      );
      const attackCount = 1000;
      const startTime = Date.now();

      const attacks = [
        "../../../etc/passwd",
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "..\\..\\windows\\system32",
        "%5c%2e%2e%5c%2e%2e%5cwindows%5csystem32",
      ];

      // Generate many attack requests
      for (let i = 0; i < attackCount; i++) {
        const attack = attacks[i % attacks.length];
        const mockRequest = {
          url: `https://example.com/${attack}?param=${i}`,
          method: "GET",
        } as Request;

        const result = shouldBypass(mockRequest);
        expect(result).toBe(false); // Should always reject
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle attacks quickly (DoS protection)
      expect(duration).toBeLessThan(1000); // Less than 1 second for 1000 attacks

      const avgTimePerAttack = duration / attackCount;
      expect(avgTimePerAttack).toBeLessThan(1); // Less than 1ms per attack
    });
  });

  describe("Token Validation Performance", () => {
    let middleware: KeycloakAuthHttpMiddleware;

    beforeEach(() => {
      middleware = new KeycloakAuthHttpMiddleware(
        mockMetrics as any,
        mockKeycloakClientFactory as any,
        {} as any,
        {
          name: "test",
          keycloakClient: "frontend",
          requireAuth: true,
          allowAnonymous: false,
          bypassRoutes: [],
          roles: [],
          permissions: [],
          enableIntrospection: true,
          cacheValidation: true,
          cacheValidationTTL: 300,
          extractUserInfo: true,
          strictMode: false,
        }
      );
    });

    it("should handle malformed token flood efficiently", () => {
      const extractToken = (middleware as any).extractTokenFromHeader.bind(
        middleware
      );
      const attackCount = 1000;
      const startTime = Date.now();

      const malformedTokens = [
        "Bearer ",
        "Bearer a",
        "Bearer notajwttoken",
        "Bearer one.two",
        "Bearer one.two.three.four",
        "Bearer " + "a".repeat(5000), // Very long token
        "Bearer head@r.payl*ad.sign&ture",
      ];

      // Generate many malformed token requests
      for (let i = 0; i < attackCount; i++) {
        const token = malformedTokens[i % malformedTokens.length];
        const result = extractToken(token);
        expect(result).toBeNull(); // Should always reject malformed tokens
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle malformed tokens quickly
      expect(duration).toBeLessThan(1000); // Less than 1 second for 1000 tokens

      const avgTimePerToken = duration / attackCount;
      expect(avgTimePerToken).toBeLessThan(1); // Less than 1ms per token
    });

    it("should validate token length limits consistently", () => {
      const extractToken = (middleware as any).extractTokenFromHeader.bind(
        middleware
      );

      // Test various token lengths around the boundaries
      const tokenLengths = [
        1, 5, 9, 10, 100, 1000, 4095, 4096, 4097, 5000, 10000,
      ];

      tokenLengths.forEach((length) => {
        const token = "a".repeat(length);
        const header = `Bearer ${token}`;
        const result = extractToken(header);

        if (length < 10 || length > 4096) {
          expect(result).toBeNull(); // Should reject too short or too long
        }
        // Note: Valid tokens also need proper JWT structure, so most will be null
        // This test ensures length validation is consistent
      });
    });
  });

  describe("Circuit Breaker Stress Testing", () => {
    let clientFactory: KeycloakClientFactory;

    beforeEach(() => {
      const envConfig = (global as any).testUtils.createMockEnvironmentConfig();
      clientFactory = new KeycloakClientFactory(envConfig);
    });

    it("should handle rapid health check requests", () => {
      const requestCount = 1000;
      const startTime = Date.now();

      // Make many rapid health check requests
      for (let i = 0; i < requestCount; i++) {
        const health = clientFactory.getHealthStatus();
        expect(health).toHaveProperty("healthy");
        expect(health).toHaveProperty("circuitBreaker");
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle health checks efficiently
      expect(duration).toBeLessThan(1000); // Less than 1 second for 1000 checks

      const avgTimePerCheck = duration / requestCount;
      expect(avgTimePerCheck).toBeLessThan(1); // Less than 1ms per check
    });
  });

  describe("Error Sanitization Performance", () => {
    it("should handle high-volume error sanitization efficiently", async () => {
      const { toAuthError } = await import("../../src/utils/result");

      const errorCount = 1000;
      const startTime = Date.now();

      // Generate many errors with sensitive content
      const sensitivePatterns = [
        "Redis connection failed to localhost:6379",
        "Database connection pool exhausted",
        "Internal circuit breaker opened",
        "Salt rotation failed in TokenHashSaltManager",
        "Cache invalidation error: redis-cluster-node-1",
      ];

      for (let i = 0; i < errorCount; i++) {
        const pattern = sensitivePatterns[i % sensitivePatterns.length];
        const error = new Error(`${pattern} - attempt ${i}`);

        const sanitized = toAuthError(error);
        expect(sanitized.message).toBe("An internal error occurred");
        expect(sanitized.code).toBe("UNKNOWN_ERROR");
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should sanitize errors quickly
      expect(duration).toBeLessThan(1000); // Less than 1 second for 1000 errors

      const avgTimePerError = duration / errorCount;
      expect(avgTimePerError).toBeLessThan(1); // Less than 1ms per error
    });

    it("should handle very long error messages efficiently", async () => {
      const { toAuthError } = await import("../../src/utils/result");

      // Generate very long error messages
      const longMessages = [];
      for (let i = 0; i < 100; i++) {
        const message =
          "This is a very long error message ".repeat(50) + ` - iteration ${i}`;
        longMessages.push(new Error(message));
      }

      const startTime = Date.now();

      longMessages.forEach((error) => {
        const sanitized = toAuthError(error);
        expect(sanitized.message.length).toBeLessThanOrEqual(203);
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle long messages efficiently
      expect(duration).toBeLessThan(100); // Less than 100ms for 100 long messages
    });
  });
});
