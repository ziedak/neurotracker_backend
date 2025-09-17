export const DEFAULT_SERVER_CONFIG = {
    port: 3000,
    version: "1.0.0",
    swagger: {
        enabled: true,
        path: "/swagger",
    },
    websocket: {
        enabled: false,
        path: "/ws",
        idleTimeout: 120,
        maxPayloadLength: 16 * 1024 * 1024, // 16MB
        perMessageDeflate: false,
        backpressureLimit: 16 * 1024 * 1024, // 16MB
        closeOnBackpressureLimit: false,
    },
    middleware: {
        enabled: true,
        cors: {
            name: "cors",
            enabled: true,
            priority: 90,
            allowedOrigins: ["http://localhost:3000"],
            credentials: true,
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
        },
        auth: {
            name: "auth",
            enabled: false,
            priority: 10,
            requireAuth: false,
            allowAnonymous: true,
            bypassRoutes: ["/health", "/metrics", "/docs", "/swagger"],
            apiKeyAuth: true,
            jwtAuth: true,
            sessionAuth: false,
        },
        rateLimit: {
            name: "rate-limit",
            enabled: true,
            priority: 10,
            algorithm: "sliding-window",
            maxRequests: 1000,
            windowMs: 60000,
            keyStrategy: "ip",
            standardHeaders: true,
            skipSuccessfulRequests: false,
            skipFailedRequests: false,
        },
        security: {
            name: "security",
            enabled: true,
            priority: 80,
            contentSecurityPolicy: {
                enabled: false,
            },
            hsts: {
                enabled: false,
            },
            frameOptions: "SAMEORIGIN",
            noSniff: true,
            xssFilter: true,
        },
        error: {
            name: "error",
            enabled: true,
            priority: 100,
            includeStackTrace: false,
            logErrors: true,
            customErrorMessages: {},
        },
        audit: {
            name: "audit",
            enabled: false,
            priority: 10,
            includeBody: false,
            includeResponse: false,
            storageStrategy: "redis",
            maxBodySize: 1024 * 5, // 5KB
            redisTtl: 7 * 24 * 3600, // 7 days
            retentionDays: 90,
        },
        logging: {
            name: "logging",
            enabled: true,
            priority: 5,
            logLevel: "info",
            logRequestBody: false,
            logResponseBody: false,
            excludePaths: ["/health", "/metrics", "/favicon.ico"],
        },
        prometheus: {
            enabled: false,
            endpoint: "/metrics",
            defaultMetrics: true,
            httpMetrics: true,
        },
    },
};
//# sourceMappingURL=config.js.map