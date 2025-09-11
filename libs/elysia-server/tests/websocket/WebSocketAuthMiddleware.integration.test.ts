// Jest globals are available without import
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  UnifiedSessionManager,
  EnhancedJWTService,
  PermissionService,
  DEFAULT_PERMISSION_SERVICE_CONFIG,
  type EnterpriseSessionData,
  SessionAuthMethod,
} from "@libs/auth";
import {
  WebSocketAuthMiddleware,
  type WebSocketSessionContext,
} from "../../src/websocket/WebSocketAuthMiddleware";
import type { WebSocketAuthConfig } from "../../src/types";
import { DatabaseUtils } from "@libs/database";

// Mock external dependencies
vi.mock("@libs/auth");
vi.mock("@libs/database");
vi.mock("@libs/monitoring");

// Create mocks
const mockSessionManager = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
} as any;

const mockJWTService = {
  verifyAccessToken: vi.fn(),
  getInstance: vi.fn(() => mockJWTService),
} as any;

const mockPermissionService = {
  checkUserPermission: vi.fn(),
  batchCheckUserPermissions: vi.fn(),
  getUserPermissions: vi.fn(),
} as any;

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
  getInstance: vi.fn(() => mockLogger),
} as any;

const mockMetrics = {
  recordCounter: vi.fn(),
  recordTimer: vi.fn(),
  getInstance: vi.fn(() => mockMetrics),
} as any;

// Setup mocks
beforeEach(() => {
  vi.mocked(UnifiedSessionManager).prototype.getSession =
    mockSessionManager.getSession;
  vi.mocked(UnifiedSessionManager).prototype.createSession =
    mockSessionManager.createSession;
  vi.mocked(UnifiedSessionManager).prototype.updateSession =
    mockSessionManager.updateSession;
  vi.mocked(UnifiedSessionManager).prototype.deleteSession =
    mockSessionManager.deleteSession;

  vi.mocked(EnhancedJWTService).getInstance = vi.fn(() => mockJWTService);
  vi.mocked(PermissionService).mockImplementation(() => mockPermissionService);
  vi.mocked(Logger).getInstance = vi.fn(() => mockLogger);
  vi.mocked(MetricsCollector).getInstance = vi.fn(() => mockMetrics);
});

// Test data factories
const createMockSession = (
  overrides?: Partial<EnterpriseSessionData>
): EnterpriseSessionData => ({
  sessionId: "sess_123",
  userId: "user_123",
  protocol: "websocket" as any,
  authMethod: SessionAuthMethod.SESSION_TOKEN,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  lastActivity: new Date(),
  ipAddress: "192.168.1.1",
  userAgent: "test-agent",
  origin: "https://test.com",
  connectionId: "conn_123",
  deviceInfo: {
    deviceType: "desktop",
    os: "Linux",
    browser: "Chrome",
  },
  metadata: {},
  isRevoked: false,
  ...overrides,
});

