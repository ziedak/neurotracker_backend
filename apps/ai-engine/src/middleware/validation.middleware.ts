import { Context } from "elysia";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { z } from "zod";
import { performance } from "perf_hooks";

/**
 * Validation schemas for AI Engine endpoints
 */
const ValidationSchemas = {
  // Prediction request validation
  predictRequest: z.object({
    cartId: z
      .string()
      .min(1, "Cart ID is required")
      .max(100, "Cart ID too long"),
    modelName: z.string().min(1, "Model name is required"),
    forceRecompute: z.boolean().optional().default(false),
    requestId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  }),

  // Batch prediction request validation
  batchPredictRequest: z.object({
    requests: z
      .array(
        z.object({
          cartId: z.string().min(1, "Cart ID is required"),
          modelName: z.string().min(1, "Model name is required"),
          forceRecompute: z.boolean().optional().default(false),
          requestId: z.string().optional(),
        })
      )
      .min(1, "At least one request is required")
      .max(50, "Too many requests in batch"),
    batchId: z.string().optional(),
  }),

  // Feature request validation
  featureRequest: z.object({
    cartId: z.string().min(1, "Cart ID is required"),
    forceRecompute: z.boolean().optional().default(false),
    featureNames: z.array(z.string()).optional(),
  }),

  // Model update request validation
  modelUpdateRequest: z.object({
    modelName: z.string().min(1, "Model name is required"),
    version: z.string().min(1, "Version is required"),
    metadata: z
      .object({
        description: z.string().optional(),
        algorithm: z.string().optional(),
        performance: z
          .object({
            accuracy: z.number().min(0).max(1),
            precision: z.number().min(0).max(1),
            recall: z.number().min(0).max(1),
            f1Score: z.number().min(0).max(1),
          })
          .optional(),
      })
      .optional(),
  }),

  // Cache invalidation request validation
  cacheInvalidationRequest: z.object({
    cartId: z.string().min(1, "Cart ID is required"),
    modelName: z.string().optional(),
    cacheType: z
      .enum(["prediction", "feature", "model", "all"])
      .optional()
      .default("all"),
  }),

  // Query parameters validation
  queryParams: z.object({
    cartId: z.string().min(1).optional(),
    modelName: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    offset: z.coerce.number().int().min(0).optional().default(0),
    format: z.enum(["json", "csv", "xml"]).optional().default("json"),
  }),

  // Explanation request validation
  explainRequest: z.object({
    cartId: z.string().min(1, "Cart ID is required"),
    modelName: z.string().min(1, "Model name is required"),
    includeFeatures: z.boolean().optional().default(true),
    includeRecommendations: z.boolean().optional().default(true),
  }),
};

interface ValidationConfig {
  enableRequestLogging: boolean;
  maxRequestSize: number;
  sanitizeInputs: boolean;
  strictMode: boolean;
}

/**
 * Validation Middleware for AI Engine
 * Handles request validation, sanitization, and parameter checking
 */
export class ValidationMiddleware {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly config: ValidationConfig;

  private readonly defaultConfig: ValidationConfig = {
    enableRequestLogging: true,
    maxRequestSize: 1024 * 1024, // 1MB
    sanitizeInputs: true,
    strictMode: true,
  };

  constructor(
    logger: Logger,
    metrics: MetricsCollector,
    config?: Partial<ValidationConfig>
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.config = { ...this.defaultConfig, ...config };

    this.logger.info("Validation Middleware initialized", {
      strictMode: this.config.strictMode,
      maxRequestSize: this.config.maxRequestSize,
    });
  }

