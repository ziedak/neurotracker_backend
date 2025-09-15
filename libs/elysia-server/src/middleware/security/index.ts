/**
 * Security Middleware Module
 * Production-grade HTTP security middleware following established patterns
 *
 * Features:
 * - OWASP-compliant security headers
 * - Environment-specific configurations
 * - Framework-agnostic design
 * - Content Security Policy management
 * - HSTS enforcement
 * - Permission policy controls
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  SecurityHttpMiddleware,
  type SecurityHttpMiddlewareConfig,
} from "./security.http.middleware";
import type { SecurityWebSocketMiddlewareConfig } from "./security.websocket.middleware";
import { SecurityWebSocketMiddleware } from "./security.websocket.middleware";

// Re-export everything for convenience
export * from "./security.http.middleware";
export * from "./security.websocket.middleware";

// Export specific examples to avoid conflicts
export {
  basicHttpSecurityExample,
  environmentHttpSecurityExample,
  presetHttpSecurityExample,
  basicWebSocketSecurityExample,
  chatWebSocketSecurityExample,
  gamingWebSocketSecurityExample,
  environmentWebSocketSecurityExample,
  developmentWebSocketSecurityExample,
  fullStackSecurityExample,
  multiEnvironmentHttpExample,
  apiGatewayWebSocketExample,
  financialWebSocketExample,
  testHttpSecurityExample,
  testWebSocketSecurityExample,
  customWebSocketValidationExample,
  microserviceHttpExample,
  loadBalancerWebSocketExample,
  expressIntegrationExample,
  socketIOIntegrationExample,
} from "./examples";

/**
 * Factory Functions for Different Environments - HTTP Security
 */

/**
 * Create SecurityHttpMiddleware for development environment
 * - Relaxed CSP for dev tools
 * - No HSTS enforcement
 * - Allows same-origin embedding
 */
export function createDevelopmentSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  return SecurityHttpMiddleware.createDevelopment(metrics, config);
}

/**
 * Create SecurityHttpMiddleware for production environment
 * - Strict CSP policy
 * - Full HSTS with preload
 * - Complete frame protection
 * - Enhanced permission policies
 */
export function createProductionSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  return SecurityHttpMiddleware.createProduction(metrics, config);
}

/**
 * Create SecurityHttpMiddleware for API services
 * - API-focused security headers
 * - No CSP (not needed for APIs)
 * - Cache control headers
 * - Frame protection
 */
export function createApiSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  return SecurityHttpMiddleware.createApi(metrics, config);
}

/**
 * Create SecurityHttpMiddleware with strict security
 * - Zero-trust CSP policy
 * - Extended HSTS duration
 * - Maximum permission restrictions
 * - Comprehensive header protection
 */
export function createStrictSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  return SecurityHttpMiddleware.createStrict(metrics, config);
}

/**
 * Create custom SecurityHttpMiddleware
 * Base factory for custom configurations
 */
export function createCustomSecurity(
  metrics: IMetricsCollector,
  config: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  return new SecurityHttpMiddleware(metrics, config);
}

/**
 * Factory Functions for Different Environments - WebSocket Security
 */

/**
 * Create SecurityWebSocketMiddleware for development environment
 * - Relaxed origin validation
 * - Higher connection limits
 * - Insecure connections allowed
 */
export function createDevelopmentWebSocketSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  return SecurityWebSocketMiddleware.createDevelopment(metrics, config);
}

/**
 * Create SecurityWebSocketMiddleware for production environment
 * - Strict origin validation
 * - Connection limits enforced
 * - Secure connections required
 * - Message type restrictions
 */
export function createProductionWebSocketSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  return SecurityWebSocketMiddleware.createProduction(metrics, config);
}

/**
 * Create SecurityWebSocketMiddleware with high security
 * - Very strict connection limits
 * - Message type whitelist
 * - Maximum security enforcement
 */
export function createHighSecurityWebSocketSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  return SecurityWebSocketMiddleware.createHighSecurity(metrics, config);
}

