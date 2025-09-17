import { generateUUId } from "@libs/utils";
import { AbstractMiddleware, } from "./AbstractMiddleware";
/**
 * Base class for HTTP middleware implementations
 * Provides HTTP-specific functionality while leveraging shared abstractions
 *
 * @template TConfig - Configuration type extending HttpMiddlewareConfig
 *
 * Features:
 * - Framework-agnostic middleware function creation
 * - Built-in path skipping logic
 * - Request context abstraction and IP extraction
 * - Security utilities for header and data sanitization
 * - Immutable configuration management
 *
 * Usage:
 * ```typescript
 * class SecurityMiddleware extends BaseMiddleware<SecurityConfig> {
 *   protected async execute(context: MiddlewareContext, next: () => Promise<void>) {
 *     // Security logic here
 *     await next();
 *   }
 * }
 *
 * // Usage
 * const middleware = new SecurityMiddleware(metrics, config);
 * const middlewareFunction = middleware.middleware();
 * ```
 */
export class BaseMiddleware extends AbstractMiddleware {
    constructor(metrics, config, name) {
        const httpDefaults = {
            skipPaths: [],
            enabled: true,
            priority: 0,
        };
        // Set default name if not provided
        const defaultName = name || config.name || "base-http";
        const configWithDefaults = {
            ...httpDefaults,
            ...config,
            name: defaultName,
        };
        // Validate configuration after merging defaults
        BaseMiddleware.validateConfig(configWithDefaults);
        super(metrics, configWithDefaults, defaultName);
    }
    /**
     * Hook called before request processing
     * Override in subclasses for custom pre-processing logic
     */
    beforeProcess(context) {
        this.logger.debug("Before request processing", {
            middlewareName: this.config.name,
            requestId: this.getRequestId(context),
        });
    }
    /**
     * Hook called after request processing
     * Override in subclasses for custom post-processing logic
     */
    afterProcess(context) {
        this.logger.debug("After request processing", {
            middlewareName: this.config.name,
            requestId: this.getRequestId(context),
        });
    }
    /**
     * Static method to validate configuration
     * Override in subclasses for custom validation
     */
    static validateConfig(config) {
        if (!config || typeof config !== "object") {
            throw new Error("Configuration must be an object");
        }
        const configObj = config;
        if (!configObj["name"] || typeof configObj["name"] !== "string") {
            throw new Error("Configuration must have a valid name");
        }
        if (configObj["enabled"] !== undefined &&
            typeof configObj["enabled"] !== "boolean") {
            throw new Error("Configuration enabled must be a boolean");
        }
        // HTTP-specific validation
        if (configObj["priority"] !== undefined &&
            (typeof configObj["priority"] !== "number" || configObj["priority"] < 0)) {
            throw new Error("Base HTTP priority must be a non-negative integer");
        }
        if (configObj["skipPaths"] !== undefined &&
            (!Array.isArray(configObj["skipPaths"]) ||
                !configObj["skipPaths"].every((path) => typeof path === "string"))) {
            throw new Error("Configuration skipPaths must be an array of strings");
        }
    }
    /**
     * Create middleware function for use in any HTTP framework
     */
    middleware() {
        return async (context, next) => {
            // Check if middleware is enabled
            if (!this.config.enabled) {
                this.logger.debug("Middleware disabled, skipping");
                return next();
            }
            // Check if path should be skipped
            if (this.shouldSkip(context)) {
                this.logger.debug("Path matched skip pattern, skipping", {
                    path: context.request.url,
                });
                return next();
            }
            // Execute middleware with error handling and timing
            const startTime = Date.now();
            try {
                await this.execute(context, next);
                await this.recordTimer(`${this.config.name}_duration`, Date.now() - startTime);
            }
            catch (error) {
                await this.handleError(error, context);
                throw error;
            }
        };
    }
    /**
     * Check if the current request should skip this middleware
     */
    shouldSkip(context) {
        const path = context.request.url.split("?")[0] || "";
        return (this.config.skipPaths?.some((skipPath) => {
            if (skipPath.endsWith("*")) {
                return path.startsWith(skipPath.slice(0, -1));
            }
            return path === skipPath || path.startsWith(`${skipPath}/`);
        }) || false);
    }
    /**
     * Extract relevant information from HTTP context for logging
     */
    extractContextInfo(context, extraInfoContext) {
        const contextInfo = {
            path: context.request.url,
            method: context.request.method,
            requestId: this.getRequestId(context),
            ip: this.getClientIp(context),
        };
        // Add extra context if provided
        if (extraInfoContext) {
            Object.assign(contextInfo, extraInfoContext);
        }
        return contextInfo;
    }
    /**
     * Extract client IP from request context
     */
    getClientIp(context) {
        const { headers } = context.request;
        return (headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            headers["x-real-ip"] ||
            headers["cf-connecting-ip"] ||
            context.request.ip ||
            "unknown");
    }
    /**
     * Generate a unique request ID if not present
     */
    getRequestId(context) {
        if (context.requestId) {
            return context.requestId;
        }
        const requestId = generateUUId(this.config.name);
        context.requestId = requestId;
        return requestId;
    }
    /**
     * Check if a header contains sensitive information
     */
    isSensitiveHeader(headerName, sensitiveFields = []) {
        const defaultSensitive = [
            "authorization",
            "cookie",
            "x-api-key",
            "x-auth-token",
        ];
        const allSensitive = [...defaultSensitive, ...sensitiveFields];
        return allSensitive.some((field) => headerName.toLowerCase().includes(field.toLowerCase()));
    }
    /**
     * Cleanup method for HTTP middleware
     * Default implementation - override in subclasses if needed
     */
    cleanup() {
        this.logger.debug("HTTP middleware cleanup completed", {
            middlewareName: this.config.name,
        });
    }
    /**
     * Update configuration with validation
     */
    updateConfig(configOverrides) {
        const newConfig = { ...this.config, ...configOverrides };
        // Call static validateConfig for validation
        this.constructor.validateConfig(newConfig);
        // Update config via property assignment
        Object.assign(this, {
            config: Object.freeze(newConfig),
        });
    }
    /**
     * Sort middleware instances by priority (lower priority numbers first = higher priority)
     */
    static sortByPriority(middlewares) {
        return middlewares.sort((a, b) => a.config.priority - b.config.priority);
    }
    /**
     * Factory method to create middleware instances
     */
    static create(metrics, config, MiddlewareClass) {
        return new MiddlewareClass(metrics, config, config.name);
    }
}
// Export aliases for backward compatibility
export const BaseHttpMiddleware = BaseMiddleware;
//# sourceMappingURL=BaseMiddleware.js.map