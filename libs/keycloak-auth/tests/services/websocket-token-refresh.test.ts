/**
 * Unit tests for WebSocket Token Refresh Service
 */

import { WebSocketTokenRefreshService } from "../../src/services/websocket-token-refresh.service";

describe("WebSocketTokenRefreshService - Zod Validation", () => {
  let mockMetrics: any;
  let mockKeycloakFactory: any;
  let mockTokenIntrospection: any;

  beforeEach(() => {
    // Use the global test utilities
    mockMetrics = (global as any).testUtils.createMockMetricsCollector?.() || {
      recordCounter: jest.fn(),
      recordGauge: jest.fn(),
      recordTimer: jest.fn(),
    };

    mockKeycloakFactory = (
      global as any
    ).testUtils.createMockKeycloakClientFactory();
    mockTokenIntrospection = (
      global as any
    ).testUtils.createMockTokenIntrospectionService();
  });

  describe("Configuration Validation", () => {
    it("should accept valid configuration", () => {
      const validConfig = {
        refreshThreshold: 300,
        maxRetryAttempts: 3,
        retryDelay: 5000,
        enableAutoRefresh: true,
        checkInterval: 60000,
        refreshGracePeriod: 30000,
        maxConcurrentRefreshes: 10,
        cleanupInterval: 300000,
        maxSessionAge: 3600000,
      };

      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics,
          validConfig
        );
      }).not.toThrow();
    });

    it("should reject configuration with refreshThreshold too low", () => {
      const invalidConfig = {
        refreshThreshold: 30, // Too low (< 60)
      };

      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics,
          invalidConfig
        );
      }).toThrow(
        "Configuration validation failed: refreshThreshold: refreshThreshold must be at least 60 seconds"
      );
    });

    it("should reject configuration with maxRetryAttempts out of range", () => {
      const invalidConfig = {
        maxRetryAttempts: 15, // Too high (> 10)
      };

      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics,
          invalidConfig
        );
      }).toThrow(
        "Configuration validation failed: maxRetryAttempts: maxRetryAttempts must be at most 10"
      );
    });

    it("should reject configuration with maxSessionAge less than cleanupInterval", () => {
      const invalidConfig = {
        cleanupInterval: 300000,
        maxSessionAge: 100000, // Less than cleanupInterval
      };

      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics,
          invalidConfig
        );
      }).toThrow(
        "Configuration validation failed: maxSessionAge: maxSessionAge must be greater than cleanupInterval"
      );
    });

    it("should reject configuration with checkInterval greater than refreshThreshold", () => {
      const invalidConfig = {
        refreshThreshold: 120, // 2 minutes
        checkInterval: 300000, // 5 minutes (greater than 2 minutes * 1000)
      };

      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics,
          invalidConfig
        );
      }).toThrow(
        "Configuration validation failed: checkInterval: checkInterval should not be greater than refreshThreshold (inefficient checking)"
      );
    });

    it("should use default configuration when no config provided", () => {
      expect(() => {
        new WebSocketTokenRefreshService(
          mockKeycloakFactory,
          mockTokenIntrospection,
          mockMetrics
        );
      }).not.toThrow();
    });

    it("should merge partial config with defaults", () => {
      const partialConfig = {
        refreshThreshold: 600, // Override just this one
      };

      const service = new WebSocketTokenRefreshService(
        mockKeycloakFactory,
        mockTokenIntrospection,
        mockMetrics,
        partialConfig
      );

      // Access private config for testing (using type assertion)
      const config = (service as any).config;

      expect(config.refreshThreshold).toBe(600);
      expect(config.maxRetryAttempts).toBe(3); // Default value
      expect(config.enableAutoRefresh).toBe(true); // Default value
    });
  });
});