/**
 * Create SecurityWebSocketMiddleware for API gateway
 * - Balanced security and performance
 * - API-focused message handling
 * - Metric endpoint skipping
 */
export function createApiGatewayWebSocketSecurity(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  return SecurityWebSocketMiddleware.createApiGateway(metrics, config);
}

/**
 * Create custom SecurityWebSocketMiddleware
 * Base factory for custom WebSocket configurations
 */
export function createCustomWebSocketSecurity(
  metrics: IMetricsCollector,
  config: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  return new SecurityWebSocketMiddleware(metrics, config);
}

/**
 * Preset Configurations
 * Ready-to-use security configurations for common scenarios
 */

/**
 * Development preset - relaxed security for development
 */
export const DevelopmentSecurityPreset: Partial<SecurityHttpMiddlewareConfig> =
  {
    name: "security-dev",
    enabled: true,
    priority: 0,
    contentSecurityPolicy: {
      enabled: false, // Allow dev tools and hot reload
    },
    hsts: {
      enabled: false, // HTTPS not always available in dev
    },
    frameOptions: "SAMEORIGIN", // Allow embedding for dev tools
    noSniff: true,
    xssFilter: true,
    referrerPolicy: "no-referrer-when-downgrade",
  };

/**
 * Production preset - comprehensive security for production
 */
export const ProductionSecurityPreset: Partial<SecurityHttpMiddlewareConfig> = {
  name: "security-prod",
  enabled: true,
  priority: 0,
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

/**
 * API preset - security optimized for APIs
 */
export const ApiSecurityPreset: Partial<SecurityHttpMiddlewareConfig> = {
  name: "security-api",
  enabled: true,
  priority: 0,
  contentSecurityPolicy: {
    enabled: false, // CSP not relevant for APIs
  },
  hsts: {
    enabled: true,
    maxAge: 31536000,
    includeSubDomains: true,
  },
  frameOptions: "DENY",
  noSniff: true,
  xssFilter: false, // XSS protection not needed for APIs
  referrerPolicy: "no-referrer",
  customHeaders: {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  },
};

/**
 * High-security preset - maximum protection
 */
export const HighSecurityPreset: Partial<SecurityHttpMiddlewareConfig> = {
  name: "security-strict",
  enabled: true,
  priority: 0,
  contentSecurityPolicy: {
    enabled: true,
    directives: {
      "default-src": ["'none'"], // Zero-trust policy
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

/**
 * Microservice preset - security for internal services
 */
export const MicroserviceSecurityPreset: Partial<SecurityHttpMiddlewareConfig> =
  {
    name: "security-microservice",
    enabled: true,
    priority: 0,
    skipPaths: ["/health", "/metrics", "/ready"],
    contentSecurityPolicy: {
      enabled: false, // Not needed for service-to-service
    },
    hsts: {
      enabled: true,
      maxAge: 31536000,
      includeSubDomains: true,
    },
    frameOptions: "DENY",
    noSniff: true,
    xssFilter: false,
    referrerPolicy: "no-referrer",
    customHeaders: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  };

/**
 * Debug preset - minimal security for debugging
 */
export const DebugSecurityPreset: Partial<SecurityHttpMiddlewareConfig> = {
  name: "security-debug",
  enabled: true,
  priority: 0,
  skipPaths: ["/debug", "/health", "/metrics"],
  contentSecurityPolicy: {
    enabled: false,
  },
  hsts: {
    enabled: false,
  },
  frameOptions: false, // Allow embedding for debug tools
  noSniff: false,
  xssFilter: false,
  referrerPolicy: "unsafe-url", // Full referrer for debugging
};

/**
 * WebSocket Preset Configurations
 * Ready-to-use security configurations for WebSocket scenarios
 */

/**
 * Development WebSocket preset - relaxed security for development
 */
export const DevelopmentWebSocketSecurityPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-dev",
    enabled: true,
    priority: 100,
    allowedOrigins: ["*"],
    maxConnectionsPerIP: 50,
    requireSecureConnection: false,
    blockSuspiciousConnections: false,
    validateHeaders: false,
    sanitizePayload: false,
  };

/**
 * Production WebSocket preset - comprehensive security for production
 */
export const ProductionWebSocketSecurityPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-prod",
    enabled: true,
    priority: 100,
    allowedOrigins: [], // Must be explicitly configured
    maxConnectionsPerIP: 5,
    requireSecureConnection: true,
    blockSuspiciousConnections: true,
    messageTypeBlacklist: [
      "eval",
      "script",
      "admin",
      "system",
      "debug",
      "test",
    ],
    validateHeaders: true,
    sanitizePayload: true,
    connectionTimeout: 15000,
  };

/**
 * High-security WebSocket preset - maximum protection
 */
export const HighSecurityWebSocketPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-strict",
    enabled: true,
    priority: 100,
    allowedOrigins: [], // Must be explicitly configured
    maxConnectionsPerIP: 2,
    requireSecureConnection: true,
    blockSuspiciousConnections: true,
    messageTypeWhitelist: ["chat", "heartbeat", "auth"],
    validateHeaders: true,
    sanitizePayload: true,
    connectionTimeout: 10000,
    heartbeatInterval: 5000,
    maxMessageSize: 512 * 1024,
  };

/**
 * API Gateway WebSocket preset - balanced security and performance
 */
export const ApiGatewayWebSocketSecurityPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-api",
    enabled: true,
    priority: 100,
    allowedOrigins: ["*"], // Usually configured at load balancer
    maxConnectionsPerIP: 20,
    requireSecureConnection: true,
    messageTypeBlacklist: ["admin", "system", "debug"],
    validateHeaders: true,
    sanitizePayload: true,
    skipMessageTypes: ["ping", "pong", "heartbeat", "metrics"],
  };

