import { BaseMiddleware, } from "../base/BaseMiddleware";
/**
 * Security Middleware
 * Implements various HTTP security headers following OWASP recommendations
 * Framework-agnostic implementation for comprehensive web security
 */
export class SecurityHttpMiddleware extends BaseMiddleware {
    defaultConfig = {
        contentSecurityPolicy: {
            enabled: true,
            directives: {
                "default-src": ["'self'"],
                "script-src": ["'self'", "'unsafe-inline'"],
                "style-src": ["'self'", "'unsafe-inline'"],
                "img-src": ["'self'", "data:", "https:"],
                "font-src": ["'self'"],
                "connect-src": ["'self'"],
                "frame-ancestors": ["'none'"],
                "base-uri": ["'self'"],
                "form-action": ["'self'"],
            },
        },
        hsts: {
            enabled: true,
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
        },
        frameOptions: "DENY",
        noSniff: true,
        xssFilter: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        permissionsPolicy: {
            camera: ["'none'"],
            microphone: ["'none'"],
            geolocation: ["'none'"],
            payment: ["'none'"],
        },
    };
    constructor(metrics, config) {
        const defaultConfig = {
            name: config.name || "security",
            enabled: config.enabled ?? true,
            priority: config.priority ?? 0,
            skipPaths: config.skipPaths || [],
            contentSecurityPolicy: {
                enabled: true,
                directives: {
                    "default-src": ["'self'"],
                    "script-src": ["'self'", "'unsafe-inline'"],
                    "style-src": ["'self'", "'unsafe-inline'"],
                    "img-src": ["'self'", "data:", "https:"],
                    "font-src": ["'self'"],
                    "connect-src": ["'self'"],
                    "frame-ancestors": ["'none'"],
                    "base-uri": ["'self'"],
                    "form-action": ["'self'"],
                },
            },
            hsts: {
                enabled: true,
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true,
            },
            frameOptions: "DENY",
            noSniff: true,
            xssFilter: true,
            referrerPolicy: "strict-origin-when-cross-origin",
            permissionsPolicy: {
                camera: ["'none'"],
                microphone: ["'none'"],
                geolocation: ["'none'"],
                payment: ["'none'"],
            },
            ...config, // Override with user config
        };
        super(metrics, defaultConfig);
    }
    /**
     * Execute security middleware - adds security headers to response
     */
    async execute(context, next) {
        const startTime = performance.now();
        try {
            // Set security headers before processing request
            this.setSecurityHeaders(context);
            // Record metrics
            await this.recordMetric("security_headers_applied");
            // Continue with next middleware/handler
            await next();
        }
        catch (error) {
            const duration = performance.now() - startTime;
            await this.recordTimer("security_middleware_error_duration", duration);
            this.logger.error("Security middleware error", error, {
                path: context.request.url,
                method: context.request.method,
                requestId: context.requestId,
            });
            throw error;
        }
        finally {
            await this.recordTimer("security_middleware_duration", performance.now() - startTime);
        }
    }
    /**
     * Set security headers based on configuration
     */
    setSecurityHeaders(context) {
        const config = this.mergeConfig(this.defaultConfig, this.config);
        const { set } = context;
        set.headers = set.headers || {};
        // Content Security Policy
        if (config.contentSecurityPolicy?.enabled) {
            const cspValue = this.buildCSPHeader(config.contentSecurityPolicy.directives || {});
            if (cspValue) {
                set.headers["Content-Security-Policy"] = cspValue;
            }
        }
        // HTTP Strict Transport Security
        if (config.hsts?.enabled) {
            let hstsValue = `max-age=${config.hsts.maxAge}`;
            if (config.hsts.includeSubDomains) {
                hstsValue += "; includeSubDomains";
            }
            if (config.hsts.preload) {
                hstsValue += "; preload";
            }
            set.headers["Strict-Transport-Security"] = hstsValue;
        }
        // X-Frame-Options
        if (config.frameOptions !== false) {
            set.headers["X-Frame-Options"] = config.frameOptions || "DENY";
        }
        // X-Content-Type-Options
        if (config.noSniff) {
            set.headers["X-Content-Type-Options"] = "nosniff";
        }
        // X-XSS-Protection
        if (config.xssFilter !== false) {
            if (typeof config.xssFilter === "boolean") {
                set.headers["X-XSS-Protection"] = "1; mode=block";
            }
            else if (config.xssFilter?.mode) {
                let xssValue = "1";
                if (config.xssFilter.mode === "block") {
                    xssValue += "; mode=block";
                }
                else if (config.xssFilter.mode === "report" &&
                    config.xssFilter.reportUri) {
                    xssValue += `; report=${config.xssFilter.reportUri}`;
                }
                set.headers["X-XSS-Protection"] = xssValue;
            }
        }
        // Referrer Policy
        if (config.referrerPolicy) {
            set.headers["Referrer-Policy"] = config.referrerPolicy;
        }
        // Permissions Policy
        if (config.permissionsPolicy) {
            const permissionsValue = this.buildPermissionsPolicyHeader(config.permissionsPolicy);
            if (permissionsValue) {
                set.headers["Permissions-Policy"] = permissionsValue;
            }
        }
        // Custom headers
        if (config.customHeaders) {
            Object.entries(config.customHeaders).forEach(([key, value]) => {
                set.headers[key] = value;
            });
        }
        // Additional security headers
        set.headers["X-Powered-By"] = ""; // Remove server signature
        set.headers["Server"] = ""; // Remove server signature
        this.logger.debug("Security headers applied", {
            path: context.request.url,
            headersCount: Object.keys(set.headers).length,
            requestId: context.requestId,
        });
    }
    /**
     * Build Content Security Policy header value
     */
    buildCSPHeader(directives) {
        return Object.entries(directives)
            .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
            .join("; ");
    }
    /**
     * Build Permissions Policy header value
     */
    buildPermissionsPolicyHeader(policies) {
        return Object.entries(policies)
            .map(([feature, allowlist]) => `${feature}=(${allowlist.join(" ")})`)
            .join(", ");
    }
    /**
     * Deep merge configurations
     */
    mergeConfig(defaultConfig, userConfig) {
        const result = { ...userConfig };
        // Merge default config
        Object.assign(result, defaultConfig, userConfig);
        // Deep merge nested objects
        if (defaultConfig.contentSecurityPolicy && result.contentSecurityPolicy) {
            result.contentSecurityPolicy = {
                ...defaultConfig.contentSecurityPolicy,
                ...result.contentSecurityPolicy,
                directives: {
                    ...defaultConfig.contentSecurityPolicy.directives,
                    ...result.contentSecurityPolicy.directives,
                },
            };
        }
        if (defaultConfig.hsts && result.hsts) {
            result.hsts = { ...defaultConfig.hsts, ...result.hsts };
        }
        if (defaultConfig.permissionsPolicy && result.permissionsPolicy) {
            result.permissionsPolicy = {
                ...defaultConfig.permissionsPolicy,
                ...result.permissionsPolicy,
            };
        }
        if (defaultConfig.customHeaders && result.customHeaders) {
            result.customHeaders = {
                ...defaultConfig.customHeaders,
                ...result.customHeaders,
            };
        }
        return result;
    }
    /**
     * Create preset configurations
     */
    static createDevelopmentConfig() {
        return {
            contentSecurityPolicy: {
                enabled: false, // Disable for development flexibility
            },
            hsts: {
                enabled: false, // Not needed for development
            },
            frameOptions: "SAMEORIGIN",
            noSniff: true,
            xssFilter: true,
            referrerPolicy: "no-referrer-when-downgrade",
        };
    }
    static createProductionConfig() {
        return {
            contentSecurityPolicy: {
                enabled: true,
                directives: {
                    "default-src": ["'self'"],
                    "script-src": ["'self'"],
                    "style-src": ["'self'", "'unsafe-inline'"],
                    "img-src": ["'self'", "data:", "https:"],
                    "font-src": ["'self'"],
                    "connect-src": ["'self'"],
                    "frame-ancestors": ["'none'"],
                    "base-uri": ["'self'"],
                    "form-action": ["'self'"],
                    "upgrade-insecure-requests": [],
                },
            },
            hsts: {
                enabled: true,
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: true,
            },
            frameOptions: "DENY",
            noSniff: true,
            xssFilter: { mode: "block" },
            referrerPolicy: "strict-origin-when-cross-origin",
            permissionsPolicy: {
                camera: ["'none'"],
                microphone: ["'none'"],
                geolocation: ["'none'"],
                payment: ["'none'"],
                "display-capture": ["'none'"],
            },
        };
    }
    static createApiConfig() {
        return {
            contentSecurityPolicy: {
                enabled: false, // APIs don't need CSP
            },
            hsts: {
                enabled: true,
                maxAge: 31536000,
                includeSubDomains: true,
            },
            frameOptions: "DENY",
            noSniff: true,
            xssFilter: false, // Not needed for APIs
            referrerPolicy: "no-referrer",
            customHeaders: {
                "Cache-Control": "no-store, no-cache, must-revalidate",
                Pragma: "no-cache",
            },
        };
    }
    static createStrictConfig() {
        return {
            contentSecurityPolicy: {
                enabled: true,
                directives: {
                    "default-src": ["'none'"],
                    "script-src": ["'self'"],
                    "style-src": ["'self'"],
                    "img-src": ["'self'"],
                    "font-src": ["'self'"],
                    "connect-src": ["'self'"],
                    "frame-ancestors": ["'none'"],
                    "base-uri": ["'none'"],
                    "form-action": ["'none'"],
                    "upgrade-insecure-requests": [],
                },
            },
            hsts: {
                enabled: true,
                maxAge: 63072000, // 2 years
                includeSubDomains: true,
                preload: true,
            },
            frameOptions: "DENY",
            noSniff: true,
            xssFilter: { mode: "block" },
            referrerPolicy: "no-referrer",
            permissionsPolicy: {
                camera: ["'none'"],
                microphone: ["'none'"],
                geolocation: ["'none'"],
                payment: ["'none'"],
                "display-capture": ["'none'"],
                "web-share": ["'none'"],
                "clipboard-read": ["'none'"],
                "clipboard-write": ["'none'"],
            },
        };
    }
    /**
     * Factory method for creating SecurityHttpMiddleware with development config
     */
    static createDevelopment(metrics, additionalConfig) {
        const devConfig = SecurityHttpMiddleware.createDevelopmentConfig();
        const config = {
            ...devConfig,
            ...additionalConfig,
            enabled: true,
            name: "security-dev",
            priority: 0,
        };
        return new SecurityHttpMiddleware(metrics, config);
    }
    /**
     * Factory method for creating SecurityHttpMiddleware with production config
     */
    static createProduction(metrics, additionalConfig) {
        const prodConfig = SecurityHttpMiddleware.createProductionConfig();
        const config = {
            ...prodConfig,
            ...additionalConfig,
            enabled: true,
            name: "security-prod",
            priority: 0,
        };
        return new SecurityHttpMiddleware(metrics, config);
    }
    /**
     * Factory method for creating SecurityHttpMiddleware with API config
     */
    static createApi(metrics, additionalConfig) {
        const apiConfig = SecurityHttpMiddleware.createApiConfig();
        const config = {
            ...apiConfig,
            ...additionalConfig,
            enabled: true,
            name: "security-api",
            priority: 0,
        };
        return new SecurityHttpMiddleware(metrics, config);
    }
    /**
     * Factory method for creating SecurityHttpMiddleware with strict config
     */
    static createStrict(metrics, additionalConfig) {
        const strictConfig = SecurityHttpMiddleware.createStrictConfig();
        const config = {
            ...strictConfig,
            ...additionalConfig,
            enabled: true,
            name: "security-strict",
            priority: 0,
        };
        return new SecurityHttpMiddleware(metrics, config);
    }
}
/**
 * Factory function for easy middleware creation
 * @deprecated Use SecurityHttpMiddleware.createDevelopment, createProduction, createApi, or createStrict instead
 */
export function createSecurityHttpMiddleware(metrics, config) {
    const finalConfig = {
        enabled: true,
        name: "security",
        priority: 0,
        ...config,
    };
    return new SecurityHttpMiddleware(metrics, finalConfig);
}
//# sourceMappingURL=security.http.middleware.js.map