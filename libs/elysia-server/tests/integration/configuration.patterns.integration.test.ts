/**
 * @fileoverview Configuration Pattern Integration Tests
 * @description Tests development, production, and custom middleware configuration patterns
 */

import {
  AdvancedElysiaServerBuilder,
  createDevelopmentServer,
  createProductionServer,
} from "../../src/server";
import { type AdvancedMiddlewareConfig } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import { createMockMetricsCollector } from "../mocks";

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

describe("Configuration Pattern Integration Tests", () => {
  let mockMetricsCollector: IMetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricsCollector = createMockMetricsCollector();
  });

  describe("Development Configuration Pattern", () => {
    it("should create development server with appropriate middleware settings", () => {
      const serverBuilder = createDevelopmentServer(
        { name: "dev-server", port: 3000 },
        mockMetricsCollector
      );

      const config = serverBuilder.getMiddlewareConfig();

      expect(config?.http?.enabled).toBe(true);
      expect(config?.http?.factoryPattern).toBe("DEVELOPMENT");
      expect(config?.websocket?.enabled).toBe(true);
      expect(config?.websocket?.factoryPattern).toBe("DEVELOPMENT");
      expect(config?.cors?.enabled).toBe(true);
      expect(config?.rateLimit?.enabled).toBe(false); // Disabled in development
      expect(config?.security?.enabled).toBe(false); // Disabled in development
      expect(config?.logging?.enabled).toBe(true);
      expect(config?.logging?.logLevel).toBe("debug");
      expect(config?.prometheus?.enabled).toBe(true);
    });

    it("should allow custom development configuration overrides", () => {
      const customConfig: Partial<AdvancedMiddlewareConfig> = {
        rateLimit: { enabled: true }, // Enable rate limiting in dev
        security: { enabled: true }, // Enable security in dev
      };

      const serverBuilder = createDevelopmentServer(
        { name: "custom-dev-server", port: 3001 },
        mockMetricsCollector,
        customConfig
      );

      const config = serverBuilder.getMiddlewareConfig();

      expect(config?.rateLimit?.enabled).toBe(true);
      expect(config?.security?.enabled).toBe(true);
      expect(config?.logging?.logLevel).toBe("debug"); // Still development default
    });
  });

  describe("Production Configuration Pattern", () => {
    it("should create production server with enhanced security settings", () => {
      const serverBuilder = createProductionServer(
        { name: "prod-server", port: 3000 },
        mockMetricsCollector
      );

      const config = serverBuilder.getMiddlewareConfig();

      expect(config?.http?.enabled).toBe(true);
      expect(config?.http?.factoryPattern).toBe("PRODUCTION_HTTP");
      expect(config?.websocket?.enabled).toBe(true);
      expect(config?.websocket?.factoryPattern).toBe("PRODUCTION_WS");
      expect(config?.cors?.enabled).toBe(true);
      expect(config?.rateLimit?.enabled).toBe(true); // Enabled in production
      expect(config?.security?.enabled).toBe(true); // Enabled in production
      expect(config?.logging?.enabled).toBe(true);
      expect(config?.logging?.logLevel).toBe("info");
      expect(config?.prometheus?.enabled).toBe(true);
    });

    it("should allow custom production configuration overrides", () => {
      const customConfig: Partial<AdvancedMiddlewareConfig> = {
        logging: { enabled: true, logLevel: "warn" }, // More restrictive logging
        rateLimit: { enabled: false }, // Disable rate limiting
      };

      const serverBuilder = createProductionServer(
        { name: "custom-prod-server", port: 3002 },
        mockMetricsCollector,
        customConfig
      );

      const config = serverBuilder.getMiddlewareConfig();

      expect(config?.rateLimit?.enabled).toBe(false);
      expect(config?.logging?.logLevel).toBe("warn");
      expect(config?.security?.enabled).toBe(true); // Still production default
    });
  });

  describe("Custom Configuration Patterns", () => {
    it("should support fine-grained middleware configuration", () => {
      const customConfig: AdvancedMiddlewareConfig = {
        http: {
          enabled: true,
          factoryPattern: "BASIC_HTTP_SECURITY",
        },
        websocket: {
          enabled: false, // Disable WebSocket entirely
        },
        cors: { enabled: true },
        rateLimit: { enabled: true },
        security: { enabled: true },
        logging: { enabled: true, logLevel: "info" },
        prometheus: { enabled: false }, // Disable metrics
      };

      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "custom-server", port: 3003 },
        mockMetricsCollector,
        customConfig
      );

      const config = serverBuilder.getMiddlewareConfig();

      expect(config).toEqual(customConfig);
    });

    it("should support runtime configuration updates", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "dynamic-server", port: 3004 },
        mockMetricsCollector
      );

      // Initial configuration
      let config = serverBuilder.getMiddlewareConfig();
      expect(config).toBeUndefined(); // No initial middleware config

      // Update with new configuration
      const newConfig: Partial<AdvancedMiddlewareConfig> = {
        cors: { enabled: true },
        logging: { enabled: true, logLevel: "debug" },
      };

      serverBuilder.updateMiddlewareConfig(newConfig);

      config = serverBuilder.getMiddlewareConfig();
      expect(config?.cors?.enabled).toBe(true);
      expect(config?.logging?.logLevel).toBe("debug");

      // Further updates
      serverBuilder.updateMiddlewareConfig({
        rateLimit: { enabled: true },
        logging: { enabled: true, logLevel: "warn" }, // Override previous setting
      });

      config = serverBuilder.getMiddlewareConfig();
      expect(config?.rateLimit?.enabled).toBe(true);
      expect(config?.logging?.logLevel).toBe("warn");
    });

    it("should support toggling individual middleware components", () => {
      const initialConfig: AdvancedMiddlewareConfig = {
        http: { enabled: true },
        websocket: { enabled: true },
        cors: { enabled: true },
        rateLimit: { enabled: true },
        security: { enabled: true },
        logging: { enabled: true, logLevel: "info" },
        prometheus: { enabled: true },
      };

      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "toggle-server", port: 3005 },
        mockMetricsCollector,
        initialConfig
      );

      const app = serverBuilder.build();
      expect(app).toBeDefined();

      // Test that middleware toggle methods exist and return boolean results
      // Note: toggleMiddleware operates on middleware chain items, not configuration
      const result1 = serverBuilder.toggleMiddleware("http", "cors", false);
      const result2 = serverBuilder.toggleMiddleware(
        "websocket",
        "auth",
        false
      );

      expect(typeof result1).toBe("boolean");
      expect(typeof result2).toBe("boolean");

      // Configuration should remain unchanged by toggle operations on chains
      const config = serverBuilder.getMiddlewareConfig();
      expect(config?.rateLimit?.enabled).toBe(true);
      expect(config?.security?.enabled).toBe(true);
      expect(config?.cors?.enabled).toBe(true);
    });
  });

  describe("Configuration Validation and Edge Cases", () => {
    it("should handle partial configuration gracefully", () => {
      const partialConfig: Partial<AdvancedMiddlewareConfig> = {
        cors: { enabled: true },
        // Only cors configuration provided
      };

      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "partial-config-server", port: 3006 },
        mockMetricsCollector,
        partialConfig as AdvancedMiddlewareConfig
      );

      const config = serverBuilder.getMiddlewareConfig();
      expect(config?.cors?.enabled).toBe(true);
      // Other middleware should be undefined or have default values
    });

    it("should not throw when toggling non-existent middleware", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "error-test-server", port: 3007 },
        mockMetricsCollector
      );

      expect(() => {
        serverBuilder.toggleMiddleware("http", "nonexistent", true);
      }).not.toThrow();

      expect(() => {
        serverBuilder.toggleMiddleware("http", "anotherFakeMiddleware", false);
      }).not.toThrow();
    });

    it("should handle empty configuration updates", () => {
      const serverBuilder = new AdvancedElysiaServerBuilder(
        { name: "empty-update-server", port: 3008 },
        mockMetricsCollector
      );

      expect(() => {
        serverBuilder.updateMiddlewareConfig({});
      }).not.toThrow();

      expect(() => {
        serverBuilder.updateMiddlewareConfig(undefined as any);
      }).not.toThrow();
    });
  });

  describe("Configuration Patterns in Practice", () => {
    it("should demonstrate typical development setup", () => {
      const devServer = createDevelopmentServer(
        {
          name: "api-server-dev",
          port: 3000,
        },
        mockMetricsCollector,
        {
          logging: { enabled: true, logLevel: "debug" },
          cors: { enabled: true },
        }
      );

      const app = devServer.build();
      expect(app).toBeDefined();

      const config = devServer.getMiddlewareConfig();
      expect(config?.logging?.logLevel).toBe("debug");
      expect(config?.cors?.enabled).toBe(true);
      expect(config?.rateLimit?.enabled).toBe(false);
      expect(config?.security?.enabled).toBe(false);
    });

    it("should demonstrate typical production setup", () => {
      const prodServer = createProductionServer(
        {
          name: "api-server-prod",
          port: 8080,
        },
        mockMetricsCollector,
        {
          logging: { enabled: true, logLevel: "warn" },
          security: { enabled: true },
          rateLimit: { enabled: true },
        }
      );

      const app = prodServer.build();
      expect(app).toBeDefined();

      const config = prodServer.getMiddlewareConfig();
      expect(config?.logging?.logLevel).toBe("warn");
      expect(config?.security?.enabled).toBe(true);
      expect(config?.rateLimit?.enabled).toBe(true);
    });

    it("should demonstrate staging environment configuration", () => {
      // Staging: production-like but with more logging
      const stagingConfig: AdvancedMiddlewareConfig = {
        http: { enabled: true, factoryPattern: "PRODUCTION_HTTP" },
        websocket: { enabled: true, factoryPattern: "PRODUCTION_WS" },
        cors: { enabled: true },
        rateLimit: { enabled: true },
        security: { enabled: true },
        logging: { enabled: true, logLevel: "info" }, // More verbose than production
        prometheus: { enabled: true },
      };

      const stagingServer = new AdvancedElysiaServerBuilder(
        {
          name: "api-server-staging",
          port: 8080,
        },
        mockMetricsCollector,
        stagingConfig
      );

      const app = stagingServer.build();
      expect(app).toBeDefined();

      const config = stagingServer.getMiddlewareConfig();
      expect(config?.http?.factoryPattern).toBe("PRODUCTION_HTTP");
      expect(config?.logging?.logLevel).toBe("info");
      expect(config?.security?.enabled).toBe(true);
    });
  });
});
