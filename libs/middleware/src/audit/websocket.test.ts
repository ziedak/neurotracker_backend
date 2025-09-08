/**
 * WebSocket Audit Middleware Integration Tests
 * Tests for connection lifecycle, event batching, and compliance features
 */

import { WebSocketAuditMiddleware } from "./WebSocketAuditMiddleware";
import {
  WS_AUDIT_PRESETS,
  WS_AUDIT_FACTORIES,
  WS_AUDIT_TESTING_UTILS,
} from "./websocket";
import type { WebSocketAuditMiddlewareConfig } from "./WebSocketAuditMiddleware";

// Mock WebSocket for testing
class MockWebSocket {
  public readyState = 1; // OPEN
  public url = "ws://localhost:3000/test";
  public protocol = "";
  public extensions = "";
  public binaryType: "blob" | "arraybuffer" = "blob";

  private eventListeners: Record<string, Function[]> = {};

  public send = jest.fn();
  public close = jest.fn();
  public terminate = jest.fn();

  public addEventListener(event: string, listener: Function): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  }

  public removeEventListener(event: string, listener: Function): void {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(
        (l) => l !== listener
      );
    }
  }

  public dispatchEvent(event: { type: string; data?: any }): boolean {
    const listeners = this.eventListeners[event.type] || [];
    listeners.forEach((listener) => listener(event));
    return true;
  }

  // Simulate connection events
  public simulateMessage(data: any): void {
    this.dispatchEvent({ type: "message", data });
  }

  public simulateError(error: Error): void {
    this.dispatchEvent({ type: "error", data: error });
  }

  public simulateClose(): void {
    this.readyState = 3; // CLOSED
    this.dispatchEvent({ type: "close" });
  }
}

