import { Logger } from "@libs/monitoring";

export interface ValidationRule {
  field: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
  custom?: (value: any) => boolean | string;
}

export interface ValidationSchema {
  body?: ValidationRule[];
  query?: ValidationRule[];
  params?: ValidationRule[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * Validation middleware for data intelligence service
 */
export class ValidationMiddleware {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Create validation middleware
   */
  validate(schema: ValidationSchema) {
    return async (context: any, next: () => Promise<void>) => {
      const { request, set } = context;
      const errors: ValidationError[] = [];

      try {
        // Validate request body
        if (schema.body && request.body) {
          const bodyErrors = this.validateFields(
            request.body,
            schema.body,
            "body"
          );
          errors.push(...bodyErrors);
        }

        // Validate query parameters
        if (schema.query && request.query) {
          const queryErrors = this.validateFields(
            request.query,
            schema.query,
            "query"
          );
          errors.push(...queryErrors);
        }

        // Validate path parameters
        if (schema.params && request.params) {
          const paramErrors = this.validateFields(
            request.params,
            schema.params,
            "params"
          );
          errors.push(...paramErrors);
        }

        // If validation errors exist, return them
        if (errors.length > 0) {
          set.status = 400;
          return {
            error: "Validation failed",
            message: "Request contains invalid data",
            details: errors,
            code: "VALIDATION_ERROR",
          };
        }

        await next();
      } catch (error) {
        this.logger.error("Validation middleware error", error as Error, {
          url: request.url,
          method: request.method,
        });

        set.status = 500;
        return {
          error: "Internal server error",
          message: "Validation service error",
          code: "VALIDATION_SERVICE_ERROR",
        };
      }
    };
  }

  /**
   * Validate fields against rules
   */
  private validateFields(
    data: any,
    rules: ValidationRule[],
    context: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const value = data[rule.field];
      const fieldPath = `${context}.${rule.field}`;

      // Check required fields
      if (
        rule.required &&
        (value === undefined || value === null || value === "")
      ) {
        errors.push({
          field: fieldPath,
          message: `${rule.field} is required`,
          value,
        });
        continue;
      }

      // Skip validation if field is not required and not provided
      if (!rule.required && (value === undefined || value === null)) {
        continue;
      }

      // Type validation
      if (!this.validateType(value, rule.type)) {
        errors.push({
          field: fieldPath,
          message: `${rule.field} must be of type ${rule.type}`,
          value,
        });
        continue;
      }

      // String-specific validations
      if (rule.type === "string" && typeof value === "string") {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be at least ${rule.minLength} characters long`,
            value,
          });
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be no more than ${rule.maxLength} characters long`,
            value,
          });
        }

        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} format is invalid`,
            value,
          });
        }

        if (rule.enum && !rule.enum.includes(value)) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be one of: ${rule.enum.join(", ")}`,
            value,
          });
        }
      }

      // Number-specific validations
      if (rule.type === "number" && typeof value === "number") {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be at least ${rule.min}`,
            value,
          });
        }

        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be no more than ${rule.max}`,
            value,
          });
        }
      }

      // Array-specific validations
      if (rule.type === "array" && Array.isArray(value)) {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must contain at least ${rule.minLength} items`,
            value,
          });
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must contain no more than ${rule.maxLength} items`,
            value,
          });
        }
      }

      // Custom validation
      if (rule.custom) {
        const customResult = rule.custom(value);
        if (customResult !== true) {
          errors.push({
            field: fieldPath,
            message:
              typeof customResult === "string"
                ? customResult
                : `${rule.field} is invalid`,
            value,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validate value type
   */
  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "boolean":
        return typeof value === "boolean";
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      case "array":
        return Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Common validation schemas
   */
  static schemas = {
    featureComputation: {
      body: [
        {
          field: "cartId",
          type: "string" as const,
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        { field: "features", type: "object" as const, required: true },
        {
          field: "version",
          type: "string" as const,
          required: false,
          maxLength: 20,
        },
        { field: "computeRealtime", type: "boolean" as const, required: false },
      ],
    },

    reportGeneration: {
      body: [
        {
          field: "type",
          type: "string" as const,
          required: true,
          enum: ["overview", "conversion", "revenue", "performance", "custom"],
        },
        {
          field: "dateFrom",
          type: "string" as const,
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}$/,
        },
        {
          field: "dateTo",
          type: "string" as const,
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}$/,
        },
        {
          field: "aggregation",
          type: "string" as const,
          required: false,
          enum: ["daily", "weekly", "monthly"],
        },
      ],
    },

    dataExport: {
      query: [
        {
          field: "format",
          type: "string" as const,
          required: false,
          enum: ["json", "csv", "parquet"],
        },
        {
          field: "limit",
          type: "number" as const,
          required: false,
          min: 1,
          max: 100000,
        },
        { field: "offset", type: "number" as const, required: false, min: 0 },
        {
          field: "dateFrom",
          type: "string" as const,
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        },
        {
          field: "dateTo",
          type: "string" as const,
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        },
      ],
    },

    qualityValidation: {
      body: [
        {
          field: "table",
          type: "string" as const,
          required: true,
          minLength: 1,
        },
        {
          field: "checks",
          type: "array" as const,
          required: true,
          minLength: 1,
        },
      ],
    },

    reconciliationRule: {
      body: [
        {
          field: "name",
          type: "string" as const,
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        {
          field: "sourceTable",
          type: "string" as const,
          required: true,
          minLength: 1,
        },
        {
          field: "targetTable",
          type: "string" as const,
          required: true,
          minLength: 1,
        },
        {
          field: "joinKey",
          type: "string" as const,
          required: true,
          minLength: 1,
        },
        { field: "enabled", type: "boolean" as const, required: false },
      ],
    },

    userId: {
      params: [
        {
          field: "userId",
          type: "string" as const,
          required: true,
          minLength: 1,
          maxLength: 100,
        },
      ],
    },

    cartId: {
      params: [
        {
          field: "cartId",
          type: "string" as const,
          required: true,
          minLength: 1,
          maxLength: 100,
        },
      ],
    },
  };

  /**
   * Pre-built validation middleware functions
   */
  validateFeatureComputation() {
    return this.validate(ValidationMiddleware.schemas.featureComputation);
  }

  validateReportGeneration() {
    return this.validate(ValidationMiddleware.schemas.reportGeneration);
  }

  validateDataExport() {
    return this.validate(ValidationMiddleware.schemas.dataExport);
  }

  validateQualityValidation() {
    return this.validate(ValidationMiddleware.schemas.qualityValidation);
  }

  validateReconciliationRule() {
    return this.validate(ValidationMiddleware.schemas.reconciliationRule);
  }

  validateUserId() {
    return this.validate(ValidationMiddleware.schemas.userId);
  }

  validateCartId() {
    return this.validate(ValidationMiddleware.schemas.cartId);
  }
}
