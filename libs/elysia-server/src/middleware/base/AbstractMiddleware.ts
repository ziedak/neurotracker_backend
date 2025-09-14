import { createLogger, type ILogger } from "@libs/utils";
import { type IMetricsCollector } from "@libs/monitoring";

/**
 * Base configuration interface for all middleware
 */
export interface BaseMiddlewareConfig {
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
}

/**
 * Abstract base class for all middleware implementations
 * Provides shared functionality while remaining protocol-agnostic
 *
 * @template TConfig - Configuration type extending BaseMiddlewareConfig
 * @template TContext - Context type for the specific protocol (HTTP, WebSocket, etc.)
 *
 * Features:
 * - Immutable configuration management
 * - Consistent error handling and metrics
 * - Protocol-agnostic design
 * - Production-ready logging
 * - Type-safe context handling
 */
export abstract class AbstractMiddleware<
  TConfig extends BaseMiddlewareConfig,
  TContext
> {
  protected readonly logger: ILogger;
  protected readonly config: Readonly<TConfig>;

  constructor(
    protected readonly metrics: IMetricsCollector,
    config: TConfig,
    name?: string
  ) {
    // Create immutable configuration with defaults
    const defaults = {
      enabled: true,
      priority: 0,
    };

    this.config = Object.freeze({
      ...defaults,
      ...config,
      name: name || config.name,
    } as TConfig);

    this.logger = createLogger(`Middleware:${this.config.name}`);

    this.logger.debug("Middleware initialized", {
      name: this.config.name,
      enabled: this.config.enabled,
      priority: this.config.priority,
    });
  }

  /**
   * Main execution method - must be implemented by subclasses
   * @param context - Protocol-specific context
   * @param next - Next middleware function
   */
  protected abstract execute(
    context: TContext,
    next: () => Promise<void>
  ): Promise<void>;

  /**
   * Check if the current context should skip this middleware
   * @param context - Protocol-specific context
   */
  protected abstract shouldSkip(context: TContext): boolean;

  /**
   * Create a new instance with merged configuration
   * Enables per-route configuration without modifying original instance
   * @param configOverrides - Configuration overrides
   */
  public withConfig(configOverrides: Partial<TConfig>): this {
    const mergedConfig = { ...this.config, ...configOverrides } as TConfig;
    return new (this.constructor as new (
      metrics: IMetricsCollector,
      config: TConfig,
      name?: string
    ) => this)(this.metrics, mergedConfig);
  }

  /**
   * Handle errors that occur during middleware execution
   * @param error - The error that occurred
   * @param context - Protocol-specific context
   */
  protected async handleError(error: Error, context: TContext): Promise<void> {
    this.logger.error(`${this.config.name} middleware error`, error, {
      middlewareName: this.config.name,
      contextInfo: this.extractContextInfo(context),
    });

    await this.recordMetric(`${this.config.name}_error`, 1, {
      errorType: error.constructor.name,
      middlewareName: this.config.name,
    });
  }

  /**
   * Extract relevant information from context for logging
   * Override in subclasses for protocol-specific information
   * @param context - Protocol-specific context
   */
  protected abstract extractContextInfo(context: TContext): Record<string, unknown>;

  /**
   * Record a metric counter with consistent tagging
   * @param name - Metric name
   * @param value - Metric value
   * @param tags - Additional tags
   */
  protected async recordMetric(
    name: string,
    value: number = 1,
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.metrics) return;

    try {
      await this.metrics.recordCounter(name, value, {
        middleware: this.config.name,
        ...tags,
      });
    } catch (error) {
      this.logger.warn("Failed to record metric", {
        name,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Record a timing metric with consistent tagging
   * @param name - Metric name
   * @param duration - Duration in milliseconds
   * @param tags - Additional tags
   */
  protected async recordTimer(
    name: string,
    duration: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.metrics) return;

    try {
      await this.metrics.recordTimer(name, duration, {
        middleware: this.config.name,
        ...tags,
      });
    } catch (error) {
      this.logger.warn("Failed to record timer", {
        name,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Record a histogram metric with consistent tagging
   * @param name - Metric name
   * @param value - Metric value
   * @param tags - Additional tags
   */
  protected async recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.metrics) return;

    try {
      await this.metrics.recordHistogram(name, value, {
        middleware: this.config.name,
        ...tags,
      });
    } catch (error) {
      this.logger.warn("Failed to record histogram", {
        name,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Sanitize object by removing or masking sensitive fields
   * @param obj - Object to sanitize
   * @param sensitiveFields - Additional sensitive field patterns
   */
  /**
   * Sanitize object by removing or masking sensitive fields
   * Handles circular references to prevent infinite recursion
   * @param obj - Object to sanitize
   * @param sensitiveFields - Additional sensitive field patterns
   * @param visited - Internal set to track visited objects (for circular refs)
   */
  protected sanitizeObject(
    obj: unknown,
    sensitiveFields: string[] = [],
    visited: WeakSet<object> = new WeakSet()
  ): unknown {
    // Handle non-objects or null
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    // Prevent circular references
    if (visited.has(obj)) {
      return "[CIRCULAR_REFERENCE]";
    }
    visited.add(obj);

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, sensitiveFields, visited));
    }

    // Handle plain objects
    const sanitized: Record<string, unknown> = {};
    const defaultSensitive = ["password", "token", "secret", "key", "auth"];
    const allSensitive = [...defaultSensitive, ...sensitiveFields];

    // Pre-compile regex for faster matching (union of patterns)
    const sensitiveRegex = new RegExp(
      allSensitive.map(field => field.toLowerCase()).join("|"),
      "i"
    );

    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = sensitiveRegex.test(key);

      if (isSensitive) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeObject(value, sensitiveFields, visited);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get middleware configuration (readonly)
   */
  public getConfig(): Readonly<TConfig> {
    return this.config;
  }

  /**
   * Get middleware name
   */
  public getName(): string {
    return this.config.name;
  }

  /**
   * Check if middleware is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }
}
