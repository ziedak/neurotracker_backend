/**
 * @file Phase 4 Oslo Cryptographic Service Tests
 * @description Comprehensive Jest test suite for the Oslo cryptographic implementation
 */

import { OsloCryptographicService } from "../services/oslo-cryptographic.service";
import { Phase4OptimizationService } from "../services/phase4-optimization.service";
import type { PasswordHashResult, JWTPayload } from "../types/auth.types";

describe("Phase 4: Oslo Cryptographic Service", () => {
  let cryptoService: OsloCryptographicService;
  let phase4Service: Phase4OptimizationService;

  beforeAll(() => {
    cryptoService = new OsloCryptographicService();
    phase4Service = new Phase4OptimizationService();
  });

  afterAll(async () => {
    // Cleanup if needed
    await phase4Service.shutdown();
  });

  describe("Password Operations", () => {
    test("should hash passwords using scrypt algorithm", async () => {
      const password = "test-password-2024";
      const result = await cryptoService.hashPassword(password);

      expect(result).toMatchObject({
        hash: expect.any(String),
        salt: expect.any(String),
        algorithm: "scrypt",
        params: expect.objectContaining({
          N: expect.any(Number),
          r: expect.any(Number),
          p: expect.any(Number),
          keyLength: expect.any(Number),
        }),
      });

      expect(result.hash).toHaveLength(88); // Base64 encoded 64-byte hash
      expect(result.salt).toHaveLength(44); // Base64 encoded 32-byte salt
      expect(result.algorithm).toBe("scrypt");
    });

    test("should verify correct passwords", async () => {
      const password = "correct-password";
      const hashResult = await cryptoService.hashPassword(password);

      const isValid = await cryptoService.verifyPassword(password, hashResult);
      expect(isValid).toBe(true);
    });

    test("should reject incorrect passwords", async () => {
      const password = "correct-password";
      const wrongPassword = "wrong-password";
      const hashResult = await cryptoService.hashPassword(password);

      const isValid = await cryptoService.verifyPassword(
        wrongPassword,
        hashResult
      );
      expect(isValid).toBe(false);
    });

    test("should handle password verification with timing consistency", async () => {
      const password = "timing-test-password";
      const hashResult = await cryptoService.hashPassword(password);

      // Test multiple verifications for timing consistency
      const startTime1 = performance.now();
      await cryptoService.verifyPassword(password, hashResult);
      const time1 = performance.now() - startTime1;

      const startTime2 = performance.now();
      await cryptoService.verifyPassword("wrong-password", hashResult);
      const time2 = performance.now() - startTime2;

      // Both should take roughly the same time (within reasonable variance)
      const timeDiff = Math.abs(time1 - time2);
      const maxVariance = Math.max(time1, time2) * 0.5; // 50% variance allowed

      expect(timeDiff).toBeLessThan(maxVariance);
    });
  });

  describe("JWT Operations", () => {
    const testSecret = "test-jwt-secret-key";
    const testPayload = {
      sub: "user-123",
      role: "admin",
      permissions: ["read", "write"],
    };

    test("should create valid JWT tokens", async () => {
      const token = await cryptoService.createJWTToken(testPayload, testSecret);

      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Should have 3 parts separated by dots
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
    });

    test("should validate correct JWT tokens", async () => {
      const token = await cryptoService.createJWTToken(testPayload, testSecret);
      const decoded = await cryptoService.validateJWTToken(token, testSecret);

      expect(decoded).toBeTruthy();
      expect(decoded?.sub).toBe(testPayload.sub);
      expect(decoded?.role).toBe(testPayload.role);
      expect(decoded?.iat).toBeDefined();
      expect(decoded?.exp).toBeDefined();
    });

    test("should reject JWT with wrong signature", async () => {
      const token = await cryptoService.createJWTToken(testPayload, testSecret);
      const wrongSecret = "wrong-secret-key";

      const decoded = await cryptoService.validateJWTToken(token, wrongSecret);
      expect(decoded).toBeNull();
    });

    test("should reject malformed JWT tokens", async () => {
      const malformedTokens = [
        "not.a.jwt",
        "invalid-token",
        "a.b", // only 2 parts
        "a.b.c.d", // too many parts
        "", // empty string
      ];

      for (const token of malformedTokens) {
        const decoded = await cryptoService.validateJWTToken(token, testSecret);
        expect(decoded).toBeNull();
      }
    });

    test("should include standard JWT claims", async () => {
      const token = await cryptoService.createJWTToken(testPayload, testSecret);
      const decoded = await cryptoService.validateJWTToken(token, testSecret);

      expect(decoded).toMatchObject({
        sub: expect.any(String),
        iat: expect.any(Number),
        exp: expect.any(Number),
        iss: expect.any(String),
        aud: expect.any(String),
        jti: expect.any(String),
      });

      // Verify expiration is in the future
      expect(decoded!.exp * 1000).toBeGreaterThan(Date.now());
    });
  });

  describe("Cryptographic Operations", () => {
    test("should generate secure random tokens", () => {
      const token1 = cryptoService.generateSecureToken("session");
      const token2 = cryptoService.generateSecureToken("session");

      expect(token1.token).toHaveLength(43); // Base64 encoded 32 bytes
      expect(token2.token).toHaveLength(43);
      expect(token1.token).not.toBe(token2.token); // Should be different
      expect(token1.purpose).toBe("session");
    });

    test("should generate SHA-256 hashes", () => {
      const data = "test-data-to-hash";
      const hash = cryptoService.generateHash(data);

      expect(hash).toHaveLength(64); // Hex encoded 32-byte hash
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // Only hex characters

      // Same data should produce same hash
      const hash2 = cryptoService.generateHash(data);
      expect(hash).toBe(hash2);
    });

    test("should generate Base64 hashes when requested", () => {
      const data = "test-data-to-hash";
      const hash = cryptoService.generateHash(data, "base64");

      expect(hash).toHaveLength(44); // Base64 encoded 32-byte hash
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/); // Base64 format
    });

    test("should generate HMAC signatures", () => {
      const data = "test-data";
      const key = "secret-key";
      const hmac = cryptoService.generateHMAC(data, key);

      expect(hmac).toHaveLength(64); // Hex encoded 32-byte HMAC
      expect(hmac).toMatch(/^[a-f0-9]{64}$/);

      // Same key and data should produce same HMAC
      const hmac2 = cryptoService.generateHMAC(data, key);
      expect(hmac).toBe(hmac2);

      // Different key should produce different HMAC
      const hmac3 = cryptoService.generateHMAC(data, "different-key");
      expect(hmac).not.toBe(hmac3);
    });
  });

  describe("Performance Benchmarking", () => {
    test("should complete performance benchmark within reasonable time", async () => {
      const startTime = performance.now();
      const results = await cryptoService.benchmark();
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      expect(results).toMatchObject({
        passwordHashing: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
        passwordVerification: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
        tokenGeneration: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
        jwtCreation: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
        jwtValidation: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
        hashGeneration: {
          duration: expect.any(Number),
          iterations: expect.any(Number),
        },
      });
    });

    test("should report reasonable performance metrics", async () => {
      const results = await cryptoService.benchmark();

      // Password hashing should be reasonably fast but secure
      const avgHashTime =
        results.passwordHashing.duration / results.passwordHashing.iterations;
      expect(avgHashTime).toBeGreaterThan(10); // At least 10ms per hash (security)
      expect(avgHashTime).toBeLessThan(1000); // Less than 1 second per hash (usability)

      // JWT operations should be fast
      const avgJwtTime =
        results.jwtCreation.duration / results.jwtCreation.iterations;
      expect(avgJwtTime).toBeLessThan(10); // Less than 10ms per JWT

      // Token generation should be very fast
      const avgTokenTime =
        results.tokenGeneration.duration / results.tokenGeneration.iterations;
      expect(avgTokenTime).toBeLessThan(5); // Less than 5ms per token
    });
  });

  describe("Service Configuration", () => {
    test("should return service configuration", () => {
      const config = cryptoService.getConfiguration();

      expect(config).toMatchObject({
        scryptN: expect.any(Number),
        scryptR: expect.any(Number),
        scryptP: expect.any(Number),
        scryptKeyLength: expect.any(Number),
        saltLength: expect.any(Number),
        tokenEntropy: expect.any(Number),
        jwtAlgorithm: "HS256",
        jwtIssuer: expect.any(String),
        jwtAudience: expect.any(String),
      });
    });

    test("should have secure default configuration", () => {
      const config = cryptoService.getConfiguration();

      // Scrypt parameters should be secure
      expect(config.scryptN).toBeGreaterThanOrEqual(16384); // At least 2^14
      expect(config.scryptR).toBe(8); // Standard block size
      expect(config.scryptP).toBeGreaterThanOrEqual(1); // At least 1 thread
      expect(config.scryptKeyLength).toBeGreaterThanOrEqual(32); // At least 256 bits

      // Salt and token entropy should be sufficient
      expect(config.saltLength).toBeGreaterThanOrEqual(32); // At least 256 bits
      expect(config.tokenEntropy).toBeGreaterThanOrEqual(32); // At least 256 bits
    });
  });
});