// Test helper to wait for async operations
const waitForAsync = (ms: number = 100): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("WebSocketAuditMiddleware", () => {
  let middleware: WebSocketAuditMiddleware;
  let mockMetrics: any;
  let mockRedis: any;
  let mockClickhouse: any;
  let mockContext: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh mocks
    const testUtils = WS_AUDIT_TESTING_UTILS.createMockMiddleware();
    middleware = testUtils.middleware;
    mockMetrics = testUtils.mocks.metrics;
    mockRedis = testUtils.mocks.redis;
    mockClickhouse = testUtils.mocks.clickhouse;

    // Create mock context
    mockContext = WS_AUDIT_TESTING_UTILS.createTestContext({
      ws: new MockWebSocket(),
    });
  });

  describe("Connection Lifecycle", () => {
    it("should track WebSocket connection events", async () => {
      // Execute connection handler
      await middleware.handleConnection(mockContext);

      // Verify connection tracking
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "connection" }
      );

      // Verify connection is stored
      expect(
        middleware["connectionStartTimes"].has(mockContext.connectionId)
      ).toBe(true);
    });

    it("should track WebSocket disconnection events with duration", async () => {
      // First establish connection
      await middleware.handleConnection(mockContext);

      // Wait a bit to simulate session duration
      await waitForAsync(50);

      // Execute disconnection handler
      await middleware.handleDisconnection(mockContext);

      // Verify disconnection tracking
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "disconnection" }
      );

      // Verify duration tracking
      expect(mockMetrics.recordTimer).toHaveBeenCalledWith(
        "websocket_audit_session_duration",
        expect.any(Number)
      );

      // Verify connection is removed
      expect(
        middleware["connectionStartTimes"].has(mockContext.connectionId)
      ).toBe(false);
    });

    it("should track WebSocket message events", async () => {
      // Execute message handler
      await middleware.handleMessage(mockContext);

      // Verify message tracking
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "message" }
      );

      // Verify message size tracking
      expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
        "websocket_audit_message_size",
        expect.any(Number)
      );
    });

    it("should track WebSocket error events", async () => {
      const error = new Error("Test WebSocket error");

      // Execute error handler
      await middleware.handleError(mockContext, error);

      // Verify error tracking
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "error" }
      );

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_errors_total",
        1,
        { error_type: "Error" }
      );
    });
  });

  describe("Event Batching", () => {
    it("should batch events when batching is enabled", async () => {
      // Create middleware with batching enabled
      const batchingMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        batchInserts: true,
        batchSize: 3,
        flushInterval: 1000,
      }).middleware;

      // Execute multiple events
      await batchingMiddleware.handleConnection(mockContext);
      await batchingMiddleware.handleMessage(mockContext);
      await batchingMiddleware.handleDisconnection(mockContext);

      // Verify events are batched (not immediately stored)
      expect(batchingMiddleware["eventBatch"]).toHaveLength(3);
    });

    it("should flush batch when size limit is reached", async () => {
      // Create middleware with small batch size
      const batchingMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        batchInserts: true,
        batchSize: 2,
        flushInterval: 1000,
      }).middleware;

      // Execute events to exceed batch size
      await batchingMiddleware.handleConnection(mockContext);
      await batchingMiddleware.handleMessage(mockContext);
      await batchingMiddleware.handleDisconnection(mockContext); // This should trigger flush

      // Wait for flush
      await waitForAsync(50);

      // Verify batch was flushed
      expect(batchingMiddleware["eventBatch"]).toHaveLength(1); // Only the last event remains
    });

    it("should flush batch on interval", async () => {
      // Create middleware with short flush interval
      const batchingMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        batchInserts: true,
        batchSize: 10,
        flushInterval: 100, // 100ms
      }).middleware;

      // Execute events
      await batchingMiddleware.handleConnection(mockContext);
      await batchingMiddleware.handleMessage(mockContext);

      // Wait for flush interval
      await waitForAsync(150);

      // Verify batch was flushed
      expect(batchingMiddleware["eventBatch"]).toHaveLength(0);
    });
  });

  describe("Data Storage Strategies", () => {
    it("should store events in Redis when strategy is 'redis'", async () => {
      const redisMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        storageStrategy: "redis",
        batchInserts: false,
      }).middleware;

      await redisMiddleware.handleConnection(mockContext);

      // Verify Redis storage was called
      expect(mockRedis.getRedis().setex).toHaveBeenCalled();
    });

    it("should store events in ClickHouse when strategy is 'clickhouse'", async () => {
      const clickhouseMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        storageStrategy: "clickhouse",
        batchInserts: false,
      }).middleware;

      await clickhouseMiddleware.handleConnection(mockContext);

      // Verify ClickHouse storage was called
      expect(mockClickhouse.insert).toHaveBeenCalled();
    });

    it("should store events in both Redis and ClickHouse when strategy is 'both'", async () => {
      const bothMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        storageStrategy: "both",
        batchInserts: false,
      }).middleware;

      await bothMiddleware.handleConnection(mockContext);

      // Verify both storages were called
      expect(mockRedis.getRedis().setex).toHaveBeenCalled();
      expect(mockClickhouse.insert).toHaveBeenCalled();
    });
  });

  describe("Compliance Features", () => {
    it("should anonymize personal data when anonymization is enabled", async () => {
      const complianceMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        anonymizePersonalData: true,
        sensitiveFields: ["email", "phone"],
        batchInserts: false,
      }).middleware;

      const contextWithSensitiveData = WS_AUDIT_TESTING_UTILS.createTestContext(
        {
          message: {
            type: "user_update",
            payload: {
              email: "user@example.com",
              phone: "123-456-7890",
              name: "John Doe",
            },
          },
        }
      );

      await complianceMiddleware.handleMessage(contextWithSensitiveData);

      // Verify sensitive data was anonymized
      const calls = mockRedis.getRedis().setex.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      const storedEvent = JSON.parse(calls[0][2]);
      expect(storedEvent.payload).toContain("***REDACTED***");
    });

    it("should respect GDPR compliance mode", async () => {
      const gdprMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        complianceMode: "GDPR",
        anonymizePersonalData: true,
        retentionDays: 365,
      }).middleware;

      await gdprMiddleware.handleConnection(mockContext);

      // Verify GDPR-specific behavior
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "connection", compliance_mode: "GDPR" }
      );
    });
  });

  describe("Message Filtering", () => {
    it("should skip messages based on skipMessageTypes configuration", async () => {
      const filteringMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        skipMessageTypes: ["ping", "pong", "heartbeat"],
        logMessages: true,
      }).middleware;

      const pingContext = WS_AUDIT_TESTING_UTILS.createTestContext({
        message: { type: "ping", payload: {} },
      });

      await filteringMiddleware.handleMessage(pingContext);

      // Verify ping message was skipped
      expect(mockMetrics.recordCounter).not.toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "message" }
      );
    });

    it("should process messages not in skipMessageTypes list", async () => {
      const filteringMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        skipMessageTypes: ["ping", "pong"],
        logMessages: true,
      }).middleware;

      const chatContext = WS_AUDIT_TESTING_UTILS.createTestContext({
        message: { type: "chat_message", payload: { text: "Hello" } },
      });

      await filteringMiddleware.handleMessage(chatContext);

      // Verify chat message was processed
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_events_total",
        1,
        { event_type: "message" }
      );
    });
  });

  describe("Real-time Analytics", () => {
    it("should track analytics when enabled", async () => {
      const analyticsMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        enableRealTimeAnalytics: true,
      }).middleware;

      // Execute multiple events
      await analyticsMiddleware.handleConnection(mockContext);
      await analyticsMiddleware.handleMessage(mockContext);
      await analyticsMiddleware.handleDisconnection(mockContext);

      // Verify analytics metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "websocket_audit_analytics_active_connections",
        expect.any(Number)
      );
    });

    it("should generate summary statistics", async () => {
      // Mock the query method to return sample data
      jest
        .spyOn(middleware, "query")
        .mockResolvedValue([
          WS_AUDIT_TESTING_UTILS.createTestAuditEvent({
            eventType: "connection",
          }),
          WS_AUDIT_TESTING_UTILS.createTestAuditEvent({ eventType: "message" }),
          WS_AUDIT_TESTING_UTILS.createTestAuditEvent({
            eventType: "disconnection",
          }),
        ]);

      const summary = await middleware.getSummary({
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        endDate: new Date(),
      });

      expect(summary).toEqual(
        expect.objectContaining({
          totalEvents: expect.any(Number),
          connectionEvents: expect.any(Number),
          messageEvents: expect.any(Number),
          disconnectionEvents: expect.any(Number),
          errorEvents: expect.any(Number),
          uniqueUsers: expect.any(Number),
          averageSessionDuration: expect.any(Number),
        })
      );
    });
  });

  describe("Performance Optimization", () => {
    it("should respect payload size limits", async () => {
      const sizeLimitMiddleware = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
        maxPayloadSize: 100, // 100 bytes
        includePayload: true,
      }).middleware;

      const largePayloadContext = WS_AUDIT_TESTING_UTILS.createTestContext({
        message: {
          type: "large_message",
          payload: { data: "x".repeat(200) }, // 200+ bytes
        },
      });

      await sizeLimitMiddleware.handleMessage(largePayloadContext);

      // Verify large payload was truncated or excluded
      const calls = mockRedis.getRedis().setex.mock.calls;
      if (calls.length > 0) {
        const storedEvent = JSON.parse(calls[0][2]);
        expect(storedEvent.payload).not.toEqual(
          largePayloadContext.message.payload
        );
      }
    });
  });
});

