# Error Handling & Recovery

Comprehensive error handling strategies, error classification, recovery mechanisms, and logging patterns for the authentication library.

## Error Classification

### Error Types Hierarchy

```typescript
// Base error classes
export class AuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Authentication errors
export class AuthenticationError extends AuthError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "AUTHENTICATION_ERROR", 401, true, context);
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(context?: Record<string, any>) {
    super("Invalid username or password", context);
  }
}

export class TokenExpiredError extends AuthenticationError {
  constructor(context?: Record<string, any>) {
    super("Authentication token has expired", context);
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(context?: Record<string, any>) {
    super("Invalid authentication token", context);
  }
}

// Authorization errors
export class AuthorizationError extends AuthError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "AUTHORIZATION_ERROR", 403, true, context);
  }
}

export class InsufficientPermissionsError extends AuthorizationError {
  constructor(
    required: string[],
    provided: string[],
    context?: Record<string, any>
  ) {
    super(
      `Insufficient permissions. Required: ${required.join(
        ", "
      )}, Provided: ${provided.join(", ")}`,
      { required, provided, ...context }
    );
  }
}

export class AccessDeniedError extends AuthorizationError {
  constructor(resource: string, context?: Record<string, any>) {
    super(`Access denied to resource: ${resource}`, { resource, ...context });
  }
}

// Validation errors
export class ValidationError extends AuthError {
  public readonly field: string;
  public readonly value: any;

  constructor(
    field: string,
    message: string,
    value?: any,
    context?: Record<string, any>
  ) {
    super(
      `Validation error for field '${field}': ${message}`,
      "VALIDATION_ERROR",
      400,
      true,
      context
    );
    this.field = field;
    this.value = value;
  }
}

export class RequiredFieldError extends ValidationError {
  constructor(field: string, context?: Record<string, any>) {
    super(field, "This field is required", undefined, context);
  }
}

export class InvalidFormatError extends ValidationError {
  constructor(
    field: string,
    expected: string,
    received: any,
    context?: Record<string, any>
  ) {
    super(
      field,
      `Expected ${expected}, received ${typeof received}`,
      received,
      context
    );
  }
}

// Service errors
export class ServiceUnavailableError extends AuthError {
  constructor(service: string, context?: Record<string, any>) {
    super(
      `Service '${service}' is currently unavailable`,
      "SERVICE_UNAVAILABLE",
      503,
      true,
      context
    );
  }
}

export class ExternalServiceError extends AuthError {
  public readonly service: string;
  public readonly externalError?: any;

  constructor(
    service: string,
    message: string,
    externalError?: any,
    context?: Record<string, any>
  ) {
    super(
      `External service '${service}' error: ${message}`,
      "EXTERNAL_SERVICE_ERROR",
      502,
      true,
      context
    );
    this.service = service;
    this.externalError = externalError;
  }
}

export class DatabaseError extends AuthError {
  public readonly operation: string;
  public readonly table?: string;

  constructor(
    operation: string,
    message: string,
    table?: string,
    context?: Record<string, any>
  ) {
    super(
      `Database ${operation} failed: ${message}`,
      "DATABASE_ERROR",
      500,
      false,
      context
    );
    this.operation = operation;
    this.table = table;
  }
}

export class CacheError extends AuthError {
  public readonly operation: string;
  public readonly key?: string;

  constructor(
    operation: string,
    message: string,
    key?: string,
    context?: Record<string, any>
  ) {
    super(
      `Cache ${operation} failed: ${message}`,
      "CACHE_ERROR",
      500,
      true,
      context
    );
    this.operation = operation;
    this.key = key;
  }
}

// Configuration errors
export class ConfigurationError extends AuthError {
  public readonly configKey: string;

  constructor(
    configKey: string,
    message: string,
    context?: Record<string, any>
  ) {
    super(
      `Configuration error for '${configKey}': ${message}`,
      "CONFIGURATION_ERROR",
      500,
      false,
      context
    );
    this.configKey = configKey;
  }
}

// Rate limiting errors
export class RateLimitExceededError extends AuthError {
  public readonly limit: number;
  public readonly window: number;
  public readonly resetTime: Date;

  constructor(
    limit: number,
    window: number,
    resetTime: Date,
    context?: Record<string, any>
  ) {
    super(
      `Rate limit exceeded. Limit: ${limit} requests per ${window} seconds`,
      "RATE_LIMIT_EXCEEDED",
      429,
      true,
      context
    );
    this.limit = limit;
    this.window = window;
    this.resetTime = resetTime;
  }
}
```

