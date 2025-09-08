import { Elysia } from "elysia";
import {
  createErrorMiddleware,
  ErrorMiddleware,
  ElysiaMiddlewareAdapter,
  type ErrorMiddlewareConfig,
} from "@libs/middleware";
import { MetricsCollector } from "@libs/monitoring";

// Initialize metrics collector
const metrics = new MetricsCollector();

// Example 1: Simple factory usage
console.log("=== Example 1: Simple Factory Usage ===");
const errorMiddleware = createErrorMiddleware(metrics, {
  includeStackTrace: process.env.NODE_ENV === "development",
  logErrors: true,
});

// Framework-agnostic middleware function
const middlewareFunction = errorMiddleware.middleware();
console.log("✅ Created framework-agnostic error middleware");

// Example 2: Direct instantiation with custom config
console.log("\n=== Example 2: Direct Instantiation ===");
const customConfig: ErrorMiddlewareConfig = {
  name: "custom-error-handler",
  enabled: true,
  priority: 1000,
  includeStackTrace: false,
  logErrors: true,
  customErrorMessages: {
    ValidationError: "Invalid request data provided",
    AuthenticationError: "Authentication is required",
    AuthorizationError: "You don't have permission to access this resource",
  },
  sensitiveFields: ["password", "token", "apiKey", "secret"],
};

const customErrorMiddleware = new ErrorMiddleware(metrics, customConfig);
console.log("✅ Created custom error middleware with specific config");

// Example 3: Elysia integration with adapter
console.log("\n=== Example 3: Elysia Integration ===");
const app = new Elysia()
  .use(new ElysiaMiddlewareAdapter(errorMiddleware).plugin())
  .get("/", () => ({ message: "Hello World!" }))
  .get("/error", () => {
    throw ErrorMiddleware.createValidationError("Test validation error");
  })
  .get("/custom-error", () => {
    const error = new Error("Custom error with details") as any;
    error.statusCode = 422;
    error.details = { field: "email", reason: "invalid format" };
    throw error;
  });

console.log("✅ Configured Elysia app with error middleware");

// Example 4: Per-route configuration
console.log("\n=== Example 4: Per-Route Configuration ===");
const baseErrorMiddleware = createErrorMiddleware(metrics, {
  includeStackTrace: false,
  logErrors: true,
});

// Development routes with detailed errors
const devErrorMiddleware = baseErrorMiddleware.withConfig({
  includeStackTrace: true,
  customErrorMessages: {
    ValidationError: "Development: Detailed validation error with context",
  },
});

// Public API with minimal errors
const publicErrorMiddleware = baseErrorMiddleware.withConfig({
  includeStackTrace: false,
  customErrorMessages: {
    ValidationError: "Invalid request",
    AuthenticationError: "Access denied",
    NotFoundError: "Not found",
  },
});

const routedApp = new Elysia()
  .use("/dev", new ElysiaMiddlewareAdapter(devErrorMiddleware).plugin())
  .use(
    "/api/public",
    new ElysiaMiddlewareAdapter(publicErrorMiddleware).plugin()
  )
  .get("/dev/test", () => {
    throw ErrorMiddleware.createValidationError("Dev test error");
  })
  .get("/api/public/test", () => {
    throw ErrorMiddleware.createValidationError("Public test error");
  });

console.log("✅ Configured per-route error handling");

// Example 5: Preset configurations
console.log("\n=== Example 5: Preset Configurations ===");

// Development preset
const devErrorConfig = ErrorMiddleware.createDevelopmentConfig();
const devErrorHandler = createErrorMiddleware(metrics, {
  name: "dev-error-handler",
  enabled: true,
  priority: 1000,
  ...devErrorConfig,
});

// Production preset
const prodErrorConfig = ErrorMiddleware.createProductionConfig();
const prodErrorHandler = createErrorMiddleware(metrics, {
  name: "prod-error-handler",
  enabled: true,
  priority: 1000,
  ...prodErrorConfig,
});

// Audit preset
const auditErrorConfig = ErrorMiddleware.createAuditConfig();
const auditErrorHandler = createErrorMiddleware(metrics, {
  name: "audit-error-handler",
  enabled: true,
  priority: 1000,
  ...auditErrorConfig,
});

console.log("✅ Created preset configurations");

// Example 6: Utility methods
console.log("\n=== Example 6: Utility Methods ===");

// Direct error response creation
const mockContext = {
  requestId: "test-123",
  request: {
    method: "POST",
    url: "/api/test",
    headers: { "user-agent": "test-agent" },
  },
  set: { status: 200, headers: {} },
} as any;

const testError = ErrorMiddleware.createValidationError("Test error", {
  field: "email",
  reason: "invalid format",
});

errorMiddleware.createErrorResponse(testError, mockContext).then((response) => {
  console.log("✅ Created error response:", {
    success: response.success,
    error: response.error,
    statusCode: response.statusCode,
    requestId: response.requestId,
  });
});

// Wrap function with error handling
const riskyFunction = async (data: any) => {
  if (!data.email) {
    throw ErrorMiddleware.createValidationError("Email is required");
  }
  return { success: true, data };
};

const safeFunction = errorMiddleware.wrapWithErrorHandling(riskyFunction);

safeFunction({ name: "test" }).then((result) => {
  console.log("✅ Safe function result:", result);
});

// Example 7: Custom error types
console.log("\n=== Example 7: Custom Error Types ===");

const validationError = ErrorMiddleware.createValidationError(
  "Invalid email format",
  { field: "email", received: "not-an-email" }
);

const authError = ErrorMiddleware.createAuthenticationError();
const authzError = ErrorMiddleware.createAuthorizationError(
  "Insufficient permissions"
);
const notFoundError = ErrorMiddleware.createNotFoundError("User not found");
const rateLimitError = ErrorMiddleware.createRateLimitError();

console.log("✅ Created custom error types");

// Example 8: Testing configuration
console.log("\n=== Example 8: Testing Configuration ===");

const testErrorMiddleware = createErrorMiddleware(metrics, {
  name: "test-error-handler",
  enabled: true,
  priority: 1000,
  includeStackTrace: true, // Useful for debugging tests
  logErrors: false, // Disable logging in tests
  customErrorMessages: {
    ValidationError: "Test validation error",
  },
});

console.log("✅ Created test configuration");

console.log("\n🎉 ErrorMiddleware migration complete!");
console.log("✅ Now follows AbstractMiddleware architecture");
console.log("✅ Framework-agnostic with adapter pattern");
console.log("✅ Immutable configuration with withConfig()");
console.log("✅ Direct instantiation without DI");
console.log("✅ Production-ready error handling and sanitization");

// Clean exit for example
process.exit(0);
