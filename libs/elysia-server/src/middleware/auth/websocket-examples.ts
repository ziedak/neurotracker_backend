/**
 * WebSocket Authentication Middleware Usage Examples
 * Comprehensive examples demonstrating AuthWebSocketMiddleware integration and configuration
 */

import { type AuthenticationService } from "@libs/auth";
import { type IMetricsCollector } from "@libs/monitoring";
import {
  createAuthWebSocketMiddleware,
  WS_AUTH_PRESETS,
  type AuthWebSocketMiddleware,
} from "./auth.websocket.middleware";

/**
 * Example 1: Basic WebSocket Authentication
 * Simple authentication for WebSocket connections with JWT support
 */
export function createBasicWebSocketAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "basic-ws-auth",
    requireAuth: true,
    jwtAuth: true,
    apiKeyAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    allowUnauthenticatedTypes: ["ping", "pong"],
  });
}

/**
 * Example 2: Real-time Chat Authentication
 * Authentication for chat applications with message-level permissions
 */
export function createChatAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "chat-auth",
    requireAuth: true,
    jwtAuth: true,
    sessionAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    allowUnauthenticatedTypes: ["ping", "pong", "heartbeat"],
    messagePermissions: {
      send_message: ["chat:write"],
      delete_message: ["chat:delete", "chat:moderate"],
      ban_user: ["chat:moderate"],
      create_room: ["chat:admin"],
    },
    messageRoles: {
      moderate: ["moderator", "admin"],
      admin_command: ["admin"],
    },
    authenticationTimeout: 300000, // 5 minutes
    reauthenticationInterval: 3600000, // 1 hour
  });
}

/**
 * Example 3: Multi-Method WebSocket Authentication
 * Supports JWT, API keys, and sessions with intelligent fallback
 */
export function createMultiMethodWebSocketAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "multi-method-ws-auth",
    requireAuth: false, // Allow anonymous connections
    jwtAuth: true,
    apiKeyAuth: true,
    sessionAuth: true,
    allowAnonymous: true,
    closeOnAuthFailure: false,
    allowUnauthenticatedTypes: ["ping", "pong", "heartbeat", "public_message"],
    extractUserInfo: true,
    authenticationTimeout: 600000, // 10 minutes
    reauthenticationInterval: 1800000, // 30 minutes
  });
}

/**
 * Example 4: Gaming WebSocket Authentication
 * Authentication for real-time gaming with ability-based permissions
 */
export function createGamingAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "gaming-auth",
    requireAuth: true,
    jwtAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    roles: ["player"],
    allowUnauthenticatedTypes: ["ping", "pong"],
    messageActions: {
      make_move: { action: "update", resource: "user" },
      start_game: { action: "create", resource: "user" },
      end_game: { action: "update", resource: "user" },
      admin_reset: { action: "manage", resource: "all" },
    },
    messageRoles: {
      admin_reset: ["admin"],
      moderate_game: ["moderator", "admin"],
    },
    authenticationTimeout: 180000, // 3 minutes
    reauthenticationInterval: 1800000, // 30 minutes
    strictMode: true,
  });
}

/**
 * Example 5: API WebSocket Authentication
 * Strict API access using API keys only
 */
export function createAPIWebSocketAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "api-ws-auth",
    requireAuth: true,
    apiKeyAuth: true,
    jwtAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    strictMode: true,
    allowUnauthenticatedTypes: ["ping"],
    authenticationTimeout: 600000, // 10 minutes
    reauthenticationInterval: 3600000, // 1 hour
  });
}

/**
 * Example 6: Live Data Streaming Authentication
 * Authentication for real-time data streaming with role-based access
 */
export function createLiveDataStreamAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "live-data-auth",
    requireAuth: true,
    jwtAuth: true,
    apiKeyAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    roles: ["subscriber", "premium", "admin"],
    allowUnauthenticatedTypes: ["ping", "pong"],
    messagePermissions: {
      subscribe_stream: ["data:read"],
      unsubscribe_stream: ["data:read"],
      request_historical: ["data:historical"],
      admin_control: ["data:admin"],
    },
    messageRoles: {
      premium_stream: ["premium", "admin"],
      admin_control: ["admin"],
    },
    authenticationTimeout: 900000, // 15 minutes
    reauthenticationInterval: 3600000, // 1 hour
  });
}

/**
 * Example 7: Collaborative Editing Authentication
 * Authentication for collaborative document editing
 */