## Error Handling Strategies

### Centralized Error Handler

```typescript
class ErrorHandler {
  private errorLoggers = new Map<string, ErrorLogger>();
  private errorMetrics = new Map<string, ErrorMetrics>();
  private recoveryStrategies = new Map<string, RecoveryStrategy>();

  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorResponse> {
    // Classify error
    const errorType = this.classifyError(error);

    // Log error
    await this.logError(error, errorType, context);

    // Record metrics
    await this.recordErrorMetrics(error, errorType, context);

    // Attempt recovery if possible
    const recoveryResult = await this.attemptRecovery(
      error,
      errorType,
      context
    );

    // Generate response
    return this.generateErrorResponse(
      error,
      errorType,
      recoveryResult,
      context
    );
  }

  private classifyError(error: Error): ErrorType {
    if (error instanceof AuthError) {
      return {
        category: "authentication",
        severity: error.isOperational ? "low" : "high",
        retryable: this.isRetryableError(error),
        code: error.code,
      };
    }

    if (error instanceof ExternalServiceError) {
      return {
        category: "external_service",
        severity: "medium",
        retryable: true,
        code: error.code,
      };
    }

    if (error instanceof DatabaseError) {
      return {
        category: "database",
        severity: "high",
        retryable: this.isRetryableDatabaseError(error),
        code: error.code,
      };
    }

    // Unknown errors
    return {
      category: "unknown",
      severity: "high",
      retryable: false,
      code: "UNKNOWN_ERROR",
    };
  }

  private async logError(
    error: Error,
    errorType: ErrorType,
    context: ErrorContext
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: errorType.code,
      },
      context: {
        userId: context.userId,
        sessionId: context.sessionId,
        requestId: context.requestId,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        endpoint: context.endpoint,
        method: context.method,
      },
      type: errorType,
      severity: errorType.severity,
    };

    // Log to multiple destinations
    await Promise.allSettled([
      this.errorLoggers.get("console")?.log(logEntry),
      this.errorLoggers.get("file")?.log(logEntry),
      this.errorLoggers.get("remote")?.log(logEntry),
    ]);
  }

  private async recordErrorMetrics(
    error: Error,
    errorType: ErrorType,
    context: ErrorContext
  ): Promise<void> {
    const metrics = this.errorMetrics.get("prometheus");
    if (!metrics) return;

    await metrics.incrementCounter("auth_errors_total", {
      category: errorType.category,
      severity: errorType.severity,
      code: errorType.code,
      endpoint: context.endpoint,
    });

    if (errorType.severity === "high") {
      await metrics.incrementCounter("auth_errors_high_severity_total");
    }
  }

  private async attemptRecovery(
    error: Error,
    errorType: ErrorType,
    context: ErrorContext
  ): Promise<RecoveryResult> {
    const strategy = this.recoveryStrategies.get(errorType.category);
    if (!strategy || !errorType.retryable) {
      return { attempted: false, successful: false };
    }

    try {
      const result = await strategy.recover(error, context);
      return { attempted: true, successful: result.success, data: result.data };
    } catch (recoveryError) {
      await this.logError(
        recoveryError,
        { category: "recovery", severity: "medium", retryable: false },
        context
      );
      return { attempted: true, successful: false, error: recoveryError };
    }
  }

  private generateErrorResponse(
    error: Error,
    errorType: ErrorType,
    recovery: RecoveryResult,
    context: ErrorContext
  ): ErrorResponse {
    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === "development";

    const response: ErrorResponse = {
      success: false,
      error: {
        code: errorType.code,
        message:
          errorType.severity === "high" && !isDevelopment
            ? "An internal error occurred"
            : error.message,
        details: isDevelopment
          ? {
              name: error.name,
              stack: error.stack,
              context: error instanceof AuthError ? error.context : undefined,
            }
          : undefined,
      },
      timestamp: new Date().toISOString(),
      requestId: context.requestId,
    };

    // Add recovery information
    if (recovery.attempted) {
      response.recovery = {
        attempted: true,
        successful: recovery.successful,
      };
    }

    // Add retry information for client
    if (errorType.retryable && !recovery.successful) {
      response.retry = {
        recommended: true,
        after: this.calculateRetryDelay(errorType.category),
      };
    }

    return response;
  }

  private isRetryableError(error: AuthError): boolean {
    // Authentication errors are generally not retryable
    if (error instanceof AuthenticationError) {
      return false;
    }

    // Service unavailable errors are retryable
    if (error instanceof ServiceUnavailableError) {
      return true;
    }

    // Rate limit errors are retryable after reset time
    if (error instanceof RateLimitExceededError) {
      return true;
    }

    return false;
  }

  private isRetryableDatabaseError(error: DatabaseError): boolean {
    // Connection errors are retryable
    if (error.message.includes("connection")) {
      return true;
    }

    // Timeout errors are retryable
    if (error.message.includes("timeout")) {
      return true;
    }

    // Deadlock errors are retryable
    if (error.message.includes("deadlock")) {
      return true;
    }

    return false;
  }

  private calculateRetryDelay(category: string): number {
    const baseDelays = {
      external_service: 1000, // 1 second
      database: 5000, // 5 seconds
      rate_limit: 60000, // 1 minute
    };

    return baseDelays[category] || 1000;
  }
}
```

