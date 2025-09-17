/**
 * Security WebSocket Middleware
 * Production-grade WebSocket security middleware following BaseWebSocketMiddleware patterns
 *
 * Features:
 * - Connection-based security controls
 * - Message filtering and validation
 * - Rate limiting per connection
 * - Origin validation
 * - Protocol security enforcement
 * - Connection metadata sanitization
 */
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base/BaseWebSocketMiddleware";
import type { WebSocketContext } from "../types";
/**
 * Configuration for Security WebSocket middleware
 * Extends WebSocketMiddlewareConfig with security-specific options
 */
export interface SecurityWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly allowedOrigins: readonly string[];
    readonly maxConnectionsPerIP: number;
    readonly maxMessageSize: number;
    readonly allowedProtocols: readonly string[];
    readonly requireSecureConnection: boolean;
    readonly messageTypeWhitelist: readonly string[];
    readonly messageTypeBlacklist: readonly string[];
    readonly sanitizePayload?: boolean;
    readonly blockSuspiciousConnections?: boolean;
    readonly connectionTimeout: number;
    readonly maxIdleTime: number;
    readonly heartbeatInterval: number;
    readonly validateHeaders?: boolean;
    readonly customValidation?: (context: WebSocketContext) => boolean;
    readonly blockedIPs?: readonly string[];
    readonly allowedIPs?: readonly string[];
    readonly blockedPorts?: readonly number[];
    readonly enableOriginValidation?: boolean;
    readonly enableUserAgentValidation?: boolean;
    readonly enableRateLimiting?: boolean;
    readonly maxConnectionTime?: number;
    readonly rateLimitMax?: number;
}
/**
 * WebSocket Security Middleware
 * Extends BaseWebSocketMiddleware for WebSocket connection and message security
 */
export declare class SecurityWebSocketMiddleware extends BaseWebSocketMiddleware<SecurityWebSocketMiddlewareConfig> {
    private readonly connectionRegistry;
    private readonly ipConnectionCounts;
    private readonly scheduler;
    constructor(metrics: IMetricsCollector, config: Partial<SecurityWebSocketMiddlewareConfig>);
    /**
     * Main execution method for WebSocket security enforcement
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Register or update connection information
     */
    private registerConnection;
    /**
     * Validate connection-level security
     */
    private validateConnectionSecurity;
    /**
     * Validate message-level security
     */
    private validateMessageSecurity;
    /**
     * Validate message content for injection attacks
     */
    private validateMessageContent;
    /**
     * Sanitize message payload
     */
    private sanitizeMessagePayload;
    /**
     * Record security metrics
     */
    private recordSecurityMetrics;
    /**
     * Record security violation
     */
    private recordSecurityViolation;
    /**
     * Helper methods
     */
    private isOriginAllowed;
    private isUserAgentAllowed;
    private isIPAllowed;
    private isPortAllowed;
    private matchesIPPattern;
    private ipToNumber;
    private isSecureConnection;
    private isProtocolAllowed;
    private areHeadersValid;
    private getOrigin;
    private calculateMessageSize;
    /**
     * Cleanup stale connections and rate limit data
     */
    private startCleanupInterval;
    private cleanupStaleConnections;
    /**
     * Check if the current context should skip this middleware
     */
    protected shouldSkip(context: WebSocketContext): boolean;
    /**
     * Extract relevant information from WebSocket context for logging
     */
    protected extractContextInfo(context: WebSocketContext, extraInfoContext?: Record<string, unknown>): Record<string, unknown>;
    /**
     * Cleanup method to clear all timers and resources
     */
    cleanup(): void;
    /**
     * Create preset configurations
     */
    static createDevelopmentConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
    static createProductionConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
    static createHighSecurityConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
    static createApiGatewayConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
    /**
     * Factory methods for creating SecurityWebSocketMiddleware with different configs
     */
    static createDevelopment(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>): SecurityWebSocketMiddleware;
    static createProduction(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>): SecurityWebSocketMiddleware;
    static createHighSecurity(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>): SecurityWebSocketMiddleware;
    static createApiGateway(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>): SecurityWebSocketMiddleware;
    /**
     * Create strict security configuration preset
     */
    static createStrictConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
    /**
     * Create minimal security configuration preset
     */
    static createMinimalConfig(): Partial<SecurityWebSocketMiddlewareConfig>;
}
/**
 * Factory function for easy middleware creation
 * @deprecated Use SecurityWebSocketMiddleware.createDevelopment, createProduction, etc. instead
 */
export declare function createSecurityWebSocketMiddleware(metrics: IMetricsCollector, config?: Partial<SecurityWebSocketMiddlewareConfig>): SecurityWebSocketMiddleware;
//# sourceMappingURL=security.websocket.middleware.d.ts.map