export function createCollaborativeEditAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "collaborative-edit-auth",
    requireAuth: true,
    jwtAuth: true,
    sessionAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    allowUnauthenticatedTypes: ["ping", "pong", "cursor_position"],
    messageActions: {
      edit_document: { action: "update", resource: "user" },
      create_document: { action: "create", resource: "user" },
      delete_document: { action: "delete", resource: "user" },
      share_document: { action: "manage", resource: "user" },
    },
    messagePermissions: {
      edit_document: ["document:write"],
      create_document: ["document:create"],
      delete_document: ["document:delete"],
      share_document: ["document:share"],
      admin_override: ["document:admin"],
    },
    authenticationTimeout: 1800000, // 30 minutes
    reauthenticationInterval: 7200000, // 2 hours
  });
}

/**
 * Example 8: Development Environment Setup
 * Relaxed authentication for development and testing
 */
export function createDevelopmentWebSocketAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(
    metrics,
    authService,
    WS_AUTH_PRESETS.development()
  );
}

/**
 * Example 9: Production Environment Setup
 * Strict authentication for production environments
 */
export function createProductionWebSocketAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(
    metrics,
    authService,
    WS_AUTH_PRESETS.production()
  );
}

/**
 * Example 10: IoT Device Authentication
 * Authentication for IoT devices with device-specific permissions
 */
export function createIoTDeviceAuthExample(
  metrics: IMetricsCollector,
  authService: AuthenticationService
): AuthWebSocketMiddleware {
  return createAuthWebSocketMiddleware(metrics, authService, {
    name: "iot-device-auth",
    requireAuth: true,
    apiKeyAuth: true,
    jwtAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    roles: ["device"],
    allowUnauthenticatedTypes: ["ping", "heartbeat"],
    messagePermissions: {
      send_telemetry: ["device:telemetry"],
      receive_command: ["device:control"],
      update_firmware: ["device:update"],
      factory_reset: ["device:admin"],
    },
    messageRoles: {
      factory_reset: ["admin"],
      debug_mode: ["admin", "technician"],
    },
    authenticationTimeout: 3600000, // 1 hour (devices have longer timeouts)
    reauthenticationInterval: 86400000, // 24 hours
    strictMode: true,
  });
}

/**
 * Configuration Presets Usage Examples
 * Demonstrating the use of pre-built configuration presets
 */
export const WS_CONFIG_EXAMPLES = {
  // Require authentication for all WebSocket connections
  requireAuth: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.requireAuth()
    ),

  // Optional authentication with user context extraction
  optionalAuth: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.optionalAuth()
    ),

  // Admin-only WebSocket access
  adminOnly: (metrics: IMetricsCollector, authService: AuthenticationService) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.adminOnly()
    ),

  // Real-time chat with comprehensive permissions
  realtimeChat: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.realtimeChat()
    ),

  // API access with API key authentication only
  apiAccess: (metrics: IMetricsCollector, authService: AuthenticationService) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.apiAccess()
    ),

  // Development environment with relaxed security
  development: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.development()
    ),

  // Production environment with strict security
  production: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) =>
    createAuthWebSocketMiddleware(
      metrics,
      authService,
      WS_AUTH_PRESETS.production()
    ),
} as const;

/**
 * Usage Pattern Examples for WebSocket Authentication
 * Common patterns for implementing WebSocket authentication middleware
 */
export const WS_USAGE_PATTERNS = {
  /**
   * Pattern 1: Connection-Level Authentication
   * Authenticate once per connection, all messages allowed
   */
  connectionLevel: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    return createAuthWebSocketMiddleware(metrics, authService, {
      name: "connection-level-auth",
      requireAuth: true,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      // No message-specific permissions - auth at connection level only
      allowUnauthenticatedTypes: ["ping", "pong", "heartbeat"],
    });
  },

  /**
   * Pattern 2: Message-Level Authorization
   * Authenticate connection + authorize each message type individually
   */
  messageLevel: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    return createAuthWebSocketMiddleware(metrics, authService, {
      name: "message-level-auth",
      requireAuth: true,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      messagePermissions: {
        read_data: ["data:read"],
        write_data: ["data:write"],
        admin_action: ["admin:all"],
      },
      messageRoles: {
        admin_action: ["admin"],
        moderate: ["moderator", "admin"],
      },
    });
  },

  /**
   * Pattern 3: Hybrid Authentication
   * Optional connection auth + strict message auth for sensitive operations
   */
  hybrid: (metrics: IMetricsCollector, authService: AuthenticationService) => {
    return createAuthWebSocketMiddleware(metrics, authService, {
      name: "hybrid-auth",
      requireAuth: false, // Allow anonymous connections
      allowAnonymous: true,
      closeOnAuthFailure: false,
      allowUnauthenticatedTypes: ["ping", "pong", "public_read"],
      messagePermissions: {
        private_read: ["user:read"],
        write: ["user:write"],
        admin: ["admin:all"],
      },
      messageRoles: {
        admin: ["admin"],
      },
    });
  },

  /**
   * Pattern 4: Tiered Access
   * Different authentication requirements based on user tier
   */
  tiered: (metrics: IMetricsCollector, authService: AuthenticationService) => {
    return createAuthWebSocketMiddleware(metrics, authService, {
      name: "tiered-auth",
      requireAuth: true,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      roles: ["user", "premium", "admin"],
      messageRoles: {
        basic_action: ["user", "premium", "admin"],
        premium_action: ["premium", "admin"],
        admin_action: ["admin"],
      },
      messagePermissions: {
        basic_action: ["basic:access"],
        premium_action: ["premium:access"],
        admin_action: ["admin:access"],
      },
    });
  },

  /**
   * Pattern 5: Time-Based Authentication
   * Different timeout settings for different use cases
   */
  timeBased: (
    metrics: IMetricsCollector,
    authService: AuthenticationService
  ) => {
    const environment = process.env["NODE_ENV"] || "development";

    const timeouts = {
      development: {
        authenticationTimeout: 1800000, // 30 minutes
        reauthenticationInterval: 7200000, // 2 hours
      },
      production: {
        authenticationTimeout: 300000, // 5 minutes
        reauthenticationInterval: 1800000, // 30 minutes
      },
    };

    const config =
      timeouts[environment as keyof typeof timeouts] || timeouts.development;

    return createAuthWebSocketMiddleware(metrics, authService, {
      name: "time-based-auth",
      requireAuth: true,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      ...config,
    });
  },
} as const;

