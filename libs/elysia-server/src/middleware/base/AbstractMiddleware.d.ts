import { type ILogger } from "@libs/utils";
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
export declare abstract class AbstractMiddleware<TConfig extends BaseMiddlewareConfig, TContext> {
    protected readonly metrics: IMetricsCollector;
    protected readonly logger: ILogger;
    protected readonly config: Readonly<TConfig>;
    constructor(metrics: IMetricsCollector, config: TConfig, name?: string);
    /**
     * Main execution method - must be implemented by subclasses
     * @param context - Protocol-specific context
     * @param next - Next middleware function
     */
    protected abstract execute(context: TContext, next: () => Promise<void>): Promise<void>;
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
    withConfig(configOverrides: Partial<TConfig>): this;
    /**
     * Handle errors that occur during middleware execution
     * @param error - The error that occurred
     * @param context - Protocol-specific context
     */
    protected handleError(error: Error, context: TContext): Promise<void>;
    /**
     * Extract relevant information from context for logging
     * Override in subclasses for protocol-specific information
     * @param context - Protocol-specific context
     */
    protected abstract extractContextInfo(context: TContext, extraInfo?: Record<string, unknown>): Record<string, unknown>;
    /**
     * Record a metric counter with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    protected recordMetric(name: string, value?: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record a timing metric with consistent tagging
     * @param name - Metric name
     * @param duration - Duration in milliseconds
     * @param tags - Additional tags
     */
    protected recordTimer(name: string, duration: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record a histogram metric with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    protected recordHistogram(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record a gauge metric with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    protected recordGauge(name: string, value: number, tags?: Record<string, string>): Promise<void>;
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
    protected sanitizeObject(obj: unknown, sensitiveFields?: string[], visited?: WeakSet<object>): unknown;
    /**
     * Abstract cleanup method - must be implemented by subclasses
     * Called when the middleware needs to clean up resources
     */
    abstract cleanup(): Promise<void> | void;
    /**
     * Get middleware configuration (readonly)
     */
    getConfig(): Readonly<TConfig>;
    /**
     * Get middleware name
     */
    getName(): string;
    getPriority(): number;
    /**
     * Check if middleware is enabled
     */
    isEnabled(): boolean;
}
//# sourceMappingURL=AbstractMiddleware.d.ts.map