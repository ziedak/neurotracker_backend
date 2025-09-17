/**
 * @fileoverview Migration Guide: Centralized Sanitization Utilities
 * @description Examples showing how to replace duplicate sanitization code
 */

/**
 * @fileoverview Migration Guide: Centralized Sanitization Utilities
 * @description Examples showing how to replace duplicate sanitization code
 */

/**
 * @fileoverview Migration Guide: Centralized Sanitization Utilities
 * @description Examples showing how to replace duplicate sanitization code
 */

/**
 * @fileoverview Migration Guide: Centralized Sanitization Utilities
 * @description Examples showing how to replace duplicate sanitization code
 */

// BEFORE: Each middleware has its own sanitization methods

// class ApiKeyStrategyOld {
//   static maskApiKey(apiKey: string): string {
//     if (apiKey.length <= 8) {
//       return "***";
//     }
//     return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
//   }
// }

// class LoggingWebSocketMiddlewareOld {
//   private sanitizeHeaders(
//     headers: Record<string, string>
//   ): Record<string, string> {
//     const sanitized: Record<string, string> = {};
//     const sensitiveHeaders = [
//       "authorization",
//       "cookie",
//       "set-cookie",
//       "x-api-key",
//     ];

//     for (const [key, value] of Object.entries(headers)) {
//       const lowerKey = key.toLowerCase();
//       if (sensitiveHeaders.includes(lowerKey)) {
//         sanitized[key] = "[REDACTED]";
//       } else {
//         sanitized[key] = value;
//       }
//     }
//     return sanitized;
//   }

//   private sanitizePayload(payload: unknown): unknown {
//     const sensitiveFields = ["password", "token", "apikey"];
//     // Custom sanitization logic...
//     return payload;
//   }
// }

// class SecurityWebSocketMiddlewareOld {
//   sanitizeObject(
//     obj: Record<string, unknown>,
//     sensitiveFields: string[]
//   ): Record<string, unknown> {
//     if (sensitiveFields.length === 0) return obj;
//     // Another custom implementation...
//     return obj;
//   }
// }

// ✅ NEW WAY - Using centralized sanitization utilities

import {
  sanitizeSecret,
  sanitizeHeaders,
  sanitizePayload,
  middlewareSanitizers,
  createSanitizer,
  type SanitizationConfig,
} from "../utils/sanitization.utils";

// ✅ NEW - ApiKeyStrategy.ts
class ApiKeyStrategy {
  static maskApiKey(apiKey: string): string {
    return sanitizeSecret(apiKey);
  }

  // Or for custom behavior:
  private static apiKeySanitizer = createSanitizer({
    maskingStrategy: "partial",
    sensitiveFields: ["apikey", "x-api-key"],
  });

  static maskApiKeyCustom(apiKey: string): string {
    return this.apiKeySanitizer.sanitize(apiKey).data as string;
  }
}

// ✅ NEW - logging.websocket.middleware.ts
class LoggingWebSocketMiddleware {
  mockfn() {
    this.sanitizeHeaders({ Authorization: "token" });
    this.sanitizePayload({ password: "1234" });
    this.sanitizeCustomPayload({ custom_field: "value" });
  }

  // Simple header sanitization
  private sanitizeHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    return sanitizeHeaders(headers) as Record<string, string>;
  }

  // Advanced payload sanitization with middleware-specific config
  private sanitizePayload<T>(payload: T): T {
    return middlewareSanitizers.logging.sanitize(payload).data;
  }

  // Or custom configuration for specific needs
  private customSanitizer = createSanitizer({
    sensitiveFields: ["password", "token", "apikey", "custom_secret"],
    maskingStrategy: "partial",
    maxDepth: 5,
  });

  private sanitizeCustomPayload<T>(payload: T): T {
    return this.customSanitizer.sanitize(payload).data;
  }
}

// ✅ NEW - security.websocket.middleware.ts
class SecurityWebSocketMiddleware {
  // Use pre-configured security sanitizer
  sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    return middlewareSanitizers.security.sanitize(obj).data as Record<
      string,
      unknown
    >;
  }

  // Or use the general utility
  sanitizeMessage(payload: unknown): unknown {
    return sanitizePayload(payload, ["custom_field", "internal_data"]);
  }
}

