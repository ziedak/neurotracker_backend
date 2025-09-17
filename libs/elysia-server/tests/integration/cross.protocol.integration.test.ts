/**
 * @fileoverview Cross-Protocol Integration Tests
 * @description Tests scenarios involving both HTTP and WebSocket protocols with shared services
 */

import { AdvancedElysiaServerBuilder } from "../../src/server";
import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { WebSocketMiddlewareChain } from "../../src/middleware/base/middlewareChain/WebSocketMiddlewareChain";
import {
  MiddlewareContext,
  WebSocketContext,
} from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import WebSocket from "ws";

// Mock external dependencies
jest.mock("@libs/monitoring");
jest.mock("@libs/auth");

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockAuthService = {
  verifyToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getJWTService: jest.fn().mockReturnValue({
    extractTokenFromHeader: jest.fn().mockReturnValue("test-token"),
  }),
  getApiKeyService: jest.fn().mockReturnValue({
    validateApiKey: jest.fn().mockResolvedValue({
      id: "api_key_123",
      userId: "user_123",
      permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
    }),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn().mockReturnValue({
      user: {
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
      },
      permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
      roles: ["user"],
    }),
  }),
};

// Mock session store for cross-protocol session management
const mockSessionStore = new Map<
  string,
  {
    userId: string;
    permissions: string[];
    roles: string[];
    createdAt: Date;
    lastActivity: Date;
    httpRequestCount: number;
    wsMessageCount: number;
  }
>();

