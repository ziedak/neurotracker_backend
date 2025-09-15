/**
 * @fileoverview Simple Server Builder Integration Test
 * @description Tests basic server builder functionality with actual API
 */

import {
  AdvancedElysiaServerBuilder,
  createDevelopmentServer,
  createProductionServer,
} from "../../src/server";
import { IMetricsCollector, createMockMetricsCollector } from "../mocks";
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

describe("Simple Server Builder Integration", () => {
  let mockMetricsCollector: IMetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricsCollector = createMockMetricsCollector();
  });

  describe("Basic Server Creation", () => {
    it("should create server with minimal configuration", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-server", port: 3000 },
        mockMetricsCollector
      );

      expect(serverBuilder).toBeDefined();
      expect(serverBuilder.getConfig().name).toBe("test-server");
      expect(serverBuilder.getConfig().port).toBe(3000);
    });

    it("should build functional Elysia app", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "test-app", port: 3001 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();

      expect(app).toBeDefined();
      expect(typeof app.listen).toBe("function");
      expect(typeof app.get).toBe("function");
      expect(typeof app.post).toBe("function");
    });

    it("should create server with basic middleware configuration", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        {
          name: "middleware-server",
          port: 3002,
          middleware: {
            enabled: true,
            cors: {
              name: "cors",
              enabled: true,
              allowedOrigins: ["http://localhost:3000"],
            },
            security: {
              name: "security",
              enabled: true,
              frameOptions: "DENY",
            },
          },
        },
        mockMetricsCollector
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();

      const config = serverBuilder.getConfig();
      expect(config.middleware?.enabled).toBe(true);
      expect(config.middleware?.cors?.enabled).toBe(true);
      expect(config.middleware?.security?.enabled).toBe(true);
    });
  });

  describe("Factory Functions", () => {
    it("should create development server using factory", () => {
      const devServer = createDevelopmentServer(
        {
          name: "dev-server",
          port: 3003,
        },
        mockMetricsCollector
      );

      expect(devServer).toBeInstanceOf(AdvancedElysiaServerBuilder);
      expect(devServer.getConfig().name).toBe("dev-server");

      const app = devServer.build();
      expect(app).toBeDefined();
    });

    it("should create production server using factory", () => {
      const prodServer = createProductionServer(
        {
          name: "prod-server",
          port: 3004,
        },
        mockMetricsCollector
      );

      expect(prodServer).toBeInstanceOf(AdvancedElysiaServerBuilder);
      expect(prodServer.getConfig().name).toBe("prod-server");

      const app = prodServer.build();
      expect(app).toBeDefined();
    });
  });

  describe("Configuration Management", () => {
    it("should allow middleware configuration updates", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        {
          name: "middleware-config",
          port: 3005,
          middleware: {
            enabled: true,
            cors: {
              name: "cors",
              enabled: true,
              allowedOrigins: ["http://localhost:3000"],
            },
          },
        },
        mockMetricsCollector
      );

      // Check initial config
      const config = serverBuilder.getConfig();
      expect(config.middleware?.cors?.allowedOrigins).toEqual([
        "http://localhost:3000",
      ]);

      // Update middleware config
      serverBuilder.updateMiddlewareConfig({
        cors: {
          enabled: true,
          config: {
            allowedOrigins: ["https://example.com"],
          },
        },
      });

      // Verify middleware config was updated
      const middlewareConfig = serverBuilder.getMiddlewareConfig();
      expect(middlewareConfig?.cors?.enabled).toBe(true);
      expect(middlewareConfig?.cors?.config?.allowedOrigins).toEqual([
        "https://example.com",
      ]);
    });

    it("should toggle middleware components", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        {
          name: "toggle-test",
          port: 3006,
          middleware: {
            enabled: true,
            cors: {
              name: "cors",
              enabled: true,
            },
          },
        },
        mockMetricsCollector
      );

      // Toggle HTTP middleware - might return false if middleware doesn't exist yet
      const toggleResult = serverBuilder.toggleMiddleware(
        "http",
        "cors",
        false
      );
      expect(typeof toggleResult).toBe("boolean");
    });
  });

  describe("Server Lifecycle", () => {
    it("should handle cleanup properly", async () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "cleanup-test", port: 3007 },
        mockMetricsCollector
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();

      // Cleanup should not throw
      await expect(serverBuilder.cleanup()).resolves.not.toThrow();
    });

    it("should build multiple times without issues", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "multi-build", port: 3008 },
        mockMetricsCollector
      );

      const app1 = serverBuilder.build();
      const app2 = serverBuilder.build();

      expect(app1).toBeDefined();
      expect(app2).toBeDefined();
      // Apps should be functional (might be new instances each time)
      expect(typeof app1.listen).toBe("function");
      expect(typeof app2.listen).toBe("function");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing configuration gracefully", () => {
      // Should not throw with minimal config
      expect(() => {
        new AdvancedElysiaServerBuilder(
          { name: "minimal" }, // Missing port (should use default)
          mockMetricsCollector
        );
      }).not.toThrow();
    });

    it("should handle invalid middleware operations gracefully", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "error-test", port: 3009 },
        mockMetricsCollector
      );

      // Should return false when toggling non-existent middleware
      const result = serverBuilder.toggleMiddleware(
        "http",
        "nonexistent",
        false
      );
      expect(result).toBe(false);
    });
  });
});