describe("Phase 4: Integration Service", () => {
  let phase4Service: Phase4OptimizationService;

  beforeAll(() => {
    phase4Service = new Phase4OptimizationService();
  });

  afterAll(async () => {
    await phase4Service.shutdown();
  });

  describe("Phase 4 Execution", () => {
    test("should execute Phase 4 optimization successfully", async () => {
      const results = await phase4Service.executePhase4();

      expect(results).toMatchObject({
        status: expect.stringMatching(/^(success|partial|failed)$/),
        performanceImprovement: expect.any(Number),
        securityUpgrades: expect.objectContaining({
          scryptImplementation: expect.any(Boolean),
          cryptographicRandomness: expect.any(Boolean),
          industryStandardJwt: expect.any(Boolean),
          auditedCryptography: expect.any(Boolean),
        }),
        duration: expect.any(Number),
      });
    });

    test("should show performance improvement", async () => {
      const results = await phase4Service.executePhase4();

      expect(results.performanceImprovement).toBeGreaterThan(0);
      expect(results.performanceImprovement).toBeLessThanOrEqual(100);
    });
  });

  describe("Health Check", () => {
    test("should perform health check", async () => {
      const health = await phase4Service.healthCheck();

      expect(health).toMatchObject({
        status: expect.stringMatching(/^(healthy|degraded|critical)$/),
        osloCryptographic: expect.stringMatching(
          /^(healthy|degraded|critical)$/
        ),
        timestamp: expect.any(Date),
        uptime: expect.any(Number),
      });
    });

    test("should report healthy status when everything is working", async () => {
      const health = await phase4Service.healthCheck();

      // Should be healthy if no issues
      expect(["healthy", "degraded"]).toContain(health.status);
      expect(["healthy", "degraded"]).toContain(health.osloCryptographic);
    });
  });

  describe("Password Migration Demo", () => {
    test("should demonstrate password migration", async () => {
      const migration = await phase4Service.demonstratePasswordMigration();

      expect(migration).toMatchObject({
        success: expect.any(Boolean),
        migratedCount: expect.any(Number),
        failedCount: expect.any(Number),
        duration: expect.any(Number),
        report: expect.objectContaining({
          totalPasswords: expect.any(Number),
          successfulMigrations: expect.any(Number),
          errors: expect.any(Array),
        }),
      });
    });

    test("should successfully migrate test passwords", async () => {
      const migration = await phase4Service.demonstratePasswordMigration();

      expect(migration.success).toBe(true);
      expect(migration.migratedCount).toBeGreaterThan(0);
      expect(migration.failedCount).toBe(0);
    });
  });
});

