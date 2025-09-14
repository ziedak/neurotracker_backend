/**
 * @fileoverview Comprehensive unit tests for middleware utilities
 * @description Tests utility functions for middleware management, validation, and helpers
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import {
  validateMiddlewareConfig,
  sanitizeData,
  generateRequestId,
  parseJsonSafely,
  getClientIP,
  isValidPath,
  matchPathPattern,
  calculateRequestSize,
  formatLogMessage,
  createMiddlewareChain,
  MiddlewareChain,
  type ValidationResult,
} from "../../src/middleware/utils/middleware.utils";
import { MiddlewareContext } from "../../src/middleware/types";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("Middleware Utilities", () => {
  describe("validateMiddlewareConfig", () => {
    it("should validate valid HTTP middleware configuration", () => {
      const validConfig = {
        name: "test-middleware",
        enabled: true,
        priority: 50,
        customField: "value",
      };

      const result = validateMiddlewareConfig(validConfig, "http");

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate valid WebSocket middleware configuration", () => {
      const validConfig = {
        name: "test-ws-middleware",
        enabled: true,
        priority: 30,
        customField: "value",
      };

      const result = validateMiddlewareConfig(validConfig, "websocket");

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid name", () => {
      const invalidConfig = {
        name: "",
        enabled: true,
        priority: 50,
      };

      const result = validateMiddlewareConfig(invalidConfig, "http");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Middleware name cannot be empty");
    });

    it("should reject invalid priority", () => {
      const invalidConfig = {
        name: "test",
        enabled: true,
        priority: -1,
      };

      const result = validateMiddlewareConfig(invalidConfig, "http");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Middleware priority must be a non-negative integer"
      );
    });

    it("should reject invalid enabled flag", () => {
      const invalidConfig = {
        name: "test",
        enabled: "true", // Should be boolean
        priority: 50,
      };

      const result = validateMiddlewareConfig(invalidConfig, "http");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Middleware enabled must be a boolean");
    });

    it("should handle multiple validation errors", () => {
      const invalidConfig = {
        name: "",
        enabled: "invalid",
        priority: -5,
      };

      const result = validateMiddlewareConfig(invalidConfig, "http");

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe("sanitizeData", () => {
    it("should sanitize sensitive fields in object", () => {
      const data = {
        name: "John Doe",
        password: "secret123",
        token: "jwt-token",
        nested: {
          secret: "nested-secret",
          normal: "normal-value",
        },
      };

      const sanitized = sanitizeData(data, ["password", "token", "secret"]);

      expect(sanitized.name).toBe("John Doe");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.nested.secret).toBe("[REDACTED]");
      expect(sanitized.nested.normal).toBe("normal-value");
    });

    it("should handle arrays", () => {
      const data = [
        { password: "secret1", name: "user1" },
        { password: "secret2", name: "user2" },
      ];

      const sanitized = sanitizeData(data, ["password"]);

      expect(sanitized[0].password).toBe("[REDACTED]");
      expect(sanitized[0].name).toBe("user1");
      expect(sanitized[1].password).toBe("[REDACTED]");
      expect(sanitized[1].name).toBe("user2");
    });

    it("should handle primitive values", () => {
      expect(sanitizeData("string", ["password"])).toBe("string");
      expect(sanitizeData(123, ["password"])).toBe(123);
      expect(sanitizeData(true, ["password"])).toBe(true);
      expect(sanitizeData(null, ["password"])).toBe(null);
      expect(sanitizeData(undefined, ["password"])).toBe(undefined);
    });

    it("should handle circular references", () => {
      const data: Record<string, unknown> = { name: "test" };
      const circularData = data as Record<string, unknown> & { self: unknown };
      circularData.self = data;

      const sanitized = sanitizeData(circularData, ["password"]);

      expect(sanitized.name).toBe("test");
      expect((sanitized as Record<string, unknown>).self).toEqual({
        "[CIRCULAR]": true,
      });
    });

    it("should handle empty sensitive fields list", () => {
      const data = { password: "secret", name: "John" };

      const sanitized = sanitizeData(data, []);

      expect(sanitized.password).toBe("secret");
      expect(sanitized.name).toBe("John");
    });
  });

  describe("generateRequestId", () => {
    it("should generate unique request IDs", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(typeof id1).toBe("string");
      expect(typeof id2).toBe("string");
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(0);
    });

    it("should generate IDs with expected format", () => {
      const id = generateRequestId();

      // Should be in req_timestamp_random format
      expect(id).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id.length).toBeGreaterThan(10); // Should be reasonably long
    });
  });

  describe("parseJsonSafely", () => {
    it("should parse valid JSON", () => {
      const jsonString = '{"name": "John", "age": 30}';
      const result = parseJsonSafely(jsonString);

      expect(result).toEqual({ name: "John", age: 30 });
    });

    it("should handle invalid JSON", () => {
      const invalidJson = '{"name": "John", "age": }';
      const result = parseJsonSafely(invalidJson);

      expect(result).toBe("[INVALID_JSON]");
    });

    it("should handle null/undefined input", () => {
      expect(parseJsonSafely(null)).toBe("[INVALID_JSON]");
      expect(parseJsonSafely(undefined)).toBe("[INVALID_JSON]");
    });

    it("should handle empty string", () => {
      expect(parseJsonSafely("")).toBe("[INVALID_JSON]");
    });

    it("should handle non-string input", () => {
      expect(parseJsonSafely(123)).toBe("[INVALID_JSON]");
      expect(parseJsonSafely({})).toBe("[INVALID_JSON]");
    });
  });

  describe("getClientIP", () => {
    it("should extract IP from x-forwarded-for header", () => {
      const headers = {
        "x-forwarded-for": "192.168.1.1, 10.0.0.1, 172.16.0.1",
      };

      const ip = getClientIP(headers);

      expect(ip).toBe("192.168.1.1");
    });

    it("should extract IP from x-real-ip header", () => {
      const headers = {
        "x-real-ip": "10.0.0.1",
      };

      const ip = getClientIP(headers);

      expect(ip).toBe("10.0.0.1");
    });

    it("should prioritize x-forwarded-for over x-real-ip", () => {
      const headers = {
        "x-forwarded-for": "192.168.1.1",
        "x-real-ip": "10.0.0.1",
      };

      const ip = getClientIP(headers);

      expect(ip).toBe("192.168.1.1");
    });

    it("should handle single IP in x-forwarded-for", () => {
      const headers = {
        "x-forwarded-for": "192.168.1.1",
      };

      const ip = getClientIP(headers);

      expect(ip).toBe("192.168.1.1");
    });

    it("should handle IPv6 addresses", () => {
      const headers = {
        "x-forwarded-for": "::1, 2001:db8::1",
      };

      const ip = getClientIP(headers);

      expect(ip).toBe("::1");
    });

    it("should return undefined for missing IP headers", () => {
      const headers = {
        "user-agent": "test-agent",
      };

      const ip = getClientIP(headers);

      expect(ip).toBeUndefined();
    });
  });

  describe("isValidPath", () => {
    it("should validate valid paths", () => {
      expect(isValidPath("/api/users")).toBe(true);
      expect(isValidPath("/api/users/123")).toBe(true);
      expect(isValidPath("/")).toBe(true);
      expect(isValidPath("/api/users?filter=active")).toBe(true);
    });

    it("should reject invalid paths", () => {
      expect(isValidPath("")).toBe(false);
      expect(isValidPath("api/users")).toBe(false);
      expect(isValidPath("//api/users")).toBe(false);
      expect(isValidPath("/api/../users")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(isValidPath(null as unknown as string)).toBe(false);
      expect(isValidPath(undefined as unknown as string)).toBe(false);
      expect(isValidPath(123 as unknown as string)).toBe(false);
    });
  });

  describe("matchPathPattern", () => {
    it("should match exact paths", () => {
      expect(matchPathPattern("/api/users", "/api/users")).toBe(true);
      expect(matchPathPattern("/api/users", "/api/posts")).toBe(false);
    });

    it("should match wildcard patterns", () => {
      expect(matchPathPattern("/api/users/*", "/api/users/123")).toBe(true);
      expect(matchPathPattern("/api/*/posts", "/api/users/posts")).toBe(true);
      // Note: This test expects * to match single segments only
      expect(matchPathPattern("/api/users/*", "/api/users/123")).toBe(true);
    });

    it("should match prefix patterns", () => {
      expect(matchPathPattern("/api/*", "/api/users")).toBe(true);
      expect(matchPathPattern("/api/*", "/api/users/123")).toBe(true);
      expect(matchPathPattern("/api/*", "/admin/users")).toBe(false);
    });

    it("should handle case sensitivity", () => {
      expect(matchPathPattern("/API/users", "/api/users")).toBe(false);
      expect(matchPathPattern("/api/users", "/API/users")).toBe(false);
    });
  });

  describe("calculateRequestSize", () => {
    it("should calculate size of string body", () => {
      const body = "Hello World";
      const size = calculateRequestSize(body);

      expect(size).toBe(11);
    });

    it("should calculate size of object body", () => {
      const body = { name: "John", age: 30 };
      const size = calculateRequestSize(body);

      expect(size).toBeGreaterThan(0);
      expect(typeof size).toBe("number");
    });

    it("should calculate size of Buffer body", () => {
      const body = Buffer.from("Hello World");
      const size = calculateRequestSize(body);

      expect(size).toBe(11);
    });

    it("should handle null/undefined body", () => {
      expect(calculateRequestSize(null)).toBe(0);
      expect(calculateRequestSize(undefined)).toBe(0);
    });

    it("should handle empty body", () => {
      expect(calculateRequestSize("")).toBe(0);
      expect(calculateRequestSize({})).toBe(2); // JSON.stringify({}) = "{}"
      expect(calculateRequestSize([])).toBe(2); // JSON.stringify([]) = "[]"
    });
  });

  describe("formatLogMessage", () => {
    it("should format log message with context", () => {
      const message = formatLogMessage("Test message", {
        requestId: "req-123",
        userId: "user-456",
        path: "/api/test",
      });

      expect(message).toContain("Test message");
      expect(message).toContain("req-123");
      expect(message).toContain("user-456");
      expect(message).toContain("/api/test");
    });

    it("should format log message without context", () => {
      const message = formatLogMessage("Test message");

      expect(message).toContain("Test message");
      expect(message).toContain(new Date().getFullYear().toString()); // Should include timestamp
    });

    it("should handle empty context", () => {
      const message = formatLogMessage("Test message", {});

      expect(message).toContain("Test message");
    });

    it("should handle special characters in message", () => {
      const message = formatLogMessage("Test with <script> tags", {
        requestId: "req-123",
      });

      expect(message).toContain("Test with <script> tags");
    });
  });

  describe("MiddlewareChain", () => {
    let mockContext: MiddlewareContext;
    let mockMiddlewares: Array<{
      name: string;
      middleware: jest.MockedFunction<
        (context: MiddlewareContext, next: () => Promise<void>) => Promise<void>
      >;
      priority?: number;
      enabled?: boolean;
    }>;

    beforeEach(() => {
      mockContext = {
        requestId: "test-request-123",
        request: {
          method: "GET",
          url: "/api/test",
          headers: {},
          body: {},
          query: {},
          params: {},
          ip: "192.168.1.1",
        },
        response: {
          status: 200,
          headers: {},
        },
        set: {
          status: 200,
          headers: {},
        },
        user: undefined,
        session: undefined,
        validated: {},
        path: "/api/test",
      };

      mockMiddlewares = [
        {
          name: "middleware1",
          middleware: jest
            .fn()
            .mockImplementation(
              async (context: MiddlewareContext, next: () => Promise<void>) => {
                await next();
              }
            ),
          priority: 10,
          enabled: true,
        },
        {
          name: "middleware2",
          middleware: jest
            .fn()
            .mockImplementation(
              async (context: MiddlewareContext, next: () => Promise<void>) => {
                await next();
              }
            ),
          priority: 20,
          enabled: true,
        },
        {
          name: "middleware3",
          middleware: jest.fn().mockResolvedValue(undefined),
          priority: 30,
          enabled: false,
        },
      ];
    });

    describe("createMiddlewareChain", () => {
      it("should create middleware chain", () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        expect(chain).toBeInstanceOf(MiddlewareChain);
      });

      it("should sort middlewares by priority", () => {
        const unsortedMiddlewares = [
          {
            name: "high",
            middleware: jest.fn(),
            priority: 30,
            enabled: true,
          },
          {
            name: "low",
            middleware: jest.fn(),
            priority: 10,
            enabled: true,
          },
          {
            name: "medium",
            middleware: jest.fn(),
            priority: 20,
            enabled: true,
          },
        ];

        const chain = createMiddlewareChain(unsortedMiddlewares);
        const sorted = chain.getMiddlewares();

        expect(sorted[0].name).toBe("low");
        expect(sorted[1].name).toBe("medium");
        expect(sorted[2].name).toBe("high");
      });

      it("should filter out disabled middlewares", () => {
        const chain = createMiddlewareChain(mockMiddlewares);
        const active = chain.getMiddlewares();

        expect(active.length).toBe(2);
        expect(active[0].name).toBe("middleware1");
        expect(active[1].name).toBe("middleware2");
      });
    });

    describe("MiddlewareChain execution", () => {
      it("should execute middlewares in order", async () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        await chain.execute(mockContext);

        expect(mockMiddlewares[0].middleware).toHaveBeenCalledWith(
          mockContext,
          expect.any(Function)
        );
        expect(mockMiddlewares[1].middleware).toHaveBeenCalledWith(
          mockContext,
          expect.any(Function)
        );
        expect(mockMiddlewares[2].middleware).not.toHaveBeenCalled(); // Disabled
      });

      it("should handle middleware execution errors", async () => {
        mockMiddlewares[0].middleware.mockRejectedValue(
          new Error("Middleware error")
        );

        const chain = createMiddlewareChain(mockMiddlewares);

        await expect(chain.execute(mockContext)).rejects.toThrow(
          "Middleware error"
        );

        expect(mockMiddlewares[1].middleware).not.toHaveBeenCalled();
      });

      it("should continue execution after successful middleware", async () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        await chain.execute(mockContext);

        expect(mockMiddlewares[0].middleware).toHaveBeenCalled();
        expect(mockMiddlewares[1].middleware).toHaveBeenCalled();
      });

      it("should provide next function to middlewares", async () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        // Mock the internal next function
        mockMiddlewares[0].middleware.mockImplementation(
          async (context: MiddlewareContext, next: () => Promise<void>) => {
            await next();
          }
        );

        await chain.execute(mockContext);

        expect(mockMiddlewares[0].middleware).toHaveBeenCalled();
        expect(mockMiddlewares[1].middleware).toHaveBeenCalled();
      });
    });

    describe("MiddlewareChain management", () => {
      it("should add middleware to chain", () => {
        const chain = createMiddlewareChain([]);
        const newMiddleware = jest.fn().mockResolvedValue(undefined);

        chain.add("new", newMiddleware, 25);

        const middlewares = chain.getMiddlewares();
        expect(middlewares).toHaveLength(1);
        expect(middlewares[0].name).toBe("new");
        expect(middlewares[0].priority).toBe(25);
      });

      it("should remove middleware from chain", () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        const removed = chain.remove("middleware1");

        expect(removed).toBe(true);
        const middlewares = chain.getMiddlewares();
        expect(middlewares.length).toBe(1);
        expect(middlewares[0].name).toBe("middleware2");
      });

      it("should enable middleware", () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        const enabled = chain.toggle("middleware3", true);

        expect(enabled).toBe(true);
        const middlewares = chain.getMiddlewares();
        expect(middlewares.length).toBe(3);
      });

      it("should disable middleware", () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        const disabled = chain.toggle("middleware1", false);

        expect(disabled).toBe(true);
        const middlewares = chain.getMiddlewares();
        expect(middlewares.length).toBe(1);
        expect(middlewares[0].name).toBe("middleware2");
      });

      it("should return false for non-existent middleware operations", () => {
        const chain = createMiddlewareChain(mockMiddlewares);

        const removed = chain.remove("non-existent");
        const toggled = chain.toggle("non-existent", false);

        expect(removed).toBe(false);
        expect(toggled).toBe(false);
      });
    });
  });
});
