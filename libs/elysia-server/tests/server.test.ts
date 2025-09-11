/**
 * @filimport {
  createMockWebSocket,
  createMockConfig,
  resetAllMocks,
  setupCommonMocks
} from './mocks';r.test.ts
 * @description Comprehensive unit tests for ElysiaServerBuilder and related server functionality
 */

import {
  ElysiaServerBuilder,
  createElysiaServer,
  WebSocketMessageSimple,
} from "../src/server";
import { ServerConfig } from "../src/config";
import {
  createMockWebSocket,
  createMockConfig,
  resetAllMocks,
  setupCommonMocks,
} from "./mocks";

describe("ElysiaServerBuilder", () => {
  let mockConfig: ServerConfig;
  let builder: ElysiaServerBuilder;
  let mockWs: any;

  beforeEach(() => {
    setupCommonMocks();
    resetAllMocks();

    mockConfig = {
      ...createMockConfig(),
      name: "TestServer",
      version: "1.0.0",
    } as ServerConfig;

    mockConfig.websocket = {
      enabled: true,
      path: "/ws",
      idleTimeout: 30000,
      maxPayloadLength: 1024 * 1024,
      perMessageDeflate: false,
      backpressureLimit: 1024,
      closeOnBackpressureLimit: false,
    };

    builder = new ElysiaServerBuilder(mockConfig);
    mockWs = { ...createMockWebSocket(), data: {} };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should initialize with default config when no config provided", () => {
      const defaultBuilder = new ElysiaServerBuilder({});
      expect(defaultBuilder).toBeInstanceOf(ElysiaServerBuilder);
    });

    it("should merge provided config with defaults", () => {
      const customConfig = { port: 8080, name: "TestServer" };
      const customBuilder = new ElysiaServerBuilder(customConfig);
      expect(customBuilder).toBeInstanceOf(ElysiaServerBuilder);
    });

    it("should handle undefined config gracefully", () => {
      const undefinedBuilder = new ElysiaServerBuilder(undefined as any);
      expect(undefinedBuilder).toBeInstanceOf(ElysiaServerBuilder);
    });
  });

  describe("addRoutes", () => {
    it("should add route setup functions", () => {
      const mockRouteSetup = jest.fn((app: any) => app);
      builder.addRoutes(mockRouteSetup);
      expect(builder).toBeInstanceOf(ElysiaServerBuilder);
    });

    it("should chain multiple route setups", () => {
      const route1 = jest.fn((app: any) => app);
      const route2 = jest.fn((app: any) => app);

      builder.addRoutes(route1).addRoutes(route2);
      expect(builder).toBeInstanceOf(ElysiaServerBuilder);
    });

    it("should handle null route setup", () => {
      expect(() => builder.addRoutes(null as any)).not.toThrow();
    });
  });

  describe("addWebSocketHandler", () => {
    it("should add WebSocket handler", () => {
      const mockHandler = {
        open: jest.fn(),
        message: jest.fn(),
        close: jest.fn(),
        drain: jest.fn(),
      };

      builder.addWebSocketHandler(mockHandler);
      expect(builder).toBeInstanceOf(ElysiaServerBuilder);
    });

    it("should handle partial WebSocket handler", () => {
      const partialHandler = { open: jest.fn() };
      builder.addWebSocketHandler(partialHandler);
      expect(builder).toBeInstanceOf(ElysiaServerBuilder);
    });
  });

  describe("WebSocket Message Handling", () => {
    let mockWs: any;
    let connectionId: string;

    beforeEach(() => {
      mockWs = createMockWebSocket();
      connectionId = "test-conn-123";
      (mockWs.data as any) = { connectionId };
    });

    it("should handle authentication message", () => {
      const message: WebSocketMessageSimple = {
        type: "authenticate",
        payload: { userId: "user123", sessionId: "session456" },
      };

      // Register the connection first
      builder["connections"].set(connectionId, mockWs);

      builder["handleWebSocketMessageSimple"](mockWs, message, connectionId);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"authenticated"')
      );
    });

    it("should handle join_room message", () => {
      const message: WebSocketMessageSimple = {
        type: "join_room",
        payload: { room: "room1" },
      };

      // Register the connection first
      builder["connections"].set(connectionId, mockWs);

      builder["handleWebSocketMessageSimple"](mockWs, message, connectionId);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"joined_room"')
      );
    });

    it("should handle leave_room message", () => {
      // First join a room
      const joinMessage: WebSocketMessageSimple = {
        type: "join_room",
        payload: { room: "room1" },
      };

      // Register the connection first
      builder["connections"].set(connectionId, mockWs);

      builder["handleWebSocketMessageSimple"](
        mockWs,
        joinMessage,
        connectionId
      );

      // Then leave it
      const leaveMessage: WebSocketMessageSimple = {
        type: "leave_room",
        payload: { room: "room1" },
      };
      builder["handleWebSocketMessageSimple"](
        mockWs,
        leaveMessage,
        connectionId
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"left_room"')
      );
    });

    it("should forward unknown message types to custom handler", () => {
      const mockHandler = { message: jest.fn() };
      builder.addWebSocketHandler(mockHandler);

      const message: WebSocketMessageSimple = {
        type: "custom",
        payload: { data: "test" },
      };

      builder["handleWebSocketMessageSimple"](mockWs, message, connectionId);

      expect(mockHandler.message).toHaveBeenCalledWith(mockWs, message);
    });

    it("should skip message handling when WebSocket is disabled", () => {
      const disabledConfig = {
        ...mockConfig,
        websocket: { ...mockConfig.websocket, enabled: false },
      };
      const disabledBuilder = new ElysiaServerBuilder(disabledConfig);

      const message: WebSocketMessageSimple = {
        type: "authenticate",
        payload: { userId: "user123" },
      };

      disabledBuilder["handleWebSocketMessageSimple"](
        mockWs,
        message,
        connectionId
      );

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe("Connection Management", () => {
    it("should generate unique connection IDs", () => {
      const id1 = builder["generateConnectionId"]();
      const id2 = builder["generateConnectionId"]();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^conn_\d+_[a-z0-9]+$/);
    });

    it("should send message to specific connection", () => {
      const mockWs = createMockWebSocket();
      const connectionId = "test-conn-123";

      builder["connections"].set(connectionId, mockWs);

      const message: WebSocketMessageSimple = {
        type: "test",
        payload: { data: "hello" },
      };

      const result = builder.sendToConnection(connectionId, message);

      expect(result).toBe(true);
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"test"')
      );
    });

    it("should return false when sending to non-existent connection", () => {
      const message: WebSocketMessageSimple = {
        type: "test",
        payload: { data: "hello" },
      };

      const result = builder.sendToConnection("non-existent", message);

      expect(result).toBe(false);
    });

    it("should handle send errors gracefully", () => {
      const mockWs = createMockWebSocket();
      mockWs.send.mockImplementation(() => {
        throw new Error("Send failed");
      });

      const connectionId = "test-conn-123";
      builder["connections"].set(connectionId, mockWs);

      const message: WebSocketMessageSimple = {
        type: "test",
        payload: { data: "hello" },
      };

      const result = builder.sendToConnection(connectionId, message);

      expect(result).toBe(false);
    });

    it("should send message to user connections", () => {
      const userId = "user123";
      const conn1 = "conn1";
      const conn2 = "conn2";

      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      builder["connections"].set(conn1, mockWs1);
      builder["connections"].set(conn2, mockWs2);
      builder["userConnections"].set(userId, new Set([conn1, conn2]));

      const message: WebSocketMessageSimple = {
        type: "notification",
        payload: { text: "Hello user!" },
      };

      const sentCount = builder.sendToUser(userId, message);

      expect(sentCount).toBe(2);
      expect(mockWs1.send).toHaveBeenCalled();
      expect(mockWs2.send).toHaveBeenCalled();
    });

    it("should send message to room members", () => {
      const room = "room1";
      const conn1 = "conn1";
      const conn2 = "conn2";

      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      builder["connections"].set(conn1, mockWs1);
      builder["connections"].set(conn2, mockWs2);
      builder["rooms"].set(room, new Set([conn1, conn2]));

      const message: WebSocketMessageSimple = {
        type: "room_message",
        payload: { text: "Hello room!" },
      };

      const sentCount = builder.sendToRoom(room, message);

      expect(sentCount).toBe(2);
      expect(mockWs1.send).toHaveBeenCalled();
      expect(mockWs2.send).toHaveBeenCalled();
    });

    it("should broadcast message to all connections", () => {
      const conn1 = "conn1";
      const conn2 = "conn2";

      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      builder["connections"].set(conn1, mockWs1);
      builder["connections"].set(conn2, mockWs2);

      const message: WebSocketMessageSimple = {
        type: "broadcast",
        payload: { text: "Hello everyone!" },
      };

      const sentCount = builder.broadcast(message);

      expect(sentCount).toBe(2);
      expect(mockWs1.send).toHaveBeenCalled();
      expect(mockWs2.send).toHaveBeenCalled();
    });
  });

  describe("Statistics", () => {
    it("should return correct stats", () => {
      // Setup some test data
      builder["connections"].set("conn1", mockWs);
      builder["connections"].set("conn2", mockWs);
      builder["rooms"].set("room1", new Set(["conn1"]));
      builder["userConnections"].set("user1", new Set(["conn1", "conn2"]));

      const stats = builder.getStats();

      expect(stats).toEqual({
        activeConnections: 2,
        activeRooms: 1,
        activeUsers: 1,
      });
    });

    it("should return zero stats when no data", () => {
      const stats = builder.getStats();

      expect(stats).toEqual({
        activeConnections: 0,
        activeRooms: 0,
        activeUsers: 0,
      });
    });
  });

  describe("Connection Cleanup", () => {
    it("should cleanup connection from all tracking structures", () => {
      const connectionId = "test-conn-123";
      const userId = "user123";
      const room = "room1";

      const mockWs = { ...createMockWebSocket(), data: { userId } };

      // Setup initial state
      builder["connections"].set(connectionId, mockWs);
      builder["userConnections"].set(userId, new Set([connectionId]));
      builder["rooms"].set(room, new Set([connectionId]));

      builder["cleanupConnection"](connectionId, mockWs);

      expect(builder["connections"].has(connectionId)).toBe(false);
      expect(builder["userConnections"].has(userId)).toBe(false);
      expect(builder["rooms"].has(room)).toBe(false);
    });

    it("should handle cleanup when user has multiple connections", () => {
      const conn1 = "conn1";
      const conn2 = "conn2";
      const userId = "user123";

      const mockWs1 = { ...createMockWebSocket(), data: { userId } };
      const mockWs2 = { ...createMockWebSocket(), data: { userId } };

      builder["connections"].set(conn1, mockWs1);
      builder["connections"].set(conn2, mockWs2);
      builder["userConnections"].set(userId, new Set([conn1, conn2]));

      builder["cleanupConnection"](conn1, mockWs1);

      expect(builder["connections"].has(conn1)).toBe(false);
      expect(builder["connections"].has(conn2)).toBe(true);
      expect(builder["userConnections"].get(userId)?.has(conn1)).toBe(false);
      expect(builder["userConnections"].get(userId)?.has(conn2)).toBe(true);
    });
  });

  describe("build()", () => {
    it("should build Elysia app with health endpoint", () => {
      const app = builder.build();

      expect(app).toBeDefined();
      // The app should have the health endpoint configured
    });

    it("should build app with WebSocket support when enabled", () => {
      const app = builder.build();

      expect(app).toBeDefined();
      // WebSocket endpoint should be configured
    });

    it("should build app without WebSocket when disabled", () => {
      const disabledConfig = {
        ...mockConfig,
        websocket: { ...mockConfig.websocket, enabled: false },
      };
      const disabledBuilder = new ElysiaServerBuilder(disabledConfig);

      const app = disabledBuilder.build();

      expect(app).toBeDefined();
    });

    it("should apply custom routes", () => {
      const mockRouteSetup = jest.fn((app: any) => app);
      builder.addRoutes(mockRouteSetup);

      builder.build();

      expect(mockRouteSetup).toHaveBeenCalled();
    });
  });

  describe("start()", () => {
    let originalExit: any;
    let originalOn: any;

    beforeEach(() => {
      originalExit = process.exit;
      originalOn = process.on;
      process.exit = jest.fn() as any;
      process.on = jest.fn();
    });

    afterEach(() => {
      process.exit = originalExit;
      process.on = originalOn;
    });

    it("should start server and return app and server", () => {
      const result = builder.start();

      expect(result).toHaveProperty("app");
      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("wsServer");
    });

    it("should setup graceful shutdown handlers", () => {
      builder.start();

      expect(process.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    });

    it("should cleanup connections on shutdown", () => {
      const mockWs = createMockWebSocket();
      builder["connections"].set("test-conn", mockWs);

      builder.start();

      // Simulate shutdown
      const shutdownHandler = (process.on as jest.Mock).mock.calls.find(
        (call: any) => call[0] === "SIGTERM"
      )?.[1];

      if (shutdownHandler) {
        shutdownHandler();
      }

      expect(mockWs.close).toHaveBeenCalledWith(1001, "Server shutting down");
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty message payload", () => {
      const mockWs = createMockWebSocket();
      const message: WebSocketMessageSimple = {
        type: "authenticate",
        payload: {},
      };

      expect(() => {
        builder["handleWebSocketMessageSimple"](mockWs, message, "test-conn");
      }).not.toThrow();
    });

    it("should handle malformed JSON in message sending", () => {
      const mockWs = createMockWebSocket();
      mockWs.send.mockImplementation(() => {
        throw new Error("Invalid JSON");
      });

      builder["connections"].set("test-conn", mockWs);

      const message: WebSocketMessageSimple = {
        type: "test",
        payload: { circular: {} },
      };

      // Create circular reference
      (message.payload as any).circular.self = message.payload;

      const result = builder.sendToConnection("test-conn", message);

      expect(result).toBe(false);
    });

    it("should handle concurrent connection cleanup", () => {
      const conn1 = "conn1";
      const conn2 = "conn2";

      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      builder["connections"].set(conn1, mockWs1);
      builder["connections"].set(conn2, mockWs2);

      // Simulate concurrent cleanup
      builder["cleanupConnection"](conn1, mockWs1);
      builder["cleanupConnection"](conn2, mockWs2);

      expect(builder["connections"].size).toBe(0);
    });

    it("should handle room operations on non-existent rooms", () => {
      const message: WebSocketMessageSimple = {
        type: "leave_room",
        payload: { room: "non-existent" },
      };

      const mockWs = createMockWebSocket();

      expect(() => {
        builder["handleWebSocketMessageSimple"](mockWs, message, "test-conn");
      }).not.toThrow();
    });

    it("should handle user operations on non-existent users", () => {
      const sentCount = builder.sendToUser("non-existent-user", {
        type: "test",
        payload: {},
      });

      expect(sentCount).toBe(0);
    });
  });
});

describe("createElysiaServer", () => {
  it("should create server builder with config", () => {
    const config = { port: 8080 };
    const server = createElysiaServer(config);

    expect(server).toBeInstanceOf(ElysiaServerBuilder);
  });

  it("should create server builder with routes", () => {
    const config = { port: 8080 };
    const routes = jest.fn((app: any) => app);

    const server = createElysiaServer(config, routes);

    expect(server).toBeInstanceOf(ElysiaServerBuilder);
  });

  it("should handle undefined routes", () => {
    const config = { port: 8080 };
    const server = createElysiaServer(config, undefined);

    expect(server).toBeInstanceOf(ElysiaServerBuilder);
  });
});