/**
 * Chat Application WebSocket preset - optimized for real-time messaging
 */
export const ChatWebSocketSecurityPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-chat",
    enabled: true,
    priority: 100,
    allowedOrigins: [], // Must be configured for chat domains
    maxConnectionsPerIP: 10,
    requireSecureConnection: true,
    messageTypeWhitelist: ["message", "typing", "join", "leave", "heartbeat"],
    validateHeaders: true,
    sanitizePayload: true,
    maxMessageSize: 2 * 1024 * 1024, // 2MB for file sharing
  };

/**
 * Gaming WebSocket preset - optimized for real-time gaming
 */
export const GamingWebSocketSecurityPreset: Partial<SecurityWebSocketMiddlewareConfig> =
  {
    name: "security-websocket-gaming",
    enabled: true,
    priority: 100,
    allowedOrigins: [], // Must be configured for gaming domains
    maxConnectionsPerIP: 5, // Stricter for gaming
    requireSecureConnection: true,
    messageTypeWhitelist: ["move", "action", "state", "ping", "heartbeat"],
    validateHeaders: true,
    sanitizePayload: true,
    maxMessageSize: 64 * 1024, // Small messages for gaming efficiency
    heartbeatInterval: 5000, // Frequent heartbeat for gaming
  };

/**
 * Testing Utilities
 */

/**
 * Create mock SecurityHttpMiddleware for testing
 */
export function createMockSecurity(
  metrics: IMetricsCollector = {} as IMetricsCollector
): SecurityHttpMiddleware {
  return new SecurityHttpMiddleware(metrics, {
    name: "security-mock",
    enabled: false, // Disabled for testing
    priority: 0,
  });
}

/**
 * Create SecurityHttpMiddleware with test configuration
 */
export function createTestSecurity(
  metrics: IMetricsCollector,
  overrides?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  const testConfig = {
    name: "security-test",
    enabled: true,
    priority: 0,
    skipPaths: ["/test", "/mock"],
    contentSecurityPolicy: {
      enabled: false,
    },
    hsts: {
      enabled: false,
    },
    frameOptions: "SAMEORIGIN",
    noSniff: true,
    xssFilter: false,
    ...overrides,
  };

  return new SecurityHttpMiddleware(metrics, testConfig);
}