  /**
   * Validate prediction request
   */
  validatePredictRequest = async (context: Context): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.predictRequest,
      "predict"
    );
  };

  /**
   * Validate batch prediction request
   */
  validateBatchPredictRequest = async (context: Context): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.batchPredictRequest,
      "batch_predict"
    );
  };

  /**
   * Validate feature request
   */
  validateFeatureRequest = async (context: Context): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.featureRequest,
      "feature"
    );
  };

  /**
   * Validate model update request
   */
  validateModelUpdateRequest = async (context: Context): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.modelUpdateRequest,
      "model_update"
    );
  };

  /**
   * Validate cache invalidation request
   */
  validateCacheInvalidationRequest = async (
    context: Context
  ): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.cacheInvalidationRequest,
      "cache_invalidation"
    );
  };

  /**
   * Validate explanation request
   */
  validateExplainRequest = async (context: Context): Promise<void> => {
    return this.validateRequest(
      context,
      ValidationSchemas.explainRequest,
      "explain"
    );
  };

  /**
   * Validate query parameters
   */
  validateQueryParams = async (context: Context): Promise<void> => {
    const startTime = performance.now();

    try {
      const { query } = context;

      // Validate query parameters
      const validatedQuery = ValidationSchemas.queryParams.parse(query);

      // Add validated query to context
      (context as any).validatedQuery = validatedQuery;

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("validation_query_duration", duration);

      this.logger.debug("Query parameters validated", {
        query: validatedQuery,
        duration: Math.round(duration),
      });
    } catch (error) {
      await this.handleValidationError(error, context, startTime, "query");
    }
  };

  /**
   * Generic request validation function
   */
  private async validateRequest(
    context: Context,
    schema: z.ZodSchema,
    requestType: string
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Check request size
      await this.checkRequestSize(context);

      // Get request body
      const body = await this.getRequestBody(context);

      // Validate against schema
      const validatedData = schema.parse(body);

      // Sanitize inputs if enabled
      if (this.config.sanitizeInputs) {
        this.sanitizeData(validatedData);
      }

      // Additional business logic validation
      await this.performBusinessValidation(validatedData, requestType);

      // Add validated data to context
      (context as any).validatedBody = validatedData;

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        `validation_${requestType}_duration`,
        duration
      );
      await this.metrics.recordCounter(`validation_${requestType}_success`);

      if (this.config.enableRequestLogging) {
        this.logger.debug("Request validated successfully", {
          requestType,
          dataSize: JSON.stringify(body).length,
          duration: Math.round(duration),
        });
      }
    } catch (error) {
      await this.handleValidationError(error, context, startTime, requestType);
    }
  }

  /**
   * Get request body with proper error handling
   */
  private async getRequestBody(context: Context): Promise<any> {
    try {
      const { body } = context;

      if (!body) {
        throw new Error("Request body is required");
      }

      // If body is already parsed, return it
      if (typeof body === "object") {
        return body;
      }

      // Try to parse JSON if it's a string
      if (typeof body === "string") {
        return JSON.parse(body);
      }

      return body;
    } catch (error) {
      throw new Error(
        "Invalid JSON in request body: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    }
  }

  /**
   * Check request size limits
   */
  private async checkRequestSize(context: Context): Promise<void> {
    try {
      const contentLength = context.request.headers.get("content-length");

      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > this.config.maxRequestSize) {
          throw new Error(
            `Request size ${size} exceeds maximum allowed size ${this.config.maxRequestSize}`
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("exceeds maximum")) {
        throw error;
      }
      // Ignore other size check errors if content-length header is missing
    }
  }

  /**
   * Sanitize input data
   */
  private sanitizeData(data: any): void {
    if (typeof data === "object" && data !== null) {
      Object.keys(data).forEach((key) => {
        if (typeof data[key] === "string") {
          // Basic sanitization - remove potentially dangerous characters
          data[key] = data[key]
            .replace(/[<>]/g, "") // Remove HTML tags
            .replace(/['"]/g, "") // Remove quotes
            .trim();
        } else if (typeof data[key] === "object") {
          this.sanitizeData(data[key]);
        }
      });
    }
  }

  /**
   * Perform business logic validation
   */
  private async performBusinessValidation(
    data: any,
    requestType: string
  ): Promise<void> {
    switch (requestType) {
      case "predict":
      case "batch_predict":
        await this.validatePredictionLogic(data);
        break;

      case "feature":
        await this.validateFeatureLogic(data);
        break;

      case "model_update":
        await this.validateModelUpdateLogic(data);
        break;

      case "explain":
        await this.validateExplanationLogic(data);
        break;

      default:
        // No additional validation needed
        break;
    }
  }

  /**
   * Validate prediction-specific business logic
   */
  private async validatePredictionLogic(data: any): Promise<void> {
    // Check cart ID format
    if (data.cartId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.cartId)) {
        throw new Error(
          "Cart ID must contain only alphanumeric characters, underscores, and hyphens"
        );
      }
    }

    // Validate model name
    if (data.modelName) {
      const validModels = [
        "cart_recovery",
        "purchase_probability",
        "customer_lifetime_value",
        "churn_prediction",
      ];

      if (!validModels.includes(data.modelName)) {
        throw new Error(
          `Invalid model name. Valid models: ${validModels.join(", ")}`
        );
      }
    }

    // Validate batch size for batch requests
    if (data.requests && Array.isArray(data.requests)) {
      if (data.requests.length > 50) {
        throw new Error("Batch size cannot exceed 50 requests");
      }

      // Check for duplicate cart IDs in batch
      const cartIds = data.requests.map((req: any) => req.cartId);
      const uniqueCartIds = new Set(cartIds);
      if (cartIds.length !== uniqueCartIds.size) {
        throw new Error("Duplicate cart IDs found in batch request");
      }
    }
  }

  /**
   * Validate feature-specific business logic
   */
  private async validateFeatureLogic(data: any): Promise<void> {
    // Validate feature names if provided
    if (data.featureNames && Array.isArray(data.featureNames)) {
      const validFeatures = [
        "cart_value",
        "session_duration",
        "page_views",
        "previous_purchases",
        "time_since_last_purchase",
        "device_type",
        "traffic_source",
        "user_engagement_score",
      ];

      const invalidFeatures = data.featureNames.filter(
        (name: string) => !validFeatures.includes(name)
      );

      if (invalidFeatures.length > 0) {
        throw new Error(`Invalid feature names: ${invalidFeatures.join(", ")}`);
      }
    }
  }

  /**
   * Validate model update business logic
   */
  private async validateModelUpdateLogic(data: any): Promise<void> {
    // Validate version format (semantic versioning)
    if (data.version) {
      const versionRegex = /^\d+\.\d+\.\d+$/;
      if (!versionRegex.test(data.version)) {
        throw new Error(
          "Version must follow semantic versioning format (x.y.z)"
        );
      }
    }

    // Validate performance metrics
    if (data.metadata?.performance) {
      const { accuracy, precision, recall, f1Score } =
        data.metadata.performance;

      // Logical validation: precision and recall should be consistent with F1 score
      if (
        precision !== undefined &&
        recall !== undefined &&
        f1Score !== undefined
      ) {
        const calculatedF1 = (2 * precision * recall) / (precision + recall);
        const tolerance = 0.01; // Allow small floating-point differences

        if (Math.abs(calculatedF1 - f1Score) > tolerance) {
          throw new Error(
            "F1 score is inconsistent with precision and recall values"
          );
        }
      }
    }
  }

  /**
   * Validate explanation request business logic
   */
  private async validateExplanationLogic(data: any): Promise<void> {
    // Ensure cart ID and model name combination makes sense
    if (data.cartId && data.modelName) {
      // Could check if a prediction exists for this combination
      // For now, just validate the format
      if (data.cartId.length > 100) {
        throw new Error("Cart ID is too long for explanation request");
      }
    }
  }

  /**
   * Handle validation errors
   */
  private async handleValidationError(
    error: any,
    context: Context,
    startTime: number,
    requestType: string
  ): Promise<void> {
    const duration = performance.now() - startTime;

    await this.metrics.recordTimer(
      `validation_${requestType}_error_duration`,
      duration
    );
    await this.metrics.recordCounter(`validation_${requestType}_error`);

    let errorMessage = "Validation failed";
    let statusCode = 400;

    if (error instanceof z.ZodError) {
      // Zod validation error
      const issues = error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      errorMessage = `Validation failed: ${issues}`;
    } else if (error instanceof Error) {
      errorMessage = error.message;

      // Set appropriate status codes
      if (error.message.includes("required")) {
        statusCode = 400;
      } else if (error.message.includes("exceeds maximum")) {
        statusCode = 413; // Payload Too Large
      } else if (error.message.includes("Invalid JSON")) {
        statusCode = 400;
      }
    }

    this.logger.error("Request validation failed", error, {
      requestType,
      path: context.path,
      duration: Math.round(duration),
      statusCode,
    });

    // Record validation event
    await this.recordValidationEvent("validation_failed", context, {
      requestType,
      error: errorMessage,
      duration,
    });

    context.set.status = statusCode;
    throw new Error(errorMessage);
  }

  /**
   * Record validation event for monitoring
   */
  private async recordValidationEvent(
    eventType: string,
    context: Context,
    data: any
  ): Promise<void> {
    try {
      const event = {
        type: eventType,
        path: context.path,
        method: context.request.method,
        timestamp: new Date().toISOString(),
        ...data,
      };

      // Record in metrics
      await this.metrics.recordCounter(`validation_event_${eventType}`);

      this.logger.debug("Validation event recorded", event);
    } catch (recordError) {
      this.logger.error(
        "Failed to record validation event",
        recordError as Error
      );
    }
  }

  /**
   * Get validation middleware health status
   */
  async getHealthStatus(): Promise<any> {
    return {
      status: "healthy",
      config: {
        strictMode: this.config.strictMode,
        maxRequestSize: this.config.maxRequestSize,
        sanitizeInputs: this.config.sanitizeInputs,
      },
      schemas: Object.keys(ValidationSchemas).length,
    };
  }
}
