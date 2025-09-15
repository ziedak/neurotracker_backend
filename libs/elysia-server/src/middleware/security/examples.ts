/**
 * Security Middleware Usage Examples
 * Comprehensive examples for both HTTP and WebSocket security middleware
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  // HTTP Security
  SecurityHttpMiddleware,
  type SecurityHttpMiddlewareConfig,
  createProductionSecurity,
  createDevelopmentSecurity,
  ProductionSecurityPreset,

  // WebSocket Security
  SecurityWebSocketMiddleware,
  type SecurityWebSocketMiddlewareConfig,
  createProductionWebSocketSecurity,
  createDevelopmentWebSocketSecurity,
  ChatWebSocketSecurityPreset,
  GamingWebSocketSecurityPreset,

  // Combined utilities
  createFullStackSecurity,
  createWebSocketSecurityForEnvironment,
} from "./index";
import { type MiddlewareContext } from "../types/context.types";

// Mock metrics collector for examples
const metrics: IMetricsCollector = {} as IMetricsCollector;

/**
 * HTTP Security Examples
 */

// Basic HTTP Security
export function basicHttpSecurityExample() {
  const security = new SecurityHttpMiddleware(metrics, {
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
  const security = new SecurityHttpMiddleware(metrics, {
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
  });

  return security;
}

// High-security WebSocket for financial applications
export function financialWebSocketExample() {
  const security = SecurityWebSocketMiddleware.createHighSecurity(metrics, {
    allowedOrigins: ["https://secure.bank.com"],
    maxConnectionsPerIP: 1, // One connection per IP
    messageTypeWhitelist: ["transaction", "balance", "auth", "heartbeat"],
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
  const security = new SecurityHttpMiddleware(metrics, {
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
  return SecurityHttpMiddleware.createApi(metrics, {
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
  return (req: unknown, res: unknown, next: unknown) => {
    const expressReq = req as {
      url: string;
      method: string;
      headers: Record<string, string>;
      id?: string;
    };
    const expressRes = res as {
      status?: number;
      headers?: Record<string, string>;
      body?: unknown;
    };
    const expressNext = next as () => Promise<void>;

    const context: MiddlewareContext = {
      request: {
        url: expressReq.url,
        method: expressReq.method,
        headers: expressReq.headers,
      },
      response: expressRes,
      set: { headers: {} },
      ...(expressReq.id && { requestId: expressReq.id }),
    };

    return httpSecurity.middleware()(context, expressNext);
  };
}

// Socket.IO integration
export function socketIOIntegrationExample() {
  const wsSecurity = createProductionWebSocketSecurity(metrics);

  return (socket: unknown, next: unknown) => {
    const ioSocket = socket as {
      id: string;
      handshake: {
        address: string;
        headers: Record<string, string>;
        query: Record<string, unknown>;
      };
    };
    const ioNext = next as () => void;
    const asyncNext = () => Promise.resolve(ioNext());

    const context = {
      ws: socket,
      connectionId: ioSocket.id,
      message: { type: "connection", payload: {} },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        clientIp: ioSocket.handshake.address,
        headers: ioSocket.handshake.headers,
        query: ioSocket.handshake.query as Record<string, string>,
      },
      authenticated: false,
    };

    return wsSecurity.middleware()(context, asyncNext);
  };
}

export {
  // Re-export for convenience
  SecurityHttpMiddleware,
  SecurityWebSocketMiddleware,
  type SecurityHttpMiddlewareConfig,
  type SecurityWebSocketMiddlewareConfig,
};