/**
 * Create mock SecurityWebSocketMiddleware for testing
 */
export function createMockWebSocketSecurity(
  metrics: IMetricsCollector = {} as IMetricsCollector
): SecurityWebSocketMiddleware {
  return new SecurityWebSocketMiddleware(metrics, {
    name: "security-websocket-mock",
    enabled: false, // Disabled for testing
    priority: 100,
  });
}

/**
 * Create SecurityWebSocketMiddleware with test configuration
 */
export function createTestWebSocketSecurity(
  metrics: IMetricsCollector,
  overrides?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  const testConfig = {
    name: "security-websocket-test",
    enabled: true,
    priority: 100,
    allowedOrigins: ["*"],
    maxConnectionsPerIP: 100,
    requireSecureConnection: false,
    blockSuspiciousConnections: false,
    validateHeaders: false,
    sanitizePayload: false,
    skipMessageTypes: ["test", "mock", "debug"],
    ...overrides,
  };

  return new SecurityWebSocketMiddleware(metrics, testConfig);
}

/**
 * Helper Functions
 */

/**
 * Create framework-agnostic HTTP middleware function
 */
export function createSecurityHttpMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
) {
  const middleware = new SecurityHttpMiddleware(metrics, config || {});
  return middleware.middleware();
}

/**
 * Create framework-agnostic WebSocket middleware function
 */
export function createSecurityWebSocketMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
) {
  const middleware = new SecurityWebSocketMiddleware(metrics, config || {});
  return middleware.middleware();
}

/**
 * Create HTTP middleware for specific environment
 */
export function createSecurityForEnvironment(
  environment: "development" | "production" | "api" | "strict",
  metrics: IMetricsCollector,
  config?: Partial<SecurityHttpMiddlewareConfig>
): SecurityHttpMiddleware {
  switch (environment) {
    case "development":
      return createDevelopmentSecurity(metrics, config);
    case "production":
      return createProductionSecurity(metrics, config);
    case "api":
      return createApiSecurity(metrics, config);
    case "strict":
      return createStrictSecurity(metrics, config);
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}

/**
 * Create WebSocket middleware for specific environment
 */
export function createWebSocketSecurityForEnvironment(
  environment:
    | "development"
    | "production"
    | "high-security"
    | "api-gateway"
    | "chat"
    | "gaming",
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  switch (environment) {
    case "development":
      return createDevelopmentWebSocketSecurity(metrics, config);
    case "production":
      return createProductionWebSocketSecurity(metrics, config);
    case "high-security":
      return createHighSecurityWebSocketSecurity(metrics, config);
    case "api-gateway":
      return createApiGatewayWebSocketSecurity(metrics, config);
    case "chat":
      return new SecurityWebSocketMiddleware(metrics, {
        ...ChatWebSocketSecurityPreset,
        ...config,
      });
    case "gaming":
      return new SecurityWebSocketMiddleware(metrics, {
        ...GamingWebSocketSecurityPreset,
        ...config,
      });
    default:
      throw new Error(`Unknown WebSocket environment: ${environment}`);
  }
}

/**
 * Create combined HTTP and WebSocket security middleware
 */
export function createFullStackSecurity(
  environment: "development" | "production" | "api" | "strict",
  metrics: IMetricsCollector,
  httpConfig?: Partial<SecurityHttpMiddlewareConfig>,
  wsConfig?: Partial<SecurityWebSocketMiddlewareConfig>
) {
  const httpMiddleware = createSecurityForEnvironment(
    environment,
    metrics,
    httpConfig
  );

  const wsEnvironmentMap = {
    development: "development" as const,
    production: "production" as const,
    api: "api-gateway" as const,
    strict: "high-security" as const,
  };

  const wsMiddleware = createWebSocketSecurityForEnvironment(
    wsEnvironmentMap[environment],
    metrics,
    wsConfig
  );

  return {
    http: httpMiddleware,
    websocket: wsMiddleware,
    httpFunction: httpMiddleware.middleware(),
    websocketFunction: wsMiddleware.middleware(),
  };
}
