/**
 * Simplified WebSocket Auth Middleware Tests
 * Focus on basic functionality and fix major issues first
 */

import { AuthWebSocketMiddleware } from "../../src/middleware/auth/auth.websocket.middleware";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
  recordHistogram: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  timing: jest.fn(),
  gauge: jest.fn(),
};

const mockAuthService = {
  authenticate: jest.fn(),
  validateApiKey: jest.fn(),
  validateToken: jest.fn(),
  getUserById: jest.fn(),
  hasPermission: jest.fn(),
  getApiKeyService: jest.fn(() => ({
    validateApiKey: jest.fn(),
  })),
  getTokenService: jest.fn(() => ({
    validateToken: jest.fn(),
  })),
  getPermissionService: jest.fn(() => ({
    createAuthContext: jest.fn(),
    hasPermission: jest.fn(),
  })),
};

describe("AuthWebSocketMiddleware - Basic Tests", () => {
  let middleware: AuthWebSocketMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up middleware to stop timers
    if (middleware && typeof middleware.cleanup === "function") {
      middleware.cleanup();
    }
    jest.clearAllTimers();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      middleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          enableCleanupTimer: false, // Disable cleanup timer for tests
        }
      );

      expect(middleware).toBeDefined();
      expect(middleware["config"].requireAuth).toBe(true);
      expect(middleware["config"].jwtAuth).toBe(true);
      expect(middleware["config"].apiKeyAuth).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      middleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "test-ws-auth",
          requireAuth: false,
          jwtAuth: false,
          apiKeyAuth: true,
          enableCleanupTimer: false,
        }
      );

      expect(middleware["config"].name).toBe("test-ws-auth");
      expect(middleware["config"].requireAuth).toBe(false);
      expect(middleware["config"].jwtAuth).toBe(false);
      expect(middleware["config"].apiKeyAuth).toBe(true);
    });
  });

  describe("Configuration Validation", () => {
    it("should throw error when no auth methods enabled", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, mockAuthService, {
          jwtAuth: false,
          apiKeyAuth: false,
          sessionAuth: false,
          enableCleanupTimer: false,
        });
      }).toThrow("At least one authentication method must be enabled");
    });
  });

  describe("Middleware Function", () => {
    it("should return middleware function", () => {
      middleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          enableCleanupTimer: false,
        }
      );

      const middlewareFunction = middleware.middleware();
      expect(typeof middlewareFunction).toBe("function");
    });

    it("should skip when disabled", async () => {
      middleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          enabled: false,
          enableCleanupTimer: false,
        }
      );

      const mockContext = {
        ws: {},
        connectionId: "test-123",
        message: { type: "test" },
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: "127.0.0.1",
          headers: {},
          query: {},
        },
        authenticated: false,
      };

      const next = jest.fn();
      const middlewareFunction = middleware.middleware();

      await middlewareFunction(mockContext as never, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