/**
 * Testing Utilities for WebSocket Authentication
 * Helper functions for testing WebSocket authentication middleware
 */
export const WS_TESTING_UTILS = {
  /**
   * Create a mock WebSocket authentication middleware for testing
   */
  createMockMiddleware: () => {
    const mockMetrics = {
      increment: jest.fn(),
      histogram: jest.fn(),
      gauge: jest.fn(),
      recordMetric: jest.fn(),
    } as any;

    const mockAuthService = {
      verifyToken: jest.fn(),
      getUserById: jest.fn(),
      getJWTService: jest.fn(() => ({
        extractTokenFromHeader: jest.fn(),
      })),
      getPermissionService: jest.fn(() => ({
        createAuthContext: jest.fn(),
      })),
      getApiKeyService: jest.fn(() => ({
        validateApiKey: jest.fn(),
      })),
      getSessionService: jest.fn(() => ({
        getSession: jest.fn(),
      })),
      can: jest.fn(),
    } as any;

    const middleware = createAuthWebSocketMiddleware(
      mockMetrics,
      mockAuthService,
      {
        name: "test-ws-auth",
        requireAuth: true,
        jwtAuth: true,
      }
    );

    return {
      middleware,
      mocks: {
        metrics: mockMetrics,
        authService: mockAuthService,
      },
    };
  },

  /**
   * Create test WebSocket context for middleware testing
   */
  createTestContext: (overrides: any = {}) => ({
    ws: {
      send: jest.fn(),
      close: jest.fn(),
    },
    connectionId: "test-connection-123",
    message: {
      type: "test_message",
      payload: {},
      ...overrides.message,
    },
    metadata: {
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 1,
      clientIp: "127.0.0.1",
      headers: {},
      query: {},
      ...overrides.metadata,
    },
    authenticated: false,
    ...overrides,
  }),

  /**
   * Create authenticated test context
   */
  createAuthenticatedContext: (
    userId: string = "test-user-123",
    overrides: any = {}
  ) => ({
    ws: {
      send: jest.fn(),
      close: jest.fn(),
    },
    connectionId: "test-connection-123",
    message: {
      type: "test_message",
      payload: {},
      ...overrides.message,
    },
    metadata: {
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 1,
      clientIp: "127.0.0.1",
      headers: {
        authorization: "Bearer test-jwt-token",
      },
      query: {},
      ...overrides.metadata,
    },
    authenticated: true,
    userId,
    userRoles: ["user"],
    userPermissions: ["basic:access"],
    ...overrides,
  }),
} as const;

// Export all examples for easy usage
export const WS_EXAMPLES = {
  basic: createBasicWebSocketAuthExample,
  chat: createChatAuthExample,
  multiMethod: createMultiMethodWebSocketAuthExample,
  gaming: createGamingAuthExample,
  api: createAPIWebSocketAuthExample,
  liveData: createLiveDataStreamAuthExample,
  collaborative: createCollaborativeEditAuthExample,
  development: createDevelopmentWebSocketAuthExample,
  production: createProductionWebSocketAuthExample,
  iot: createIoTDeviceAuthExample,
} as const;
