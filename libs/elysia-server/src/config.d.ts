import type { CorsHttpMiddlewareConfig } from "./middleware/cors/cors.http.middleware";
import type { SecurityHttpMiddlewareConfig } from "./middleware/security/security.http.middleware";
import type { AuthHttpMiddlewareConfig } from "./middleware/auth/auth.http.middleware";
import type { RateLimitHttpMiddlewareConfig } from "./middleware/rateLimit/rateLimit.http.Middleware";
import type { AuditHttpMiddlewareConfig } from "./middleware/audit/audit.http.middleware";
import type { ErrorHttpMiddlewareConfig } from "./middleware/error/error.http.middleware";
import type { LoggingHttpMiddlewareConfig } from "./middleware/logging/logging.http.middleware";
export interface ServerConfig {
    port: number;
    name: string;
    version: string;
    description?: string;
    swagger?: {
        enabled?: boolean;
        path?: string;
        title?: string;
        version?: string;
        description?: string;
    };
    websocket?: {
        enabled?: boolean;
        path?: string;
        idleTimeout?: number;
        maxPayloadLength?: number;
        perMessageDeflate?: boolean;
        backpressureLimit?: number;
        closeOnBackpressureLimit?: boolean;
    };
    middleware?: {
        enabled?: boolean;
        cors?: Partial<CorsHttpMiddlewareConfig>;
        security?: Partial<SecurityHttpMiddlewareConfig>;
        auth?: Partial<AuthHttpMiddlewareConfig>;
        rateLimit?: Partial<RateLimitHttpMiddlewareConfig>;
        audit?: Partial<AuditHttpMiddlewareConfig>;
        error?: Partial<ErrorHttpMiddlewareConfig>;
        logging?: Partial<LoggingHttpMiddlewareConfig>;
        prometheus?: {
            enabled?: boolean;
            endpoint?: string;
            defaultMetrics?: boolean;
            httpMetrics?: boolean;
        };
    };
}
export declare const DEFAULT_SERVER_CONFIG: Partial<ServerConfig>;
//# sourceMappingURL=config.d.ts.map