### Recovery Strategies

```typescript
interface RecoveryStrategy {
  recover(error: Error, context: ErrorContext): Promise<RecoveryResult>;
}

class DatabaseRecoveryStrategy implements RecoveryStrategy {
  async recover(
    error: DatabaseError,
    context: ErrorContext
  ): Promise<RecoveryResult> {
    if (error.operation === "connection") {
      // Attempt to reconnect
      try {
        await this.database.reconnect();
        return { success: true };
      } catch (reconnectError) {
        return { success: false, error: reconnectError };
      }
    }

    if (error.operation === "query" && error.message.includes("timeout")) {
      // Retry with exponential backoff
      const retryCount = context.retryCount || 0;
      if (retryCount < 3) {
        await this.delay(Math.pow(2, retryCount) * 1000);
        return { success: true, retry: true };
      }
    }

    return { success: false };
  }
}

class ExternalServiceRecoveryStrategy implements RecoveryStrategy {
  async recover(
    error: ExternalServiceError,
    context: ErrorContext
  ): Promise<RecoveryResult> {
    // Check if service is down
    const isDown = await this.healthCheck.isServiceDown(error.service);

    if (isDown) {
      // Use fallback service if available
      const fallback = this.fallbackServices.get(error.service);
      if (fallback) {
        return {
          success: true,
          data: { useFallback: true, fallbackService: fallback },
        };
      }

      // Return cached data if available
      const cached = await this.cache.getFallbackData(error.service, context);
      if (cached) {
        return { success: true, data: { useCache: true, cachedData: cached } };
      }
    }

    // Retry with circuit breaker
    if (this.circuitBreaker.canAttempt(error.service)) {
      return { success: true, retry: true };
    }

    return { success: false };
  }
}

class CacheRecoveryStrategy implements RecoveryStrategy {
  async recover(
    error: CacheError,
    context: ErrorContext
  ): Promise<RecoveryResult> {
    if (error.operation === "get") {
      // Fallback to database
      try {
        const data = await this.database.get(error.key);
        return { success: true, data: { fallbackData: data } };
      } catch (dbError) {
        return { success: false, error: dbError };
      }
    }

    if (error.operation === "set") {
      // Log and continue (cache write failures are often acceptable)
      this.logger.warn("Cache write failed, continuing without cache", {
        key: error.key,
      });
      return { success: true, data: { cacheDisabled: true } };
    }

    return { success: false };
  }
}

class AuthenticationRecoveryStrategy implements RecoveryStrategy {
  async recover(
    error: AuthenticationError,
    context: ErrorContext
  ): Promise<RecoveryResult> {
    // Most authentication errors are not recoverable
    // But we can provide helpful guidance

    if (error instanceof TokenExpiredError) {
      // Check if refresh token is available
      const refreshToken = await this.tokenManager.getRefreshToken(
        context.userId
      );
      if (refreshToken && !refreshToken.isExpired()) {
        try {
          const newTokens = await this.tokenManager.refreshTokens(refreshToken);
          return { success: true, data: { newTokens } };
        } catch (refreshError) {
          return { success: false, error: refreshError };
        }
      }
    }

    return { success: false };
  }
}
```

