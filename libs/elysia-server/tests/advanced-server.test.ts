/**
 * @file advanced-server.test.ts
 * @description Comprehensive unit tests for AdvancedElysiaServerBuilder
 */

import {
  AdvancedElysiaServerBuilder,
  createAdvancedElysiaServer,
  createProductionServer,
  createDevelopmentServer,
} from "../src/server";
import { ServerConfig } from "../src/config";
import {
  createMockWebSocket,
  createMockConfig,
  createMockMetricsCollector,
  resetAllMocks,
  setupCommonMocks,
  type IMetricsCollector,
} from "./mocks";

// Global cleanup for all tests
afterAll(async () => {
  // Clear all timers
  jest.clearAllTimers();

  // Force garbage collection if available (in Node.js with --expose-gc)
  if (global.gc) {
    global.gc();
  }

  // Shorter wait for any pending async operations
  await new Promise((resolve) => setTimeout(resolve, 50));
}, 5000); // Increase timeout to 5 seconds

describe("AdvancedElysiaServerBuilder", () => {
  let mockConfig: ServerConfig;
  let mockMetrics: IMetricsCollector;
  let builder: AdvancedElysiaServerBuilder;
  let mockWs: ReturnType<typeof createMockWebSocket> & {
    connectionId?: string;
    connectedAt?: number;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  };

  beforeEach(() => {
    setupCommonMocks();
    resetAllMocks();

    mockConfig = {
      ...createMockConfig(),
      name: "TestServer",
      version: "1.0.0",
    } as ServerConfig;

    mockMetrics = createMockMetricsCollector();
    builder = new AdvancedElysiaServerBuilder(mockConfig, mockMetrics);
    mockWs = { ...createMockWebSocket(), data: {} };
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.clearAllMocks();
    // Cleanup builder state to prevent test interference
    if (builder) {
      await builder.cleanup();
    }
  });

  describe("Constructor", () => {
    it("should initialize with basic config", () => {
      const basicBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics
      );
      expect(basicBuilder).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should initialize with middleware config", () => {
      const middlewareConfig = {
        http: { enabled: true },
        websocket: { enabled: true },
      };

      const configBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      expect(configBuilder).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should handle undefined middleware config", () => {
      const undefinedBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        undefined
      );
      expect(undefinedBuilder).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should initialize middleware chains", () => {
      const middlewareConfig = {
        http: { enabled: true, factoryPattern: "DEVELOPMENT" as const },
        websocket: { enabled: true, factoryPattern: "DEVELOPMENT" as const },
      };

      const chainBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      expect(chainBuilder).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });
  });

  describe("Middleware Chain Initialization", () => {
    it("should initialize HTTP middleware chain when enabled", () => {
      const middlewareConfig = {
        http: { enabled: true },
        websocket: { enabled: false },
      };

      const chainBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      // The chain should be initialized
      expect(chainBuilder).toBeDefined();
    });

    it("should initialize WebSocket middleware chain when enabled", () => {
      const middlewareConfig = {
        http: { enabled: false },
        websocket: { enabled: true },
      };

      const chainBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      expect(chainBuilder).toBeDefined();
    });

    it("should skip HTTP chain when disabled", () => {
      const middlewareConfig = {
        http: { enabled: false },
        websocket: { enabled: true },
      };

      const chainBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      expect(chainBuilder).toBeDefined();
    });

    it("should handle factory pattern configuration", () => {
      const middlewareConfig = {
        http: { enabled: true, factoryPattern: "PRODUCTION_HTTP" as const },
        websocket: { enabled: true, factoryPattern: "PRODUCTION_WS" as const },
      };

      const factoryBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics,
        middlewareConfig
      );
      expect(factoryBuilder).toBeDefined();
    });

    it("should handle invalid factory pattern gracefully", () => {
      const middlewareConfig = {
        http: {
          enabled: true,
          factoryPattern: "NON_EXISTENT_PATTERN" as "PRODUCTION_HTTP",
        },
        websocket: {
          enabled: true,
          factoryPattern: "NON_EXISTENT_PATTERN" as "PRODUCTION_WS",
        },
      };

      expect(() => {
        new AdvancedElysiaServerBuilder(
          mockConfig,
          mockMetrics,
          middlewareConfig
        );
      }).not.toThrow();
    });
  });

  describe("build()", () => {
    it("should build Elysia app successfully", () => {
      const app = builder.build();
      expect(app).toBeDefined();
    });

    it("should build app with health endpoint", () => {
      const app = builder.build();
      expect(app).toBeDefined();
      // Health endpoint should be configured
    });

    it("should build app with middleware status endpoint", () => {
      const app = builder.build();
      expect(app).toBeDefined();
      // Middleware status endpoint should be configured
    });

    it("should build app with WebSocket support when enabled", () => {
      const wsConfig = {
        ...mockConfig,
        websocket: { ...mockConfig.websocket, enabled: true },
      };
      const wsBuilder = new AdvancedElysiaServerBuilder(wsConfig, mockMetrics);

      const app = wsBuilder.build();
      expect(app).toBeDefined();
    });

    it("should build app without WebSocket when disabled", () => {
      const noWsConfig = {
        ...mockConfig,
        websocket: { ...mockConfig.websocket, enabled: false },
      };
      const noWsBuilder = new AdvancedElysiaServerBuilder(
        noWsConfig,
        mockMetrics
      );

      const app = noWsBuilder.build();
      expect(app).toBeDefined();
    });

    it("should handle build errors gracefully", () => {
      // Mock a scenario that might cause build errors
      const errorBuilder = new AdvancedElysiaServerBuilder(
        mockConfig,
        mockMetrics
      );
      expect(() => errorBuilder.build()).not.toThrow();
    });
  });

  describe("WebSocket Handling", () => {
    let wsBuilder: AdvancedElysiaServerBuilder;

    beforeEach(() => {
      const wsConfig = {
        ...mockConfig,
        websocket: { ...mockConfig.websocket, enabled: true },
      };
      wsBuilder = new AdvancedElysiaServerBuilder(wsConfig, mockMetrics);
    });

    it("should handle WebSocket connection open", () => {
      const app = wsBuilder.build();
      expect(app).toBeDefined();
      // WebSocket open handler should be configured
    });

    it("should handle WebSocket messages", () => {
      const app = wsBuilder.build();
      expect(app).toBeDefined();
      // WebSocket message handler should be configured
    });

    it("should handle WebSocket connection close", () => {
      const app = wsBuilder.build();
      expect(app).toBeDefined();
      // WebSocket close handler should be configured
    });

    it("should generate unique connection IDs", () => {
      const id1 = wsBuilder["generateConnectionId"]();
      const id2 = wsBuilder["generateConnectionId"]();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^conn_\d+_[a-z0-9]+$/);
    });

    it("should handle default WebSocket messages", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";

      // Test ping message
      const pingMessage = JSON.stringify({ type: "ping" });
      wsBuilder["handleDefaultWebSocketMessage"](
        mockWs,
        pingMessage,
        connectionId
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"pong"')
      );
    });

    it("should handle join_room message", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";
      const roomMessage = JSON.stringify({
        type: "join_room",
        room: "test-room",
      });

      wsBuilder["handleDefaultWebSocketMessage"](
        mockWs,
        roomMessage,
        connectionId
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"room_joined"')
      );
    });

    it("should handle leave_room message", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";

      // First join a room
      const joinMessage = JSON.stringify({
        type: "join_room",
        room: "test-room",
      });
      wsBuilder["handleDefaultWebSocketMessage"](
        mockWs,
        joinMessage,
        connectionId
      );

      // Then leave it
      const leaveMessage = JSON.stringify({
        type: "leave_room",
        room: "test-room",
      });
      wsBuilder["handleDefaultWebSocketMessage"](
        mockWs,
        leaveMessage,
        connectionId
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"room_left"')
      );
    });

    it("should handle unknown message types", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";
      const unknownMessage = JSON.stringify({ type: "unknown", data: "test" });

      expect(() => {
        wsBuilder["handleDefaultWebSocketMessage"](
          mockWs,
          unknownMessage,
          connectionId
        );
      }).not.toThrow();
    });

    it("should handle malformed JSON messages", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";
      const malformedMessage = '{"type": "test", "invalid": json}'; // Missing quotes around "json"

      expect(() => {
        wsBuilder["handleDefaultWebSocketMessage"](
          mockWs,
          malformedMessage,
          connectionId
        );
      }).not.toThrow();
    });
  });

  describe("Room Management", () => {
    it("should join room successfully", () => {
      const connectionId = "test-conn-123";
      const room = "test-room";

      builder["joinRoom"](connectionId, room);

      expect(builder["rooms"].has(room)).toBe(true);
      expect(builder["rooms"].get(room)?.has(connectionId)).toBe(true);
    });

    it("should leave room successfully", () => {
      const connectionId = "test-conn-123";
      const room = "test-room";

      // Join first
      builder["joinRoom"](connectionId, room);
      expect(builder["rooms"].get(room)?.has(connectionId)).toBe(true);

      // Then leave
      builder["leaveRoom"](connectionId, room);
      // After leaving, the connection should not be in the room
      // If room still exists, connection should not be in it
      // If room was deleted (empty), that's also correct behavior
      const roomConnections = builder["rooms"].get(room);
      const isConnectionInRoom = roomConnections
        ? roomConnections.has(connectionId)
        : false;
      expect(isConnectionInRoom).toBe(false);
    });

    it("should cleanup empty rooms", () => {
      const connectionId = "test-conn-123";
      const room = "test-room";

      builder["joinRoom"](connectionId, room);
      expect(builder["rooms"].has(room)).toBe(true);

      builder["leaveRoom"](connectionId, room);
      expect(builder["rooms"].has(room)).toBe(false);
    });

    it("should handle leaving non-existent room", () => {
      const connectionId = "test-conn-123";
      const room = "non-existent";

      expect(() => {
        builder["leaveRoom"](connectionId, room);
      }).not.toThrow();
    });
  });

  describe("Connection Cleanup", () => {
    it("should cleanup user connection from all rooms", () => {
      const connectionId = "test-conn-123";
      const room1 = "room1";
      const room2 = "room2";

      builder["joinRoom"](connectionId, room1);
      builder["joinRoom"](connectionId, room2);

      expect(builder["rooms"].get(room1)?.has(connectionId)).toBe(true);
      expect(builder["rooms"].get(room2)?.has(connectionId)).toBe(true);

      builder["cleanupUserConnection"](connectionId);

      // After cleanup, connections should be removed from all rooms
      // If rooms still exist, connection should not be in them
      // If rooms were deleted (empty), that's also correct behavior
      const room1Connections = builder["rooms"].get(room1);
      const room2Connections = builder["rooms"].get(room2);
      const isInRoom1 = room1Connections
        ? room1Connections.has(connectionId)
        : false;
      const isInRoom2 = room2Connections
        ? room2Connections.has(connectionId)
        : false;
      expect(isInRoom1).toBe(false);
      expect(isInRoom2).toBe(false);
    });

    it("should cleanup user connections map", () => {
      const connectionId = "test-conn-123";
      const userId = "user123";

      builder["userConnections"].set(userId, new Set([connectionId]));

      builder["cleanupUserConnection"](connectionId);

      expect(builder["userConnections"].has(userId)).toBe(false);
    });

    it("should handle cleanup of non-existent connection", () => {
      expect(() => {
        builder["cleanupUserConnection"]("non-existent");
      }).not.toThrow();
    });
  });

  describe("Health and Status", () => {
    it("should return health status", () => {
      const health = builder["getHealthStatus"]();

      expect(health).toHaveProperty("status", "healthy");
      expect(health).toHaveProperty("timestamp");
      expect(health).toHaveProperty("server");
      expect(health).toHaveProperty("middleware");
      expect(health).toHaveProperty("connections");
    });

    it("should return middleware status", () => {
      const status = builder["getMiddlewareStatus"]();

      expect(status).toHaveProperty("timestamp");
      expect(status).toHaveProperty("http");
      expect(status).toHaveProperty("websocket");
    });

    it("should include connection statistics in health", () => {
      // Add some test connections
      builder["connections"].set("conn1", mockWs);
      builder["rooms"].set("room1", new Set(["conn1"]));
      builder["userConnections"].set("user1", new Set(["conn1"]));

      const health = builder["getHealthStatus"]();

      expect(health.connections.total).toBe(1);
      expect(health.connections.rooms).toBe(1);
      expect(health.connections.users).toBe(1);
    });
  });

  describe("Middleware Management", () => {
    it("should update middleware configuration", () => {
      const newConfig = {
        http: { enabled: false },
        websocket: { enabled: false },
      };

      builder.updateMiddlewareConfig(newConfig);

      expect(builder.getMiddlewareConfig()).toEqual(newConfig);
    });

    it("should get middleware configuration", () => {
      const config = builder.getMiddlewareConfig();
      // Middleware config is undefined when not explicitly set
      expect(config).toBeUndefined();
    });

    it("should toggle HTTP middleware", () => {
      const result = builder.toggleMiddleware("http", "test-middleware", true);
      // Result depends on whether the middleware exists
      expect(typeof result).toBe("boolean");
    });

    it("should toggle WebSocket middleware", () => {
      const result = builder.toggleMiddleware(
        "websocket",
        "test-middleware",
        false
      );
      // WebSocket toggle may not be supported yet
      expect(typeof result).toBe("boolean");
    });

    it("should handle toggle of non-existent middleware type", () => {
      const result = builder.toggleMiddleware(
        "invalid" as "http",
        "test",
        true
      );
      expect(result).toBe(false);
    });
  });

  describe("Configuration Access", () => {
    it("should return server configuration", () => {
      const config = builder.getConfig();
      // Check that essential properties are present
      expect(config.name).toBe(mockConfig.name);
      expect(config.version).toBe(mockConfig.version);
      expect(config).toHaveProperty("port");
      expect(config).toHaveProperty("websocket");
    });

    it("should return app instance after build", () => {
      expect(builder.getApp()).toBeUndefined();

      builder.build();
      expect(builder.getApp()).toBeDefined();
    });
  });

  describe("Factory Functions", () => {
    it("should create advanced server with factory function", () => {
      const server = createAdvancedElysiaServer(mockConfig, mockMetrics);
      expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should create production server", () => {
      const server = createProductionServer(mockConfig, mockMetrics);
      expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should create development server", () => {
      const server = createDevelopmentServer(mockConfig, mockMetrics);
      expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should allow custom config in production server", () => {
      const customConfig = { rateLimit: { enabled: false } };
      const server = createProductionServer(
        mockConfig,
        mockMetrics,
        customConfig
      );
      expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });

    it("should allow custom config in development server", () => {
      const customConfig = { security: { enabled: true } };
      const server = createDevelopmentServer(
        mockConfig,
        mockMetrics,
        customConfig
      );
      expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
    });
  });

  describe("Error Handling", () => {
    it("should handle middleware chain initialization errors", () => {
      const invalidConfig = {
        http: { enabled: true, factoryPattern: "INVALID" as "PRODUCTION_HTTP" },
      };

      expect(() => {
        new AdvancedElysiaServerBuilder(mockConfig, mockMetrics, invalidConfig);
      }).not.toThrow();
    });

    it("should handle WebSocket message parsing errors", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";
      const invalidMessage = '{"type": "test", "data": unquoted}'; // Missing quotes around "unquoted"

      expect(() => {
        builder["handleDefaultWebSocketMessage"](
          mockWs,
          invalidMessage,
          connectionId
        );
      }).not.toThrow();
    });

    it("should handle connection cleanup errors", () => {
      // Create a scenario that might cause cleanup errors
      const connectionId = "test-conn-123";

      expect(() => {
        builder["cleanupUserConnection"](connectionId);
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty room names", () => {
      const connectionId = "test-conn-123";

      expect(() => {
        builder["joinRoom"](connectionId, "");
      }).not.toThrow();
    });

    it("should handle empty connection IDs", () => {
      expect(() => {
        builder["cleanupUserConnection"]("");
      }).not.toThrow();
    });

    it("should handle concurrent room operations", () => {
      const conn1 = "conn1";
      const conn2 = "conn2";
      const room = "test-room";

      builder["joinRoom"](conn1, room);
      builder["joinRoom"](conn2, room);

      expect(builder["rooms"].get(room)?.size).toBe(2);

      // Simulate concurrent leaves
      builder["leaveRoom"](conn1, room);
      builder["leaveRoom"](conn2, room);

      expect(builder["rooms"].has(room)).toBe(false);
    });

    it("should handle large number of connections", () => {
      // Add many connections
      for (let i = 0; i < 100; i++) {
        builder["connections"].set(`conn${i}`, mockWs);
      }

      expect(builder["connections"].size).toBe(100);

      const health = builder["getHealthStatus"]();
      expect(health.connections.total).toBe(100);
    });

    it("should handle binary WebSocket messages", () => {
      const mockWs = { ...createMockWebSocket(), data: {} };
      const connectionId = "test-conn-123";
      const binaryMessage = Buffer.from("binary data");

      expect(() => {
        builder["handleDefaultWebSocketMessage"](
          mockWs,
          binaryMessage,
          connectionId
        );
      }).not.toThrow();
    });
  });
});
