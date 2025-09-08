/**
 * Security Middleware Usage Examples
 * Comprehensive examples for both HTTP and WebSocket security middleware
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  // HTTP Security
  SecurityMiddleware,
  type SecurityConfig,
  createProductionSecurity,
  createDevelopmentSecurity,
  ProductionSecurityPreset,

  // WebSocket Security
  SecurityWebSocketMiddleware,
  type SecurityWebSocketConfig,
  createProductionWebSocketSecurity,
  createDevelopmentWebSocketSecurity,
  ChatWebSocketSecurityPreset,
  GamingWebSocketSecurityPreset,

  // Combined utilities
  createFullStackSecurity,
  createWebSocketSecurityForEnvironment,
} from "./index";

// Mock metrics collector for examples
const metrics: IMetricsCollector = {} as IMetricsCollector;

/**
 * HTTP Security Examples
 */

// Basic HTTP Security
export function basicHttpSecurityExample() {
  const security = new SecurityMiddleware(metrics, {
    name: "basic-security",
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
      },
    },
    hsts: {
      enabled: true,
      maxAge: 31536000,
    },
  });

  return security.middleware();
}

// Environment-specific HTTP Security
export function environmentHttpSecurityExample() {
  const isDevelopment = process.env["NODE_ENV"] === "development";

  if (isDevelopment) {
    return createDevelopmentSecurity(metrics, {
      skipPaths: ["/debug", "/dev-tools"],
    });
  } else {
    return createProductionSecurity(metrics, {
      skipPaths: ["/public"],
      customHeaders: {
        "X-Custom-Security": "enabled",
      },
    });
  }
}

// Preset-based HTTP Security
export function presetHttpSecurityExample() {
  const security = new SecurityMiddleware(metrics, {
    ...ProductionSecurityPreset,
    skipPaths: ["/health", "/metrics"],
    customHeaders: {
      "X-API-Version": "v1",
    },
  });

  return security;
}

/**
 * WebSocket Security Examples
 */

// Basic WebSocket Security
export function basicWebSocketSecurityExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    name: "websocket-security",
    allowedOrigins: ["https://myapp.com"],
    maxConnectionsPerIP: 5,
    rateLimitPerConnection: {
      messagesPerMinute: 30,
      messagesPerHour: 1000,
    },
  });

  return security.middleware();
}

// Chat Application WebSocket Security
export function chatWebSocketSecurityExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    ...ChatWebSocketSecurityPreset,
    allowedOrigins: ["https://chat.example.com"],
    maxConnectionsPerIP: 3,
    customValidation: (context) => {
      // Custom validation logic
      return context.authenticated === true;
    },
  });

  return security;
}

// Gaming Application WebSocket Security
export function gamingWebSocketSecurityExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    ...GamingWebSocketSecurityPreset,
    allowedOrigins: ["https://game.example.com"],
    maxConnectionsPerIP: 1, // One connection per IP for gaming
    rateLimitPerConnection: {
      messagesPerMinute: 600, // Very high for real-time gaming
      messagesPerHour: 20000,
      bytesPerMinute: 256 * 1024, // 256KB
    },
  });

  return security;
}

// Environment-specific WebSocket Security
export function environmentWebSocketSecurityExample() {
  const environment =
    process.env["NODE_ENV"] === "production" ? "production" : "development";

  return createWebSocketSecurityForEnvironment(environment, metrics, {
    skipMessageTypes: ["debug", "test"],
  });
}

// Development WebSocket Security
export function developmentWebSocketSecurityExample() {
  return createDevelopmentWebSocketSecurity(metrics, {
    skipMessageTypes: ["debug", "test", "dev"],
    maxConnectionsPerIP: 100, // Allow many connections in dev
  });
}

/**
 * Combined HTTP + WebSocket Security
 */

// Full-stack security setup
export function fullStackSecurityExample() {
  const security = createFullStackSecurity(
    "production",
    metrics,
    {
      // HTTP config
      skipPaths: ["/health", "/metrics"],
      customHeaders: {
        "X-Service": "api",
      },
    },
    {
      // WebSocket config
      allowedOrigins: ["https://app.example.com"],
      maxConnectionsPerIP: 10,
    }
  );

  return {
    httpMiddleware: security.httpFunction,
    websocketMiddleware: security.websocketFunction,
  };
}

/**
 * Advanced Configuration Examples
 */

// Multi-environment HTTP security
export function multiEnvironmentHttpExample() {
  const configs = {
    development: createDevelopmentSecurity(metrics, {
      skipPaths: ["/dev", "/debug"],
    }),
    staging: createProductionSecurity(metrics, {
      hsts: { enabled: false }, // No HSTS in staging
    }),
    production: createProductionSecurity(metrics, {
      customHeaders: {
        "Strict-Transport-Security":
          "max-age=63072000; includeSubDomains; preload",
      },
    }),
  };

  const env =
    (process.env["NODE_ENV"] as keyof typeof configs) || "development";
  return configs[env];
}

