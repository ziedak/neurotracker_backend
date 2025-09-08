/**
 * Error Middleware Usage Examples
 * Simple examples to avoid unused variable warnings
 */

import { Elysia } from "@libs/elysia-server";
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
export function simpleFactoryExample() {
  const errorMiddleware = createErrorMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: true,
  });

  return errorMiddleware.middleware();
}

// Example 2: Direct instantiation with custom config
export function directInstantiationExample() {
  const customConfig: ErrorMiddlewareConfig = {
    name: "custom-error-handler",
    enabled: true,
    priority: 1000,
    includeStackTrace: false,
    logErrors: true,
    customErrorMessages: {
      ValidationError: "Invalid input provided",
      AuthenticationError: "Authentication required",
      AuthorizationError: "Access forbidden",
      NotFoundError: "Resource not found",
    },
  };

  return new ErrorMiddleware(metrics, customConfig);
}

// Example 3: Elysia integration
export function elysiaIntegrationExample() {
  const errorMiddleware = createErrorMiddleware(metrics);

  const app = new Elysia()
    .use(new ElysiaMiddlewareAdapter(errorMiddleware).plugin())
    .get("/", () => "Hello World");

  return app;
}

// Example 4: Environment-specific configurations
export function environmentConfigExample() {
  const devErrorHandler = createErrorMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: true,
  });

  const prodErrorHandler = createErrorMiddleware(metrics, {
    includeStackTrace: false,
    logErrors: true,
  });

  const auditErrorHandler = createErrorMiddleware(metrics, {
    includeStackTrace: false,
    logErrors: true,
    sensitiveFields: ["password", "token", "apiKey"],
  });

  return { devErrorHandler, prodErrorHandler, auditErrorHandler };
}

// Example 5: Error response creation
export async function errorResponseExample() {
  const errorMiddleware = createErrorMiddleware(metrics);
  const testError = new Error("Test error");
  const mockContext = {
    request: { url: "/test", method: "GET" },
    set: { headers: {} },
    requestId: "test-123",
  };

  return await errorMiddleware.createErrorResponse(
    testError,
    mockContext as any
  );
}

// Example 6: Function wrapping
export async function functionWrappingExample() {
  const errorMiddleware = createErrorMiddleware(metrics);

  const riskyFunction = async (data: { name: string }) => {
    if (!data.name) throw new Error("Name is required");
    return { success: true, data };
  };

  const safeFunction = errorMiddleware.wrapWithErrorHandling(riskyFunction);
  return await safeFunction({ name: "test" });
}

// Example 7: Predefined error types
export function predefinedErrorsExample() {
  const validationError = ErrorMiddleware.createValidationError(
    "Invalid email format"
  );

  const authError = ErrorMiddleware.createAuthenticationError();
  const authzError = ErrorMiddleware.createAuthorizationError(
    "User does not have permission to access this resource"
  );
  const notFoundError = ErrorMiddleware.createNotFoundError("User not found");
  const rateLimitError = ErrorMiddleware.createRateLimitError();

  return {
    validationError,
    authError,
    authzError,
    notFoundError,
    rateLimitError,
  };
}

// Example 8: Testing configuration
export function testingConfigExample() {
  return createErrorMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: false, // Don't spam logs during tests
  });
}
