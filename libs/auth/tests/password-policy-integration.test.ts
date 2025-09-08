/**
 * Corrected Integration tests for Password Policy Service and Input Validation
 * Tests the complete flow from input validation to password policy checking
 */

import { PasswordPolicyService } from "../src/services/password-policy-service";
import { ValidationSchemas, safeValidate } from "../src/validation/schemas";
import { AuthConfig, ServiceDependencies } from "../src/types";

// Mock dependencies
const mockDeps: ServiceDependencies = {
  database: {},
  redis: {},
  monitoring: {
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  },
  config: {} as AuthConfig,
};

// Test configuration with password policy enabled
const testConfig: AuthConfig = {
  jwt: {
    secret: "test-secret",
    expiresIn: "1h",
    refreshExpiresIn: "7d",
    issuer: "test",
    audience: "test",
  },
  keycloak: {
    serverUrl: "http://localhost:8080",
    realm: "test",
    clientId: "test",
    clientSecret: "test",
  },
  redis: {
    host: "localhost",
    port: 6379,
    db: 0,
  },
  session: {
    ttl: 3600,
    refreshThreshold: 300,
  },
  apiKey: {
    prefix: "ak_",
    length: 32,
  },
  passwordPolicy: {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    specialChars: "!@#$%^&*()_+-=[]{}|;:,.<>?",
    blacklistedPasswords: ["password", "123456"],
    enableCommonPasswordCheck: true,
    enableCompromisedPasswordCheck: false,
  },
};

describe("Password Policy and Validation Integration - Corrected", () => {
  let passwordPolicyService: PasswordPolicyService;

  beforeEach(() => {
    passwordPolicyService = new PasswordPolicyService(testConfig, mockDeps);
  });

  describe("Input Validation with Zod Schemas", () => {
    it("should validate correct login credentials", () => {
      const credentials = {
        email: "test@example.com",
        password: "ValidPassword123!",
        deviceInfo: {
          name: "TestDevice",
          type: "desktop",
        },
      };

      const result = safeValidate(
        ValidationSchemas.LoginCredentials,
        credentials
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("test@example.com");
        expect(result.data.password).toBe("ValidPassword123!");
      }
    });

    it("should reject invalid email format", () => {
      const credentials = {
        email: "invalid-email",
        password: "ValidPassword123!",
      };

      const result = safeValidate(
        ValidationSchemas.LoginCredentials,
        credentials
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.errors.issues.map((err) => err.message);
        expect(errorMessages).toContain("Invalid email format");
      }
    });

    it("should transform email to lowercase", () => {
      const credentials = {
        email: "TEST@EXAMPLE.COM",
        password: "ValidPassword123!",
      };

      const result = safeValidate(
        ValidationSchemas.LoginCredentials,
        credentials
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("test@example.com");
      }
    });
  });

  describe("Password Policy Validation", () => {
    it("should accept strong password that meets all requirements", async () => {
      const password = "ComplexPassword123!";
      const userContext = { email: "user@example.com", name: "John" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject weak password", async () => {
      const password = "weak";
      const userContext = { email: "test@example.com", name: "Test User" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain(
        "Password must be at least 8 characters long"
      );
    });

    it("should reject password without special characters", async () => {
      const password = "NoSpecialChars123A";
      const userContext = { email: "test@example.com", name: "Test User" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)"
      );
    });

    it("should reject blacklisted passwords", async () => {
      const password = "password";
      const userContext = { email: "test@example.com", name: "Test User" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Password is not allowed by security policy"
      );
    });

    it("should reject password containing personal information", async () => {
      const password = "TestPassword123!";
      const userContext = { email: "test@example.com", name: "Test" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Password should not contain personal information"
      );
    });
  });

  describe("Complete Integration Flow", () => {
    it("should validate input and then apply password policy for valid credentials", async () => {
      const credentials = {
        email: "USER@EXAMPLE.COM",
        password: "ValidPassword123!",
        deviceInfo: {
          name: "TestDevice",
          type: "desktop" as const,
        },
      };

      // Step 1: Input validation with Zod
      const inputValidation = safeValidate(
        ValidationSchemas.LoginCredentials,
        credentials
      );
      expect(inputValidation.success).toBe(true);

      if (inputValidation.success) {
        const validatedCredentials = inputValidation.data;
        expect(validatedCredentials.email).toBe("user@example.com");

        // Step 2: Password policy validation
        const passwordValidation = await passwordPolicyService.validatePassword(
          validatedCredentials.password,
          { email: validatedCredentials.email }
        );

        expect(passwordValidation.isValid).toBe(true);
        expect(passwordValidation.score).toBeGreaterThan(70);
      }
    });

    it("should handle validation without user context", async () => {
      const password = "ValidPassword123!";

      const result = await passwordPolicyService.validatePassword(password);

      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThan(70);
    });
  });

  describe("Edge Cases", () => {
    it("should handle maximum length passwords", async () => {
      const longPassword = "A".repeat(129) + "1!"; // 131 chars total
      const userContext = { email: "test@example.com" };

      const result = await passwordPolicyService.validatePassword(
        longPassword,
        userContext
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Password must be no more than 128 characters long"
      );
    });

    it("should handle empty user context gracefully", async () => {
      const password = "ValidPassword123!";

      const result = await passwordPolicyService.validatePassword(password, {});

      expect(result.isValid).toBe(true);
      expect(typeof result.score).toBe("number");
    });

    it("should handle special characters in passwords", async () => {
      const password = "Complex@Password#123$";
      const userContext = { email: "test@example.com" };

      const result = await passwordPolicyService.validatePassword(
        password,
        userContext
      );

      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThan(70);
    });
  });
});
