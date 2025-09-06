import { BaseMiddleware } from "../../base";
import { MiddlewareContext, ValidationConfig } from "../../types";
import { Logger, MetricsCollector, type ILogger } from "@libs/monitoring";
import { ZodValidator } from "./ZodValidator";
import { RuleValidator } from "./RuleValidator";

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  data?: any;
  errors?: ValidationError[] | undefined;
}

/**
 * Validation error interface
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  code?: string;
}

/**
 * Validator interface
 */
export interface Validator {
  validate(context: MiddlewareContext): Promise<ValidationResult>;
}

/**
 * Main validation middleware
 * Supports multiple validation engines (Zod, custom rules)
 */
export class ValidationMiddleware extends BaseMiddleware<ValidationConfig> {
  private readonly validator: Validator;

  constructor(
    config: ValidationConfig,
    logger: ILogger,
    metrics?: MetricsCollector
  ) {
    super("validation", config, logger, metrics);

    // Initialize appropriate validator based on engine
    if (config.engine === "zod") {
      this.validator = new ZodValidator(config, logger);
    } else if (config.engine === "rules") {
      this.validator = new RuleValidator(config, logger);
    } else {
      throw new Error(`Unknown validation engine: ${config.engine}`);
    }
  }

  async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any> {
    const startTime = performance.now();
    const requestId = this.getRequestId(context);

    try {
      // Check request size if configured
      if (this.config.maxRequestSize) {
        await this.checkRequestSize(context);
      }

      // Perform validation
      const result = await this.validator.validate(context);

      if (!result.valid) {
        context.set.status = 400;
        await this.recordMetric("validation_failed");

        this.logger.warn("Validation failed", {
          path: context.request.url,
          method: context.request.method,
          errors: result.errors?.length || 0,
          requestId,
        });

        return {
          error: "Validation failed",
          message: "Request contains invalid data",
          details: result.errors,
          code: "VALIDATION_ERROR",
          requestId,
        };
      }

      // Attach validated data to context
      if (result.data) {
        if (!context.validated) {
          context.validated = {};
        }

        // Store validated data by type
        if (result.data.body !== undefined) {
          context.validated.body = result.data.body;
        }
        if (result.data.query !== undefined) {
          context.validated.query = result.data.query;
        }
        if (result.data.params !== undefined) {
          context.validated.params = result.data.params;
        }
      }

      await this.recordMetric("validation_success");
      this.logger.debug("Validation successful", {
        path: context.request.url,
        method: context.request.method,
        engine: this.config.engine,
        requestId,
      });

      await next();
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordTimer("validation_error_duration", duration);

      this.logger.error("Validation middleware error", error as Error, {
        path: context.request.url,
        requestId,
        duration: Math.round(duration),
      });

      context.set.status = 500;
      return {
        error: "Validation service error",
        message: "Internal validation error",
        code: "VALIDATION_SERVICE_ERROR",
        requestId,
      };
    } finally {
      await this.recordTimer(
        "validation_duration",
        performance.now() - startTime
      );
    }
  }

  /**
   * Check request size limits
   */
  private async checkRequestSize(context: MiddlewareContext): Promise<void> {
    try {
      const contentLength = context.request.headers["content-length"];

      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > this.config.maxRequestSize!) {
          throw new Error(
            `Request size ${size} exceeds maximum allowed size ${this.config.maxRequestSize}`
          );
        }
      }

      // Also check actual body size if available
      if (context.request.body) {
        const bodySize = JSON.stringify(context.request.body).length;
        if (bodySize > this.config.maxRequestSize!) {
          throw new Error(
            `Request body size ${bodySize} exceeds maximum allowed size ${this.config.maxRequestSize}`
          );
        }
      }
    } catch (error) {
      if ((error as Error).message.includes("exceeds maximum")) {
        throw error;
      }
      // Ignore other size check errors
    }
  }

  /**
   * Factory method for common validation configurations
   */
  public static create(
    type: "ai-engine" | "data-intelligence" | "event-pipeline" | "api-gateway",
    overrides?: Partial<ValidationConfig>
  ): ValidationMiddleware {
    const configs = {
      "ai-engine": {
        engine: "zod" as const,
        strictMode: true,
        sanitizeInputs: true,
        maxRequestSize: 1024 * 1024, // 1MB
        validateBody: true,
        validateQuery: true,
      },
      "data-intelligence": {
        engine: "rules" as const,
        strictMode: true,
        sanitizeInputs: true,
        maxRequestSize: 10 * 1024 * 1024, // 10MB for data exports
        validateBody: true,
        validateQuery: true,
        validateParams: true,
      },
      "event-pipeline": {
        engine: "zod" as const,
        strictMode: false, // More lenient for event data
        sanitizeInputs: false, // Preserve event data integrity
        maxRequestSize: 5 * 1024 * 1024, // 5MB for batch events
        validateBody: true,
      },
      "api-gateway": {
        engine: "rules" as const,
        strictMode: false, // Gateway validates basics only
        sanitizeInputs: false, // Let downstream services handle
        maxRequestSize: 2 * 1024 * 1024, // 2MB
        validateQuery: true,
      },
    };

    const config = { ...configs[type], ...overrides };
    const logger = Logger.getInstance(type);
    const metrics = MetricsCollector.getInstance();

    return new ValidationMiddleware(config, logger, metrics);
  }

  /**
   * Create validation middleware for specific schema
   */
  public static forSchema(
    schemaName: string,
    engine: "zod" | "rules" = "zod",
    logger: ILogger
  ): ValidationMiddleware {
    const config: ValidationConfig = {
      engine,
      schemas: { [schemaName]: true },
      strictMode: true,
      sanitizeInputs: true,
      validateBody: true,
    };

    const metrics = MetricsCollector.getInstance();
    return new ValidationMiddleware(config, logger, metrics);
  }

  /**
   * Create Elysia plugin for this middleware
   */
  public elysia(config?: Partial<ValidationConfig>) {
    const finalConfig = config ? { ...this.config, ...config } : this.config;
    const middleware = new ValidationMiddleware(
      finalConfig,

      this.metrics
    );

    return (app: any) => {
      return app.onBeforeHandle(middleware.middleware());
    };
  }
}