const createMockContext = (
  overrides?: Partial<WebSocketSessionContext>
): WebSocketSessionContext => ({
  ws: {
    send: vi.fn(),
    close: vi.fn(),
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

const createAuthConfig = (
  overrides?: Partial<WebSocketAuthConfig>
): WebSocketAuthConfig => ({
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
  ...overrides,
});

describe("WebSocketAuthMiddleware Integration", () => {
  let middleware: WebSocketAuthMiddleware;
  let config: WebSocketAuthConfig;

  beforeEach(() => {
    config = createAuthConfig();
    middleware = new WebSocketAuthMiddleware(
      config,
      mockSessionManager as any,
      mockLogger,
      mockMetrics,
      mockPermissionService
    );

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe("Session-based Authentication", () => {
    it("should authenticate with valid session", async () => {
      const session = createMockSession();
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);
      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 0,
        totalEvaluationTime: 10,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: ["test:read"],
        },
      ]);

      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(context.userId).toBe("user_123");
      expect(context.sessionId).toBe("sess_123");
      expect(context.session).toEqual(session);
      expect(next).toHaveBeenCalled();
    });

    it("should handle expired session", async () => {
      const expiredSession = createMockSession({
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(expiredSession);
      mockSessionManager.deleteSession.mockResolvedValue(undefined);

      await expect(middleware.execute(context, next)).rejects.toThrow();

      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith("sess_123");
      expect(context.authenticated).toBe(false);
      expect(context.ws.close).toHaveBeenCalledWith(
        1008,
        expect.stringContaining("Authentication failed")
      );
    });

    it("should handle session not found", async () => {
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(null);
      mockJWTService.verifyAccessToken.mockResolvedValue({
        valid: false,
        error: "Token invalid",
      });

      await expect(middleware.execute(context, next)).rejects.toThrow();
      expect(context.authenticated).toBe(false);
    });

    it("should upgrade session to support WebSocket protocol", async () => {
      const httpSession = createMockSession({
        protocol: "http" as any,
      });
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(httpSession);
      mockSessionManager.updateSession.mockResolvedValue(undefined);
      mockSessionManager.getSession
        .mockResolvedValueOnce(httpSession)
        .mockResolvedValueOnce(createMockSession({ protocol: "both" as any }));

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 0,
        totalEvaluationTime: 10,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: [],
        },
      ]);

      await middleware.execute(context, next);

      expect(mockSessionManager.updateSession).toHaveBeenCalledWith(
        "sess_123",
        {
          protocol: "both",
          connectionId: "conn_123",
        }
      );
      expect(context.authenticated).toBe(true);
    });
  });

  describe("JWT Authentication Fallback", () => {
    it("should authenticate with valid JWT token", async () => {
      const context = createMockContext({
        metadata: {
          ...createMockContext().metadata,
          headers: { authorization: "Bearer valid-jwt-token" },
        },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(null);
      mockJWTService.verifyAccessToken.mockResolvedValue({
        valid: true,
        payload: {
          sub: "user_123",
          email: "test@example.com",
          role: "user" as const,
          permissions: ["test:read"],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const newSession = createMockSession();
      mockSessionManager.createSession.mockResolvedValue(newSession);

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 0,
        totalEvaluationTime: 10,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: ["test:read"],
        },
      ]);

      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(context.userId).toBe("user_123");
      expect(context.authMethod).toBe(SessionAuthMethod.JWT);
      expect(mockSessionManager.createSession).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid JWT token", async () => {
      const context = createMockContext({
        metadata: {
          ...createMockContext().metadata,
          headers: { authorization: "Bearer invalid-jwt-token" },
        },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(null);
      mockJWTService.verifyAccessToken.mockResolvedValue({
        valid: false,
        error: "Invalid token",
      });

      await expect(middleware.execute(context, next)).rejects.toThrow();
      expect(context.authenticated).toBe(false);
      expect(context.ws.close).toHaveBeenCalled();
    });
  });

  describe("API Key Authentication", () => {
    it("should authenticate with valid API key", async () => {
      const context = createMockContext({
        metadata: {
          ...createMockContext().metadata,
          headers: { "x-api-key": "valid-api-key" },
        },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(null);
      mockJWTService.verifyAccessToken.mockResolvedValue({
        valid: false,
        error: "No token provided",
      });

      // Mock API key validation
      vi.mocked(DatabaseUtils)
        .exportData.mockResolvedValueOnce([
          {
            id: "key_123",
            user_id: "user_123",
            name: "test-key",
            permissions: ["api:access"],
            last_used_at: new Date().toISOString(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "user_123",
            email: "test@example.com",
            role: "user",
            store_id: "store_123",
          },
        ]);

      const newSession = createMockSession();
      mockSessionManager.createSession.mockResolvedValue(newSession);

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 0,
        totalEvaluationTime: 10,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(context.userId).toBe("user_123");
      expect(context.authMethod).toBe(SessionAuthMethod.API_KEY);
      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid API key", async () => {
      const context = createMockContext({
        metadata: {
          ...createMockContext().metadata,
          headers: { "x-api-key": "invalid-api-key" },
        },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(null);
      mockJWTService.verifyAccessToken.mockResolvedValue({
        valid: false,
        error: "No token provided",
      });

      // Mock API key not found
      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([]);

      await expect(middleware.execute(context, next)).rejects.toThrow();
      expect(context.authenticated).toBe(false);
      expect(context.ws.close).toHaveBeenCalled();
    });
  });

  describe("Permission Authorization", () => {
    it("should authorize message with sufficient permissions", async () => {
      const session = createMockSession();
      const context = createMockContext({
        message: { type: "test", payload: {} },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);

      mockPermissionService.checkUserPermission.mockResolvedValue({
        allowed: true,
        evaluationPath: ["user", "permissions", "test:read"],
        matchedPermissions: [{ name: "test:read", actions: ["read"] }],
        evaluationTime: 5,
        cached: false,
        roles: ["user"],
        conditions: [],
      });

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map([
          [
            "test:read",
            {
              allowed: true,
              evaluationPath: ["user", "permissions"],
              matchedPermissions: [],
              evaluationTime: 5,
              cached: false,
              roles: ["user"],
              conditions: [],
            },
          ],
        ]),
        totalChecks: 1,
        allowedCount: 1,
        deniedCount: 0,
        cacheHitRate: 0,
        totalEvaluationTime: 5,
      });

      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: ["test:read"],
        },
      ]);

      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    it("should deny message with insufficient permissions", async () => {
      const session = createMockSession();
      const context = createMockContext({
        message: { type: "admin", payload: {} },
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);

      mockPermissionService.checkUserPermission.mockResolvedValue({
        allowed: false,
        evaluationPath: ["user", "permissions", "admin:write"],
        matchedPermissions: [],
        evaluationTime: 3,
        cached: false,
        roles: ["user"],
        conditions: [],
      });

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map([
          [
            "admin:write",
            {
              allowed: false,
              evaluationPath: ["user", "permissions"],
              matchedPermissions: [],
              evaluationTime: 3,
              cached: false,
              roles: ["user"],
              conditions: [],
            },
          ],
        ]),
        totalChecks: 1,
        allowedCount: 0,
        deniedCount: 1,
        cacheHitRate: 0,
        totalEvaluationTime: 3,
      });

      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: ["test:read"],
        },
      ]);

      await expect(middleware.execute(context, next)).rejects.toThrow(
        "Access denied for message type: admin"
      );

      expect(next).not.toHaveBeenCalled();
    });

    it("should use cached permissions for performance", async () => {
      const session = createMockSession();
      const context = createMockContext({
        message: { type: "test", payload: {} },
        cachedPermissions: new Map([
          [
            "test:read",
            {
              allowed: true,
              evaluationPath: ["cached"],
              matchedPermissions: [],
              evaluationTime: 1,
              cached: true,
              roles: ["user"],
              conditions: [],
            },
          ],
        ]),
      });
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);

      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 1,
        totalEvaluationTime: 1,
      });

      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: ["test:read"],
        },
      ]);

      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(next).toHaveBeenCalled();
      expect(mockPermissionService.checkUserPermission).not.toHaveBeenCalled();
    });
  });

  describe("Performance Requirements", () => {
    it("should complete authentication within 50ms target", async () => {
      const session = createMockSession();
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);
      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 1,
        totalEvaluationTime: 2,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: [],
        },
      ]);

      const startTime = performance.now();
      await middleware.execute(context, next);
      const executionTime = performance.now() - startTime;

      expect(executionTime).toBeLessThan(50);
      expect(context.authenticated).toBe(true);
    });

    it("should handle concurrent authentication requests", async () => {
      const session = createMockSession();

      mockSessionManager.getSession.mockResolvedValue(session);
      mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
        results: new Map(),
        totalChecks: 0,
        allowedCount: 0,
        deniedCount: 0,
        cacheHitRate: 1,
        totalEvaluationTime: 1,
      });
      mockPermissionService.getUserPermissions.mockResolvedValue([]);

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: [],
        },
      ]);

      // Create multiple concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) => {
        const context = createMockContext({
          connectionId: `conn_${i}`,
        });
        const next = vi.fn();
        return middleware.execute(context, next);
      });

      const startTime = performance.now();
      const results = await Promise.all(promises);
      const totalTime = performance.now() - startTime;

      expect(totalTime).toBeLessThan(200); // All 10 requests in under 200ms
      results.forEach((_, i) => {
        // Context is modified in place, so we can't check results directly
        // But the fact that all promises resolved successfully is the test
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle database connection errors gracefully", async () => {
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockRejectedValue(
        new Error("Database connection error")
      );

      await expect(middleware.execute(context, next)).rejects.toThrow();
      expect(context.authenticated).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "WebSocket authentication error",
        expect.any(Error),
        expect.any(Object)
      );
    });

    it("should handle permission service errors", async () => {
      const session = createMockSession();
      const context = createMockContext();
      const next = vi.fn();

      mockSessionManager.getSession.mockResolvedValue(session);
      mockPermissionService.batchCheckUserPermissions.mockRejectedValue(
        new Error("Permission service unavailable")
      );

      vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
        {
          id: "user_123",
          role: "user",
          permissions: [],
        },
      ]);

      // Should still authenticate but with warning about permission preload failure
      await middleware.execute(context, next);

      expect(context.authenticated).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to preload user permissions",
        expect.any(Object)
      );
    });
  });
});

describe("Cross-Protocol Session Synchronization", () => {
  let middleware: WebSocketAuthMiddleware;

  beforeEach(() => {
    const config = createAuthConfig();
    middleware = new WebSocketAuthMiddleware(
      config,
      mockSessionManager as any,
      mockLogger,
      mockMetrics,
      mockPermissionService
    );

    vi.clearAllMocks();
  });

  it("should sync session updates across protocols", async () => {
    const session = createMockSession();
    const context = createMockContext();
    const next = vi.fn();

    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    mockPermissionService.batchCheckUserPermissions.mockResolvedValue({
      results: new Map(),
      totalChecks: 0,
      allowedCount: 0,
      deniedCount: 0,
      cacheHitRate: 1,
      totalEvaluationTime: 1,
    });
    mockPermissionService.getUserPermissions.mockResolvedValue([]);

    vi.mocked(DatabaseUtils).exportData.mockResolvedValue([
      {
        id: "user_123",
        role: "user",
        permissions: [],
      },
    ]);

    await middleware.execute(context, next);

    expect(mockSessionManager.updateSession).toHaveBeenCalledWith("sess_123", {
      lastActivity: expect.any(Date),
    });
  });
});
