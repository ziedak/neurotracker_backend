import { Logger } from "@libs/monitoring";

export interface ValidationRule {
  field: string;
  type: "string" | "number" | "boolean" | "email" | "date" | "array" | "object";
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => boolean | string;
}

export interface ValidationSchema {
  rules: ValidationRule[];
}

export interface ValidationErrorItem {
  field: string;
  message: string;
  value?: any;
}

/**
 * Validation Middleware for Dashboard
 * Provides comprehensive request validation with schema support
 */
export class ValidationMiddleware {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validate request data against a schema
   */
  async validate(request: any, schema?: ValidationSchema): Promise<any> {
    try {
      this.logger.debug("Starting validation", {
        hasSchema: !!schema,
        rulesCount: schema?.rules?.length || 0,
      });

      if (!schema) {
        // Basic validation without schema
        return this.basicValidation(request);
      }

      const errors = this.validateWithSchema(request, schema);

      if (errors.length > 0) {
        this.logger.warn("Validation failed", { errors });
        throw new ValidationRequestError("Validation failed", errors);
      }

      this.logger.debug("Validation passed");
      return request;
    } catch (error) {
      this.logger.error("Validation error", error as Error);
      throw error;
    }
  }

  /**
   * Basic validation without schema
   */
  private basicValidation(request: any): any {
    // Basic sanitization
    if (typeof request === "object" && request !== null) {
      return this.sanitizeObject(request);
    }
    return request;
  }

  /**
   * Validate request against schema
   */
  private validateWithSchema(
    data: any,
    schema: ValidationSchema
  ): ValidationErrorItem[] {
    const errors: ValidationErrorItem[] = [];

    for (const rule of schema.rules) {
      const fieldValue = this.getFieldValue(data, rule.field);
      const fieldErrors = this.validateField(fieldValue, rule);
      errors.push(...fieldErrors);
    }

    return errors;
  }

  /**
   * Validate a single field
   */
  private validateField(
    value: any,
    rule: ValidationRule
  ): ValidationErrorItem[] {
    const errors: ValidationErrorItem[] = [];

    // Check required
    if (
      rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      errors.push({
        field: rule.field,
        message: `${rule.field} is required`,
        value,
      });
      return errors; // No point checking other rules if required field is missing
    }

    // Skip other validations if field is optional and empty
    if (
      !rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      return errors;
    }

    // Type validation
    const typeError = this.validateType(value, rule);
    if (typeError) {
      errors.push(typeError);
      return errors; // No point checking other rules if type is wrong
    }

    // Length/range validation
    const rangeError = this.validateRange(value, rule);
    if (rangeError) {
      errors.push(rangeError);
    }

    // Pattern validation
    if (
      rule.pattern &&
      typeof value === "string" &&
      !rule.pattern.test(value)
    ) {
      errors.push({
        field: rule.field,
        message: `${rule.field} does not match required pattern`,
        value,
      });
    }

    // Custom validation
    if (rule.custom) {
      const customResult = rule.custom(value);
      if (customResult !== true) {
        errors.push({
          field: rule.field,
          message:
            typeof customResult === "string"
              ? customResult
              : `${rule.field} is invalid`,
          value,
        });
      }
    }

    return errors;
  }

  /**
   * Validate field type
   */
  private validateType(
    value: any,
    rule: ValidationRule
  ): ValidationErrorItem | null {
    switch (rule.type) {
      case "string":
        if (typeof value !== "string") {
          return {
            field: rule.field,
            message: `${rule.field} must be a string`,
            value,
          };
        }
        break;

      case "number":
        if (typeof value !== "number" || isNaN(value)) {
          return {
            field: rule.field,
            message: `${rule.field} must be a number`,
            value,
          };
        }
        break;

      case "boolean":
        if (typeof value !== "boolean") {
          return {
            field: rule.field,
            message: `${rule.field} must be a boolean`,
            value,
          };
        }
        break;

      case "email":
        if (typeof value !== "string" || !this.isValidEmail(value)) {
          return {
            field: rule.field,
            message: `${rule.field} must be a valid email address`,
            value,
          };
        }
        break;

      case "date":
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          return {
            field: rule.field,
            message: `${rule.field} must be a valid date`,
            value,
          };
        }
        break;

      case "array":
        if (!Array.isArray(value)) {
          return {
            field: rule.field,
            message: `${rule.field} must be an array`,
            value,
          };
        }
        break;

      case "object":
        if (
          typeof value !== "object" ||
          Array.isArray(value) ||
          value === null
        ) {
          return {
            field: rule.field,
            message: `${rule.field} must be an object`,
            value,
          };
        }
        break;
    }

    return null;
  }

  /**
   * Validate field range/length
   */
  private validateRange(
    value: any,
    rule: ValidationRule
  ): ValidationErrorItem | null {
    if (rule.min !== undefined) {
      if (typeof value === "string" || Array.isArray(value)) {
        if (value.length < rule.min) {
          return {
            field: rule.field,
            message: `${rule.field} must be at least ${rule.min} characters long`,
            value,
          };
        }
      } else if (typeof value === "number") {
        if (value < rule.min) {
          return {
            field: rule.field,
            message: `${rule.field} must be at least ${rule.min}`,
            value,
          };
        }
      }
    }

    if (rule.max !== undefined) {
      if (typeof value === "string" || Array.isArray(value)) {
        if (value.length > rule.max) {
          return {
            field: rule.field,
            message: `${rule.field} must be at most ${rule.max} characters long`,
            value,
          };
        }
      } else if (typeof value === "number") {
        if (value > rule.max) {
          return {
            field: rule.field,
            message: `${rule.field} must be at most ${rule.max}`,
            value,
          };
        }
      }
    }

    return null;
  }

  /**
   * Get field value from nested object
   */
  private getFieldValue(data: any, fieldPath: string): any {
    const parts = fieldPath.split(".");
    let value = data;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Sanitize object by removing dangerous properties
   */
  private sanitizeObject(obj: any): any {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    const dangerousKeys = ["__proto__", "constructor", "prototype"];

    for (const [key, value] of Object.entries(obj)) {
      if (!dangerousKeys.includes(key)) {
        sanitized[key] = this.sanitizeObject(value);
      }
    }

    return sanitized;
  }

  /**
   * Check if email is valid
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Create validation schema for common patterns
   */
  static createUserSchema(): ValidationSchema {
    return {
      rules: [
        { field: "name", type: "string", required: true, min: 2, max: 100 },
        { field: "email", type: "email", required: true },
      ],
    };
  }

  static createProductSchema(): ValidationSchema {
    return {
      rules: [
        { field: "name", type: "string", required: true, min: 2, max: 200 },
        { field: "price", type: "number", required: true, min: 0 },
        {
          field: "currency",
          type: "string",
          required: false,
          pattern: /^[A-Z]{3}$/,
        },
        { field: "description", type: "string", required: false, max: 1000 },
        { field: "category", type: "string", required: false, max: 100 },
      ],
    };
  }

  static createMetricsSchema(): ValidationSchema {
    return {
      rules: [
        { field: "dateFrom", type: "date", required: false },
        { field: "dateTo", type: "date", required: false },
        {
          field: "granularity",
          type: "string",
          required: false,
          custom: (value) => ["hour", "day", "week", "month"].includes(value),
        },
        { field: "metrics", type: "array", required: false },
      ],
    };
  }
}

/**
 * Custom ValidationError class
 */
export class ValidationRequestError extends Error {
  public readonly errors: ValidationErrorItem[];

  constructor(message: string, errors: ValidationErrorItem[]) {
    super(message);
    this.name = "ValidationRequestError";
    this.errors = errors;
  }
}
