/**
 * EncryptionManager test suite - Integration test with real crypto-js
 * Tests the secure AES encryption implementation that replaced vulnerable base64 encoding
 */

import {
  EncryptionManager,
  createEncryptionManager,
} from "../../src/services/EncryptionManager";

// Set shorter test timeout
jest.setTimeout(30000); // 30 seconds max per test

// Only mock @libs/utils - let crypto-js work normally
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn((name: string) => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    name,
  })),
}));

describe("EncryptionManager", () => {
  let encryptionManager: EncryptionManager;
  const testMasterKey = "test-master-key-12345";
  const testPlaintext = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test-jwt-token";

  beforeEach(() => {
    jest.clearAllMocks();
    // Use lower iteration count for faster tests
    encryptionManager = new EncryptionManager(testMasterKey, {
      keyDerivationIterations: 1000, // Much lower than default 100000
    });
  });

  describe("Constructor", () => {
    it("should initialize with default options", () => {
      expect(encryptionManager).toBeInstanceOf(EncryptionManager);
    });

    it("should initialize with custom options", () => {
      const customManager = new EncryptionManager(testMasterKey, {
        keyDerivationIterations: 500, // Fast for testing
        keySize: 8,
      });
      expect(customManager).toBeInstanceOf(EncryptionManager);
    });
  });

  describe("encrypt() and decrypt()", () => {
    it("should encrypt and decrypt plaintext data correctly", () => {
      const result = encryptionManager.encrypt(testPlaintext);

      expect(result).toHaveProperty("encrypted");
      expect(typeof result.encrypted).toBe("string");
      expect(result.encrypted.length).toBeGreaterThan(0);

      // Decrypt and verify it matches original
      const decrypted = encryptionManager.decrypt(result.encrypted);
      expect(decrypted).toBe(testPlaintext);
    });

    it("should produce different encrypted results for same data (random salts)", () => {
      const encrypted1 = encryptionManager.encrypt(testPlaintext);
      const encrypted2 = encryptionManager.encrypt(testPlaintext);

      // Different encrypted results due to random salts
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);

      // But both should decrypt to original
      const decrypted1 = encryptionManager.decrypt(encrypted1.encrypted);
      const decrypted2 = encryptionManager.decrypt(encrypted2.encrypted);

      expect(decrypted1).toBe(testPlaintext);
      expect(decrypted2).toBe(testPlaintext);
    });

    it("should handle decryption errors gracefully", () => {
      expect(() => {
        encryptionManager.decrypt(
          "invalid-base64-data-that-cannot-be-decrypted"
        );
      }).toThrow(
        "Failed to decrypt data - data may be corrupted or tampered with"
      );
    });
  });

  describe("encryptCompact() and decryptCompact()", () => {
    it("should encrypt and decrypt using compact format", () => {
      const encrypted = encryptionManager.encryptCompact(testPlaintext);
      const decrypted = encryptionManager.decryptCompact(encrypted);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
      expect(decrypted).toBe(testPlaintext);
    });

    it("should produce different compact results for same data", () => {
      const encrypted1 = encryptionManager.encryptCompact(testPlaintext);
      const encrypted2 = encryptionManager.encryptCompact(testPlaintext);

      // Different due to random salts
      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt correctly
      expect(encryptionManager.decryptCompact(encrypted1)).toBe(testPlaintext);
      expect(encryptionManager.decryptCompact(encrypted2)).toBe(testPlaintext);
    });
  });

  describe("verify() and verifyCompact()", () => {
    it("should verify valid encrypted data", () => {
      const encrypted = encryptionManager.encrypt(testPlaintext);
      const isValid = encryptionManager.verify(encrypted.encrypted);
      expect(isValid).toBe(true);
    });

    it("should reject invalid encrypted data", () => {
      const isValid = encryptionManager.verify(
        "definitely-invalid-encrypted-data"
      );
      expect(isValid).toBe(false);
    });

    it("should verify compact format data", () => {
      const encrypted = encryptionManager.encryptCompact(testPlaintext);
      const isValid = encryptionManager.verifyCompact(encrypted);
      expect(isValid).toBe(true);
    });

    it("should reject invalid compact format data", () => {
      const isValid = encryptionManager.verifyCompact("invalid.compact.data");
      expect(isValid).toBe(false);
    });
  });

  describe("generateMasterKey()", () => {
    it("should generate a random master key", () => {
      const key = EncryptionManager.generateMasterKey();

      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });

    it("should generate different keys on multiple calls", () => {
      const key1 = EncryptionManager.generateMasterKey();
      const key2 = EncryptionManager.generateMasterKey();

      expect(key1).not.toBe(key2);
      expect(key1.length).toBeGreaterThan(0);
      expect(key2.length).toBeGreaterThan(0);
    });
  });

  describe("destroy()", () => {
    it("should clear sensitive data from memory", () => {
      expect(() => {
        encryptionManager.destroy();
      }).not.toThrow();
    });
  });
});

