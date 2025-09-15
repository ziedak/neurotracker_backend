// Jest globals are available without import
import type { WebSocketContext } from "../../src/middleware/types/websocket.types";
import { AuthWebSocketMiddleware } from "../../src/middleware/auth/auth.websocket.middleware";

// Mock external dependencies
jest.mock("@libs/auth");
jest.mock("@libs/monitoring");

// Create mocks
const mockJWTService = {
  extractTokenFromHeader: jest.fn().mockReturnValue("test-token"),
};

const mockPermissionService = {
  createAuthContext: jest.fn().mockReturnValue({
    user: { id: "user_123", roles: ["user"], permissions: ["test:read"] },
    permissions: ["test:read"],
    roles: ["user"],
  }),
};

const mockMetrics: {
  recordCounter: jest.MockedFunction<() => void>;
  recordTimer: jest.MockedFunction<() => void>;
  getInstance: jest.MockedFunction<() => typeof mockMetrics>;
} = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  getInstance: jest.fn(() => mockMetrics),
};

const mockAuthService: {
  verifyToken: jest.MockedFunction<() => Promise<unknown>>;
  getUserById: jest.MockedFunction<() => Promise<unknown>>;
  can: jest.MockedFunction<() => Promise<boolean>>;
  getJWTService: jest.MockedFunction<() => typeof mockJWTService>;
  getApiKeyService: jest.MockedFunction<() => unknown>;
  getSessionService: jest.MockedFunction<() => unknown>;
  getPermissionService: jest.MockedFunction<() => typeof mockPermissionService>;
} = {
  verifyToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getJWTService: jest.fn().mockReturnValue(mockJWTService),
  getApiKeyService: jest.fn(),
  getSessionService: jest.fn(),
  getPermissionService: jest.fn().mockReturnValue(mockPermissionService),
};

// Test data factories
const createMockContext = (
  overrides?: Partial<WebSocketContext>
): WebSocketContext => ({
  ws: {
    send: jest.fn(),
    close: jest.fn(),
    readyState: 0,
  },
  connectionId: "conn_123",
  message: { type: "test", payload: {} },
  metadata: {
    connectedAt: new Date(),
    lastActivity: new Date(),
    messageCount: 1,
    clientIp: "192.168.1.1",
    userAgent: "test-agent",
    headers: {
      authorization: "Bearer test-token",
      cookie: "sessionId=sess_123",
      origin: "https://test.com",
    },
    query: {},
  },
  authenticated: false,
  ...overrides,
});

const createAuthConfig = (): {
  name: string;
  requireAuth: boolean;
  closeOnAuthFailure: boolean;
  jwtSecret: string;
  apiKeyHeader: string;
  messagePermissions: Record<string, string[]>;
  messageRoles: Record<string, string[]>;
  enableCleanupTimer: boolean;
} => ({
  name: "test-auth",
  requireAuth: true,
  closeOnAuthFailure: true,
  jwtSecret: "test-secret",
  apiKeyHeader: "x-api-key",
  messagePermissions: {
    test: ["test:read"],
    admin: ["admin:write"],
  },
  messageRoles: {
    test: ["user"],
    admin: ["admin"],
  },
  enableCleanupTimer: false, // Disable cleanup timer in tests to prevent hanging async operations
});

describe("WebSocketAuthMiddleware Integration", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clear all timers to prevent hanging async operations
    jest.clearAllTimers();
  });

  it("should instantiate middleware", () => {
    const config = createAuthConfig();
    const middleware = new AuthWebSocketMiddleware(
      mockMetrics,
      mockAuthService,
      config
    );

    expect(middleware).toBeDefined();
    expect(typeof middleware.middleware).toBe("function");
  });

  it("should return middleware function", () => {
    const config = createAuthConfig();
    const middleware = new AuthWebSocketMiddleware(
      mockMetrics,
      mockAuthService,
      config
    );

    const middlewareFn = middleware.middleware();
    expect(typeof middlewareFn).toBe("function");
  });

  it("should handle basic middleware execution", async () => {
    const config = createAuthConfig();
    const middleware = new AuthWebSocketMiddleware(
      mockMetrics,
      mockAuthService,
      config
    );

    const context = createMockContext();
    const next = jest.fn();

    // Mock successful authentication
    mockAuthService.verifyToken.mockResolvedValue({
      id: "user_123",
      roles: ["user"],
      permissions: ["test:read"],
    });

    await middleware.middleware()(context, next);

    expect(next).toHaveBeenCalled();
    expect(mockJWTService.extractTokenFromHeader).toHaveBeenCalledWith(
      "Bearer test-token"
    );
    expect(mockAuthService.verifyToken).toHaveBeenCalledWith("test-token");
    expect(mockPermissionService.createAuthContext).toHaveBeenCalledWith({
      id: "user_123",
      roles: ["user"],
      permissions: ["test:read"],
    });
  });
});
