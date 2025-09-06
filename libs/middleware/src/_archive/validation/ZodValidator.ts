import { z } from "@libs/utils";
import { ILogger } from "@libs/monitoring";
import { ValidationConfig, MiddlewareContext } from "../../types";
import {
  Validator,
  ValidationResult,
  ValidationError,
} from "./ValidationMiddleware";

/**
 * Zod-based validator implementation
 * Uses Zod schemas for type-safe validation
 */
export class ZodValidator implements Validator {
  private readonly config: ValidationConfig;
  private readonly logger: ILogger;
  private readonly schemas: Map<string, z.ZodSchema>;

  constructor(config: ValidationConfig, logger: ILogger) {
    this.config = config;
    this.logger = createLogger( "ZodValidator" });
    this.schemas = new Map();

    // Initialize built-in schemas
    this.initializeSchemas();
  }

  /**
   * Validate request using Zod schemas
   */
  async validate(context: MiddlewareContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const validatedData: any = {};

    try {
      // Validate body
      if (this.config.validateBody && context.request.body) {
        const bodyResult = await this.validateBody(
          context.request.body,
          context
        );
        if (!bodyResult.valid) {
          errors.push(...bodyResult.errors!);
        } else {
          validatedData.body = bodyResult.data;
        }
      }

      // Validate query parameters
      if (this.config.validateQuery && context.request.query) {
        const queryResult = await this.validateQuery(
          context.request.query,
          context
        );
        if (!queryResult.valid) {
          errors.push(...queryResult.errors!);
        } else {
          validatedData.query = queryResult.data;
        }
      }

      // Validate path parameters
      if (this.config.validateParams && context.request.params) {
        const paramsResult = await this.validateParams(
          context.request.params,
          context
        );
        if (!paramsResult.valid) {
          errors.push(...paramsResult.errors!);
        } else {
          validatedData.params = paramsResult.data;
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
      this.logger.error("Zod validation error", error as Error);
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
   * Validate request body
   */
  private async validateBody(
    body: any,
    context: MiddlewareContext
  ): Promise<ValidationResult> {
    const schema = this.getSchemaForContext(context, "body");
    if (!schema) {
      return { valid: true, data: body };
    }

    return this.validateWithSchema(body, schema, "body");
  }

  /**
   * Validate query parameters
   */
  private async validateQuery(
    query: any,
    context: MiddlewareContext
  ): Promise<ValidationResult> {
    const schema = this.getSchemaForContext(context, "query");
    if (!schema) {
      return { valid: true, data: query };
    }

    return this.validateWithSchema(query, schema, "query");
  }

  /**
   * Validate path parameters
   */
  private async validateParams(
    params: any,
    context: MiddlewareContext
  ): Promise<ValidationResult> {
    const schema = this.getSchemaForContext(context, "params");
    if (!schema) {
      return { valid: true, data: params };
    }

    return this.validateWithSchema(params, schema, "params");
  }

  /**
   * Validate data against a Zod schema
   */
  private validateWithSchema(
    data: any,
    schema: z.ZodSchema,
    context: string
  ): ValidationResult {
    try {
      const result = schema.safeParse(data);

      if (result.success) {
        return {
          valid: true,
          data: result.data,
        };
      } else {
        const errors: ValidationError[] = result.error.errors.map(
          (err: { path: any[]; message: any; code: any }) => ({
            field: `${context}.${err.path.join(".")}`,
            message: err.message,
            value: data,
            code: err.code,
          })
        );

        return {
          valid: false,
          errors,
        };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            field: context,
            message: `Schema validation failed: ${(error as Error).message}`,
            code: "SCHEMA_ERROR",
          },
        ],
      };
    }
  }

  /**
   * Get appropriate schema for context
   */
  private getSchemaForContext(
    context: MiddlewareContext,
    type: "body" | "query" | "params"
  ): z.ZodSchema | null {
    const path = context.request.url.split("?")[0];
    const method = context.request.method.toLowerCase();

    // Try to find specific schema
    const schemaKey = `${method}:${path}:${type}`;
    let schema = this.schemas.get(schemaKey);

    if (!schema) {
      // Try generic schema for the type
      schema = this.schemas.get(type);
    }

    if (!schema) {
      // Try default schema
      schema = this.schemas.get("default");
    }

    return schema || null;
  }

  /**
   * Initialize built-in Zod schemas
   */
  private initializeSchemas(): void {
    // AI Engine schemas
    this.addSchema(
      "post:/predict:body",
      z.object({
        cartId: z.string().min(1).max(100),
        modelName: z.string().min(1),
        forceRecompute: z.boolean().optional().default(false),
        requestId: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      })
    );

    this.addSchema(
      "post:/batch-predict:body",
      z.object({
        requests: z
          .array(
            z.object({
              cartId: z.string().min(1),
              modelName: z.string().min(1),
              forceRecompute: z.boolean().optional().default(false),
              requestId: z.string().optional(),
            })
          )
          .min(1)
          .max(50),
        batchId: z.string().optional(),
      })
    );

    this.addSchema(
      "get:/explain:query",
      z.object({
        cartId: z.string().min(1),
        modelName: z.string().min(1),
        includeFeatures: z.boolean().optional().default(true),
        includeRecommendations: z.boolean().optional().default(true),
      })
    );

    // Event Pipeline schemas
    this.addSchema(
      "post:/events:body",
      z.object({
        userId: z.string().min(1),
        eventType: z.string().min(1),
        timestamp: z.number().int().positive(),
        metadata: z.record(z.any()).optional(),
      })
    );

    this.addSchema(
      "post:/events/batch:body",
      z
        .array(
          z.object({
            userId: z.string().min(1),
            eventType: z.string().min(1),
            timestamp: z.number().int().positive(),
            metadata: z.record(z.any()).optional(),
          })
        )
        .min(1)
        .max(1000)
    );

    // Data Intelligence schemas
    this.addSchema(
      "post:/analytics:body",
      z.object({
        type: z.enum([
          "overview",
          "conversion",
          "revenue",
          "performance",
          "custom",
        ]),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        aggregation: z.enum(["daily", "weekly", "monthly"]).optional(),
      })
    );

    this.addSchema(
      "get:/exports:query",
      z.object({
        format: z.enum(["json", "csv", "parquet"]).optional(),
        limit: z.coerce.number().int().min(1).max(100000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
          .optional(),
      })
    );

    // Common parameter schemas
    this.addSchema(
      "params",
      z.object({
        id: z.string().uuid().or(z.string().min(1)).optional(),
        userId: z.string().min(1).max(100).optional(),
        cartId: z.string().min(1).max(100).optional(),
      })
    );

    // Common query schemas
    this.addSchema(
      "query",
      z.object({
        limit: z.coerce.number().int().min(1).max(1000).optional().default(10),
        offset: z.coerce.number().int().min(0).optional().default(0),
        format: z.enum(["json", "csv", "xml"]).optional().default("json"),
      })
    );
  }

  /**
   * Add a custom schema
   */
  public addSchema(key: string, schema: z.ZodSchema): void {
    this.schemas.set(key, schema);
    this.logger.debug("Schema added", { key });
  }

  /**
   * Remove a schema
   */
  public removeSchema(key: string): void {
    this.schemas.delete(key);
    this.logger.debug("Schema removed", { key });
  }

  /**
   * Get all schema keys
   */
  public getSchemaKeys(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Sanitize validated data
   */
  private sanitizeData(data: any): void {
    if (!data || typeof data !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") {
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
   * Create schema transformer for common patterns
   */
  public static createTransformers() {
    return {
      // Transform string to number
      stringToNumber: z.string().transform((val: string) => parseInt(val, 10)),

      // Transform string to boolean
      stringToBoolean: z
        .string()
        .transform((val: string) => val.toLowerCase() === "true"),

      // Transform comma-separated string to array
      csvToArray: z
        .string()
        .transform((val: string) => val.split(",").map((s) => s.trim())),

      // Transform date string to Date object
      stringToDate: z
        .string()
        .transform((val: string | number | Date) => new Date(val)),

      // Trim whitespace
      trimString: z.string().transform((val: string) => val.trim()),

      // Normalize email
      normalizeEmail: z
        .string()
        .email()
        .transform((val: string) => val.toLowerCase()),
    };
  }
}
