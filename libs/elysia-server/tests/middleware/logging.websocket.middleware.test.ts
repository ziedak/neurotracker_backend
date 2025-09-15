/**
 * @fileoverview Comprehensive unit tests for LoggingWebSocketMiddleware
 * @description Tests WebSocket message logging, data sanitization, and connection monitoring
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { LoggingWebSocketMiddleware } from "../../src/middleware/logging/logging.websocket.middleware";
import { WebSocketContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("LoggingWebSocketMiddleware", () => {
  let middleware: LoggingWebSocketMiddleware;
  let mockContext: WebSocketContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new LoggingWebSocketMiddleware(mockMetricsCollector, {
      name: "test-ws-logging",
      enabled: true,
      priority: 40,
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      logHeartbeat: false,
      includeConnectionId: true,
      includeUserId: true,
      includeTimestamp: true,
      includeMessageSize: true,
      includeMessageType: true,
      sanitizeMessages: true,
      sensitiveFields: ["password", "token", "secret", "apiKey"],
      maxMessageSize: 1024,
      excludePaths: ["/health-ws", "/metrics-ws"],
      logLevel: "info",
      sampleRate: 1.0,
      customLabels: {
        environment: "test",
        service: "websocket",
      },
    });

    // Create mock WebSocket context
    mockContext = {
      requestId: "ws-log-test-123",
      connectionId: "ws-conn-456",
      request: {
        method: "GET",
        url: "/ws/chat",
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-key": "test-key",
          origin: "http://localhost:3000",
        },
        query: { room: "general" },
        params: {},
        ip: "192.168.1.1",
      },
      response: {
        status: 101,
        headers: { upgrade: "websocket" },
      },
      set: {
        status: 101,
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-accept": "test-accept-key",
        },
      },
      user: {
        userId: "user-123",
        role: "user",
        permissions: ["read", "write"],
      },
      session: {
        sessionId: "session-789",
        userId: "user-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        data: {},
      },
      validated: {},
      path: "/ws/chat",
      websocket: {
        send: jest.fn(),
        close: jest.fn(),
        ping: jest.fn(),
        pong: jest.fn(),
        data: {},
        isAlive: true,
        readyState: 1,
      },
      message: undefined,
      isBinary: false,
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("ws-logging");
      expect(defaultMiddleware["config"].logConnections).toBe(true);
      expect(defaultMiddleware["config"].logMessages).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-ws-logging");
      expect(middleware["config"].logConnections).toBe(true);
      expect(middleware["config"].logMessages).toBe(true);
      expect(middleware["config"].sensitiveFields).toEqual([
        "password",
        "token",
        "secret",
        "apiKey",
      ]);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new LoggingWebSocketMiddleware(mockMetricsCollector, {
          maxMessageSize: -1,
        });
      }).toThrow("WebSocket Logging maxMessageSize must be a positive integer");
    });
  });

  describe("Connection Logging", () => {
    it("should log WebSocket connection establishment", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket connection established",
        expect.objectContaining({
          connectionId: "ws-conn-456",
          userId: "user-123",
          path: "/ws/chat",
          ip: "192.168.1.1",
          timestamp: expect.any(String),
          environment: "test",
          service: "websocket",
        })
      );

      consoleSpy.mockRestore();
    });

    it("should skip connection logging when disabled", async () => {
      const noConnectionLogMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          logConnections: false,
        }
      );

      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      await noConnectionLogMiddleware["execute"](mockContext, nextFunction);

      const connectionLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket connection established"
      );

      expect(connectionLogs).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it("should handle connections without user context", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.user = undefined;

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket connection established",
        expect.objectContaining({
          connectionId: "ws-conn-456",
          userId: undefined,
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Message Logging", () => {
    it("should log incoming text messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = JSON.stringify({
        type: "chat",
        content: "Hello world",
        timestamp: Date.now(),
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket message received",
        expect.objectContaining({
          connectionId: "ws-conn-456",
          userId: "user-123",
          messageType: "text",
          messageSize: expect.any(Number),
          direction: "incoming",
          timestamp: expect.any(String),
        })
      );

      consoleSpy.mockRestore();
    });

    it("should log outgoing messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = JSON.stringify({
        type: "response",
        data: "Success",
      });

      // Simulate outgoing message
      mockContext.websocket.data.outgoing = true;

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket message sent",
        expect.objectContaining({
          direction: "outgoing",
        })
      );

      consoleSpy.mockRestore();
    });

    it("should log binary messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = Buffer.from("binary data");
      mockContext.isBinary = true;

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket message received",
        expect.objectContaining({
          messageType: "binary",
          messageSize: 11, // "binary data".length
        })
      );

      consoleSpy.mockRestore();
    });

    it("should skip message logging when disabled", async () => {
      const noMessageLogMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          logMessages: false,
        }
      );

      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = "test message";

      await noMessageLogMiddleware["execute"](mockContext, nextFunction);

      const messageLogs = consoleSpy.mock.calls.filter((call) =>
        call[0].includes("WebSocket message")
      );

      expect(messageLogs).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe("Data Sanitization", () => {
    it("should sanitize sensitive fields in messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = JSON.stringify({
        type: "auth",
        password: "secret123",
        token: "jwt-token",
        secret: "api-secret",
        apiKey: "key-123",
        normalField: "safe data",
      });

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message.password).toBe("[REDACTED]");
      expect(loggedData.message.token).toBe("[REDACTED]");
      expect(loggedData.message.secret).toBe("[REDACTED]");
      expect(loggedData.message.apiKey).toBe("[REDACTED]");
      expect(loggedData.message.normalField).toBe("safe data");

      consoleSpy.mockRestore();
    });

    it("should sanitize nested sensitive fields", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = JSON.stringify({
        user: {
          credentials: {
            password: "secret",
            token: "token123",
          },
          profile: {
            name: "John",
            secret: "hidden",
          },
        },
      });

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message.user.credentials.password).toBe("[REDACTED]");
      expect(loggedData.message.user.credentials.token).toBe("[REDACTED]");
      expect(loggedData.message.user.profile.secret).toBe("[REDACTED]");
      expect(loggedData.message.user.profile.name).toBe("John");

      consoleSpy.mockRestore();
    });

    it("should handle non-JSON messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = "plain text message";

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message).toBe("plain text message");

      consoleSpy.mockRestore();
    });

    it("should handle invalid JSON messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = '{"invalid": json content}';

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message).toBe("[INVALID_JSON]");

      consoleSpy.mockRestore();
    });
  });

  describe("Message Size Limits", () => {
    it("should truncate large messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      const largeMessage = "x".repeat(2000);
      mockContext.message = largeMessage;

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message.length).toBeLessThanOrEqual(1024);
      expect(loggedData.message).toContain("[TRUNCATED");

      consoleSpy.mockRestore();
    });

    it("should handle empty messages", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.message = "";

      await middleware["execute"](mockContext, nextFunction);

      const loggedData = consoleSpy.mock.calls.find(
        (call) => call[0] === "WebSocket message received"
      )?.[1];

      expect(loggedData.message).toBe("");
      expect(loggedData.messageSize).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe("Disconnection Logging", () => {
    it("should log WebSocket disconnections", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      // Simulate disconnection
      mockContext.websocket.readyState = 3; // CLOSED
      mockContext.websocket.data.disconnectReason = "Client disconnected";

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket connection closed",
        expect.objectContaining({
          connectionId: "ws-conn-456",
          userId: "user-123",
          disconnectReason: "Client disconnected",
          timestamp: expect.any(String),
        })
      );

      consoleSpy.mockRestore();
    });

    it("should skip disconnection logging when disabled", async () => {
      const noDisconnectLogMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          logDisconnections: false,
        }
      );

      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.websocket.readyState = 3;

      await noDisconnectLogMiddleware["execute"](mockContext, nextFunction);

      const disconnectLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket connection closed"
      );

      expect(disconnectLogs).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe("Error Logging", () => {
    it("should log WebSocket errors", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const testError = new Error("WebSocket error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket error occurred",
        expect.objectContaining({
          connectionId: "ws-conn-456",
          userId: "user-123",
          error: "WebSocket error",
          timestamp: expect.any(String),
        })
      );

      consoleSpy.mockRestore();
    });

    it("should skip error logging when disabled", async () => {
      const noErrorLogMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          logErrors: false,
        }
      );

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const testError = new Error("WebSocket error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        noErrorLogMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("Heartbeat Logging", () => {
    it("should log heartbeat messages when enabled", async () => {
      const heartbeatMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          logHeartbeat: true,
        }
      );

      const consoleSpy = jest.spyOn(console, "debug").mockImplementation();

      mockContext.message = JSON.stringify({ type: "ping" });
      mockContext.websocket.data.heartbeat = true;

      await heartbeatMiddleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith(
        "WebSocket heartbeat",
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it("should skip heartbeat logging when disabled", async () => {
      const consoleSpy = jest.spyOn(console, "debug").mockImplementation();

      mockContext.message = JSON.stringify({ type: "ping" });
      mockContext.websocket.data.heartbeat = true;

      await middleware["execute"](mockContext, nextFunction);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("Path Exclusion", () => {
    it("should skip logging for excluded paths", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.path = "/health-ws";

      await middleware["execute"](mockContext, nextFunction);

      const connectionLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket connection established"
      );

      expect(connectionLogs).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it("should log for non-excluded paths", async () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation();

      mockContext.path = "/ws/chat";

      await middleware["execute"](mockContext, nextFunction);

      const connectionLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket connection established"
      );

      expect(connectionLogs).toHaveLength(1);

      consoleSpy.mockRestore();
    });
  });

  describe("Sampling Rate", () => {
    it("should apply sampling rate to message logging", async () => {
      const sampledMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          sampleRate: 0.5,
        }
      );

      const consoleSpy = jest.spyOn(console, "info").mockImplementation();
      const randomSpy = jest.spyOn(Math, "random");

      // Mock random to return value above sample rate (should not log)
      randomSpy.mockReturnValue(0.7);

      mockContext.message = "test message";

      await sampledMiddleware["execute"](mockContext, nextFunction);

      const messageLogs = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket message received"
      );

      expect(messageLogs).toHaveLength(0);

      // Mock random to return value below sample rate (should log)
      randomSpy.mockReturnValue(0.3);

      await sampledMiddleware["execute"](mockContext, nextFunction);

      const messageLogsAfter = consoleSpy.mock.calls.filter(
        (call) => call[0] === "WebSocket message received"
      );

      expect(messageLogsAfter).toHaveLength(1);

      consoleSpy.mockRestore();
      randomSpy.mockRestore();
    });
  });

  describe("Performance Monitoring", () => {
    it("should record connection metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_connections_total",
        1,
        expect.any(Object)
      );
    });

    it("should record message metrics", async () => {
      mockContext.message = "test message";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_messages_total",
        1,
        expect.any(Object)
      );

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "ws_message_size_bytes",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record error metrics", async () => {
      const testError = new Error("WebSocket error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_errors_total",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxMessageSize", () => {
      expect(() => {
        new LoggingWebSocketMiddleware(mockMetricsCollector, {
          maxMessageSize: 0,
        });
      }).toThrow("WebSocket Logging maxMessageSize must be a positive integer");
    });

    it("should reject invalid sampleRate", () => {
      expect(() => {
        new LoggingWebSocketMiddleware(mockMetricsCollector, {
          sampleRate: 1.5,
        });
      }).toThrow("WebSocket Logging sampleRate must be between 0 and 1");
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new LoggingWebSocketMiddleware(mockMetricsCollector, {
          excludePaths: ["invalid-path"],
        });
      }).toThrow("WebSocket Logging excludePaths must start with '/'");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = LoggingWebSocketMiddleware.createDevelopmentConfig();

      expect(devConfig.logLevel).toBe("debug");
      expect(devConfig.logHeartbeat).toBe(true);
      expect(devConfig.sampleRate).toBe(1.0);
    });

    it("should create production configuration", () => {
      const prodConfig = LoggingWebSocketMiddleware.createProductionConfig();

      expect(prodConfig.logLevel).toBe("info");
      expect(prodConfig.logHeartbeat).toBe(false);
      expect(prodConfig.sampleRate).toBe(0.1);
    });

    it("should create minimal configuration", () => {
      const minimalConfig = LoggingWebSocketMiddleware.createMinimalConfig();

      expect(minimalConfig.logConnections).toBe(true);
      expect(minimalConfig.logMessages).toBe(false);
      expect(minimalConfig.logErrors).toBe(true);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(40);
    });

    it("should preserve WebSocket context", async () => {
      const originalConnectionId = mockContext.connectionId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.connectionId).toBe(originalConnectionId);
      expect(mockContext.websocket).toBeDefined();
    });

    it("should handle concurrent WebSocket operations", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