// API Gateway WebSocket security
export function apiGatewayWebSocketExample() {
  const security = SecurityWebSocketMiddleware.createApiGateway(metrics, {
    allowedOrigins: ["*"], // Handled by load balancer
    maxConnectionsPerIP: 50,
    skipMessageTypes: ["ping", "pong", "heartbeat", "health"],
    rateLimitPerConnection: {
      messagesPerMinute: 100,
      messagesPerHour: 5000,
      bytesPerMinute: 2 * 1024 * 1024, // 2MB
    },
  });

  return security;
}

// High-security WebSocket for financial applications
export function financialWebSocketExample() {
  const security = SecurityWebSocketMiddleware.createHighSecurity(metrics, {
    allowedOrigins: ["https://secure.bank.com"],
    maxConnectionsPerIP: 1, // One connection per IP
    messageTypeWhitelist: ["transaction", "balance", "auth", "heartbeat"],
    rateLimitPerConnection: {
      messagesPerMinute: 5, // Very conservative
      messagesPerHour: 100,
      bytesPerMinute: 32 * 1024, // 32KB
    },
    maxMessageSize: 64 * 1024, // 64KB max
    connectionTimeout: 5000, // 5 seconds
    requireSecureConnection: true,
    blockSuspiciousConnections: true,
    validateHeaders: true,
    sanitizePayload: true,
  });

  return security;
}

/**
 * Testing Examples
 */

// Test setup for HTTP security
export function testHttpSecurityExample() {
  const security = new SecurityMiddleware(metrics, {
    name: "test-security",
    enabled: true,
    skipPaths: ["/test"],
    contentSecurityPolicy: { enabled: false },
    hsts: { enabled: false },
  });

  return security;
}

// Test setup for WebSocket security
export function testWebSocketSecurityExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    name: "test-websocket-security",
    enabled: true,
    allowedOrigins: ["*"],
    requireSecureConnection: false,
    blockSuspiciousConnections: false,
    validateHeaders: false,
    maxConnectionsPerIP: 100,
  });

  return security;
}

/**
 * Custom Validation Examples
 */

// Custom WebSocket validation
export function customWebSocketValidationExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    name: "custom-validation",
    allowedOrigins: ["https://app.example.com"],
    customValidation: (context) => {
      // Check if user has required permissions
      if (!context.authenticated) {
        return false;
      }

      // Check if user is in allowed rooms
      if (context.rooms && context.rooms.length > 10) {
        return false; // Too many rooms
      }

      // Check message frequency
      if (context.metadata.messageCount > 1000) {
        return false; // Too many messages
      }

      return true;
    },
  });

  return security;
}

/**
 * Production Deployment Examples
 */

// Microservice HTTP security
export function microserviceHttpExample() {
  return SecurityMiddleware.createApi(metrics, {
    skipPaths: ["/health", "/metrics", "/ready"],
    customHeaders: {
      "X-Service-Name": "user-service",
      "X-Service-Version": "1.0.0",
    },
  });
}

// Load balancer WebSocket security
export function loadBalancerWebSocketExample() {
  const security = new SecurityWebSocketMiddleware(metrics, {
    name: "lb-websocket-security",
    allowedOrigins: ["*"], // Origins validated at LB
    maxConnectionsPerIP: 100, // Higher limit behind LB
    requireSecureConnection: false, // Terminated at LB
    validateHeaders: false, // Headers modified by LB
    rateLimitPerConnection: {
      messagesPerMinute: 200,
      messagesPerHour: 10000,
    },
  });

  return security;
}

/**
 * Framework Integration Examples
 */

// Express.js integration
export function expressIntegrationExample() {
  const httpSecurity = createProductionSecurity(metrics);

  // Convert to Express middleware
  return (req: any, res: any, next: any) => {
    const context = {
      request: { url: req.url, method: req.method, headers: req.headers },
      response: res,
      set: { headers: {} },
      requestId: req.id,
    };

    return httpSecurity.middleware()(context, next);
  };
}

// Socket.IO integration
export function socketIOIntegrationExample() {
  const wsSecurity = createProductionWebSocketSecurity(metrics);

  return (socket: any, next: any) => {
    const context = {
      ws: socket,
      connectionId: socket.id,
      message: { type: "connection", payload: {} },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        clientIp: socket.handshake.address,
        headers: socket.handshake.headers,
        query: socket.handshake.query,
      },
      authenticated: false,
    };

    return wsSecurity.middleware()(context, next);
  };
}

export {
  // Re-export for convenience
  SecurityMiddleware,
  SecurityWebSocketMiddleware,
  type SecurityConfig,
  type SecurityWebSocketConfig,
};
