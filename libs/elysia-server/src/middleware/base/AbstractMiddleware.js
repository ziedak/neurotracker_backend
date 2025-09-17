import { createLogger } from "@libs/utils";
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
export class AbstractMiddleware {
    metrics;
    logger;
    config;
    constructor(metrics, config, name) {
        this.metrics = metrics;
        // Create immutable configuration with defaults
        const defaults = {
            enabled: true,
            priority: 0,
        };
        this.config = Object.freeze({
            ...defaults,
            ...config,
            name: name || config.name,
        });
        this.logger = createLogger(`Middleware:${this.config.name}`);
        this.logger.debug("Middleware initialized", {
            name: this.config.name,
            enabled: this.config.enabled,
            priority: this.config.priority,
        });
    }
    /**
     * Create a new instance with merged configuration
     * Enables per-route configuration without modifying original instance
     * @param configOverrides - Configuration overrides
     */
    withConfig(configOverrides) {
        const mergedConfig = { ...this.config, ...configOverrides };
        return new this.constructor(this.metrics, mergedConfig);
    }
    /**
     * Handle errors that occur during middleware execution
     * @param error - The error that occurred
     * @param context - Protocol-specific context
     */
    async handleError(error, context) {
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
     * Record a metric counter with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    async recordMetric(name, value = 1, tags) {
        if (!this.metrics)
            return;
        try {
            await this.metrics.recordCounter(name, value, {
                middleware: this.config.name,
                ...tags,
            });
        }
        catch (error) {
            this.logger.warn("Failed to record metric", {
                name,
                error: error.message,
            });
        }
    }
    /**
     * Record a timing metric with consistent tagging
     * @param name - Metric name
     * @param duration - Duration in milliseconds
     * @param tags - Additional tags
     */
    async recordTimer(name, duration, tags) {
        if (!this.metrics)
            return;
        try {
            await this.metrics.recordTimer(name, duration, {
                middleware: this.config.name,
                ...tags,
            });
        }
        catch (error) {
            this.logger.warn("Failed to record timer", {
                name,
                error: error.message,
            });
        }
    }
    /**
     * Record a histogram metric with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    async recordHistogram(name, value, tags) {
        if (!this.metrics)
            return;
        try {
            await this.metrics.recordHistogram(name, value, {
                middleware: this.config.name,
                ...tags,
            });
        }
        catch (error) {
            this.logger.warn("Failed to record histogram", {
                name,
                error: error.message,
            });
        }
    }
    /**
     * Record a gauge metric with consistent tagging
     * @param name - Metric name
     * @param value - Metric value
     * @param tags - Additional tags
     */
    async recordGauge(name, value, tags) {
        if (!this.metrics)
            return;
        try {
            await this.metrics.recordGauge(name, value, {
                middleware: this.config.name,
                ...tags,
            });
        }
        catch (error) {
            this.logger.warn("Failed to record gauge", {
                name,
                error: error.message,
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
    sanitizeObject(obj, sensitiveFields = [], visited = new WeakSet()) {
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
        const sanitized = {};
        const defaultSensitive = ["password", "token", "secret", "key", "auth"];
        const allSensitive = [...defaultSensitive, ...sensitiveFields];
        // Pre-compile regex for faster matching (union of patterns)
        const sensitiveRegex = new RegExp(allSensitive.map((field) => field.toLowerCase()).join("|"), "i");
        for (const [key, value] of Object.entries(obj)) {
            const isSensitive = sensitiveRegex.test(key);
            if (isSensitive) {
                sanitized[key] = "[REDACTED]";
            }
            else if (typeof value === "object" && value !== null) {
                sanitized[key] = this.sanitizeObject(value, sensitiveFields, visited);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    /**
     * Get middleware configuration (readonly)
     */
    getConfig() {
        return this.config;
    }
    /**
     * Get middleware name
     */
    getName() {
        return this.config.name;
    }
    getPriority() {
        return this.config.priority;
    }
    /**
     * Check if middleware is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
}
//# sourceMappingURL=AbstractMiddleware.js.map