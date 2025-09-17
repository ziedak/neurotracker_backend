import { BaseMiddleware, type HttpMiddlewareConfig } from "../base/BaseMiddleware";
import { MiddlewareContext } from "../types";
import { type IMetricsCollector } from "@libs/monitoring";
export interface SecurityHttpMiddlewareConfig extends HttpMiddlewareConfig {
    contentSecurityPolicy?: {
        enabled?: boolean;
        directives?: Record<string, string[]>;
    };
    hsts?: {
        enabled?: boolean;
        maxAge?: number;
        includeSubDomains?: boolean;
        preload?: boolean;
    };
    frameOptions?: "DENY" | "SAMEORIGIN" | string | false;
    noSniff?: boolean;
    xssFilter?: boolean | {
        mode?: "block" | "report";
        reportUri?: string;
    };
    referrerPolicy?: string;
    permissionsPolicy?: Record<string, string[]>;
    customHeaders?: Record<string, string>;
}
/**
 * Security Middleware
 * Implements various HTTP security headers following OWASP recommendations
 * Framework-agnostic implementation for comprehensive web security
 */
export declare class SecurityHttpMiddleware extends BaseMiddleware<SecurityHttpMiddlewareConfig> {
    private readonly defaultConfig;
    constructor(metrics: IMetricsCollector, config: Partial<SecurityHttpMiddlewareConfig>);
    /**
     * Execute security middleware - adds security headers to response
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Set security headers based on configuration
     */
    private setSecurityHeaders;
    /**
     * Build Content Security Policy header value
     */
    private buildCSPHeader;
    /**
     * Build Permissions Policy header value
     */
    private buildPermissionsPolicyHeader;
    /**
     * Deep merge configurations
     */
    private mergeConfig;
    /**
     * Create preset configurations
     */
    static createDevelopmentConfig(): Partial<SecurityHttpMiddlewareConfig>;
    static createProductionConfig(): Partial<SecurityHttpMiddlewareConfig>;
    static createApiConfig(): Partial<SecurityHttpMiddlewareConfig>;
    static createStrictConfig(): Partial<SecurityHttpMiddlewareConfig>;
    /**
     * Factory method for creating SecurityHttpMiddleware with development config
     */
    static createDevelopment(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityHttpMiddlewareConfig>): SecurityHttpMiddleware;
    /**
     * Factory method for creating SecurityHttpMiddleware with production config
     */
    static createProduction(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityHttpMiddlewareConfig>): SecurityHttpMiddleware;
    /**
     * Factory method for creating SecurityHttpMiddleware with API config
     */
    static createApi(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityHttpMiddlewareConfig>): SecurityHttpMiddleware;
    /**
     * Factory method for creating SecurityHttpMiddleware with strict config
     */
    static createStrict(metrics: IMetricsCollector, additionalConfig?: Partial<SecurityHttpMiddlewareConfig>): SecurityHttpMiddleware;
}
/**
 * Factory function for easy middleware creation
 * @deprecated Use SecurityHttpMiddleware.createDevelopment, createProduction, createApi, or createStrict instead
 */
export declare function createSecurityHttpMiddleware(metrics: IMetricsCollector, config?: Partial<SecurityHttpMiddlewareConfig>): SecurityHttpMiddleware;
//# sourceMappingURL=security.http.middleware.d.ts.map