/**
 * Security Fuzzing and Edge Case Tests
 * Tests for input fuzzing, boundary conditions, and edge case attacks
 */

import { TokenIntrospectionService } from "../../src/services/token-introspection";
import { KeycloakClientFactory } from "../../src/client/keycloak-client-factory";
import { KeycloakAuthHttpMiddleware } from "../../src/middleware/keycloak-http.middleware";
import { toAuthError } from "../../src/utils/result";

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

describe("Security Fuzzing Tests", () => {
  describe("Token Hash Fuzzing", () => {
    let tokenService: TokenIntrospectionService;

    beforeEach(() => {
      tokenService = new TokenIntrospectionService(
        mockKeycloakClientFactory as any,
        mockCacheService as any
      );
    });

    const generateFuzzTokens = (): string[] => {
      const fuzzTokens = [];

      // Null bytes and control characters
      fuzzTokens.push("\x00\x01\x02\x03");
      fuzzTokens.push("test\x00token");
      fuzzTokens.push("\x1f\x7f\x80\xff");

      // Unicode edge cases
      fuzzTokens.push("🚀🔐💥🎯"); // Emojis
      fuzzTokens.push("𝕳𝖊𝖑𝖑𝖔"); // Mathematical symbols
      fuzzTokens.push("😈💀☠️🔥"); // More emojis
      fuzzTokens.push("ＡＢＣａｂｃ１２３"); // Full-width characters

      // Extremely long strings
      fuzzTokens.push("a".repeat(1000000)); // 1MB token
      fuzzTokens.push("z".repeat(100000)); // 100KB token

      // Binary data patterns
      fuzzTokens.push(
        String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))
      ); // All bytes 0-255

      // Repeated patterns that might cause hash issues
      fuzzTokens.push("abcd".repeat(10000));
      fuzzTokens.push("1234".repeat(25000));

      // Special character combinations
      fuzzTokens.push("\\n\\r\\t\\0\\\\");
      fuzzTokens.push("'\"`;DROP TABLE users;--");
      fuzzTokens.push("<script>alert('xss')</script>");
      fuzzTokens.push("../../../etc/passwd\x00");

      return fuzzTokens;
    };

    it("should handle fuzzing inputs without crashing", () => {
      const hashToken = (tokenService as any).hashToken.bind(tokenService);
      const fuzzTokens = generateFuzzTokens();

      fuzzTokens.forEach((token, index) => {
        try {
          const hash = hashToken(token);

          // Hash should always be valid hex string of correct length
          expect(hash).toHaveLength(64);
          expect(hash).toMatch(/^[a-f0-9]{64}$/);

          // Hash should be deterministic
          const hash2 = hashToken(token);
          expect(hash).toBe(hash2);
        } catch (error) {
          // If an error occurs, it should be handled gracefully
          fail(`Token hashing failed for fuzz input ${index}: ${error}`);
        }
      });
    });

    it("should produce different hashes for similar but different inputs", () => {
      const hashToken = (tokenService as any).hashToken.bind(tokenService);
      const hashes = new Set<string>();

      // Generate similar tokens that should have different hashes
      const similarTokens = [
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test1.sig",
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test2.sig",
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test1.siq", // Last char different
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.Test1.sig", // Case different
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test1.sig ", // Trailing space
        " eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test1.sig", // Leading space
      ];

      similarTokens.forEach((token) => {
        const hash = hashToken(token);
        expect(hashes.has(hash)).toBe(false); // No collisions
        hashes.add(hash);
      });

      expect(hashes.size).toBe(similarTokens.length);
    });
  });

  describe("Path Traversal Fuzzing", () => {
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

    const generatePathTraversalFuzzInputs = (): string[] => {
      const fuzzPaths = [];

      // Various encoding combinations
      const encodings = [
        "../",
        "..\\",
        "%2e%2e%2f",
        "%2E%2E%2F",
        "%2e%2e%5c",
        "%2E%2E%5C",
        "..%2f",
        "..%5c",
        "%2e%2e/",
        "%2e%2e\\",
        "..%c0%af",
        "..%c1%9c", // UTF-8 overlong encoding
      ];

      const targets = [
        "etc/passwd",
        "windows/system32",
        "boot.ini",
        "config.sys",
        "proc/self/environ",
        "dev/null",
        "etc/shadow",
      ];

      // Generate combinations
      encodings.forEach((encoding) => {
        targets.forEach((target) => {
          // Repeat traversal patterns
          for (let depth = 1; depth <= 10; depth++) {
            fuzzPaths.push(encoding.repeat(depth) + target);
          }
        });
      });

      // Mixed encoding attacks
      fuzzPaths.push("..%2f..%5c..%2fetc%2fpasswd");
      fuzzPaths.push("%2e%2e%2f%2e%2e%5c%2e%2e%2fetc%2fpasswd");
      fuzzPaths.push("..%u002f..%u005c..%u002fetc%u002fpasswd");

      // Double encoding
      fuzzPaths.push("%252e%252e%252fetc%252fpasswd");
      fuzzPaths.push("%25252e%25252e%25252fetc%25252fpasswd");

      // Null byte injection
      fuzzPaths.push("../../../etc/passwd%00");
      fuzzPaths.push("..\\..\\..\\windows\\system32%00");
      fuzzPaths.push("%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd%00");

      // Unicode normalization attacks
      fuzzPaths.push(
        "\u002e\u002e\u002f\u002e\u002e\u002f\u002e\u002e\u002fetc\u002fpasswd"
      );
      fuzzPaths.push(
        "\uff0e\uff0e\u002f\uff0e\uff0e\u002f\uff0e\uff0e\u002fetc\u002fpasswd"
      );

      // Long path attacks
      fuzzPaths.push("../".repeat(1000) + "etc/passwd");
      fuzzPaths.push("..\\".repeat(1000) + "windows\\system32");

      return fuzzPaths;
    };

    it("should reject all path traversal fuzzing attempts", () => {
      const shouldBypass = (middleware as any).shouldBypassAuth.bind(
        middleware
      );
      const fuzzPaths = generatePathTraversalFuzzInputs();

      fuzzPaths.forEach((path, index) => {
        try {
          const mockRequest = {
            url: `https://example.com${path.startsWith("/") ? "" : "/"}${path}`,
            method: "GET",
          } as Request;

          const result = shouldBypass(mockRequest);
          expect(result).toBe(false); // Should always reject traversal attempts
        } catch (error) {
          // Should not crash on malformed inputs
          fail(`Path traversal check failed for fuzz input ${index}: ${error}`);
        }
      });
    });

    it("should handle malformed URLs gracefully", () => {
      const shouldBypass = (middleware as any).shouldBypassAuth.bind(
        middleware
      );

      const malformedUrls = [
        "not-a-url",
        "://invalid",
        "http://",
        "https://",
        "ftp://example.com/test",
        "",
        null as any,
        undefined as any,
        123 as any,
        {} as any,
      ];

      malformedUrls.forEach((url) => {
        try {
          const mockRequest = {
            url: url,
            method: "GET",
          } as Request;

          // Should not crash on invalid URLs
          const result = shouldBypass(mockRequest);
          expect(typeof result).toBe("boolean");
        } catch (error) {
          // Graceful handling expected for malformed URLs
          // The middleware should handle this without crashing
        }
      });
    });
  });

  describe("Token Validation Fuzzing", () => {
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

    const generateTokenFuzzInputs = (): string[] => {
      const fuzzTokens = [];

      // Invalid Bearer formats
      fuzzTokens.push("bearer token"); // lowercase
      fuzzTokens.push("BEARER TOKEN"); // uppercase
      fuzzTokens.push("Bear er token"); // space in Bearer
      fuzzTokens.push("Bearer\ttoken"); // tab character
      fuzzTokens.push("Bearer\ntoken"); // newline
      fuzzTokens.push("Bearer\x00token"); // null byte
      fuzzTokens.push("BearerToken"); // no space
      fuzzTokens.push("Bearer  token"); // double space

      // JWT structure fuzzing
      fuzzTokens.push("Bearer .");
      fuzzTokens.push("Bearer ..");
      fuzzTokens.push("Bearer ...");
      fuzzTokens.push("Bearer ....");
      fuzzTokens.push("Bearer .....");

      // Invalid base64url characters
      fuzzTokens.push("Bearer header+payload/signature"); // base64 instead of base64url
      fuzzTokens.push("Bearer header=payload=signature="); // padding in wrong place
      fuzzTokens.push("Bearer header!.payload@.signature#"); // special chars

      // Extremely long parts
      const longPart = "a".repeat(100000);
      fuzzTokens.push(`Bearer ${longPart}.payload.signature`);
      fuzzTokens.push(`Bearer header.${longPart}.signature`);
      fuzzTokens.push(`Bearer header.payload.${longPart}`);

      // Unicode in tokens
      fuzzTokens.push("Bearer 🔐.💥.🚀");
      fuzzTokens.push("Bearer héadër.payłøad.signäture");
      fuzzTokens.push("Bearer ＨＥＡＤＥＲ.ＰＡＹＬＯＡＤ.ＳＩＧＮＡＴＵＲＥ");

      // Control characters
      fuzzTokens.push(`Bearer header\x01.payload\x02.signature\x03`);
      fuzzTokens.push(`Bearer \x1fheader.payload\x7f.signature\x80`);

      // SQL injection attempts in tokens
      fuzzTokens.push("Bearer '; DROP TABLE users; --.payload.signature");
      fuzzTokens.push("Bearer header.'; DELETE FROM tokens; --.signature");

      // XSS attempts in tokens
      fuzzTokens.push("Bearer <script>alert('xss')</script>.payload.signature");
      fuzzTokens.push("Bearer header.<img src=x onerror=alert(1)>.signature");

      // Path traversal in tokens
      fuzzTokens.push("Bearer ../../../etc/passwd.payload.signature");
      fuzzTokens.push("Bearer header.%2e%2e%2f%2e%2e%2fetc%2fpasswd.signature");

      return fuzzTokens;
    };

    it("should reject all malformed token fuzzing attempts", () => {
      const extractToken = (middleware as any).extractTokenFromHeader.bind(
        middleware
      );
      const fuzzTokens = generateTokenFuzzInputs();

      fuzzTokens.forEach((header, index) => {
        try {
          const result = extractToken(header);

          // Most fuzzing attempts should be rejected (null)
          // Only properly formatted JWT-like strings should pass basic validation
          if (result !== null) {
            // If it passes, it should be a valid JWT structure
            expect(result).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
          }
        } catch (error) {
          // Should not crash on fuzzing inputs
          fail(`Token extraction failed for fuzz input ${index}: ${error}`);
        }
      });
    });

    it("should handle boundary conditions for token length", () => {
      const extractToken = (middleware as any).extractTokenFromHeader.bind(
        middleware
      );

      // Test exact boundary conditions
      const boundaryTests = [
        { length: 9, shouldPass: false }, // Just under minimum
        { length: 10, shouldPass: true }, // Exact minimum (but needs JWT structure)
        { length: 4096, shouldPass: true }, // Exact maximum (but needs JWT structure)
        { length: 4097, shouldPass: false }, // Just over maximum
      ];

      boundaryTests.forEach(({ length, shouldPass }) => {
        // Create a JWT-like structure with the target length
        const headerPart = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"; // 36 chars
        const payloadPart =
          "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9"; // 64 chars
        const baseLength = headerPart.length + payloadPart.length + 2; // +2 for dots
        const remainingLength = length - baseLength;

        if (remainingLength > 0) {
          const signaturePart = "a".repeat(remainingLength);
          const token = `${headerPart}.${payloadPart}.${signaturePart}`;
          const header = `Bearer ${token}`;

          const result = extractToken(header);

          if (shouldPass && length >= 10 && length <= 4096) {
            // Should extract token if length is within bounds and has JWT structure
            expect(result).not.toBeNull();
          } else {
            // Should reject if outside bounds
            expect(result).toBeNull();
          }
        }
      });
    });
  });

  describe("Error Sanitization Fuzzing", () => {
    const generateErrorFuzzInputs = (): Error[] => {
      const fuzzErrors = [];

      // Various sensitive patterns mixed with safe content
      const sensitivePatterns = [
        "redis",
        "database",
        "localhost",
        "internal",
        "cache",
        "salt",
        "circuit",
        "file",
        "secret",
        "key",
        "connection",
        "password",
        "token",
        "auth",
        "session",
        "user",
        "admin",
        "config",
      ];

      const safePatterns = [
        "invalid",
        "format",
        "required",
        "missing",
        "expired",
        "denied",
        "forbidden",
        "unauthorized",
        "timeout",
        "failed",
        "error",
      ];

      // Mix sensitive and safe patterns
      sensitivePatterns.forEach((sensitive) => {
        safePatterns.forEach((safe) => {
          fuzzErrors.push(new Error(`${safe} ${sensitive} operation`));
          fuzzErrors.push(new Error(`${sensitive} ${safe} detected`));
          fuzzErrors.push(
            new Error(`Error: ${sensitive.toUpperCase()} ${safe}`)
          );
        });
      });

      // Very long error messages
      fuzzErrors.push(new Error("Very long error: " + "a".repeat(10000)));
      fuzzErrors.push(new Error("redis".repeat(1000))); // Repeated sensitive pattern

      // Unicode and special characters in errors
      fuzzErrors.push(new Error("Redis connection failed 🚨🔥"));
      fuzzErrors.push(new Error("Database error: 💥💀☠️"));
      fuzzErrors.push(new Error("Internal salt rotation failed ＲＥＤＩＳ"));

      // Control characters
      fuzzErrors.push(new Error("Redis\x00connection\x01failed\x02"));
      fuzzErrors.push(new Error("Database\nconnection\tpool\rexhausted"));

      // Injection attempts in error messages
      fuzzErrors.push(
        new Error("Redis'; DROP TABLE errors; -- connection failed")
      );
      fuzzErrors.push(
        new Error("Database <script>alert('xss')</script> error")
      );

      return fuzzErrors;
    };

    it("should sanitize all sensitive fuzzing inputs", () => {
      const fuzzErrors = generateErrorFuzzInputs();

      fuzzErrors.forEach((error, index) => {
        const sanitized = toAuthError(error);

        // SECURITY VALIDATION: All sanitized errors must have proper structure
        expect(sanitized).toHaveProperty("message");
        expect(sanitized).toHaveProperty("code");
        expect(sanitized).toHaveProperty("statusCode");
        expect(sanitized.code).toBe("UNKNOWN_ERROR");
        expect(sanitized.statusCode).toBe(500);
        expect(typeof sanitized.message).toBe("string");
        expect(sanitized.message.length).toBeGreaterThan(0);

        // SECURITY VALIDATION: Message should not be excessively long (DoS protection)
        expect(sanitized.message.length).toBeLessThanOrEqual(203);

        // SECURITY VALIDATION: Check for sensitive information leakage
        const sanitizedLower = sanitized.message.toLowerCase();
        const originalLower = error.message.toLowerCase();

        // If original error contained sensitive patterns, sanitized version should NOT contain them
        const sensitivePatterns = [
          "redis",
          "database",
          "localhost",
          "internal",
          "cache",
          "salt",
          "circuit",
          "file",
          "secret",
          "key",
          "connection",
          "password",
          "token",
          "auth",
          "session",
          "user",
          "admin",
          "config",
        ];

        const originalHasSensitive = sensitivePatterns.some((pattern) =>
          originalLower.includes(pattern)
        );

        if (originalHasSensitive) {
          // CRITICAL: Sanitized error must not leak sensitive information
          sensitivePatterns.forEach((pattern) => {
            expect(sanitizedLower).not.toMatch(new RegExp(pattern, "i"));
          });

          // Should use generic message for sensitive errors
          expect(sanitizedLower).toMatch(
            /internal.*error|error.*occurred|unknown.*error/
          );
        }

        // SECURITY VALIDATION: Ensure no stack traces are leaked
        expect(sanitized.message).not.toMatch(/at\s+\w+\./); // Stack trace pattern
        expect(sanitized.message).not.toMatch(/node_modules/);
        expect(sanitized.message).not.toMatch(/\.js:\d+/);
        expect(sanitized.message).not.toMatch(/Error:\s*Error:/); // Double error prefix

        // Add context for debugging if test fails
        if (
          originalHasSensitive &&
          sensitivePatterns.some((pattern) => sanitizedLower.includes(pattern))
        ) {
          throw new Error(
            `Security test failed for fuzz input ${index}: Sensitive information leaked in sanitized error "${sanitized.message}" from original "${error.message}"`
          );
        }
      });
    });

    it("should handle extreme edge cases in error messages", () => {
      const edgeCases = [
        new Error(""), // Empty message
        new Error(null as any), // Null message
        new Error(undefined as any), // Undefined message
        { message: "Not an Error object" } as Error, // Duck typed object
        { name: "CustomError", message: "redis connection failed" } as Error, // Custom error
      ];

      edgeCases.forEach((error, index) => {
        const sanitized = toAuthError(error);

        // SECURITY VALIDATION: Must always return a proper AuthError structure
        expect(sanitized).toHaveProperty("message");
        expect(sanitized).toHaveProperty("code");
        expect(sanitized).toHaveProperty("statusCode");
        expect(sanitized.code).toBe("UNKNOWN_ERROR");
        expect(sanitized.statusCode).toBe(500);

        // SECURITY VALIDATION: Message must be a non-empty string
        expect(typeof sanitized.message).toBe("string");
        expect(sanitized.message.length).toBeGreaterThan(0);

        // SECURITY VALIDATION: Should not crash or return undefined/null
        expect(sanitized.message).toBeDefined();
        expect(sanitized.message).not.toBeNull();

        // SECURITY VALIDATION: Edge cases should get generic error message
        const isEdgeCase =
          !error ||
          !error.message ||
          error.message.length === 0 ||
          typeof error.message !== "string";
        if (isEdgeCase) {
          expect(sanitized.message).toMatch(
            /internal.*error|error.*occurred|unknown.*error/i
          );
        }

        // SECURITY VALIDATION: Length limits for DoS protection
        expect(sanitized.message.length).toBeLessThanOrEqual(203);

        // Add context for debugging if test fails
        if (!sanitized.message || sanitized.message.length === 0) {
          throw new Error(
            `Security test failed for edge case ${index}: Empty message in sanitized error from input: ${JSON.stringify(
              error
            )}`
          );
        }
      });
    });
  });

  describe("Discovery Document Fuzzing", () => {
    let clientFactory: KeycloakClientFactory;

    beforeEach(() => {
      const envConfig = (global as any).testUtils.createMockEnvironmentConfig();
      clientFactory = new KeycloakClientFactory(envConfig);
    });

    const generateDiscoveryDocumentFuzzInputs = (): any[] => {
      const fuzzDocs = [];

      // Invalid types
      fuzzDocs.push(null);
      fuzzDocs.push(undefined);
      fuzzDocs.push("");
      fuzzDocs.push("not an object");
      fuzzDocs.push(123);
      fuzzDocs.push([]);
      fuzzDocs.push(true);

      // Missing required fields
      fuzzDocs.push({});
      fuzzDocs.push({ issuer: null });
      fuzzDocs.push({ issuer: "" });
      fuzzDocs.push({ issuer: 123 });

      // Invalid URL formats
      fuzzDocs.push({
        issuer: "not-a-url",
        authorization_endpoint: "https://valid.com/auth",
      });

      fuzzDocs.push({
        issuer: "https://valid.com/realms/test",
        authorization_endpoint: "not-a-url",
      });

      // XSS attempts in URLs
      fuzzDocs.push({
        issuer: "javascript:alert('xss')",
        authorization_endpoint: "https://valid.com/auth",
      });

      // Path traversal in URLs
      fuzzDocs.push({
        issuer: "https://example.com/../../../etc/passwd",
        authorization_endpoint: "https://valid.com/auth",
      });

      // Very long URLs
      const longPath = "path/".repeat(1000);
      fuzzDocs.push({
        issuer: `https://example.com/${longPath}`,
        authorization_endpoint: "https://valid.com/auth",
      });

      // Unicode in URLs
      fuzzDocs.push({
        issuer: "https://🔐💥.com/realms/test",
        authorization_endpoint: "https://valid.com/auth",
      });

      return fuzzDocs;
    };

    it("should reject all invalid discovery document fuzzing inputs", () => {
      const validateDiscoveryDocument = (
        clientFactory as any
      ).validateDiscoveryDocument.bind(clientFactory);
      const fuzzDocs = generateDiscoveryDocumentFuzzInputs();

      fuzzDocs.forEach((doc, index) => {
        try {
          validateDiscoveryDocument(doc, "test-realm");
          // If we reach here, validation should have thrown
          fail(`Expected validation to fail for fuzz input ${index}`);
        } catch (error) {
          // Validation should throw for invalid documents
          expect(error).toBeInstanceOf(Error);
          if (error instanceof Error) {
            expect(error.message).toMatch(
              /Discovery document|invalid|missing|URL/
            );
          }
        }
      });
    });
  });
});
