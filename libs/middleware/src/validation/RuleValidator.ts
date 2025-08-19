import { Logger } from "@libs/monitoring";
import { ValidationConfig, MiddlewareContext } from "../types";
import {
  Validator,
  ValidationResult,
  ValidationError,
} from "./ValidationMiddleware";

/**
 * Validation rule interface
 */
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

/**
 * Validation rule set
 */
export interface ValidationRuleSet {
  body?: ValidationRule[];
  query?: ValidationRule[];
  params?: ValidationRule[];
}

/**
 * Rule-based validator implementation
 * Uses custom validation rules for flexible validation
 */
export class RuleValidator implements Validator {
  private readonly config: ValidationConfig;
  private readonly logger: Logger;
  private readonly ruleSets: Map<string, ValidationRuleSet>;

  constructor(config: ValidationConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: "RuleValidator" });
    this.ruleSets = new Map();

    // Initialize built-in rule sets
    this.initializeRuleSets();
  }

  /**
   * Validate request using custom rules
   */
  async validate(context: MiddlewareContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const validatedData: any = {};

    try {
      const ruleSet = this.getRuleSetForContext(context);
      if (!ruleSet) {
        return { valid: true };
      }

      // Validate body
      if (this.config.validateBody && ruleSet.body && context.request.body) {
        const bodyErrors = this.validateFields(
          context.request.body,
          ruleSet.body,
          "body"
        );
        errors.push(...bodyErrors);
        if (bodyErrors.length === 0) {
          validatedData.body = context.request.body;
        }
      }

      // Validate query parameters
      if (this.config.validateQuery && ruleSet.query && context.request.query) {
        const queryErrors = this.validateFields(
          context.request.query,
          ruleSet.query,
          "query"
        );
        errors.push(...queryErrors);
        if (queryErrors.length === 0) {
          validatedData.query = context.request.query;
        }
      }

      // Validate path parameters
      if (
        this.config.validateParams &&
        ruleSet.params &&
        context.request.params
      ) {
        const paramsErrors = this.validateFields(
          context.request.params,
          ruleSet.params,
          "params"
        );
        errors.push(...paramsErrors);
        if (paramsErrors.length === 0) {
          validatedData.params = context.request.params;
        }
      }

      // Apply input sanitization if enabled
      if (this.config.sanitizeInputs && errors.length === 0) {
        this.sanitizeData(validatedData);
      }

      return {
        valid: errors.length === 0,
        data: errors.length === 0 ? validatedData : undefined,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error("Rule validation error", error as Error);
      return {
        valid: false,
        errors: [
          {
            field: "validation",
            message: "Validation service error",
            code: "INTERNAL_ERROR",
          },
        ],
      };
    }
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
          code: "REQUIRED",
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
          code: "INVALID_TYPE",
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
            code: "TOO_SHORT",
          });
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be no more than ${rule.maxLength} characters long`,
            value,
            code: "TOO_LONG",
          });
        }

        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} format is invalid`,
            value,
            code: "INVALID_FORMAT",
          });
        }

        if (rule.enum && !rule.enum.includes(value)) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be one of: ${rule.enum.join(", ")}`,
            value,
            code: "INVALID_ENUM",
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
            code: "TOO_SMALL",
          });
        }

        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must be no more than ${rule.max}`,
            value,
            code: "TOO_LARGE",
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
            code: "TOO_FEW_ITEMS",
          });
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push({
            field: fieldPath,
            message: `${rule.field} must contain no more than ${rule.maxLength} items`,
            value,
            code: "TOO_MANY_ITEMS",
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
            code: "CUSTOM_VALIDATION",
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
   * Get rule set for context
   */
  private getRuleSetForContext(
    context: MiddlewareContext
  ): ValidationRuleSet | null {
    const path = context.request.url.split("?")[0];
    const method = context.request.method.toLowerCase();

    // Try to find specific rule set
    const ruleSetKey = `${method}:${path}`;
    let ruleSet = this.ruleSets.get(ruleSetKey);

    if (!ruleSet) {
      // Try wildcard matches
      for (const [key, rules] of this.ruleSets.entries()) {
        if (key.includes("*")) {
          const pattern = key.replace("*", ".*");
          const regex = new RegExp(`^${pattern}$`);
          if (regex.test(ruleSetKey)) {
            ruleSet = rules;
            break;
          }
        }
      }
    }

    if (!ruleSet) {
      // Try default rule set
      ruleSet = this.ruleSets.get("default");
    }

    return ruleSet || null;
  }

  /**
   * Initialize built-in rule sets
   */
  private initializeRuleSets(): void {
    // Data Intelligence rule sets
    this.addRuleSet("post:/analytics", {
      body: [
        {
          field: "type",
          type: "string",
          required: true,
          enum: ["overview", "conversion", "revenue", "performance", "custom"],
        },
        {
          field: "dateFrom",
          type: "string",
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}$/,
        },
        {
          field: "dateTo",
          type: "string",
          required: false,
          pattern: /^\d{4}-\d{2}-\d{2}$/,
        },
        {
          field: "aggregation",
          type: "string",
          required: false,
          enum: ["daily", "weekly", "monthly"],
        },
      ],
    });

    this.addRuleSet("get:/exports", {
      query: [
        {
          field: "format",
          type: "string",
          required: false,
          enum: ["json", "csv", "parquet"],
        },
        {
          field: "limit",
          type: "number",
          required: false,
          min: 1,
          max: 100000,
        },
        {
          field: "offset",
          type: "number",
          required: false,
          min: 0,
        },
      ],
    });

    this.addRuleSet("post:/quality/validate", {
      body: [
        {
          field: "table",
          type: "string",
          required: true,
          minLength: 1,
        },
        {
          field: "checks",
          type: "array",
          required: true,
          minLength: 1,
        },
      ],
    });

    this.addRuleSet("post:/reconciliation/rules", {
      body: [
        {
          field: "name",
          type: "string",
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        {
          field: "sourceTable",
          type: "string",
          required: true,
          minLength: 1,
        },
        {
          field: "targetTable",
          type: "string",
          required: true,
          minLength: 1,
        },
        {
          field: "joinKey",
          type: "string",
          required: true,
          minLength: 1,
        },
        {
          field: "enabled",
          type: "boolean",
          required: false,
        },
      ],
    });

    // Common parameter rules
    this.addRuleSet("default", {
      params: [
        {
          field: "id",
          type: "string",
          required: false,
          minLength: 1,
          maxLength: 100,
        },
        {
          field: "userId",
          type: "string",
          required: false,
          minLength: 1,
          maxLength: 100,
        },
        {
          field: "cartId",
          type: "string",
          required: false,
          minLength: 1,
          maxLength: 100,
        },
        {
          field: "shopId",
          type: "string",
          required: false,
          minLength: 1,
          maxLength: 100,
        },
      ],
      query: [
        {
          field: "limit",
          type: "number",
          required: false,
          min: 1,
          max: 1000,
        },
        {
          field: "offset",
          type: "number",
          required: false,
          min: 0,
        },
        {
          field: "format",
          type: "string",
          required: false,
          enum: ["json", "csv", "xml"],
        },
      ],
    });
  }

  /**
   * Add a custom rule set
   */
  public addRuleSet(key: string, ruleSet: ValidationRuleSet): void {
    this.ruleSets.set(key, ruleSet);
    this.logger.debug("Rule set added", { key });
  }

  /**
   * Remove a rule set
   */
  public removeRuleSet(key: string): void {
    this.ruleSets.delete(key);
    this.logger.debug("Rule set removed", { key });
  }

  /**
   * Get all rule set keys
   */
  public getRuleSetKeys(): string[] {
    return Array.from(this.ruleSets.keys());
  }

  /**
   * Sanitize validated data
   */
  private sanitizeData(data: any): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const sensitiveFields = ["password", "token", "secret", "key"];

    for (const [key, value] of Object.entries(data)) {
      const isSensitive = sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      );

      if (isSensitive) {
        (data as any)[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        // Basic string sanitization
        (data as any)[key] = value
          .trim()
          .replace(/[<>]/g, "") // Remove potential HTML tags
          .replace(/[\x00-\x1f\x7f]/g, ""); // Remove control characters
      } else if (typeof value === "object" && value !== null) {
        this.sanitizeData(value);
      }
    }
  }

  /**
   * Create common validation rules
   */
  public static createCommonRules() {
    return {
      // UUID validation
      uuid: {
        type: "string" as const,
        pattern:
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      },

      // Email validation
      email: {
        type: "string" as const,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      },

      // Date validation (YYYY-MM-DD)
      date: {
        type: "string" as const,
        pattern: /^\d{4}-\d{2}-\d{2}$/,
      },

      // DateTime validation (ISO 8601)
      datetime: {
        type: "string" as const,
        pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      },

      // Positive integer
      positiveInteger: {
        type: "number" as const,
        min: 1,
        custom: (value: any) => Number.isInteger(value) || "Must be an integer",
      },

      // Non-negative integer
      nonNegativeInteger: {
        type: "number" as const,
        min: 0,
        custom: (value: any) => Number.isInteger(value) || "Must be an integer",
      },
    };
  }
}