## Error Logging and Monitoring

### Structured Logging

```typescript
class StructuredLogger {
  private logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  private currentLevel = this.logLevels[process.env.LOG_LEVEL || "info"];

  async logError(error: AuthError, context: ErrorContext): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      category: "authentication",
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        stack: this.shouldIncludeStack(error) ? error.stack : undefined,
        context: error.context,
      },
      request: {
        id: context.requestId,
        method: context.method,
        url: context.endpoint,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        userId: context.userId,
        sessionId: context.sessionId,
      },
      environment: {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV,
        service: "auth-service",
        version: process.env.npm_package_version,
      },
    };

    // Write to multiple outputs
    await this.writeToOutputs(logEntry);
  }

  async logWarn(message: string, context?: Record<string, any>): Promise<void> {
    if (this.currentLevel < this.logLevels.warn) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "warn",
      message,
      context,
    };

    await this.writeToOutputs(logEntry);
  }

  async logInfo(message: string, context?: Record<string, any>): Promise<void> {
    if (this.currentLevel < this.logLevels.info) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message,
      context,
    };

    await this.writeToOutputs(logEntry);
  }

  private async writeToOutputs(logEntry: any): Promise<void> {
    const outputs = [
      this.writeToConsole(logEntry),
      this.writeToFile(logEntry),
      this.writeToRemote(logEntry),
    ];

    await Promise.allSettled(outputs);
  }

  private writeToConsole(logEntry: any): Promise<void> {
    return new Promise((resolve) => {
      console.log(JSON.stringify(logEntry, null, 2));
      resolve();
    });
  }

  private async writeToFile(logEntry: any): Promise<void> {
    const logFile = path.join(
      this.logDirectory,
      `${new Date().toISOString().split("T")[0]}.log`
    );
    const logLine = JSON.stringify(logEntry) + "\n";

    try {
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }

  private async writeToRemote(logEntry: any): Promise<void> {
    if (!this.remoteLoggingEnabled) return;

    try {
      await fetch(this.remoteLogEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.remoteLogToken}`,
        },
        body: JSON.stringify(logEntry),
      });
    } catch (error) {
      console.error("Failed to send log to remote:", error);
    }
  }

  private shouldIncludeStack(error: AuthError): boolean {
    // Include stack traces for non-operational errors
    return !error.isOperational;
  }
}
```

### Error Metrics and Alerting

```typescript
class ErrorMetricsCollector {
  private metrics = new Map<string, number>();
  private alerts = new Map<string, AlertRule>();

  async recordError(error: AuthError, context: ErrorContext): Promise<void> {
    const key = `${error.code}:${context.endpoint}`;

    // Increment error counter
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);

    // Check alert rules
    await this.checkAlerts(key, current + 1, error, context);

    // Record error rate
    await this.recordErrorRate(error.code);

    // Record error by category
    await this.recordErrorByCategory(error.constructor.name);
  }

  async recordErrorRate(errorCode: string): Promise<void> {
    const now = Date.now();
    const window = 5 * 60 * 1000; // 5 minutes

    // Get errors in the last window
    const recentErrors = Array.from(this.metrics.entries())
      .filter(([key]) => key.startsWith(errorCode))
      .reduce((sum, [, count]) => sum + count, 0);

    const rate = recentErrors / (window / 1000); // errors per second

    // Store rate for monitoring
    this.errorRates.set(errorCode, { rate, timestamp: now });
  }

  async checkAlerts(
    key: string,
    count: number,
    error: AuthError,
    context: ErrorContext
  ): Promise<void> {
    const rule = this.alerts.get(key);
    if (!rule) return;

    if (count >= rule.threshold) {
      await this.triggerAlert(rule, error, context, count);
    }
  }

  async triggerAlert(
    rule: AlertRule,
    error: AuthError,
    context: ErrorContext,
    count: number
  ): Promise<void> {
    const alert = {
      id: crypto.randomUUID(),
      rule: rule.name,
      severity: rule.severity,
      message: `Error threshold exceeded: ${count} ${error.code} errors in ${rule.window}ms`,
      error: {
        code: error.code,
        message: error.message,
        context: error.context,
      },
      context: {
        endpoint: context.endpoint,
        userId: context.userId,
        requestId: context.requestId,
      },
      timestamp: new Date().toISOString(),
    };

    // Send to alerting system
    await this.alertManager.sendAlert(alert);

    // Reset counter after alert
    this.metrics.set(rule.key, 0);
  }

  getErrorStats(): ErrorStats {
    return {
      totalErrors: Array.from(this.metrics.values()).reduce(
        (sum, count) => sum + count,
        0
      ),
      errorsByCode: Object.fromEntries(this.metrics),
      errorRates: Object.fromEntries(this.errorRates),
      topErrors: Array.from(this.metrics.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10),
    };
  }
}
```

## Error Recovery Patterns

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.state = "half-open";
      } else {
        throw new CircuitBreakerError("Circuit breaker is open");
      }
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.successCount++;

    if (
      this.state === "half-open" &&
      this.successCount >= this.successThreshold
    ) {
      this.state = "closed";
      this.successCount = 0;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }
}
```