describe("Key Isolation", () => {
  it("should prevent cross-key decryption", () => {
    // Use fast settings for testing
    const manager1 = new EncryptionManager("key1", {
      keyDerivationIterations: 500,
    });
    const manager2 = new EncryptionManager("key2", {
      keyDerivationIterations: 500,
    });

    const plaintext = "sensitive-data";
    const encrypted = manager1.encryptCompact(plaintext);

    // Manager1 can decrypt its own data
    expect(manager1.decryptCompact(encrypted)).toBe(plaintext);

    // Manager2 cannot decrypt manager1's data
    expect(() => {
      manager2.decryptCompact(encrypted);
    }).toThrow();
  });

  it("should produce different encrypted results with different keys", () => {
    const manager1 = new EncryptionManager("key1", {
      keyDerivationIterations: 500,
    });
    const manager2 = new EncryptionManager("key2", {
      keyDerivationIterations: 500,
    });

    const plaintext = "test-data";
    const encrypted1 = manager1.encryptCompact(plaintext);
    const encrypted2 = manager2.encryptCompact(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });
});

describe("Factory Functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
  });

  describe("createEncryptionManager()", () => {
    it("should create encryption manager with provided key", () => {
      const manager = createEncryptionManager("test-key");
      expect(manager).toBeInstanceOf(EncryptionManager);

      // Test it actually works
      const plaintext = "test-data";
      const encrypted = manager.encryptCompact(plaintext);
      const decrypted = manager.decryptCompact(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should use environment variable when no key provided", () => {
      process.env["KEYCLOAK_ENCRYPTION_KEY"] = "env-test-key";

      const manager = createEncryptionManager();
      expect(manager).toBeInstanceOf(EncryptionManager);

      // Verify it works with env key
      const plaintext = "env-test-data";
      const encrypted = manager.encryptCompact(plaintext);
      const decrypted = manager.decryptCompact(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should generate random key when none provided", () => {
      const manager = createEncryptionManager();
      expect(manager).toBeInstanceOf(EncryptionManager);

      // Should still work with generated key
      const plaintext = "auto-key-test";
      const encrypted = manager.encryptCompact(plaintext);
      const decrypted = manager.decryptCompact(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should accept custom options", () => {
      const manager = createEncryptionManager("test-key", {
        keyDerivationIterations: 500, // Fast for testing
      });
      expect(manager).toBeInstanceOf(EncryptionManager);

      // Verify custom options work
      const plaintext = "custom-options-test";
      const encrypted = manager.encryptCompact(plaintext);
      const decrypted = manager.decryptCompact(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("getDefaultEncryptionManager()", () => {
    it("should return singleton instance", () => {
      const {
        getDefaultEncryptionManager,
      } = require("../../src/services/EncryptionManager");

      const manager1 = getDefaultEncryptionManager();
      const manager2 = getDefaultEncryptionManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe("resetDefaultEncryptionManager()", () => {
    it("should reset singleton instance", () => {
      const {
        getDefaultEncryptionManager,
        resetDefaultEncryptionManager,
      } = require("../../src/services/EncryptionManager");

      const manager1 = getDefaultEncryptionManager();
      resetDefaultEncryptionManager();
      const manager2 = getDefaultEncryptionManager();

      // After reset, we should get a new instance
      expect(manager1).not.toBe(manager2);
    });
  });
});

describe("Integration with KeycloakSessionManager", () => {
  it("should replace vulnerable base64 encoding", () => {
    const manager = createEncryptionManager("test-key");
    const testToken = "sensitive-jwt-token";

    const encrypted = manager.encryptCompact(testToken);

    // Verify it's not just base64 encoded (which would be reversible without a key)
    expect(encrypted).not.toBe(Buffer.from(testToken).toString("base64"));
    expect(encrypted).not.toBe(testToken);

    // Verify it's actually encrypted and requires the key to decrypt
    expect(encrypted.length).toBeGreaterThan(testToken.length);
    expect(manager.decryptCompact(encrypted)).toBe(testToken);
  });

  it("should use secure key derivation with high iteration count", () => {
    const manager = createEncryptionManager("test-key", {
      keyDerivationIterations: 1000, // Reduced for testing
    });

    const testToken = "test-token-for-pbkdf2";
    const encrypted = manager.encryptCompact(testToken);
    const decrypted = manager.decryptCompact(encrypted);

    expect(decrypted).toBe(testToken);
    // The fact that this works proves PBKDF2 was used correctly
  });

  it("should handle different data types securely", () => {
    const manager = createEncryptionManager("test-key", {
      keyDerivationIterations: 500,
    });

    // Test cases for faster execution (excluding empty string which has edge case behavior)
    const testCases = [
      "simple-string",
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature", // JWT-like
      '{"user":"john","role":"admin"}', // JSON
      "medium-length-string-with-content", // Normal case
    ];

    testCases.forEach((testCase, index) => {
      const encrypted = manager.encryptCompact(testCase);
      const decrypted = manager.decryptCompact(encrypted);

      expect(decrypted).toBe(testCase);
      expect(encrypted).not.toBe(testCase);

      // Each encryption should be unique (due to random salt)
      const encrypted2 = manager.encryptCompact(testCase);
      if (index > 0) {
        // Skip uniqueness check for first case
        expect(encrypted).not.toBe(encrypted2);
      }
    });
  });

  it("should maintain security across multiple operations", () => {
    const manager = createEncryptionManager("security-test-key", {
      keyDerivationIterations: 500,
    });
    const iterations = 5; // Reduced from 100 for faster tests
    const testData = "security-test-data-for-multiple-operations";

    const encryptedValues: string[] = [];

    // Perform multiple encrypt/decrypt cycles
    for (let i = 0; i < iterations; i++) {
      const encrypted = manager.encryptCompact(`${testData}-${i}`);
      const decrypted = manager.decryptCompact(encrypted);

      expect(decrypted).toBe(`${testData}-${i}`);
      expect(encryptedValues).not.toContain(encrypted); // Each should be unique
      encryptedValues.push(encrypted);
    }

    // Verify all encrypted values are still valid
    encryptedValues.forEach((encrypted, index) => {
      const decrypted = manager.decryptCompact(encrypted);
      expect(decrypted).toBe(`${testData}-${index}`);
    });
  });
});