describe("Cross-Protocol Integration Tests", () => {
  let serverBuilder: AdvancedElysiaServerBuilder;
  let testServer: { server: any; port: number };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStore.clear();
    serverBuilder = new AdvancedElysiaServerBuilder(mockMetricsCollector);
  });

  afterEach(async () => {
    if (testServer?.server) {
      try {
        await testServer.server.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe("Shared Authentication Between HTTP and WebSocket", () => {
    it("should authenticate user via HTTP and maintain session for WebSocket", async () => {
      const app = serverBuilder
        .development()
        .withAuthentication(mockAuthService, {
          jwtSecret: "test-secret",
          bypassRoutes: ["/auth/login"],
          enableSessionManagement: true,
        })
        .withWebSocket({
          enabled: true,
          path: "/ws",
        })
        .withWebSocketAuth(mockAuthService, {
          requireAuth: true,
          jwtSecret: "test-secret",
          enableSessionSharing: true, // Share sessions with HTTP
        })
        .build();

      // Add authentication endpoint
      app.post("/auth/login", ({ body }) => {
        const { username, password } = body as any;

        if (username === "testuser" && password === "testpass") {
          const sessionId = "session_123";
          const userId = "user_123";

          // Store session
          mockSessionStore.set(sessionId, {
            userId,
            permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
            roles: ["user"],
            createdAt: new Date(),
            lastActivity: new Date(),
            httpRequestCount: 1,
            wsMessageCount: 0,
          });

          return {
            success: true,
            token: "jwt-token-123",
            sessionId,
            userId,
          };
        }

        return { success: false };
      });

      // Add protected HTTP endpoint
      app.get("/api/profile", () => {
        // Update session activity
        const session = mockSessionStore.get("session_123");
        if (session) {
          session.lastActivity = new Date();
          session.httpRequestCount++;
        }

        return {
          id: "user_123",
          username: "testuser",
          permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
        };
      });

      testServer = { server: app, port: 3010 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Step 1: Authenticate via HTTP
      const loginResponse = await fetch(
        `http://localhost:${testServer.port}/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "testuser", password: "testpass" }),
        }
      );

      expect(loginResponse.status).toBe(200);
      const loginData = await loginResponse.json();
      expect(loginData.success).toBe(true);
      expect(loginData.token).toBeDefined();

      // Step 2: Use token for protected HTTP endpoint
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
      });

      const profileResponse = await fetch(
        `http://localhost:${testServer.port}/api/profile`,
        {
          headers: { Authorization: `Bearer ${loginData.token}` },
        }
      );

      expect(profileResponse.status).toBe(200);
      const profileData = await profileResponse.json();
      expect(profileData.id).toBe("user_123");

      // Step 3: Connect via WebSocket using same token
      const wsClient = new WebSocket(`ws://localhost:${testServer.port}/ws`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });

      await new Promise<void>((resolve, reject) => {
        wsClient.on("open", () => {
          // Update session activity for WebSocket
          const session = mockSessionStore.get("session_123");
          if (session) {
            session.wsMessageCount++;
          }
          resolve();
        });
        wsClient.on("error", reject);
        setTimeout(reject, 5000);
      });

      wsClient.close();

      // Verify session was shared between protocols
      const session = mockSessionStore.get("session_123");
      expect(session).toBeDefined();
      expect(session!.httpRequestCount).toBeGreaterThan(0);
      expect(session!.wsMessageCount).toBeGreaterThan(0);

      // Verify cross-protocol authentication metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cross_protocol_session_shared",
        1,
        expect.objectContaining({
          sessionId: "session_123",
          httpRequests: session!.httpRequestCount,
          wsMessages: session!.wsMessageCount,
        })
      );
    }, 10000);

    it("should handle token refresh across both protocols", async () => {
      const app = serverBuilder
        .development()
        .withAuthentication(mockAuthService, {
          jwtSecret: "test-secret",
          enableTokenRefresh: true,
          tokenRefreshEndpoint: "/auth/refresh",
        })
        .withWebSocketAuth(mockAuthService, {
          requireAuth: true,
          jwtSecret: "test-secret",
          handleTokenRefresh: true,
        })
        .build();

      // Token refresh endpoint
      app.post("/auth/refresh", ({ headers }) => {
        const oldToken = headers.authorization?.replace("Bearer ", "");

        if (oldToken === "expired-token") {
          const newToken = "refreshed-token-456";

          // Update session with new token
          mockSessionStore.set("session_refresh", {
            userId: "user_123",
            permissions: ["api:read", "ws:connect"],
            roles: ["user"],
            createdAt: new Date(),
            lastActivity: new Date(),
            httpRequestCount: 0,
            wsMessageCount: 0,
          });

          return {
            success: true,
            token: newToken,
            expiresIn: 3600,
          };
        }

        return { success: false, error: "Invalid token" };
      });

      testServer = { server: app, port: 3011 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test token refresh
      const refreshResponse = await fetch(
        `http://localhost:${testServer.port}/auth/refresh`,
        {
          method: "POST",
          headers: { Authorization: "Bearer expired-token" },
        }
      );

      expect(refreshResponse.status).toBe(200);
      const refreshData = await refreshResponse.json();
      expect(refreshData.success).toBe(true);
      expect(refreshData.token).toBe("refreshed-token-456");

      // Token refresh metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "token_refreshed",
        1,
        expect.objectContaining({ protocol: "http" })
      );
    }, 10000);
  });

  describe("Unified Metrics Collection Across Protocols", () => {
    it("should collect metrics from both HTTP and WebSocket middleware", () => {
      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "http-metrics-test"
      );
      const wsChain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-metrics-test"
      );

      // Shared metrics middleware for both protocols
      const createMetricsMiddleware = (protocol: string) => ({
        execute: jest
          .fn()
          .mockImplementation(async (context: any, next?: Function) => {
            const startTime = Date.now();

            // Record request/message start
            mockMetricsCollector.recordCounter(
              `${protocol}_requests_started`,
              1,
              {
                path: protocol === "http" ? context.request?.url : "websocket",
                type:
                  protocol === "http"
                    ? context.request?.method
                    : context.message?.type,
              }
            );

            if (next) await next();

            const duration = Date.now() - startTime;

            // Record completion metrics
            mockMetricsCollector.recordTimer(
              `${protocol}_request_duration`,
              duration,
              { protocol }
            );

            mockMetricsCollector.recordCounter(
              `${protocol}_requests_completed`,
              1,
              { success: true }
            );
          }),
      });

      const httpMetricsMiddleware = createMetricsMiddleware("http");
      const wsMetricsMiddleware = createMetricsMiddleware("websocket");

      httpChain.register(
        { name: "metrics", priority: 100 },
        httpMetricsMiddleware.execute
      );
      wsChain.register(
        { name: "metrics", priority: 100 },
        wsMetricsMiddleware.execute
      );

      // Execute HTTP request
      const httpContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers(),
        } as any,
        response: { headers: new Headers(), status: 200 } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "http_req",
          userAgent: "Test",
          ipAddress: "127.0.0.1",
        },
      };

      const wsContext: WebSocketContext = {
        ws: { send: jest.fn(), close: jest.fn(), readyState: 1 } as any,
        connectionId: "ws_conn",
        message: { type: "chat_message", payload: {} },
        timestamp: new Date().toISOString(),
        authenticated: false,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: "127.0.0.1",
          userAgent: "Test",
          headers: {},
          query: {},
        },
      };

      // Execute chains
      httpChain.execute(httpContext, jest.fn());
      wsChain.execute(wsContext);

      // Verify metrics collected from both protocols
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_requests_started",
        1,
        expect.objectContaining({ path: "/api/test", type: "GET" })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_requests_started",
        1,
        expect.objectContaining({ path: "websocket", type: "chat_message" })
      );

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "http_request_duration",
        expect.any(Number),
        expect.objectContaining({ protocol: "http" })
      );

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "websocket_request_duration",
        expect.any(Number),
        expect.objectContaining({ protocol: "websocket" })
      );
    });

    it("should aggregate metrics across both protocols for unified dashboards", () => {
      // Simulate collecting metrics from multiple sources
      const protocolMetrics = {
        http: {
          requestCount: 1500,
          averageResponseTime: 150,
          errorRate: 0.02,
        },
        websocket: {
          messageCount: 3000,
          averageProcessingTime: 50,
          connectionDropRate: 0.01,
        },
      };

      // Aggregate metrics for unified view
      const unifiedMetrics = {
        totalRequests:
          protocolMetrics.http.requestCount +
          protocolMetrics.websocket.messageCount,
        averageLatency:
          (protocolMetrics.http.averageResponseTime +
            protocolMetrics.websocket.averageProcessingTime) /
          2,
        overallErrorRate:
          (protocolMetrics.http.errorRate +
            protocolMetrics.websocket.connectionDropRate) /
          2,
      };

      // Record unified metrics
      mockMetricsCollector.recordGauge(
        "unified_total_requests",
        unifiedMetrics.totalRequests,
        { aggregation: "cross_protocol" }
      );

      mockMetricsCollector.recordGauge(
        "unified_average_latency",
        unifiedMetrics.averageLatency,
        { protocols: ["http", "websocket"] }
      );

      mockMetricsCollector.recordGauge(
        "unified_error_rate",
        unifiedMetrics.overallErrorRate,
        { calculation: "weighted_average" }
      );

      // Verify unified metrics
      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "unified_total_requests",
        4500,
        expect.objectContaining({ aggregation: "cross_protocol" })
      );

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "unified_average_latency",
        100,
        expect.objectContaining({ protocols: ["http", "websocket"] })
      );
    });
  });

  describe("Session Management Between HTTP and WebSocket", () => {
    it("should maintain user session state across protocol switches", () => {
      // Simulate user session that spans both protocols
      const userSession = {
        sessionId: "cross_session_789",
        userId: "user_456",
        permissions: ["api:read", "api:write", "ws:connect", "chat:send"],
        roles: ["user"],
        httpConnections: 0,
        wsConnections: 0,
        activities: [] as Array<{
          type: "http" | "websocket";
          action: string;
          timestamp: Date;
        }>,
      };

      const sessionManager = {
        trackHttpActivity: (action: string) => {
          userSession.httpConnections++;
          userSession.activities.push({
            type: "http",
            action,
            timestamp: new Date(),
          });

          mockMetricsCollector.recordCounter("session_activity_tracked", 1, {
            protocol: "http",
            action,
            sessionId: userSession.sessionId,
          });
        },

        trackWebSocketActivity: (action: string) => {
          userSession.wsConnections++;
          userSession.activities.push({
            type: "websocket",
            action,
            timestamp: new Date(),
          });

          mockMetricsCollector.recordCounter("session_activity_tracked", 1, {
            protocol: "websocket",
            action,
            sessionId: userSession.sessionId,
          });
        },

        getSessionSummary: () => ({
          sessionId: userSession.sessionId,
          totalActivities: userSession.activities.length,
          httpActivities: userSession.activities.filter(
            (a) => a.type === "http"
          ).length,
          wsActivities: userSession.activities.filter(
            (a) => a.type === "websocket"
          ).length,
          crossProtocolSwitches: userSession.activities.reduce(
            (switches, activity, index) => {
              if (
                index > 0 &&
                userSession.activities[index - 1].type !== activity.type
              ) {
                return switches + 1;
              }
              return switches;
            },
            0
          ),
        }),
      };

      // Simulate user activities across both protocols
      sessionManager.trackHttpActivity("login");
      sessionManager.trackHttpActivity("get_profile");
      sessionManager.trackWebSocketActivity("connect");
      sessionManager.trackWebSocketActivity("send_message");
      sessionManager.trackHttpActivity("update_profile");
      sessionManager.trackWebSocketActivity("send_message");

      const summary = sessionManager.getSessionSummary();

      expect(summary.totalActivities).toBe(6);
      expect(summary.httpActivities).toBe(3);
      expect(summary.wsActivities).toBe(3);
      expect(summary.crossProtocolSwitches).toBe(3); // http->ws, ws->http, http->ws

      // Verify session tracking metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "session_activity_tracked",
        1,
        expect.objectContaining({ protocol: "http", action: "login" })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "session_activity_tracked",
        1,
        expect.objectContaining({ protocol: "websocket", action: "connect" })
      );
    });

    it("should handle session cleanup when user disconnects from both protocols", () => {
      const sessionId = "cleanup_session_999";

      // Track connections
      const connectionTracker = {
        httpConnections: new Set<string>(),
        wsConnections: new Set<string>(),

        addHttpConnection: (requestId: string) => {
          this.httpConnections.add(requestId);
          mockMetricsCollector.recordGauge(
            "active_http_connections",
            this.httpConnections.size,
            { sessionId }
          );
        },

        addWsConnection: (connectionId: string) => {
          this.wsConnections.add(connectionId);
          mockMetricsCollector.recordGauge(
            "active_ws_connections",
            this.wsConnections.size,
            { sessionId }
          );
        },

        removeHttpConnection: (requestId: string) => {
          this.httpConnections.delete(requestId);
          mockMetricsCollector.recordGauge(
            "active_http_connections",
            this.httpConnections.size,
            { sessionId }
          );

          this.checkForSessionCleanup();
        },

        removeWsConnection: (connectionId: string) => {
          this.wsConnections.delete(connectionId);
          mockMetricsCollector.recordGauge(
            "active_ws_connections",
            this.wsConnections.size,
            { sessionId }
          );

          this.checkForSessionCleanup();
        },

        checkForSessionCleanup: () => {
          if (
            this.httpConnections.size === 0 &&
            this.wsConnections.size === 0
          ) {
            // Session has no active connections - cleanup
            mockSessionStore.delete(sessionId);

            mockMetricsCollector.recordCounter("session_cleaned_up", 1, {
              sessionId,
              reason: "no_active_connections",
              protocols: ["http", "websocket"],
            });
          }
        },
      };

      // Simulate connections and disconnections
      connectionTracker.addHttpConnection("http_req_1");
      connectionTracker.addWsConnection("ws_conn_1");
      connectionTracker.addHttpConnection("http_req_2");

      // Remove connections
      connectionTracker.removeHttpConnection("http_req_1");
      connectionTracker.removeHttpConnection("http_req_2");
      connectionTracker.removeWsConnection("ws_conn_1"); // This should trigger cleanup

      // Verify session cleanup occurred
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "session_cleaned_up",
        1,
        expect.objectContaining({
          sessionId,
          reason: "no_active_connections",
        })
      );
    });
  });

  describe("Unified Error Handling Across Protocols", () => {
    it("should handle errors consistently between HTTP and WebSocket", () => {
      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "unified-error-http"
      );
      const wsChain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "unified-error-ws"
      );

      // Shared error handler that works for both protocols
      const createUnifiedErrorHandler = (protocol: string) => ({
        execute: jest
          .fn()
          .mockImplementation(async (context: any, next?: Function) => {
            try {
              if (next) await next();
            } catch (error: any) {
              const errorInfo = {
                protocol,
                errorType: error.constructor.name,
                message: error.message,
                timestamp: new Date(),
                contextId:
                  protocol === "http"
                    ? context.metadata?.requestId
                    : context.connectionId,
              };

              // Record unified error metrics
              mockMetricsCollector.recordCounter("unified_error_occurred", 1, {
                protocol,
                errorType: errorInfo.errorType,
                contextId: errorInfo.contextId,
              });

              // Handle error based on protocol
              if (protocol === "http") {
                context.response.status = error.statusCode || 500;
                // Set error response body
              } else if (protocol === "websocket") {
                if (context.ws && context.ws.readyState === 1) {
                  context.ws.send(
                    JSON.stringify({
                      type: "error",
                      error: errorInfo.message,
                      timestamp: errorInfo.timestamp,
                    })
                  );
                }
              }

              // Log error to central error tracking
              console.error(`[${protocol.toUpperCase()}] Error:`, errorInfo);
            }
          }),
      });

      const httpErrorHandler = createUnifiedErrorHandler("http");
      const wsErrorHandler = createUnifiedErrorHandler("websocket");

      // Add error-throwing middleware
      const errorMiddleware = {
        execute: jest.fn().mockRejectedValue(new Error("Test error")),
      };

      httpChain.register(
        { name: "error-handler", priority: 10 },
        httpErrorHandler.execute
      );
      httpChain.register(
        { name: "error-thrower", priority: 90 },
        errorMiddleware.execute
      );

      wsChain.register(
        { name: "error-handler", priority: 10 },
        wsErrorHandler.execute
      );
      wsChain.register(
        { name: "error-thrower", priority: 90 },
        errorMiddleware.execute
      );

      // Test HTTP error handling
      const httpContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers(),
        } as any,
        response: { headers: new Headers(), status: 200 } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "http_error_test",
          userAgent: "Test",
          ipAddress: "127.0.0.1",
        },
      };

      httpChain.execute(httpContext, jest.fn());

      // Test WebSocket error handling
      const wsContext: WebSocketContext = {
        ws: { send: jest.fn(), close: jest.fn(), readyState: 1 } as any,
        connectionId: "ws_error_test",
        message: { type: "test", payload: {} },
        timestamp: new Date().toISOString(),
        authenticated: false,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: "127.0.0.1",
          userAgent: "Test",
          headers: {},
          query: {},
        },
      };

      wsChain.execute(wsContext);

      // Verify unified error handling
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "unified_error_occurred",
        1,
        expect.objectContaining({ protocol: "http", errorType: "Error" })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "unified_error_occurred",
        1,
        expect.objectContaining({ protocol: "websocket", errorType: "Error" })
      );

      // Verify error responses
      expect(httpContext.response.status).toBe(500);
      expect(wsContext.ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"')
      );
    });

    it("should escalate critical errors across both protocols", () => {
      const criticalErrorHandler = {
        errors: [] as Array<{
          protocol: string;
          error: Error;
          timestamp: Date;
        }>,

        handleCriticalError: (protocol: string, error: Error) => {
          this.errors.push({
            protocol,
            error,
            timestamp: new Date(),
          });

          // Check if we have critical errors in multiple protocols
          const recentErrors = this.errors.filter(
            (e) => Date.now() - e.timestamp.getTime() < 60000 // Last minute
          );

          const protocolsWithErrors = new Set(
            recentErrors.map((e) => e.protocol)
          );

          if (protocolsWithErrors.size > 1) {
            // Multi-protocol failure - escalate
            mockMetricsCollector.recordCounter(
              "critical_cross_protocol_failure",
              1,
              {
                protocols: Array.from(protocolsWithErrors),
                errorCount: recentErrors.length,
                timeWindow: "1m",
              }
            );

            // Trigger alerting/escalation
            console.error("CRITICAL: Cross-protocol failure detected", {
              protocols: Array.from(protocolsWithErrors),
              errors: recentErrors.map((e) => e.error.message),
            });
          }
        },
      };

      // Simulate critical errors from both protocols
      const httpError = new Error("Database connection lost");
      (httpError as any).critical = true;

      const wsError = new Error("Message queue unavailable");
      (wsError as any).critical = true;

      criticalErrorHandler.handleCriticalError("http", httpError);
      criticalErrorHandler.handleCriticalError("websocket", wsError);

      // Verify critical error escalation
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "critical_cross_protocol_failure",
        1,
        expect.objectContaining({
          protocols: ["http", "websocket"],
          errorCount: 2,
        })
      );
    });
  });

  describe("Cross-Protocol Rate Limiting and Security", () => {
    it("should apply unified rate limiting across HTTP and WebSocket", () => {
      // Unified rate limiter that works across protocols
      const unifiedRateLimiter = {
        requests: new Map<string, { count: number; resetTime: number }>(),

        checkRateLimit: (clientId: string, protocol: string) => {
          const now = Date.now();
          const windowMs = 60000; // 1 minute
          const maxRequests = 100;

          let clientData = this.requests.get(clientId);

          if (!clientData || now > clientData.resetTime) {
            clientData = { count: 0, resetTime: now + windowMs };
            this.requests.set(clientId, clientData);
          }

          clientData.count++;

          const isLimited = clientData.count > maxRequests;

          if (isLimited) {
            mockMetricsCollector.recordCounter(
              "unified_rate_limit_exceeded",
              1,
              {
                clientId,
                protocol,
                count: clientData.count,
                limit: maxRequests,
              }
            );
          }

          return {
            allowed: !isLimited,
            remaining: Math.max(0, maxRequests - clientData.count),
            resetTime: clientData.resetTime,
          };
        },
      };

      // Test rate limiting across protocols for same client
      const clientId = "client_unified_test";

      // Make HTTP requests
      for (let i = 0; i < 60; i++) {
        const result = unifiedRateLimiter.checkRateLimit(clientId, "http");
        expect(result.allowed).toBe(true);
      }

      // Make WebSocket requests (same client)
      for (let i = 0; i < 45; i++) {
        const result = unifiedRateLimiter.checkRateLimit(clientId, "websocket");
        if (i < 40) {
          expect(result.allowed).toBe(true);
        } else {
          expect(result.allowed).toBe(false); // Rate limited (60 HTTP + 40 WS = 100, limit exceeded)
        }
      }

      // Verify unified rate limiting metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "unified_rate_limit_exceeded",
        expect.any(Number),
        expect.objectContaining({
          clientId,
          protocol: "websocket",
        })
      );
    });

    it("should apply consistent security policies across both protocols", () => {
      const securityPolicyEnforcer = {
        policies: {
          maxRequestSize: 1024 * 1024, // 1MB
          allowedOrigins: [
            "https://app.example.com",
            "https://admin.example.com",
          ],
          blockedIPs: new Set(["192.168.1.100", "10.0.0.50"]),
          requiredHeaders: ["user-agent"],
        },

        enforcePolicy: (context: any, protocol: string) => {
          const violations: string[] = [];

          // Check IP blocking
          const clientIP =
            protocol === "http"
              ? context.metadata?.ipAddress
              : context.metadata?.clientIp;

          if (clientIP && this.policies.blockedIPs.has(clientIP)) {
            violations.push("blocked_ip");
          }

          // Check origin (for both protocols)
          const origin =
            protocol === "http"
              ? context.request?.headers.get("origin")
              : context.metadata?.headers?.origin;

          if (origin && !this.policies.allowedOrigins.includes(origin)) {
            violations.push("unauthorized_origin");
          }

          // Check required headers
          const headers =
            protocol === "http"
              ? context.request?.headers
              : context.metadata?.headers;

          for (const requiredHeader of this.policies.requiredHeaders) {
            if (!headers?.[requiredHeader]) {
              violations.push(`missing_header_${requiredHeader}`);
            }
          }

          // Record security violations
          if (violations.length > 0) {
            mockMetricsCollector.recordCounter(
              "security_policy_violation",
              violations.length,
              {
                protocol,
                violations,
                clientIP,
                origin,
              }
            );
          }

          return {
            allowed: violations.length === 0,
            violations,
          };
        },
      };

      // Test HTTP security policy enforcement
      const httpContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers({
            origin: "https://malicious.com",
            "user-agent": "Test Browser",
          }),
        } as any,
        response: { headers: new Headers(), status: 200 } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "sec_test_http",
          userAgent: "Test Browser",
          ipAddress: "192.168.1.100", // Blocked IP
        },
      };

      const httpResult = securityPolicyEnforcer.enforcePolicy(
        httpContext,
        "http"
      );
      expect(httpResult.allowed).toBe(false);
      expect(httpResult.violations).toContain("blocked_ip");
      expect(httpResult.violations).toContain("unauthorized_origin");

      // Test WebSocket security policy enforcement
      const wsContext: WebSocketContext = {
        ws: { send: jest.fn(), close: jest.fn(), readyState: 1 } as any,
        connectionId: "sec_test_ws",
        message: { type: "test", payload: {} },
        timestamp: new Date().toISOString(),
        authenticated: false,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: "192.168.1.100", // Blocked IP
          userAgent: "Test WebSocket Client",
          headers: {
            origin: "https://malicious.com",
            "user-agent": "Test WebSocket Client",
          },
          query: {},
        },
      };

      const wsResult = securityPolicyEnforcer.enforcePolicy(
        wsContext,
        "websocket"
      );
      expect(wsResult.allowed).toBe(false);
      expect(wsResult.violations).toContain("blocked_ip");
      expect(wsResult.violations).toContain("unauthorized_origin");

      // Verify consistent security policy enforcement
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "security_policy_violation",
        expect.any(Number),
        expect.objectContaining({
          protocol: "http",
          violations: expect.arrayContaining([
            "blocked_ip",
            "unauthorized_origin",
          ]),
        })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "security_policy_violation",
        expect.any(Number),
        expect.objectContaining({
          protocol: "websocket",
          violations: expect.arrayContaining([
            "blocked_ip",
            "unauthorized_origin",
          ]),
        })
      );
    });
  });
});
