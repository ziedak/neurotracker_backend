/**
 * @fileoverview Centralized utility functions for middleware operations
 * @description Common utility functions used across middleware classes for validation,
 * sanitization, ID generation, and data processing
 */
/**
 * Validate middleware configuration
 * @param config - Configuration object to validate
 * @param type - Middleware type ('http' or 'websocket')
 * @returns ValidationResult with errors if any
 */
export function validateMiddlewareConfig(config, _type) {
    const errors = [];
    // Validate name
    if (!config.name || typeof config.name !== "string" || !config.name.trim()) {
        errors.push("Middleware name cannot be empty");
    }
    // Validate enabled flag
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
        errors.push("Middleware enabled must be a boolean");
    }
    // Validate priority
    if (config.priority !== undefined &&
        (typeof config.priority !== "number" ||
            !Number.isInteger(config.priority) ||
            config.priority < 0)) {
        errors.push("Middleware priority must be a non-negative integer");
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Sanitize sensitive data by redacting specified fields
 * @param data - Data to sanitize
 * @param sensitiveFields - Array of field names to redact
 * @returns Sanitized data
 */
export function sanitizeData(data, sensitiveFields) {
    if (!data || sensitiveFields.length === 0) {
        return data;
    }
    // Handle primitives
    if (typeof data !== "object" || data === null) {
        return data;
    }
    // Handle arrays
    if (Array.isArray(data)) {
        return data.map((item) => sanitizeData(item, sensitiveFields));
    }
    // Handle objects
    const dataObj = data;
    // Track visited objects to handle circular references
    const visited = new WeakSet();
    function sanitizeObject(obj) {
        if (visited.has(obj)) {
            return { "[CIRCULAR]": true };
        }
        visited.add(obj);
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))) {
                result[key] = "[REDACTED]";
            }
            else if (typeof value === "object" && value !== null) {
                if (Array.isArray(value)) {
                    result[key] = value.map((item) => sanitizeData(item, sensitiveFields));
                }
                else {
                    result[key] = sanitizeObject(value);
                }
            }
            else {
                result[key] = value;
            }
        }
        return result;
    }
    return sanitizeObject(dataObj);
}
/**
 * Generate a unique request ID
 * @returns Unique request identifier
 */
export function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
/**
 * Safely parse JSON string
 * @param jsonString - JSON string to parse
 * @returns Parsed object or error indicator
 */
export function parseJsonSafely(jsonString) {
    if (!jsonString || typeof jsonString !== "string") {
        return "[INVALID_JSON]";
    }
    try {
        return JSON.parse(jsonString);
    }
    catch {
        return "[INVALID_JSON]";
    }
}
/**
 * Extract client IP address from request headers
 * @param headers - Request headers
 * @returns Client IP address or undefined
 */
export function getClientIP(headers) {
    // Check for forwarded headers
    const forwardedFor = headers["x-forwarded-for"];
    if (forwardedFor) {
        const firstIp = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : forwardedFor;
        return firstIp ? firstIp.split(",")[0].trim() : undefined;
    }
    const realIp = headers["x-real-ip"];
    if (realIp) {
        return Array.isArray(realIp) ? realIp[0] : realIp;
    }
    return undefined;
}
/**
 * Validate if a path is properly formatted
 * @param path - Path to validate
 * @returns True if path is valid
 */
export function isValidPath(path) {
    if (!path || typeof path !== "string") {
        return false;
    }
    // Must start with /
    if (!path.startsWith("/")) {
        return false;
    }
    // Must not contain invalid sequences
    if (path.includes("//") || path.includes("/../") || path.includes("/./")) {
        return false;
    }
    return true;
}
/**
 * Match path against a pattern (supports wildcards).
 * Wildcard semantics:
 *   - `*` matches exactly one path segment (no slashes).
 *   - `/*` at the end matches any number of segments (multi-segment).
 * Example: "/api/*" matches "/api/foo" but not "/api/foo/bar"; "/api/*" with trailing slash matches "/api/foo/bar".
 * @param pattern - Pattern to match against (e.g., "/api/*")
 * @param path - Path to test
 * @returns True if path matches pattern
 */