describe("Phase 4: End-to-End Integration", () => {
  let cryptoService: OsloCryptographicService;
  let phase4Service: Phase4OptimizationService;

  beforeAll(() => {
    cryptoService = new OsloCryptographicService();
    phase4Service = new Phase4OptimizationService();
  });

  afterAll(async () => {
    await phase4Service.shutdown();
  });

  test("complete authentication flow with Oslo cryptography", async () => {
    // 1. Register user with password hashing
    const userPassword = "user-secure-password-2024";
    const hashResult = await cryptoService.hashPassword(userPassword);

    expect(hashResult.algorithm).toBe("scrypt");

    // 2. Login verification
    const isValidLogin = await cryptoService.verifyPassword(
      userPassword,
      hashResult
    );
    expect(isValidLogin).toBe(true);

    // 3. Create session JWT
    const sessionPayload = {
      sub: "user-12345",
      role: "user",
      permissions: ["read", "write"],
      sessionId: cryptoService.generateSecureToken("session").token,
    };

    const sessionSecret = "session-secret-key";
    const jwtToken = await cryptoService.createJWTToken(
      sessionPayload,
      sessionSecret
    );

    expect(jwtToken).toBeTruthy();

    // 4. Validate JWT for API requests
    const decodedPayload = await cryptoService.validateJWTToken(
      jwtToken,
      sessionSecret
    );

    expect(decodedPayload).toBeTruthy();
    expect(decodedPayload?.sub).toBe(sessionPayload.sub);
    expect(decodedPayload?.role).toBe(sessionPayload.role);

    // 5. Generate API key
    const apiKey = cryptoService.generateSecureToken("api");
    expect(apiKey.token).toHaveLength(43);
    expect(apiKey.purpose).toBe("api");

    // 6. Generate HMAC signature for API request
    const requestData = JSON.stringify({
      endpoint: "/api/users",
      method: "GET",
    });
    const signature = cryptoService.generateHMAC(requestData, apiKey.token);

    expect(signature).toHaveLength(64);

    // 7. Verify HMAC signature
    const verifySignature = cryptoService.generateHMAC(
      requestData,
      apiKey.token
    );
    expect(signature).toBe(verifySignature);
  });

  test("Phase 4 optimization shows measurable improvements", async () => {
    const phase4Results = await phase4Service.executePhase4();
    const cryptoBenchmark = await cryptoService.benchmark();

    // Phase 4 should be successful
    expect(phase4Results.status).toBe("success");

    // Should show performance improvements
    expect(phase4Results.performanceImprovement).toBeGreaterThan(0);

    // All security upgrades should be implemented
    expect(phase4Results.securityUpgrades.scryptImplementation).toBe(true);
    expect(phase4Results.securityUpgrades.cryptographicRandomness).toBe(true);
    expect(phase4Results.securityUpgrades.industryStandardJwt).toBe(true);
    expect(phase4Results.securityUpgrades.auditedCryptography).toBe(true);

    // Benchmark should complete successfully
    expect(cryptoBenchmark.passwordHashing.iterations).toBeGreaterThan(0);
    expect(cryptoBenchmark.jwtCreation.iterations).toBeGreaterThan(0);
  });
});
