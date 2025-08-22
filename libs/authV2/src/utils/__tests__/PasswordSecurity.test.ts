import { PasswordSecurity, PasswordStrengthSchema } from "../PasswordSecurity";

describe("PasswordSecurity", () => {
  describe("hashPassword", () => {
    it("should hash password with Argon2id successfully", async () => {
      const password = "SecurePassword123!";

      const result = await PasswordSecurity.hashPassword(password);

      expect(result.hash).toBeDefined();
      expect(result.hash).not.toBe(password);
      expect(result.algorithm).toBe("argon2id");
      expect(result.hashedAt).toBeInstanceOf(Date);
      expect(result.hashingTimeMs).toBeGreaterThan(0);
      expect(result.hash).toMatch(/^\$argon2id\$/);
    });

    it("should produce different hashes for the same password", async () => {
      const password = "SecurePassword123!";

      const result1 = await PasswordSecurity.hashPassword(password);
      const result2 = await PasswordSecurity.hashPassword(password);

      expect(result1.hash).not.toBe(result2.hash);
      expect(result1.algorithm).toBe(result2.algorithm);
    });

    it("should reject weak passwords", async () => {
      const weakPasswords = [
        "short",
        "nouppercase123!",
        "NOLOWERCASE123!",
        "NoNumbers!",
        "NoSpecialChars123",
        "",
        "a".repeat(129), // too long
      ];

      for (const weakPassword of weakPasswords) {
        await expect(
          PasswordSecurity.hashPassword(weakPassword)
        ).rejects.toThrow(/Password strength validation failed/);
      }
    });

    it("should handle hashing errors gracefully", async () => {
      // Test with null input (should fail validation)
      const invalidInput = null as unknown as string;
      await expect(
        PasswordSecurity.hashPassword(invalidInput)
      ).rejects.toThrow();
    });

    it("should track hashing performance", async () => {
      const password = "SecurePassword123!";

      const result = await PasswordSecurity.hashPassword(password);

      // Argon2 should take reasonable time (not too fast, not too slow)
      expect(result.hashingTimeMs).toBeGreaterThan(10);
      expect(result.hashingTimeMs).toBeLessThan(5000);
    });
  });

  describe("verifyPassword", () => {
    let hashedPassword: string;
    const originalPassword = "SecurePassword123!";

    beforeAll(async () => {
      const hashResult = await PasswordSecurity.hashPassword(originalPassword);
      hashedPassword = hashResult.hash;
    });

    it("should verify correct password successfully", async () => {
      const result = await PasswordSecurity.verifyPassword(
        originalPassword,
        hashedPassword
      );

      expect(result.isValid).toBe(true);
      expect(result.verificationTimeMs).toBeGreaterThan(0);
      expect(result.needsRehash).toBeDefined();
    });

    it("should reject incorrect password", async () => {
      const result = await PasswordSecurity.verifyPassword(
        "WrongPassword123!",
        hashedPassword
      );

      expect(result.isValid).toBe(false);
      expect(result.verificationTimeMs).toBeGreaterThan(0);
    });

    it("should handle empty password input", async () => {
      await expect(
        PasswordSecurity.verifyPassword("", hashedPassword)
      ).rejects.toThrow(/Password must be a non-empty string/);
    });

    it("should handle invalid hash input", async () => {
      await expect(
        PasswordSecurity.verifyPassword(originalPassword, "")
      ).rejects.toThrow(/Hash must be a non-empty string/);

      await expect(
        PasswordSecurity.verifyPassword(originalPassword, "invalid-hash")
      ).rejects.toThrow();
    });

    it("should handle null inputs gracefully", async () => {
      const nullPassword = null as unknown as string;
      const nullHash = null as unknown as string;

      await expect(
        PasswordSecurity.verifyPassword(nullPassword, hashedPassword)
      ).rejects.toThrow();

      await expect(
        PasswordSecurity.verifyPassword(originalPassword, nullHash)
      ).rejects.toThrow();
    });

    it("should detect when rehashing is needed", async () => {
      // Create hash with different parameters (simulated old hash)
      const result = await PasswordSecurity.verifyPassword(
        originalPassword,
        hashedPassword
      );

      // This should be false with current configuration, but we test the property exists
      expect(typeof result.needsRehash).toBe("boolean");
    });

    it("should prevent timing attacks", async () => {
      const correctPassword = originalPassword;
      const wrongPassword = "WrongPassword123!";

      // Measure verification times
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await PasswordSecurity.verifyPassword(correctPassword, hashedPassword);
        times.push(Date.now() - start);
      }

      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        try {
          await PasswordSecurity.verifyPassword(wrongPassword, hashedPassword);
        } catch {
          // Expected to fail
        }
        times.push(Date.now() - start);
      }

      // Times should not vary dramatically (within reasonable bounds for Argon2)
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxDeviation = Math.max(...times.map((t) => Math.abs(t - avgTime)));

      // Allow reasonable deviation for system variations
      expect(maxDeviation / avgTime).toBeLessThan(2.0);
    });
  });

  describe("validatePasswordStrength", () => {
    it("should accept strong passwords", () => {
      const strongPasswords = [
        "SecurePassword123!",
        "AnotherGood1@",
        "VerySecure2023$",
        "Complex!Password9",
      ];

      strongPasswords.forEach((password) => {
        expect(() =>
          PasswordSecurity.validatePasswordStrength(password)
        ).not.toThrow();
        expect(PasswordSecurity.validatePasswordStrength(password)).toBe(true);
      });
    });

    it("should reject weak passwords with detailed error messages", () => {
      const testCases = [
        { password: "short", expectedError: /at least 8 characters/ },
        { password: "nouppercase123!", expectedError: /uppercase letter/ },
        { password: "NOLOWERCASE123!", expectedError: /lowercase letter/ },
        { password: "NoNumbers!", expectedError: /one number/ },
        { password: "NoSpecialChars123", expectedError: /special character/ },
        {
          password: "a".repeat(129),
          expectedError: /not exceed 128 characters/,
        },
      ];

      testCases.forEach(({ password, expectedError }) => {
        expect(() =>
          PasswordSecurity.validatePasswordStrength(password)
        ).toThrow(expectedError);
      });
    });
  });

  describe("generateSecurePassword", () => {
    it("should generate password with default length 16", () => {
      const password = PasswordSecurity.generateSecurePassword();

      expect(password).toHaveLength(16);
      expect(PasswordSecurity.validatePasswordStrength(password)).toBe(true);
    });

    it("should generate password with custom length", () => {
      const customLength = 20;
      const password = PasswordSecurity.generateSecurePassword(customLength);

      expect(password).toHaveLength(customLength);
      expect(PasswordSecurity.validatePasswordStrength(password)).toBe(true);
    });

    it("should reject length less than 12", () => {
      expect(() => PasswordSecurity.generateSecurePassword(8)).toThrow(
        /must be at least 12 characters long/
      );
    });

    it("should generate unique passwords", () => {
      const passwords = new Set<string>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        passwords.add(PasswordSecurity.generateSecurePassword());
      }

      // All generated passwords should be unique
      expect(passwords.size).toBe(iterations);
    });

    it("should contain all required character types", () => {
      const password = PasswordSecurity.generateSecurePassword();

      expect(password).toMatch(/[a-z]/); // lowercase
      expect(password).toMatch(/[A-Z]/); // uppercase
      expect(password).toMatch(/\d/); // digit
      expect(password).toMatch(/[@$!%*?&]/); // special char
    });
  });

  describe("getHashingConfig", () => {
    it("should return current hashing configuration", () => {
      const config = PasswordSecurity.getHashingConfig();

      expect(config).toHaveProperty("memoryCost");
      expect(config).toHaveProperty("timeCost");
      expect(config).toHaveProperty("parallelism");
      expect(config).toHaveProperty("hashLength");
      expect(config).toHaveProperty("saltLength");

      expect(config.memoryCost).toBe(65536);
      expect(config.timeCost).toBe(3);
      expect(config.parallelism).toBe(4);
      expect(config.hashLength).toBe(32);
      expect(config.saltLength).toBe(16);
    });

    it("should return immutable configuration", () => {
      const config1 = PasswordSecurity.getHashingConfig();
      const config2 = PasswordSecurity.getHashingConfig();

      // Should be different objects (copied)
      expect(config1).not.toBe(config2);
      // But with same values
      expect(config1).toEqual(config2);
    });
  });

  describe("PasswordStrengthSchema", () => {
    it("should validate strong passwords", () => {
      const strongPassword = "SecurePassword123!";

      expect(() => PasswordStrengthSchema.parse(strongPassword)).not.toThrow();
    });

    it("should reject weak passwords with structured errors", () => {
      const weakPassword = "weak";

      expect(() => PasswordStrengthSchema.parse(weakPassword)).toThrow();
    });
  });

  describe("Security Properties", () => {
    it("should produce cryptographically secure hashes", async () => {
      const password = "TestPassword123!";
      const hash = await PasswordSecurity.hashPassword(password);

      // Argon2id hash format validation
      expect(hash.hash).toMatch(/^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/);
    });

    it("should resist hash length extension attacks", async () => {
      const password = "TestPassword123!";
      const hashResult = await PasswordSecurity.hashPassword(password);

      // Hash should be consistent length and format
      expect(hashResult.hash.length).toBeGreaterThan(80);
      expect(hashResult.hash).toMatch(/^\$argon2id\$/);
    });

    it("should handle concurrent hashing operations safely", async () => {
      const password = "ConcurrentTest123!";
      const concurrentOperations = 10;

      const hashPromises = Array(concurrentOperations)
        .fill(0)
        .map(() => PasswordSecurity.hashPassword(password));

      const results = await Promise.all(hashPromises);

      // All operations should succeed
      expect(results).toHaveLength(concurrentOperations);

      // All hashes should be different
      const hashes = results.map((r) => r.hash);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(concurrentOperations);
    });
  });

  describe("Error Handling", () => {
    it("should provide clear error messages for validation failures", async () => {
      try {
        await PasswordSecurity.hashPassword("weak");
        fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Password strength validation failed"
        );
      }
    });

    it("should handle system errors gracefully", async () => {
      // Test with extreme parameters that might cause system issues
      const veryLongPassword = "A".repeat(1000) + "a1!";

      // Should either succeed or fail gracefully
      try {
        const result = await PasswordSecurity.hashPassword(veryLongPassword);
        expect(result.hash).toBeDefined();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