// ✅ ADVANCED USAGE EXAMPLES

// Example 1: Environment-specific sanitization
const createEnvironmentSanitizer = () => {
  const isProduction = process.env["NODE_ENV"] === "production";

  return createSanitizer({
    maskingStrategy: isProduction ? "redact" : "partial",
    maxDepth: isProduction ? 3 : 10,
    sensitiveFields: isProduction
      ? ["password", "token", "secret", "key"]
      : ["password", "token"], // Less restrictive in dev
  });
};

// Example 2: Middleware-specific configurations
const middlewareConfigs: Record<string, SanitizationConfig> = {
  cors: {
    sensitiveFields: ["authorization", "cookie"],
    maskingStrategy: "partial",
  },

  auth: {
    sensitiveFields: ["password", "token", "jwt", "refresh_token"],
    maskingStrategy: "redact",
  },

  rateLimit: {
    sensitiveFields: ["x-api-key", "authorization"],
    maskingStrategy: "hash", // For tracking while preserving privacy
  },

  audit: {
    sensitiveFields: ["password", "token", "secret"],
    maskingStrategy: "hash", // Consistent hashing for audit trails
    preserveStructure: true,
  },
};

// Example 3: Real-world middleware integration
class ModernCorsMiddleware {
  private sanitizer = middlewareSanitizers.cors;
  private logger = { info: console.info, error: console.error }; // Mock logger for example

  // Example usage in middleware methods
  processRequest(context: Record<string, unknown>) {
    // Log sanitized request data
    this.logger.info("CORS request processed", {
      origin: context["headers"],
      headers: this.sanitizer.sanitize(context["headers"]).data,
      timestamp: new Date().toISOString(),
    });
  }

  processError(error: Error, context: Record<string, unknown>) {
    // Log sanitized error context
    this.logger.error("CORS error", {
      error: error.message,
      sanitizedContext: this.sanitizer.sanitize({
        headers: context["headers"],
        url: context["url"],
        method: context["method"],
      }).data,
    });
  }
}

// Example 4: Testing sanitization
import { sanitizers } from "../utils/sanitization.utils";

describe("Sanitization Integration", () => {
  it("should sanitize API keys consistently", () => {
    const apiKey = "fake_api_key_for_testing_12345";

    // All middleware should produce same sanitized result
    const corsResult = middlewareSanitizers.cors.sanitize({
      "x-api-key": apiKey,
    });
    const authResult = middlewareSanitizers.auth.sanitize({ apikey: apiKey });

    expect(corsResult.fieldsRedacted).toBeGreaterThan(0);
    expect(authResult.fieldsRedacted).toBeGreaterThan(0);
  });

  it("should handle complex nested objects", () => {
    const complexPayload = {
      user: {
        id: 123,
        email: "user@example.com",
        credentials: {
          password: "secret123",
          apiKey: "fake_test_api_key_67890",
          metadata: {
            lastLogin: new Date(),
            preferences: {
              theme: "dark",
              notifications: true,
            },
          },
        },
      },
    };

    const result = sanitizers.logging.sanitize(complexPayload);

    expect(result.data).toBeDefined();
    expect(result.fieldsRedacted).toBeGreaterThan(0);
    // Verify structure is preserved but sensitive data is masked
    const sanitizedData = result.data as {
      user: {
        id: number;
        email: string;
        credentials: {
          password: string;
          apiKey: string;
          metadata: {
            lastLogin: Date;
            preferences: {
              theme: string;
              notifications: boolean;
            };
          };
        };
      };
    };
    expect(sanitizedData.user.id).toBe(123);
    expect(sanitizedData.user.credentials.password).toBe("[REDACTED]");
  });
});

export {
  ApiKeyStrategy,
  LoggingWebSocketMiddleware,
  SecurityWebSocketMiddleware,
  createEnvironmentSanitizer,
  middlewareConfigs,
  ModernCorsMiddleware,
};