### Retry with Exponential Backoff

```typescript
class RetryManager {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      backoffFactor = 2,
      retryCondition = () => true,
    } = options;

    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || !retryCondition(error)) {
          throw error;
        }

        const delay = Math.min(
          baseDelay * Math.pow(backoffFactor, attempt - 1),
          maxDelay
        );
        const jitter = Math.random() * 0.1 * delay; // Add 10% jitter

        await this.delay(delay + jitter);
      }
    }

    throw lastError!;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### Fallback Strategies

```typescript
class FallbackManager {
  private fallbacks = new Map<string, FallbackStrategy>();

  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackKey: string,
    context?: Record<string, any>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const fallback = this.fallbacks.get(fallbackKey);
      if (!fallback) {
        throw error;
      }

      this.logger.warn(`Primary operation failed, using fallback`, {
        fallbackKey,
        error: error.message,
      });

      try {
        return await fallback.execute(context);
      } catch (fallbackError) {
        this.logger.error(`Fallback also failed`, {
          fallbackKey,
          fallbackError: fallbackError.message,
        });
        throw fallbackError;
      }
    }
  }

  registerFallback(key: string, strategy: FallbackStrategy): void {
    this.fallbacks.set(key, strategy);
  }
}

// Example fallback strategies
class CacheFallback implements FallbackStrategy {
  async execute(context: any): Promise<any> {
    return await this.cache.get(context.key);
  }
}

class DatabaseFallback implements FallbackStrategy {
  async execute(context: any): Promise<any> {
    return await this.database.query(context.query);
  }
}

class DefaultValueFallback implements FallbackStrategy {
  constructor(private defaultValue: any) {}

  async execute(): Promise<any> {
    return this.defaultValue;
  }
}
```

## Error Response Formatting

```typescript
class ErrorResponseFormatter {
  formatError(
    error: AuthError,
    context: ErrorContext,
    includeStack: boolean = false
  ): ErrorResponse {
    const baseResponse = {
      success: false,
      error: {
        code: error.code,
        message: this.getErrorMessage(error, includeStack),
        timestamp: new Date().toISOString(),
        requestId: context.requestId,
      },
    };

    // Add additional fields based on error type
    if (error instanceof ValidationError) {
      return {
        ...baseResponse,
        error: {
          ...baseResponse.error,
          field: error.field,
          value: includeStack ? error.value : undefined,
        },
      };
    }

    if (error instanceof RateLimitExceededError) {
      return {
        ...baseResponse,
        error: {
          ...baseResponse.error,
          retryAfter: Math.ceil(
            (error.resetTime.getTime() - Date.now()) / 1000
          ),
        },
      };
    }

    if (error instanceof ExternalServiceError) {
      return {
        ...baseResponse,
        error: {
          ...baseResponse.error,
          service: error.service,
          retry: true,
        },
      };
    }

    return baseResponse;
  }

  private getErrorMessage(error: AuthError, includeStack: boolean): string {
    // In production, don't expose internal error details
    if (!includeStack && !error.isOperational) {
      return "An internal error occurred. Please try again later.";
    }

    return error.message;
  }

  formatValidationErrors(errors: ValidationError[]): ValidationErrorResponse {
    return {
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "One or more validation errors occurred",
        timestamp: new Date().toISOString(),
        fields: errors.map((err) => ({
          field: err.field,
          message: err.message,
          code: err.code,
        })),
      },
    };
  }
}
```
