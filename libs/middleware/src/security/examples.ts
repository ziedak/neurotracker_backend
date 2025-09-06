/**
 * Security Middleware - Usage Examples
 *
 * Demonstrates the updated SecurityMiddleware following the new BaseMiddleware pattern
 */

import { SecurityMiddleware, type SecurityConfig } from "./security.middleware";
import { ILogger, IMetricsCollector } from "@libs/monitoring";

// Example usage with different factory methods
export class SecurityMiddlewareExamples {
  constructor(
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector
  ) {}

  /**
   * Example 1: Development environment with relaxed security
   */
  createDevelopmentSecurity() {
    return SecurityMiddleware.createDevelopment(this.metrics, {
      // Additional dev-specific config
      customHeaders: {
        "X-Environment": "development",
        "Access-Control-Allow-Origin": "*", // Only for dev!
      },
    });
  }

  /**
   * Example 2: Production environment with strict security
   */
  createProductionSecurity() {
    return SecurityMiddleware.createProduction(this.metrics, {
      // Override with stricter CSP
      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "https:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "upgrade-insecure-requests": [],
        },
      },
    });
  }

  /**
   * Example 3: API-specific security (no CSP, API-focused headers)
   */
  createApiSecurity() {
    return SecurityMiddleware.createApi(this.metrics, {
      customHeaders: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-API-Version": "v1",
      },
    });
  }

  /**
   * Example 4: Maximum security for sensitive applications
   */
  createStrictSecurity() {
    return SecurityMiddleware.createStrict(this.metrics, {
      // Additional strict headers
      customHeaders: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  }

  /**
   * Example 5: Custom configuration for specific needs
   */
  createCustomSecurity() {
    const config: SecurityConfig = {
      name: "custom-security",
      enabled: true,
      skipPaths: ["/health", "/metrics", "/docs"],

      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "https://cdn.jsdelivr.net"],
          "style-src": [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "https:"],
          "connect-src": ["'self'", "wss:", "https:"],
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
        geolocation: ["'self'"],
        payment: ["'none'"],
        usb: ["'none'"],
        "screen-wake-lock": ["'none'"],
      },

      customHeaders: {
        "X-Content-Security-Policy": "", // Remove legacy header
        "X-WebKit-CSP": "", // Remove legacy header
      },
    };

    return new SecurityMiddleware(this.metrics, config);
  }

  /**
   * Example 6: Using with different configurations per route group
   */
  createRouteSpecificSecurity() {
    const baseSecurity = SecurityMiddleware.createProduction(this.metrics);

    return {
      // Strict security for admin routes
      adminSecurity: baseSecurity.elysia({
        frameOptions: "DENY",
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'"],
            "frame-ancestors": ["'none'"],
          },
        },
      }),

      // Relaxed security for public API
      apiSecurity: baseSecurity.elysia({
        contentSecurityPolicy: { enabled: false },
        xssFilter: false,
        customHeaders: {
          "Cache-Control": "public, max-age=300",
        },
      }),

      // Standard security for web pages
      webSecurity: baseSecurity.elysia({
        frameOptions: "SAMEORIGIN",
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "https:"],
          },
        },
      }),
    };
  }
}

/**
 * Example Elysia application setup
 */
export function setupSecurityMiddleware(
  logger: ILogger,
  metrics: IMetricsCollector
) {
  const examples = new SecurityMiddlewareExamples(logger, metrics);
  const securities = examples.createRouteSpecificSecurity();

  // In your Elysia app:
  // const app = new Elysia()
  //   .group('/admin', app => app.use(securities.adminSecurity))
  //   .group('/api', app => app.use(securities.apiSecurity))
  //   .group('/web', app => app.use(securities.webSecurity))

  return securities;
}

/**
 * Testing utilities
 */
export function createTestSecurity(
  mockLogger: ILogger,
  mockMetrics: IMetricsCollector,
  config?: Partial<SecurityConfig>
): SecurityMiddleware {
  const testConfig: SecurityConfig = {
    name: "test-security",
    enabled: true,
    noSniff: true,
    frameOptions: "DENY",
    xssFilter: true,
    ...config,
  };

  return new SecurityMiddleware(mockLogger, mockMetrics, testConfig);
}
