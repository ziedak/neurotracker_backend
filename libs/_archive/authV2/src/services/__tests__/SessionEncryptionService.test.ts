/**
 * @fileoverview Comprehensive test suite for SessionEncryptionService
 * @module services/__tests__/SessionEncryptionService
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1.3 Session Security Enhancement
 */

import { SessionEncryptionService } from "../SessionEncryptionService";

describe("SessionEncryptionService", () => {
  let encryptionService: SessionEncryptionService;
  const testSecretKey = "test-secret-key-that-is-32-chars-long-exactly!";

  beforeEach(() => {
    encryptionService = new SessionEncryptionService(testSecretKey);
  });

  describe("constructor", () => {
    it("should create instance with valid secret key", () => {
      expect(encryptionService).toBeInstanceOf(SessionEncryptionService);
    });

    it("should throw error for missing secret key", () => {
      expect(() => {
        new SessionEncryptionService("");
      }).toThrow("Session secret key is required for encryption");
    });

    it("should throw error for short secret key", () => {
      expect(() => {
        new SessionEncryptionService("short");
      }).toThrow("Session secret key must be at least 32 characters");
    });
  });

  describe("encryptSessionData", () => {
    it("should encrypt session data successfully", () => {
      const sessionData = {
        userId: "user123",
        sessionId: "session456",
        metadata: { test: "value" },
      };

      const result = encryptionService.encryptSessionData(sessionData);

      expect(result.success).toBe(true);
      expect(result.encryptedData).toBeDefined();
      expect(result.encryptedData!.encryptedData).toBeTruthy();
      expect(result.encryptedData!.iv).toBeTruthy();
      expect(result.encryptedData!.tag).toBeTruthy();
      expect(result.encryptedData!.algorithm).toBe("aes-256-gcm");
    });

    it("should reject invalid input data", () => {
      const result = encryptionService.encryptSessionData(null as any);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid session data provided");
    });

    it("should handle encryption errors gracefully", () => {
      // Test error handling by using corrupted internal state
      const service = new SessionEncryptionService(testSecretKey);

      // Corrupt the internal configuration to trigger encryption failure
      (service as any).config.algorithm = null;

      const result = service.encryptSessionData({ test: "data" });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("Encryption failed");
    });
  });

  describe("decryptSessionData", () => {
    it("should decrypt previously encrypted data", () => {
      const originalData = {
        userId: "user123",
        sessionId: "session456",
        metadata: { test: "value" },
      };

      const encryptResult = encryptionService.encryptSessionData(originalData);
      expect(encryptResult.success).toBe(true);

      const decryptResult = encryptionService.decryptSessionData(
        encryptResult.encryptedData!
      );

      expect(decryptResult.success).toBe(true);
      expect(decryptResult.decryptedData).toEqual(originalData);
    });

    it("should reject invalid encrypted data", () => {
      const invalidData = {
        encryptedData: "",
        iv: "",
        tag: "",
        algorithm: "aes-256-gcm",
      };

      const result = encryptionService.decryptSessionData(invalidData);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid encrypted session data");
    });

    it("should handle decryption errors gracefully", () => {
      const corruptedData = {
        encryptedData: "corrupted-data",
        iv: "invalid-iv",
        tag: "invalid-tag",
        algorithm: "aes-256-gcm",
      };

      const result = encryptionService.decryptSessionData(corruptedData);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("Decryption failed");
    });
  });

  describe("generateSecureSessionId", () => {
    it("should generate unique session IDs", () => {
      const id1 = encryptionService.generateSecureSessionId();
      const id2 = encryptionService.generateSecureSessionId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^ses_[a-f0-9]{32}$/);
      expect(id2).toMatch(/^ses_[a-f0-9]{32}$/);
    });

    it("should generate different ID when regenerating from existing", () => {
      const originalId = encryptionService.generateSecureSessionId();
      const regeneratedId =
        encryptionService.generateSecureSessionId(originalId);

      expect(regeneratedId).not.toBe(originalId);
      expect(regeneratedId).toMatch(/^ses_[a-f0-9]{32}$/);
    });
  });

  describe("requiresRegeneration", () => {
    it("should require regeneration for old sessions", () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      const result = encryptionService.requiresRegeneration(oldDate);

      expect(result).toBe(true);
    });

    it("should require regeneration after interval", () => {
      const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const lastRegeneration = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago

      const result = encryptionService.requiresRegeneration(
        createdAt,
        lastRegeneration
      );

      expect(result).toBe(true);
    });

    it("should require regeneration on privilege change", () => {
      const recentDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

      const result = encryptionService.requiresRegeneration(
        recentDate,
        undefined,
        true
      );

      expect(result).toBe(true);
    });

    it("should not require regeneration for recent sessions", () => {
      const recentDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

      const result = encryptionService.requiresRegeneration(recentDate);

      expect(result).toBe(false);
    });
  });

  describe("generateSecureCookieConfig", () => {
    it("should generate secure cookie configuration", () => {
      const config = encryptionService.generateSecureCookieConfig(
        true,
        "example.com"
      );

      expect(config).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: expect.any(Number),
        domain: "example.com",
        path: "/",
        priority: "high",
        __Secure: true,
      });
    });

    it("should handle insecure connections", () => {
      const config = encryptionService.generateSecureCookieConfig(false);

      expect(config.secure).toBe(false);
      expect(config.__Secure).toBe(false);
      expect(config.httpOnly).toBe(true);
      expect(config.sameSite).toBe("strict");
    });
  });

  describe("validateSessionIntegrity", () => {
    it("should validate correct checksum", () => {
      const sessionData = { userId: "user123", test: "data" };
      const checksum = encryptionService.generateSessionChecksum(sessionData);

      const isValid = encryptionService.validateSessionIntegrity(
        sessionData,
        checksum
      );

      expect(isValid).toBe(true);
    });

    it("should reject incorrect checksum", () => {
      const sessionData = { userId: "user123", test: "data" };
      const incorrectChecksum = "invalid-checksum";

      const isValid = encryptionService.validateSessionIntegrity(
        sessionData,
        incorrectChecksum
      );

      expect(isValid).toBe(false);
    });

    it("should reject tampered data", () => {
      const originalData = { userId: "user123", test: "data" };
      const checksum = encryptionService.generateSessionChecksum(originalData);

      const tamperedData = { userId: "user123", test: "tampered" };

      const isValid = encryptionService.validateSessionIntegrity(
        tamperedData,
        checksum
      );

      expect(isValid).toBe(false);
    });
  });

  describe("generateSessionChecksum", () => {
    it("should generate consistent checksums", () => {
      const sessionData = { userId: "user123", test: "data" };

      const checksum1 = encryptionService.generateSessionChecksum(sessionData);
      const checksum2 = encryptionService.generateSessionChecksum(sessionData);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex output
    });

    it("should generate different checksums for different data", () => {
      const data1 = { userId: "user123" };
      const data2 = { userId: "user456" };

      const checksum1 = encryptionService.generateSessionChecksum(data1);
      const checksum2 = encryptionService.generateSessionChecksum(data2);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe("deriveSessionKey", () => {
    it("should derive consistent keys for same input", () => {
      const sessionId = "session123";

      const key1 = encryptionService.deriveSessionKey(sessionId);
      const key2 = encryptionService.deriveSessionKey(sessionId);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should derive different keys for different session IDs", () => {
      const key1 = encryptionService.deriveSessionKey("session123");
      const key2 = encryptionService.deriveSessionKey("session456");

      expect(key1).not.toBe(key2);
    });

    it("should derive different keys with different salts", () => {
      const sessionId = "session123";

      const key1 = encryptionService.deriveSessionKey(sessionId, "salt1");
      const key2 = encryptionService.deriveSessionKey(sessionId, "salt2");

      expect(key1).not.toBe(key2);
    });
  });

  describe("getConfig", () => {
    it("should return immutable configuration", () => {
      const config = encryptionService.getConfig();

      expect(config.algorithm).toBe("aes-256-gcm");
      expect(config.keyLength).toBe(32);
      expect(config.ivLength).toBe(16);
      expect(config.tagLength).toBe(16);

      // Should be read-only
      expect(() => {
        (config as any).algorithm = "modified";
      }).toThrow();
    });
  });

  describe("getFixationConfig", () => {
    it("should return fixation protection configuration", () => {
      const config = encryptionService.getFixationConfig();

      expect(config.regenerateOnLogin).toBe(true);
      expect(config.regenerateOnPrivilegeEscalation).toBe(true);
      expect(config.regenerateInterval).toBeGreaterThan(0);
      expect(config.maxSessionAge).toBeGreaterThan(0);

      // Should be read-only
      expect(() => {
        (config as any).regenerateOnLogin = false;
      }).toThrow();
    });
  });

  describe("end-to-end encryption", () => {
    it("should handle complex session data encryption/decryption", () => {
      const complexData = {
        userId: "user-12345",
        sessionId: "session-67890",
        roles: ["admin", "user"],
        permissions: {
          read: true,
          write: true,
          delete: false,
        },
        metadata: {
          loginTime: new Date().toISOString(),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          nested: {
            deep: {
              value: "nested-data",
            },
          },
        },
        preferences: {
          theme: "dark",
          language: "en",
          notifications: true,
        },
      };

      // Encrypt
      const encryptResult = encryptionService.encryptSessionData(complexData);
      expect(encryptResult.success).toBe(true);

      // Decrypt
      const decryptResult = encryptionService.decryptSessionData(
        encryptResult.encryptedData!
      );
      expect(decryptResult.success).toBe(true);
      expect(decryptResult.decryptedData).toEqual(complexData);
    });

    it("should maintain data integrity across multiple encrypt/decrypt cycles", () => {
      const originalData = {
        counter: 0,
        data: "test-data",
        timestamp: Date.now(),
      };

      let currentData = originalData;

      // Multiple encryption/decryption cycles
      for (let i = 0; i < 5; i++) {
        const encrypted = encryptionService.encryptSessionData(currentData);
        expect(encrypted.success).toBe(true);

        const decrypted = encryptionService.decryptSessionData(
          encrypted.encryptedData!
        );
        expect(decrypted.success).toBe(true);

        currentData = decrypted.decryptedData as any;
        currentData.counter = i + 1;
      }

      expect(currentData.data).toBe(originalData.data);
      expect(currentData.timestamp).toBe(originalData.timestamp);
      expect(currentData.counter).toBe(5);
    });
  });
});
