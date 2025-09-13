/**
 * @file InputValidator.test.ts
 * @description Comprehensive Jest tests for the type-safe InputValidator
 */

import { InputValidator } from "../../src/utils/InputValidator";
import {
  WebSocketMessage,
  JsonValue,
  HttpHeaders,
} from "../../src/types/validation.types";

describe("InputValidator", () => {
  describe("WebSocket Message Validation", () => {
    it("should validate a proper WebSocket message", () => {
      const message: WebSocketMessage = {
        type: "test",
        payload: { data: "value" },
        id: "msg123",
        timestamp: Date.now(),
      };

      const result = InputValidator.validateWebSocketMessage(message);

      expect(result).toEqual({
        type: "test",
        payload: { data: "value" },
        id: "msg123",
      });
    });

    it("should validate message without optional fields", () => {
      const message: WebSocketMessage = {
        type: "ping",
      };

      const result = InputValidator.validateWebSocketMessage(message);

      expect(result).toEqual({
        type: "ping",
      });
    });

    it("should throw error for missing type", () => {
      const message = {
        payload: { data: "value" },
      } as unknown as WebSocketMessage;

      expect(() => {
        InputValidator.validateWebSocketMessage(message);
      }).toThrow("Invalid message: missing type");
    });

    it("should throw error for empty type", () => {
      const message: WebSocketMessage = {
        type: "",
        payload: { data: "value" },
      };

      expect(() => {
        InputValidator.validateWebSocketMessage(message);
      }).toThrow("Invalid message: type cannot be empty");
    });

    it("should throw error for non-string type", () => {
      const message = {
        type: 123,
        payload: { data: "value" },
      } as unknown as WebSocketMessage;

      expect(() => {
        InputValidator.validateWebSocketMessage(message);
      }).toThrow("Invalid message: type must be a string");
    });

    it("should handle complex nested payload", () => {
      const message: WebSocketMessage = {
        type: "complex",
        payload: {
          user: {
            id: 123,
            name: "John",
            preferences: {
              theme: "dark",
              notifications: true,
            },
          },
          data: [1, 2, 3, "test", null],
        },
      };

      const result = InputValidator.validateWebSocketMessage(message);

      expect(result.payload).toEqual(message.payload);
    });
  });

  describe("JSON Payload Validation", () => {
    it("should validate valid JSON values", () => {
      const validValues: JsonValue[] = [
        "string",
        123,
        true,
        false,
        null,
        { key: "value" },
        [1, 2, 3],
        { nested: { array: [1, 2, { deep: true }] } },
      ];

      validValues.forEach((value) => {
        const result = InputValidator.validateJsonPayload(value, {});
        expect(result).toEqual(value);
      });
    });

    it("should reject undefined values", () => {
      expect(() => {
        InputValidator.validateJsonPayload(undefined, {});
      }).toThrow("Invalid JSON: undefined values not allowed");
    });

    it("should reject functions", () => {
      const func = (): string => "test";

      expect(() => {
        InputValidator.validateJsonPayload(func, {});
      }).toThrow("Invalid JSON: functions not allowed");
    });

    it("should reject symbols", () => {
      const sym = Symbol("test");

      expect(() => {
        InputValidator.validateJsonPayload(sym, {});
      }).toThrow("Invalid JSON: symbols not allowed");
    });

    it("should enforce max depth limit", () => {
      // Create deeply nested object
      let deepObject: Record<string, unknown> = { level: 1 };
      for (let i = 2; i <= 15; i++) {
        deepObject = { level: i, nested: deepObject };
      }

      expect(() => {
        InputValidator.validateJsonPayload(deepObject, { maxDepth: 10 });
      }).toThrow("JSON depth limit exceeded");
    });

    it("should enforce max size limit", () => {
      const largeArray = new Array(1000).fill("x".repeat(100));

      expect(() => {
        InputValidator.validateJsonPayload(largeArray, { maxSizeBytes: 1000 });
      }).toThrow("JSON size limit exceeded");
    });

    it("should allow valid size within limit", () => {
      const smallObject = { key: "value" };

      const result = InputValidator.validateJsonPayload(smallObject, {
        maxSizeBytes: 1000,
      });

      expect(result).toEqual(smallObject);
    });
  });

  describe("HTTP Headers Validation", () => {
    it("should validate proper headers", () => {
      const headers: HttpHeaders = {
        "content-type": "application/json",
        authorization: "Bearer token123",
        "x-custom-header": "custom-value",
      };

      const result = InputValidator.validateHeaders(headers);

      expect(result).toEqual({
        "content-type": "application/json",
        authorization: "Bearer token123",
        "x-custom-header": "custom-value",
      });
    });

    it("should reject headers with array values", () => {
      const headers = {
        "content-type": ["application/json", "charset=utf-8"],
      } as unknown as HttpHeaders;

      expect(() => {
        InputValidator.validateHeaders(headers);
      }).toThrow("Invalid header value: must be string");
    });

    it("should reject headers with numeric values", () => {
      const headers = {
        "content-length": 1234,
      } as unknown as HttpHeaders;

      expect(() => {
        InputValidator.validateHeaders(headers);
      }).toThrow("Invalid header value: must be string");
    });

    it("should handle empty headers", () => {
      const headers: HttpHeaders = {};

      const result = InputValidator.validateHeaders(headers);

      expect(result).toEqual({});
    });

    it("should reject null header values", () => {
      const headers = {
        authorization: null,
      } as unknown as HttpHeaders;

      expect(() => {
        InputValidator.validateHeaders(headers);
      }).toThrow("Invalid header value: must be string");
    });
  });

  describe("String Validation and Sanitization", () => {
    describe("sanitizeString", () => {
      it("should remove HTML tags", () => {
        const input = '<script>alert("xss")</script>Hello World<br>';
        const result = InputValidator.sanitizeString(input);

        expect(result).toBe('alert("xss")Hello World');
      });

      it("should handle empty strings", () => {
        expect(InputValidator.sanitizeString("")).toBe("");
      });

      it("should handle strings without HTML", () => {
        const input = "Plain text message";
        const result = InputValidator.sanitizeString(input);

        expect(result).toBe("Plain text message");
      });

      it("should handle complex HTML", () => {
        const input = '<div class="test">Content</div><p>Paragraph</p>';
        const result = InputValidator.sanitizeString(input);

        expect(result).toBe("ContentParagraph");
      });
    });
  });

  describe("Token and URL Validation", () => {
    describe("validateToken", () => {
      it("should validate proper JWT tokens", () => {
        const validToken =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

        const result = InputValidator.validateToken(validToken);
        expect(result).toBe(validToken);
      });

      it("should remove Bearer prefix", () => {
        const tokenWithBearer =
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        const expectedToken =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

        const result = InputValidator.validateToken(tokenWithBearer);
        expect(result).toBe(expectedToken);
      });

      it("should throw error for invalid token format", () => {
        expect(() => {
          InputValidator.validateToken("invalid.token");
        }).toThrow("Invalid token format - must be valid JWT");
      });

      it("should throw error for missing token", () => {
        expect(() => {
          InputValidator.validateToken(undefined);
        }).toThrow("Authentication token is required");
      });
    });

    describe("validateUrl", () => {
      it("should validate proper URLs", () => {
        const validUrl = "https://example.com/path";
        const result = InputValidator.validateUrl(validUrl);
        expect(result).toBe(validUrl);
      });

      it("should throw error for invalid URLs", () => {
        expect(() => {
          InputValidator.validateUrl("not-a-url");
        }).toThrow();
      });
    });
  });

  describe("Error Handling", () => {
    it("should provide descriptive error messages", () => {
      expect(() => {
        InputValidator.validateJsonPayload(undefined, {});
      }).toThrow("Invalid JSON: undefined values not allowed");

      expect(() => {
        InputValidator.validateWebSocketMessage({
          type: "",
        } as unknown as WebSocketMessage);
      }).toThrow("Invalid message: type cannot be empty");
    });

    it("should handle edge cases gracefully", () => {
      // Very large valid JSON
      const largeValidObject = {
        data: new Array(100).fill("small"),
      };

      expect(() => {
        InputValidator.validateJsonPayload(largeValidObject, {
          maxSizeBytes: 10000,
        });
      }).not.toThrow();

      // Deeply nested but within limits
      const deepObject = {
        level1: {
          level2: {
            level3: {
              data: "value",
            },
          },
        },
      };

      expect(() => {
        InputValidator.validateJsonPayload(deepObject, { maxDepth: 5 });
      }).not.toThrow();
    });
  });

  describe("Performance", () => {
    it("should validate large payloads efficiently", () => {
      const largePayload = {
        users: new Array(1000).fill(null).map((_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      };

      const startTime = Date.now();
      const result = InputValidator.validateJsonPayload(largePayload, {
        maxSizeBytes: 1000000,
      });
      const endTime = Date.now();

      expect(result).toEqual(largePayload);
      expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
    });

    it("should validate many messages efficiently", () => {
      const messages = new Array(1000).fill(null).map((_, i) => ({
        type: "test",
        payload: { index: i },
        id: `msg${i}`,
      }));

      const startTime = Date.now();
      messages.forEach((msg) => {
        InputValidator.validateWebSocketMessage(msg);
      });
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500); // Should complete in under 500ms
    });
  });
});
