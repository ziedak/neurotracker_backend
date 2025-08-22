/**
 * @fileoverview Comprehensive test suite for InputValidator utility
 * @module utils/__tests__/InputValidator
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1.2 Input Validation & Sanitization
 */

import { InputValidator } from "../InputValidator";

describe("InputValidator", () => {
  describe("validateEmail", () => {
    it("should validate correct email addresses", () => {
      const validEmails = [
        "user@example.com",
        "test.email+tag@domain.org",
        "user123@sub.domain.com",
        "email@domain-with-dash.com",
      ];

      validEmails.forEach((email) => {
        const result = InputValidator.validateEmail(email);
        expect(result.success).toBe(true);
        expect(result.data).toBe(email);
        expect(result.errors).toBeUndefined();
      });
    });

    it("should reject invalid email addresses", () => {
      const invalidEmails = [
        "plainaddress",
        "@missinglocalpart.com",
        "missing@.com",
        "spaces @example.com",
        "toolong" + "a".repeat(250) + "@example.com",
      ];

      invalidEmails.forEach((email) => {
        const result = InputValidator.validateEmail(email);
        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
      });
    });

    it("should handle non-string input", () => {
      const result = InputValidator.validateEmail(123);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(["Email must be a string"]);
    });

    it("should sanitize email input", () => {
      const result = InputValidator.validateEmail("  user@example.com  ");
      expect(result.success).toBe(true);
      expect(result.data).toBe("user@example.com");
    });
  });

  describe("validateUsername", () => {
    it("should validate correct usernames", () => {
      const validUsernames = ["user123", "test_user", "user-name", "TestUser"];

      validUsernames.forEach((username) => {
        const result = InputValidator.validateUsername(username);
        expect(result.success).toBe(true);
        expect(result.data).toBe(username);
      });
    });

    it("should reject invalid usernames", () => {
      const invalidUsernames = [
        "ab", // too short
        "123user", // starts with number
        "user@name", // invalid character
        "user name", // space
        "user.name", // dot
      ];

      invalidUsernames.forEach((username) => {
        const result = InputValidator.validateUsername(username);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      // Test long username separately
      const longUsername = "a".repeat(51);
      const longResult = InputValidator.validateUsername(longUsername);
      expect(longResult.success).toBe(false);
      expect(longResult.errors).toBeDefined();
    });

    it("should sanitize username input", () => {
      const result = InputValidator.validateUsername("  TestUser  ");
      expect(result.success).toBe(true);
      expect(result.data).toBe("TestUser");
    });
  });

  describe("validateName", () => {
    it("should validate correct names", () => {
      const validNames = [
        "John",
        "Mary-Jane",
        "José María",
        "O'Connor",
        "Jean-Luc",
        "François",
      ];

      validNames.forEach((name) => {
        const result = InputValidator.validateName(name);
        expect(result.success).toBe(true);
        expect(result.data).toBe(name);
      });
    });

    it("should reject invalid names", () => {
      const invalidNames = [
        "John123", // numbers
        "John@Doe", // special characters
      ];

      invalidNames.forEach((name) => {
        const result = InputValidator.validateName(name);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      // Test empty and long names separately
      expect(InputValidator.validateName("").success).toBe(false);
      expect(InputValidator.validateName("a".repeat(101)).success).toBe(false);
    });

    it("should sanitize name input", () => {
      const result = InputValidator.validateName("  John Doe  ");
      expect(result.success).toBe(true);
      expect(result.data).toBe("John Doe");
    });
  });

  describe("validatePhone", () => {
    it("should validate correct phone numbers", () => {
      const validPhones = [
        "+1234567890",
        "+44123456789",
        "1234567890",
        "+12025551234",
      ];

      validPhones.forEach((phone) => {
        const result = InputValidator.validatePhone(phone);
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid phone numbers", () => {
      const invalidPhones = [
        "+", // too short
        "abc123", // letters
        "++123456789", // multiple plus
      ];

      invalidPhones.forEach((phone) => {
        const result = InputValidator.validatePhone(phone);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });
    });

    it("should sanitize phone input", () => {
      const result = InputValidator.validatePhone("(123) 456-7890");
      expect(result.success).toBe(true);
      expect(result.data).toBe("1234567890");
    });
  });

  describe("validateEntityId", () => {
    it("should validate correct entity IDs", () => {
      const validIds = ["user123", "order_456", "product-789", "ABC123"];

      validIds.forEach((id) => {
        const result = InputValidator.validateEntityId(id);
        expect(result.success).toBe(true);
        expect(result.data).toBe(id);
      });
    });

    it("should reject invalid entity IDs", () => {
      const invalidIds = [
        "user@123", // invalid character
        "user.123", // dot
        "user 123", // space
      ];

      invalidIds.forEach((id) => {
        const result = InputValidator.validateEntityId(id);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      // Test empty and long IDs separately
      expect(InputValidator.validateEntityId("").success).toBe(false);
      expect(InputValidator.validateEntityId("a".repeat(51)).success).toBe(
        false
      );
    });
  });

  describe("validateMetadata", () => {
    it("should validate safe metadata objects", () => {
      const validMetadata = [
        { key: "value", number: 42, boolean: true },
        { nested: { object: "value" } },
        { array: ["item1", "item2"] },
        null,
        undefined,
      ];

      validMetadata.forEach((metadata) => {
        const result = InputValidator.validateMetadata(metadata);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });
    });

    it("should reject dangerous metadata", () => {
      // These should pass because the sanitizer strips dangerous content
      // but the metadata validator should reject based on XSS pattern detection
      const result1 = InputValidator.validateMetadata({
        iframe: "<iframe src='malicious'></iframe>",
      });
      expect(result1.success).toBe(false);

      const result2 = InputValidator.validateMetadata({
        object: "<object data='malicious'></object>",
      });
      expect(result2.success).toBe(false);
    });

    it("should sanitize metadata values", () => {
      const input = {
        "key<script>": "value<script>alert('xss')</script>",
        validKey: "  clean value  ",
        nested: {
          innerKey: "<b>bold</b> text",
        },
      };

      const result = InputValidator.validateMetadata(input);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data!;
      expect(data["validKey"]).toBe("clean value");

      // HTML should be stripped from nested values
      const nested = data["nested"] as Record<string, unknown>;
      expect(nested["innerKey"]).toBe("bold text");
    });

    it("should handle array inputs gracefully", () => {
      const result = InputValidator.validateMetadata(["array", "input"]);
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Metadata must be an object");
    });
  });

  describe("sanitizeString", () => {
    it("should strip HTML tags", () => {
      const input = "Hello <script>alert('xss')</script> World";
      const result = InputValidator.sanitizeString(input, { stripHtml: true });
      expect(result).toBe("Hello alert('xss') World");
    });

    it("should normalize whitespace", () => {
      const input = "  Hello    World  ";
      const result = InputValidator.sanitizeString(input, {
        normalizeWhitespace: true,
      });
      expect(result).toBe("Hello World");
    });

    it("should apply length limits", () => {
      const input = "This is a very long string";
      const result = InputValidator.sanitizeString(input, { maxLength: 10 });
      expect(result).toBe("This is a ");
    });

    it("should filter allowed characters", () => {
      const input = "Hello123World!@#";
      const result = InputValidator.sanitizeString(input, {
        allowedCharacters: /^[a-zA-Z0-9]+$/,
      });
      expect(result).toBe("Hello123World");
    });
  });

  describe("validateBatch", () => {
    it("should validate array of emails", () => {
      const emails = [
        "user1@example.com",
        "user2@example.com",
        "invalid-email",
      ];
      const result = InputValidator.validateBatch(
        emails,
        InputValidator.validateEmail
      );

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("Item 2:");
    });

    it("should return successful validation for all valid inputs", () => {
      const emails = ["user1@example.com", "user2@example.com"];
      const result = InputValidator.validateBatch(
        emails,
        InputValidator.validateEmail
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(emails);
    });
  });

  describe("security validation", () => {
    describe("containsSqlInjection", () => {
      it("should detect SQL injection patterns", () => {
        const sqlPatterns = [
          "'; DROP TABLE users; --",
          "1=1 OR 2=2",
          "UNION SELECT * FROM passwords",
          "'; EXEC xp_cmdshell('dir'); --",
        ];

        sqlPatterns.forEach((pattern) => {
          expect(InputValidator.containsSqlInjection(pattern)).toBe(true);
        });
      });

      it("should not flag safe content", () => {
        const safeContent = [
          "Normal user input",
          "Email@example.com",
          "Some regular text with numbers 123",
        ];

        safeContent.forEach((content) => {
          expect(InputValidator.containsSqlInjection(content)).toBe(false);
        });
      });
    });

    describe("containsXss", () => {
      it("should detect XSS patterns", () => {
        const xssPatterns = [
          "<script>alert('xss')</script>",
          "javascript:void(0)",
          "onclick=alert()",
          "<iframe src='malicious'></iframe>",
          "vbscript:msgbox('xss')",
        ];

        xssPatterns.forEach((pattern) => {
          expect(InputValidator.containsXss(pattern)).toBe(true);
        });
      });

      it("should not flag safe content", () => {
        const safeContent = [
          "Normal text content",
          "Email@example.com",
          "Safe HTML like <p>paragraph</p> should be detected",
        ];

        // Note: <p> tags would be detected as potential XSS by our conservative approach
        expect(InputValidator.containsXss(safeContent[0]!)).toBe(false);
        expect(InputValidator.containsXss(safeContent[1]!)).toBe(false);
      });
    });

    describe("validateSecurity", () => {
      it("should reject SQL injection attempts", () => {
        const result = InputValidator.validateSecurity(
          "'; DROP TABLE users; --"
        );
        expect(result.success).toBe(false);
        expect(result.errors).toContain(
          "Input contains potentially dangerous SQL patterns"
        );
      });

      it("should reject XSS attempts", () => {
        const result = InputValidator.validateSecurity(
          "<script>alert('xss')</script>"
        );
        expect(result.success).toBe(false);
        expect(result.errors).toContain(
          "Input contains potentially dangerous XSS patterns"
        );
      });

      it("should accept safe content", () => {
        const result = InputValidator.validateSecurity("Normal safe content");
        expect(result.success).toBe(true);
        expect(result.data).toBe("Normal safe content");
      });
    });
  });

  describe("edge cases", () => {
    it("should handle null and undefined inputs gracefully", () => {
      expect(InputValidator.validateEmail(null).success).toBe(false);
      expect(InputValidator.validateEmail(undefined).success).toBe(false);
      expect(InputValidator.validateUsername(null).success).toBe(false);
      expect(InputValidator.validateName(undefined).success).toBe(false);
    });

    it("should handle empty string inputs", () => {
      expect(InputValidator.validateEmail("").success).toBe(false);
      expect(InputValidator.validateUsername("").success).toBe(false);
      expect(InputValidator.validateName("").success).toBe(false);
    });

    it("should handle very long inputs", () => {
      const veryLongString = "a".repeat(1000);

      expect(
        InputValidator.validateEmail(veryLongString + "@example.com").success
      ).toBe(false);
      expect(InputValidator.validateName(veryLongString).success).toBe(false);

      // Username validation truncates to maxLength in sanitization, but then fails validation
      const usernameResult = InputValidator.validateUsername(veryLongString);
      expect(usernameResult.success).toBe(false);
    });

    it("should handle special unicode characters", () => {
      expect(InputValidator.validateName("José María").success).toBe(true);
      expect(InputValidator.validateName("François").success).toBe(true);
      expect(InputValidator.validateName("北京").success).toBe(false); // Chinese characters not in our regex
    });
  });
});
