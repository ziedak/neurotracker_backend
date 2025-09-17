import { BaseWebSocketMiddleware, } from "../base";
/**
 * Default WebSocket CORS configuration constants
 */
const DEFAULT_WS_CORS_OPTIONS = {
    ORIGIN: "*",
    ALLOWED_PROTOCOLS: ["ws", "wss"],
    ALLOWED_EXTENSIONS: ["permessage-deflate", "x-webkit-deflate-frame"],
    CREDENTIALS: true,
    MAX_AGE: 86400, // 24 hours
    VALIDATE_UPGRADE: true,
    ALLOW_ORIGINLESS: false,
    PRIORITY: 100, // High priority for CORS
};
/**
 * Production-grade WebSocket CORS Middleware
 * Implements Cross-Origin Resource Sharing validation for WebSocket connections
 *
 * Features:
 * - WebSocket-specific CORS validation during connection upgrade
 * - Protocol and extension validation
 * - Origin validation with detailed logging
 * - Connection security validation
 * - Comprehensive monitoring and metrics
 * - Support for originless connections (controlled)
 *
 * @template CorsWebSocketMiddlewareConfig - WebSocket CORS-specific configuration
 */
export class CorsWebSocketMiddleware extends BaseWebSocketMiddleware {
    constructor(metrics, config = {}) {
        // Create complete configuration with validated defaults
        const completeConfig = {
            name: config.name || "websocket-cors",
            enabled: config.enabled ?? true,
            priority: config.priority ?? DEFAULT_WS_CORS_OPTIONS.PRIORITY,
            skipMessageTypes: config.skipMessageTypes || ["ping", "pong"],
            origin: config.origin ?? DEFAULT_WS_CORS_OPTIONS.ORIGIN,
            allowedProtocols: config.allowedProtocols ?? [
                ...DEFAULT_WS_CORS_OPTIONS.ALLOWED_PROTOCOLS,
            ],
            allowedExtensions: config.allowedExtensions ?? [
                ...DEFAULT_WS_CORS_OPTIONS.ALLOWED_EXTENSIONS,
            ],
            credentials: config.credentials ?? DEFAULT_WS_CORS_OPTIONS.CREDENTIALS,
            maxAge: config.maxAge ?? DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
            validateUpgrade: config.validateUpgrade ?? DEFAULT_WS_CORS_OPTIONS.VALIDATE_UPGRADE,
            allowOriginless: config.allowOriginless ?? DEFAULT_WS_CORS_OPTIONS.ALLOW_ORIGINLESS,
        };
        super(metrics, completeConfig, completeConfig.name);
        this.validateConfiguration();
    }
    /**
     * Core WebSocket CORS middleware execution logic
     * Validates CORS policies for WebSocket connections and messages
     */
    async execute(context, next) {
        const startTime = performance.now();
        const connectionId = this.getConnectionId(context);
        try {
            this.logger.debug("Processing WebSocket CORS validation", {
                connectionId,
                messageType: context.message?.type,
                hasUpgradeHeaders: !!context["upgradeHeaders"],
            });
            // Validate connection upgrade if headers are present (initial connection)
            if (context["upgradeHeaders"] && this.config.validateUpgrade) {
                await this.validateConnectionUpgrade(context);
            }
            // Validate ongoing message if not skipped
            if (context.message && !this.shouldSkip(context)) {
                await this.validateMessageOrigin(context);
            }
            // Record successful CORS validation
            await this.recordWebSocketCorsMetrics("validation_success", {
                connectionId,
                messageType: context.message?.type || "upgrade",
            });
            // Continue to next middleware
            await next();
        }
        catch (error) {
            await this.handleWebSocketCorsError(error, context);
            throw error; // Re-throw to maintain error chain
        }
        finally {
            const executionTime = performance.now() - startTime;
            await this.recordMetric("websocket_cors_execution_time", executionTime, {
                connectionId,
                messageType: context.message?.type || "upgrade",
            });
        }
    }
    /**
     * Validate WebSocket connection upgrade request
     */
    async validateConnectionUpgrade(context) {
        if (!context["upgradeHeaders"]) {
            throw new Error("Missing upgrade headers for WebSocket CORS validation");
        }
        const headers = this.extractUpgradeHeaders(context["upgradeHeaders"]);
        const { origin } = headers;
        this.logger.debug("Validating WebSocket upgrade", {
            origin: origin || "null",
            upgrade: headers.upgrade,
            connection: headers.connection,
            protocols: headers.secWebSocketProtocol,
            extensions: headers.secWebSocketExtensions,
        });
        // Validate origin
        const originValidation = this.validateOrigin(origin);
        if (!originValidation.allowed) {
            throw new Error(`WebSocket CORS origin validation failed: ${originValidation.reason}`);
        }
        // Validate upgrade headers
        this.validateUpgradeHeaders(headers);
        // Validate protocols if specified
        if (headers.secWebSocketProtocol) {
            this.validateProtocols(headers.secWebSocketProtocol);
        }
        // Validate extensions if specified
        if (headers.secWebSocketExtensions) {
            this.validateExtensions(headers.secWebSocketExtensions);
        }
        await this.recordWebSocketCorsMetrics("upgrade_validated", {
            origin: origin || "null",
            allowed: originValidation.allowed.toString(),
            reason: originValidation.reason || "unknown",
        });
    }
    /**
     * Validate message origin for ongoing WebSocket communication
     */
    async validateMessageOrigin(context) {
        const connectionId = this.getConnectionId(context);
        // For ongoing messages, we rely on the connection being already validated
        // Additional validation can be added here if needed for specific message types
        this.logger.debug("Validating WebSocket message origin", {
            connectionId,
            messageType: context.message?.type,
        });
        // Custom message-level validation can be implemented here
        // For now, we trust the connection-level validation
    }
    /**
     * Extract upgrade headers from context
     */
    extractUpgradeHeaders(upgradeHeaders) {
        const getHeader = (name) => {
            const value = upgradeHeaders[name.toLowerCase()];
            return Array.isArray(value) ? value[0] : value;
        };
        return {
            origin: getHeader("origin"),
            upgrade: getHeader("upgrade"),
            connection: getHeader("connection"),
            secWebSocketKey: getHeader("sec-websocket-key"),
            secWebSocketVersion: getHeader("sec-websocket-version"),
            secWebSocketProtocol: getHeader("sec-websocket-protocol"),
            secWebSocketExtensions: getHeader("sec-websocket-extensions"),
        };
    }
    /**
     * Validate WebSocket upgrade headers
     */
    validateUpgradeHeaders(headers) {
        if (!headers.upgrade || headers.upgrade.toLowerCase() !== "websocket") {
            throw new Error("Invalid or missing Upgrade header for WebSocket");
        }
        if (!headers.connection?.toLowerCase().includes("upgrade")) {
            throw new Error("Invalid or missing Connection header for WebSocket");
        }
        if (!headers.secWebSocketKey) {
            throw new Error("Missing Sec-WebSocket-Key header");
        }
        if (!headers.secWebSocketVersion) {
            throw new Error("Missing Sec-WebSocket-Version header");
        }
        // Validate WebSocket version (RFC 6455 specifies version 13)
        if (headers.secWebSocketVersion !== "13") {
            throw new Error(`Unsupported WebSocket version: ${headers.secWebSocketVersion}`);
        }
    }
    /**
     * Validate WebSocket protocols
     */
    validateProtocols(protocolHeader) {
        const requestedProtocols = protocolHeader.split(",").map((p) => p.trim());
        const { allowedProtocols } = this.config;
        if (!allowedProtocols || allowedProtocols.length === 0) {
            return; // No protocol restrictions
        }
        const hasValidProtocol = requestedProtocols.some((protocol) => allowedProtocols.includes(protocol));
        if (!hasValidProtocol) {
            throw new Error(`No allowed WebSocket protocols found. Requested: ${requestedProtocols.join(", ")}`);
        }
    }
    /**
     * Validate WebSocket extensions
     */
    validateExtensions(extensionsHeader) {
        const requestedExtensions = extensionsHeader.split(",").map((ext) => {
            // Extract extension name (before any parameters)
            return ext.trim().split(";")[0];
        });
        const { allowedExtensions } = this.config;
        if (!allowedExtensions || allowedExtensions.length === 0) {
            return; // No extension restrictions
        }
        const invalidExtensions = requestedExtensions.filter((ext) => ext && !allowedExtensions.includes(ext));
        if (invalidExtensions.length > 0) {
            throw new Error(`Unsupported WebSocket extensions: ${invalidExtensions.join(", ")}`);
        }
    }
    /**
     * Validate origin against configuration with detailed result
     */
    validateOrigin(origin) {
        if (!origin) {
            const allowed = this.config.allowOriginless ||
                this.config.origin === "*" ||
                this.config.origin === true;
            return {
                allowed,
                reason: allowed ? "originless_allowed" : "originless_forbidden",
            };
        }
        try {
            const { origin: allowedOrigin } = this.config;
            if (allowedOrigin === true || allowedOrigin === "*") {
                return {
                    allowed: true,
                    matchedOrigin: "*",
                    reason: "wildcard_allowed",
                };
            }
            if (typeof allowedOrigin === "string") {
                const allowed = origin === allowedOrigin;
                return {
                    allowed,
                    matchedOrigin: allowed ? allowedOrigin : undefined,
                    reason: allowed ? "exact_match" : "no_match",
                };
            }
            if (Array.isArray(allowedOrigin)) {
                const matchedOrigin = allowedOrigin.find((allowed) => allowed === origin);
                return {
                    allowed: !!matchedOrigin,
                    matchedOrigin,
                    reason: matchedOrigin ? "array_match" : "not_in_array",
                };
            }
            if (typeof allowedOrigin === "function") {
                const allowed = allowedOrigin(origin);
                return {
                    allowed,
                    matchedOrigin: allowed ? origin : undefined,
                    reason: allowed ? "function_approved" : "function_rejected",
                };
            }
            return { allowed: false, reason: "invalid_config" };
        }
        catch (error) {
            this.logger.error("WebSocket origin validation error", { origin, error });
            return { allowed: false, reason: "validation_error" };
        }
    }
    /**
     * Handle WebSocket CORS-related errors
     */
    async handleWebSocketCorsError(error, context) {
        const connectionId = this.getConnectionId(context);
        const errorMessage = error instanceof Error ? error.message : "Unknown WebSocket CORS error";
        this.logger.error("WebSocket CORS middleware error", {
            error: errorMessage,
            connectionId,
            messageType: context.message?.type,
            hasUpgradeHeaders: !!context["upgradeHeaders"],
        });
        await this.recordMetric("websocket_cors_error", 1, {
            error_type: error instanceof Error ? error.constructor.name : "unknown",
            connectionId,
            messageType: context.message?.type || "upgrade",
        });
        // Send error response if possible
        const websocket = context["websocket"];
        if (websocket && typeof websocket.send === "function") {
            try {
                const errorResponse = {
                    type: "error",
                    error: "CORS_VALIDATION_FAILED",
                    message: "WebSocket CORS validation failed",
                    timestamp: new Date().toISOString(),
                };
                websocket.send(JSON.stringify(errorResponse));
            }
            catch (sendError) {
                this.logger.error("Failed to send WebSocket CORS error response", {
                    sendError,
                });
            }
        }
    }
    /**
     * Record WebSocket CORS-specific metrics
     */
    async recordWebSocketCorsMetrics(action, additionalTags = {}) {
        await this.recordMetric(`websocket_cors_${action}`, 1, additionalTags);
    }
    /**
     * Validate configuration on instantiation
     */
    validateConfiguration() {
        const { allowedProtocols, allowedExtensions, maxAge } = this.config;
        if (allowedProtocols && allowedProtocols.length === 0) {
            throw new Error("WebSocket CORS allowed protocols array cannot be empty");
        }
        if (allowedExtensions?.some((ext) => !ext.trim())) {
            throw new Error("WebSocket CORS allowed extensions cannot contain empty strings");
        }
        if (maxAge !== undefined && (maxAge < 0 || !Number.isInteger(maxAge))) {
            throw new Error("WebSocket CORS maxAge must be a non-negative integer");
        }
    }
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig() {
        return {
            name: "websocket-cors-dev",
            origin: "*",
            credentials: true,
            allowedProtocols: ["ws", "wss"],
            allowedExtensions: ["*"], // Allow all extensions in development
            validateUpgrade: true,
            allowOriginless: true, // Allow originless connections in development
            enabled: true,
            priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create production configuration preset
     */
    static createProductionConfig(allowedOrigins) {
        return {
            name: "websocket-cors-prod",
            origin: [...allowedOrigins],
            credentials: true,
            allowedProtocols: ["wss"], // Only secure WebSocket in production
            allowedExtensions: ["permessage-deflate"],
            validateUpgrade: true,
            allowOriginless: false, // Strict origin validation in production
            maxAge: DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
            enabled: true,
            priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create real-time application configuration preset
     */
    static createRealtimeConfig(allowedOrigins) {
        return {
            name: "websocket-cors-realtime",
            origin: [...allowedOrigins],
            credentials: true,
            allowedProtocols: ["ws", "wss"],
            allowedExtensions: ["permessage-deflate", "x-webkit-deflate-frame"],
            validateUpgrade: true,
            allowOriginless: false,
            maxAge: DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
            enabled: true,
            priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create strict security configuration preset
     */
    static createStrictConfig(allowedOrigins) {
        return {
            name: "websocket-cors-strict",
            origin: [...allowedOrigins],
            credentials: true,
            allowedProtocols: ["wss"], // Only secure connections
            allowedExtensions: [], // No extensions allowed
            validateUpgrade: true,
            allowOriginless: false,
            maxAge: 3600, // 1 hour cache
            enabled: true,
            priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
        };
    }
}
/**
 * Factory function for WebSocket CORS middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function CorscreateWebSocketMiddleware(metrics, config) {
    return new CorsWebSocketMiddleware(metrics, config);
}
/**
 * Preset configurations for common WebSocket CORS scenarios
 * Immutable configuration objects for different environments and use cases
 */
export const WEBSOCKET_CORS_PRESETS = {
    development: () => CorsWebSocketMiddleware.createDevelopmentConfig(),
    production: (origins) => CorsWebSocketMiddleware.createProductionConfig(origins),
    realtime: (origins) => CorsWebSocketMiddleware.createRealtimeConfig(origins),
    strict: (origins) => CorsWebSocketMiddleware.createStrictConfig(origins),
    gaming: (origins) => ({
        name: "websocket-cors-gaming",
        origin: [...origins],
        credentials: true,
        allowedProtocols: ["wss"],
        allowedExtensions: ["permessage-deflate"], // Optimize for gaming performance
        validateUpgrade: true,
        allowOriginless: false,
        maxAge: DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
        enabled: true,
        priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
    }),
    streaming: (origins) => ({
        name: "websocket-cors-streaming",
        origin: [...origins],
        credentials: true,
        allowedProtocols: ["ws", "wss"],
        allowedExtensions: ["permessage-deflate", "x-webkit-deflate-frame"],
        validateUpgrade: true,
        allowOriginless: false,
        maxAge: DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
        enabled: true,
        priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
    }),
    chat: (origins) => ({
        name: "websocket-cors-chat",
        origin: [...origins],
        credentials: true,
        allowedProtocols: ["wss"],
        allowedExtensions: ["permessage-deflate"],
        validateUpgrade: true,
        allowOriginless: false,
        maxAge: DEFAULT_WS_CORS_OPTIONS.MAX_AGE,
        enabled: true,
        priority: DEFAULT_WS_CORS_OPTIONS.PRIORITY,
    }),
};
//# sourceMappingURL=cors.websocket.middleware.js.map