describe("WebSocket Audit Middleware Presets", () => {
  it("should create development preset with correct configuration", () => {
    const devConfig = WS_AUDIT_PRESETS.development();

    expect(devConfig).toEqual(
      expect.objectContaining({
        name: "ws-audit-dev",
        logConnections: true,
        logMessages: true,
        includePayload: true,
        anonymizePersonalData: false,
        batchInserts: false,
        retentionDays: 7,
      })
    );
  });

  it("should create production preset with correct configuration", () => {
    const prodConfig = WS_AUDIT_PRESETS.production();

    expect(prodConfig).toEqual(
      expect.objectContaining({
        name: "ws-audit-prod",
        includePayload: false,
        anonymizePersonalData: true,
        batchInserts: true,
        retentionDays: 90,
        storageStrategy: "both",
      })
    );
  });

  it("should create GDPR compliance preset with correct configuration", () => {
    const gdprConfig = WS_AUDIT_PRESETS.gdprCompliance();

    expect(gdprConfig).toEqual(
      expect.objectContaining({
        name: "ws-audit-gdpr",
        complianceMode: "GDPR",
        anonymizePersonalData: true,
        retentionDays: 2555, // 7 years
        includePayload: true,
        skipMessageTypes: [],
      })
    );
  });

  it("should create gaming preset with optimized configuration", () => {
    const gamingConfig = WS_AUDIT_PRESETS.gaming();

    expect(gamingConfig).toEqual(
      expect.objectContaining({
        name: "ws-audit-gaming",
        logMessages: false, // High volume
        storageStrategy: "clickhouse",
        batchSize: 500,
        skipMessageTypes: expect.arrayContaining([
          "player_position",
          "game_state_update",
        ]),
      })
    );
  });

  it("should create high-performance preset with minimal overhead", () => {
    const perfConfig = WS_AUDIT_PRESETS.highPerformance();

    expect(perfConfig).toEqual(
      expect.objectContaining({
        name: "ws-audit-perf",
        logMessages: false,
        includePayload: false,
        includeMetadata: false,
        enableRealTimeAnalytics: false,
        batchSize: 1000,
        flushInterval: 10000,
      })
    );
  });
});

