/**
 * Error Middleware Usage Examples
 * Simple examples to avoid unused variable warnings
 */

import { Elysia } from "elysia";

import { MetricsCollector } from "@libs/monitoring";
import {
  createErrorHttpMiddleware,
  ErrorHttpMiddleware,
  type ErrorHttpMiddlewareConfig,
} from "./error.http.middleware";
import { ElysiaMiddlewareAdapter } from "../adapters/ElysiaMiddlewareAdapter";

// Initialize metrics collector
const metrics = new MetricsCollector();

// Example 1: Simple factory usage
export function simpleFactoryExample() {
  const errorMiddleware = createErrorHttpMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: true,
  });

  return errorMiddleware.middleware();
}

// Example 2: Direct instantiation with custom config
export function directInstantiationExample() {
  const customConfig: ErrorHttpMiddlewareConfig = {
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

  return new ErrorHttpMiddleware(metrics, customConfig);
}

// Example 3: Elysia integration
export function elysiaIntegrationExample() {
  const errorMiddleware = createErrorHttpMiddleware(metrics);

  const app = new Elysia()
    .use(new ElysiaMiddlewareAdapter(errorMiddleware).plugin())
    .get("/", () => "Hello World");

  return app;
}

// Example 4: Environment-specific configurations
export function environmentConfigExample() {
  const devErrorHandler = createErrorHttpMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: true,
  });

  const prodErrorHandler = createErrorHttpMiddleware(metrics, {
    includeStackTrace: false,
    logErrors: true,
  });

  const auditErrorHandler = createErrorHttpMiddleware(metrics, {
    includeStackTrace: false,
    logErrors: true,
    sensitiveFields: ["password", "token", "apiKey"],
  });

  return { devErrorHandler, prodErrorHandler, auditErrorHandler };
}

// Example 5: Error response creation
export async function errorResponseExample() {
  const errorMiddleware = createErrorHttpMiddleware(metrics);
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
  const errorMiddleware = createErrorHttpMiddleware(metrics);

  const riskyFunction = async (data: { name: string }) => {
    if (!data.name) throw new Error("Name is required");
    return { success: true, data };
  };

  const safeFunction = errorMiddleware.wrapWithErrorHandling(riskyFunction);
  return await safeFunction({ name: "test" });
}

// Example 7: Predefined error types
export function predefinedErrorsExample() {
  const validationError = ErrorHttpMiddleware.createValidationError(
    "Invalid email format"
  );

  const authError = ErrorHttpMiddleware.createAuthenticationError();
  const authzError = ErrorHttpMiddleware.createAuthorizationError(
    "User does not have permission to access this resource"
  );
  const notFoundError =
    ErrorHttpMiddleware.createNotFoundError("User not found");
  const rateLimitError = ErrorHttpMiddleware.createRateLimitError();

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
  return createErrorHttpMiddleware(metrics, {
    includeStackTrace: true,
    logErrors: false, // Don't spam logs during tests
  });
}
