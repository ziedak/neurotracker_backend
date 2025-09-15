import {
  AdvancedElysiaServerBuilder,
  createDevelopmentServer,
  createProductionServer,
} from "../../src/server";
import {
  MiddlewareContext,
  type AdvancedMiddlewareConfig,
} from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import { createMockMetricsCollector } from "../mocks";
import { setupTestCleanup } from "../helpers/testCleanup";

// Mock external dependencies
jest.mock("@libs/monitoring", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    setLevel: jest.fn(),
  })),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    setLevel: jest.fn(),
  })),
}));

// Setup automatic cleanup to prevent memory leaks
setupTestCleanup();

describe("AdvancedElysiaServerBuilder Integration Tests", () => {
  let mockMetricsCollector: IMetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricsCollector = createMockMetricsCollector();
  });

  describe("Server Builder Basic Functionality", () => {
    it("should create a server with default configuration", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();

      expect(app).toBeDefined();
      expect(serverBuilder.getConfig().name).toBe("test-server");
      expect(serverBuilder.getConfig().port).toBe(3000);
    });

    it("should create a server with middleware configuration", async () => {
      const middlewareConfig: AdvancedMiddlewareConfig = {
        http: {
          enabled: true,
          factoryPattern: "DEVELOPMENT",
        },
        websocket: {
          enabled: false,
        },
        cors: { enabled: true },
        rateLimit: { enabled: false },
        security: { enabled: true },
        logging: { enabled: true, logLevel: "debug" },
        prometheus: { enabled: true },
      };

      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector,
        middlewareConfig
      );

      const app = serverBuilder.build();

      expect(app).toBeDefined();
      expect(serverBuilder.getMiddlewareConfig()).toEqual(middlewareConfig);
    });

    it("should create development server using factory function", async () => {
      const serverBuilder = createDevelopmentServer(
        { name: "dev-server", port: 3001 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();

      expect(app).toBeDefined();
      expect(serverBuilder.getConfig().name).toBe("dev-server");

      const middlewareConfig = serverBuilder.getMiddlewareConfig();
      expect(middlewareConfig?.http?.enabled).toBe(true);
      expect(middlewareConfig?.rateLimit?.enabled).toBe(false);
      expect(middlewareConfig?.security?.enabled).toBe(false);
    });

    it("should create production server using factory function", async () => {
      const serverBuilder = createProductionServer(
        { name: "prod-server", port: 3002 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();

      expect(app).toBeDefined();
      expect(serverBuilder.getConfig().name).toBe("prod-server");

      const middlewareConfig = serverBuilder.getMiddlewareConfig();
      expect(middlewareConfig?.http?.enabled).toBe(true);
      expect(middlewareConfig?.rateLimit?.enabled).toBe(true);
      expect(middlewareConfig?.security?.enabled).toBe(true);
    });
  });

  describe("Middleware Configuration Management", () => {
    it("should update middleware configuration dynamically", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector
      );

      const newConfig: Partial<AdvancedMiddlewareConfig> = {
        rateLimit: { enabled: true },
        logging: { enabled: true, logLevel: "info" },
      };

      serverBuilder.updateMiddlewareConfig(newConfig);

      const updatedConfig = serverBuilder.getMiddlewareConfig();
      expect(updatedConfig?.rateLimit?.enabled).toBe(true);
      expect(updatedConfig?.logging?.logLevel).toBe("info");
    });

    it("should toggle middleware components", async () => {
      const middlewareConfig: AdvancedMiddlewareConfig = {
        http: { enabled: true },
        websocket: { enabled: true },
        cors: { enabled: true },
        rateLimit: { enabled: true },
        security: { enabled: true },
        logging: { enabled: true },
        prometheus: { enabled: true },
      };

      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector,
        middlewareConfig
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();

      // Test that middleware toggle returns expected results
      // Note: The actual toggle operates on middleware chain items, not config
      const httpToggleResult = serverBuilder.toggleMiddleware(
        "http",
        "cors",
        false
      );
      const wsToggleResult = serverBuilder.toggleMiddleware(
        "websocket",
        "auth",
        false
      );

      // HTTP chain should support toggle (if middleware exists in chain)
      expect(typeof httpToggleResult).toBe("boolean");

      // WebSocket toggle should return false (not implemented yet)
      expect(wsToggleResult).toBe(false);

      // Configuration should remain unchanged by toggle operations
      const config = serverBuilder.getMiddlewareConfig();
      expect(config?.rateLimit?.enabled).toBe(true);
      expect(config?.security?.enabled).toBe(true);
    });
  });

  describe("Server Cleanup and Lifecycle", () => {
    it("should properly cleanup server resources", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();

      // Cleanup should complete without errors
      await expect(serverBuilder.cleanup()).resolves.toBeUndefined();
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle invalid middleware configuration gracefully", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector
      );

      // Should not throw when updating with partial config
      expect(() => {
        serverBuilder.updateMiddlewareConfig({
          cors: { enabled: true },
        });
      }).not.toThrow();

      // Should not throw when toggling non-existent middleware
      expect(() => {
        serverBuilder.toggleMiddleware("nonexistent" as any, true);
      }).not.toThrow();
    });

    it("should create server with minimal configuration", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        {},
        mockMetricsCollector
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();
    });
  });
});