describe("WebSocket Audit Middleware Factory Functions", () => {
  let mockMetrics: any;
  let mockRedis: any;
  let mockClickhouse: any;

  beforeEach(() => {
    const testUtils = WS_AUDIT_TESTING_UTILS.createMockMiddleware();
    mockMetrics = testUtils.mocks.metrics;
    mockRedis = testUtils.mocks.redis;
    mockClickhouse = testUtils.mocks.clickhouse;
  });

  it("should create middleware for development environment", () => {
    const devMiddleware = WS_AUDIT_FACTORIES.forDevelopment(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(devMiddleware).toBeInstanceOf(WebSocketAuditMiddleware);
    expect(devMiddleware["config"].name).toBe("ws-audit-dev");
  });

  it("should create middleware for production environment", () => {
    const prodMiddleware = WS_AUDIT_FACTORIES.forProduction(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(prodMiddleware).toBeInstanceOf(WebSocketAuditMiddleware);
    expect(prodMiddleware["config"].name).toBe("ws-audit-prod");
  });

  it("should create middleware with custom overrides", () => {
    const customMiddleware = WS_AUDIT_FACTORIES.forProduction(
      mockMetrics,
      mockRedis,
      mockClickhouse,
      { name: "custom-ws-audit", retentionDays: 365 }
    );

    expect(customMiddleware["config"].name).toBe("custom-ws-audit");
    expect(customMiddleware["config"].retentionDays).toBe(365);
  });

  it("should create compliance-specific middleware", () => {
    const gdprMiddleware = WS_AUDIT_FACTORIES.forGDPR(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(gdprMiddleware["config"].complianceMode).toBe("GDPR");
    expect(gdprMiddleware["config"].anonymizePersonalData).toBe(true);

    const soxMiddleware = WS_AUDIT_FACTORIES.forSOX(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(soxMiddleware["config"].complianceMode).toBe("SOX");
    expect(soxMiddleware["config"].retentionDays).toBe(2555); // 7 years

    const hipaaMiddleware = WS_AUDIT_FACTORIES.forHIPAA(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(hipaaMiddleware["config"].complianceMode).toBe("HIPAA");

    const pciMiddleware = WS_AUDIT_FACTORIES.forPCI(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(pciMiddleware["config"].complianceMode).toBe("PCI_DSS");
    expect(pciMiddleware["config"].logMessages).toBe(false); // Never log payment data
  });

  it("should create application-specific middleware", () => {
    const chatMiddleware = WS_AUDIT_FACTORIES.forRealtimeChat(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(chatMiddleware["config"].sensitiveFields).toContain(
      "message_content"
    );

    const gamingMiddleware = WS_AUDIT_FACTORIES.forGaming(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(gamingMiddleware["config"].logMessages).toBe(false);
    expect(gamingMiddleware["config"].skipMessageTypes).toContain(
      "player_position"
    );

    const iotMiddleware = WS_AUDIT_FACTORIES.forIoT(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(iotMiddleware["config"].skipMessageTypes).toContain("sensor_data");

    const apiMiddleware = WS_AUDIT_FACTORIES.forAPI(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(apiMiddleware["config"].trackMessageSize).toBe(true);
  });

  it("should create high-performance middleware", () => {
    const perfMiddleware = WS_AUDIT_FACTORIES.forHighPerformance(
      mockMetrics,
      mockRedis,
      mockClickhouse
    );

    expect(perfMiddleware["config"].logMessages).toBe(false);
    expect(perfMiddleware["config"].enableRealTimeAnalytics).toBe(false);
    expect(perfMiddleware["config"].batchSize).toBe(1000);
  });
});

describe("Integration Tests", () => {
  it("should handle complete WebSocket session lifecycle", async () => {
    const { middleware } = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      batchInserts: false,
    });

    const mockWs = new MockWebSocket();
    const sessionContext = WS_AUDIT_TESTING_UTILS.createTestContext({
      ws: mockWs,
      connectionId: "session-test-123",
    });

    // Simulate complete session
    await middleware.handleConnection(sessionContext);

    // Simulate multiple messages
    for (let i = 0; i < 5; i++) {
      const msgContext = {
        ...sessionContext,
        message: {
          type: "chat_message",
          payload: { text: `Message ${i}` },
          id: `msg-${i}`,
        },
      };
      await middleware.handleMessage(msgContext);
    }

    // Simulate disconnection
    await middleware.handleDisconnection(sessionContext);

    // Verify all events were tracked
    expect(mockMetrics.recordCounter).toHaveBeenCalledTimes(7); // 1 connection + 5 messages + 1 disconnection
  });

  it("should handle error scenarios gracefully", async () => {
    const { middleware } = WS_AUDIT_TESTING_UTILS.createMockMiddleware();

    // Simulate storage failure
    mockRedis
      .getRedis()
      .setex.mockRejectedValue(new Error("Redis connection failed"));

    const errorContext = WS_AUDIT_TESTING_UTILS.createTestContext();

    // Should not throw error even if storage fails
    await expect(
      middleware.handleConnection(errorContext)
    ).resolves.not.toThrow();

    // Should still record metrics
    expect(mockMetrics.recordCounter).toHaveBeenCalled();
  });

  it("should cleanup resources properly", async () => {
    const { middleware } = WS_AUDIT_TESTING_UTILS.createMockMiddleware({
      batchInserts: true,
      flushInterval: 1000,
    });

    // Create connection
    const context = WS_AUDIT_TESTING_UTILS.createTestContext();
    await middleware.handleConnection(context);

    // Cleanup middleware
    await middleware.cleanup();

    // Verify timers are cleared and resources cleaned up
    expect(middleware["eventBatch"]).toHaveLength(0);
    expect(middleware["flushTimer"]).toBeUndefined();
  });
});