const _regexCache = {};
export function matchPathPattern(pattern, path) {
    if (!pattern || !path) {
        return false;
    }
    // Exact match
    if (pattern === path) {
        return true;
    }
    // Wildcard matching
    if (pattern.includes("*")) {
        // Handle different wildcard patterns
        if (pattern.endsWith("/*")) {
            // Prefix pattern like "/api/*" - matches any path starting with the prefix
            const prefix = pattern.slice(0, -1); // Remove the "/*"
            return path.startsWith(prefix);
        }
        else {
            // General wildcard pattern - convert to regex with strict segment matching
            if (!_regexCache[pattern]) {
                const regexPattern = pattern
                    .replace(/\*/g, "([^/]+)") // * matches exactly one segment (no slashes)
                    .replace(/\//g, "\\/");
                _regexCache[pattern] = new RegExp(`^${regexPattern}$`);
            }
            return _regexCache[pattern].test(path);
        }
    }
    return false;
}
/**
 * Calculate request/response size
 * @param data - Data to measure
 * @returns Size in bytes
 */
export function calculateRequestSize(data) {
    if (!data) {
        return 0;
    }
    if (typeof data === "string") {
        return Buffer.byteLength(data, "utf8");
    }
    if (data instanceof Buffer) {
        return data.length;
    }
    try {
        return Buffer.byteLength(JSON.stringify(data), "utf8");
    }
    catch {
        return 0;
    }
}
/**
 * Format log message with context
 * @param message - Base message
 * @param context - Additional context data
 * @returns Formatted message
 */
export function formatLogMessage(message, context = {}) {
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(context).length > 0
        ? ` | ${Object.entries(context)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" ")}`
        : "";
    return `[${timestamp}] ${message}${contextStr}`;
}
/**
 * Middleware chain for managing multiple middleware functions
 */
export class MiddlewareChain {
    middlewares = [];
    /**
     * Add middleware to chain
     */
    add(name, middleware, priority = 0) {
        this.middlewares.push({
            name,
            middleware,
            priority,
            enabled: true,
        });
        // Sort by priority (lower priority first)
        this.middlewares.sort((a, b) => a.priority - b.priority);
    }
    /**
     * Remove middleware from chain
     */
    remove(name) {
        const index = this.middlewares.findIndex((m) => m.name === name);
        if (index >= 0) {
            this.middlewares.splice(index, 1);
            return true;
        }
        return false;
    }
    /**
     * Enable/disable middleware
     */
    toggle(name, enabled) {
        const middleware = this.middlewares.find((m) => m.name === name);
        if (middleware) {
            middleware.enabled = enabled;
            return true;
        }
        return false;
    }
    /**
     * Get all middlewares
     */
    getMiddlewares() {
        return this.middlewares
            .filter((m) => m.enabled)
            .map((m) => ({
            name: m.name,
            priority: m.priority,
            enabled: m.enabled,
        }));
    }
    /**
     * Execute middleware chain
     */
    async execute(context) {
        let index = 0;
        const next = async () => {
            if (index >= this.middlewares.length) {
                return;
            }
            const current = this.middlewares[index++];
            if (!current?.enabled) {
                return next();
            }
            await current.middleware(context, next);
        };
        await next();
    }
}
/**
 * Create middleware chain
 * @param middlewares - Array of middleware configurations
 * @returns MiddlewareChain instance
 */
export function createMiddlewareChain(middlewares) {
    const chain = new MiddlewareChain();
    for (const mw of middlewares) {
        chain.add(mw.name, mw.middleware, mw.priority ?? 0);
        if (mw.enabled === false) {
            chain.toggle(mw.name, false);
        }
    }
    return chain;
}
//# sourceMappingURL=middleware.utils.js.map