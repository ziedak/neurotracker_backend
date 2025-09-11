/**
 * Prometheus Middleware Factory Functions and Utilities
 * Production-grade factory functions following established patterns
 */

import { type IMetricsCollector } from "@libs/monitoring";

import {
  PrometheusWebSocketMiddleware,
  type PrometheusWebSocketMiddlewareConfig,
} from "./prometheus.websocket.middleware";
import {
  PrometheusHttpMiddleware,
  type PrometheusHttpMiddlewareConfig,
} from "./prometheus.http.middleware";

/**
 * Prometheus middleware preset configurations
 * Pre-built configurations for common use cases and environments
 */
export const PROMETHEUS_PRESETS = {
  /**
   * Development environment preset
   * Includes detailed metrics and verbose tracking
   */
  development(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-dev",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: true,
      serviceName: "dev-service",
      enableNodeMetrics: true,
      nodeMetricsSampleRate: 1.0, // 100% sampling in dev
      includeRequestBody: true,
      includeResponseBody: true,
      maxBodySize: 1024 * 10, // 10KB
      trackUserMetrics: true,
      enableCustomMetrics: true,
      skipPaths: ["/health", "/favicon.ico"],
    };
  },

  /**
   * Production environment preset
   * Optimized for performance and essential metrics only
   */
  production(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-prod",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: true,
      serviceName: "prod-service",
      enableNodeMetrics: true,
      nodeMetricsSampleRate: 0.1, // 10% sampling
      includeRequestBody: false,
      includeResponseBody: false,
      maxBodySize: 1024, // 1KB
      trackUserMetrics: true,
      enableCustomMetrics: true,
      skipPaths: ["/health", "/metrics", "/favicon.ico"],
    };
  },

  /**
   * High-performance preset
   * Minimal overhead for high-throughput systems
   */
  highPerformance(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-perf",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: false,
      serviceName: "perf-service",
      enableNodeMetrics: false,
      nodeMetricsSampleRate: 0.01, // 1% sampling
      includeRequestBody: false,
      includeResponseBody: false,
      maxBodySize: 512, // 512 bytes
      trackUserMetrics: false,
      enableCustomMetrics: false,
      skipPaths: ["/health", "/metrics", "/favicon.ico", "/static"],
    };
  },

  /**
   * API gateway preset
   * Focused on API request tracking and routing metrics
   */
  apiGateway(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-gateway",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: true,
      serviceName: "api-gateway",
      enableNodeMetrics: true,
      nodeMetricsSampleRate: 0.05, // 5% sampling
      includeRequestBody: false,
      includeResponseBody: false,
      maxBodySize: 1024 * 2, // 2KB
      trackUserMetrics: true,
      enableCustomMetrics: true,
      skipPaths: ["/health", "/metrics", "/favicon.ico", "/docs", "/swagger"],
    };
  },

  /**
   * Microservice preset
   * Balanced metrics for individual microservices
   */
  microservice(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-microservice",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: true,
      serviceName: "microservice",
      enableNodeMetrics: true,
      nodeMetricsSampleRate: 0.1, // 10% sampling
      includeRequestBody: false,
      includeResponseBody: false,
      maxBodySize: 1024 * 5, // 5KB
      trackUserMetrics: true,
      enableCustomMetrics: true,
      skipPaths: ["/health", "/metrics"],
    };
  },

  /**
   * Debug preset
   * Maximum observability for troubleshooting
   */
  debug(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      name: "prometheus-debug",
      enabled: true,
      priority: 100,
      endpoint: "/metrics",
      enableDetailedMetrics: true,
      serviceName: "debug-service",
      enableNodeMetrics: true,
      nodeMetricsSampleRate: 1.0, // 100% sampling
      includeRequestBody: true,
      includeResponseBody: true,
      maxBodySize: 1024 * 100, // 100KB
      trackUserMetrics: true,
      enableCustomMetrics: true,
      skipPaths: [],
    };
  },
} as const;

/**
 * WebSocket Prometheus middleware preset configurations
 */
export const PROMETHEUS_WS_PRESETS = {
  /**
   * Development WebSocket preset
   */
  development(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-dev",
      enabled: true,
      priority: 100,
      serviceName: "ws-dev-service",
      enableDetailedMetrics: true,
      enableConnectionTracking: true,
      enableMessageMetrics: true,
      enableErrorTracking: true,
      trackMessageSize: true,
      trackRooms: true,
      trackUserMetrics: true,
      connectionTimeoutMs: 10000, // 10 seconds
      metricsFlushInterval: 2000, // 2 seconds
      skipMessageTypes: ["ping", "pong"],
    };
  },

  /**
   * Production WebSocket preset
   */
  production(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-prod",
      enabled: true,
      priority: 100,
      serviceName: "ws-prod-service",
      enableDetailedMetrics: true,
      enableConnectionTracking: true,
      enableMessageMetrics: true,
      enableErrorTracking: true,
      trackMessageSize: false,
      trackRooms: false,
      trackUserMetrics: true,
      connectionTimeoutMs: 60000, // 60 seconds
      metricsFlushInterval: 10000, // 10 seconds
      skipMessageTypes: ["ping", "pong", "heartbeat"],
    };
  },

  /**
   * High-performance WebSocket preset
   */
  highPerformance(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-perf",
      enabled: true,
      priority: 100,
      serviceName: "ws-perf-service",
      enableDetailedMetrics: false,
      enableConnectionTracking: true,
      enableMessageMetrics: false,
      enableErrorTracking: true,
      trackMessageSize: false,
      trackRooms: false,
      trackUserMetrics: false,
      connectionTimeoutMs: 120000, // 2 minutes
      metricsFlushInterval: 30000, // 30 seconds
      skipMessageTypes: ["ping", "pong", "heartbeat", "status", "update"],
    };
  },

  /**
   * Real-time chat WebSocket preset
   */
  realtimeChat(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-chat",
      enabled: true,
      priority: 100,
      serviceName: "ws-chat-service",
      enableDetailedMetrics: true,
      enableConnectionTracking: true,
      enableMessageMetrics: true,
      enableErrorTracking: true,
      trackMessageSize: true,
      trackRooms: true,
      trackUserMetrics: true,
      connectionTimeoutMs: 30000, // 30 seconds
      metricsFlushInterval: 5000, // 5 seconds
      skipMessageTypes: ["ping", "pong", "heartbeat", "typing"],
    };
  },

  /**
   * Gaming WebSocket preset
   */
  gaming(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-gaming",
      enabled: true,
      priority: 100,
      serviceName: "ws-gaming-service",
      enableDetailedMetrics: false,
      enableConnectionTracking: true,
      enableMessageMetrics: false, // Too high volume
      enableErrorTracking: true,
      trackMessageSize: false,
      trackRooms: true,
      trackUserMetrics: true,
      connectionTimeoutMs: 60000, // 60 seconds
      metricsFlushInterval: 15000, // 15 seconds
      skipMessageTypes: [
        "ping",
        "pong",
        "heartbeat",
        "player_position",
        "game_state",
        "input",
      ],
    };
  },

  /**
   * IoT monitoring WebSocket preset
   */
  iotMonitoring(): Partial<PrometheusWebSocketMiddlewareConfig> {
    return {
      name: "prometheus-ws-iot",
      enabled: true,
      priority: 100,
      serviceName: "ws-iot-service",
      enableDetailedMetrics: true,
      enableConnectionTracking: true,
      enableMessageMetrics: true,
      enableErrorTracking: true,
      trackMessageSize: true,
      trackRooms: false,
      trackUserMetrics: false,
      connectionTimeoutMs: 300000, // 5 minutes
      metricsFlushInterval: 60000, // 60 seconds
      skipMessageTypes: ["ping", "pong", "heartbeat"],
    };
  },
} as const;

/**
 * Create Prometheus HTTP middleware with comprehensive dependency injection
 */
export function createPrometheusHttpMiddleware(
  metrics: IMetricsCollector,
  config: Partial<PrometheusHttpMiddlewareConfig> = {}
): PrometheusHttpMiddleware {
  return new PrometheusHttpMiddleware(metrics, config);
}

/**
 * Create Prometheus WebSocket middleware with comprehensive dependency injection
 */
export function createPrometheusWebSocketMiddleware(
  metrics: IMetricsCollector,
  config: Partial<PrometheusWebSocketMiddlewareConfig> = {}
): PrometheusWebSocketMiddleware {
  return new PrometheusWebSocketMiddleware(metrics, config);
}

/**
 * Create Prometheus HTTP middleware with preset configuration
 */
export function createPrometheusHttpMiddlewareWithPreset(
  metrics: IMetricsCollector,
  preset: () => Partial<PrometheusHttpMiddlewareConfig>,
  overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
): PrometheusHttpMiddleware {
  const presetConfig = preset();
  const finalConfig = { ...presetConfig, ...overrides };

  return new PrometheusHttpMiddleware(metrics, finalConfig);
}

/**
 * Create Prometheus WebSocket middleware with preset configuration
 */
export function createPrometheusWebSocketMiddlewareWithPreset(
  metrics: IMetricsCollector,
  preset: () => Partial<PrometheusWebSocketMiddlewareConfig>,
  overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
): PrometheusWebSocketMiddleware {
  const presetConfig = preset();
  const finalConfig = { ...presetConfig, ...overrides };

  return new PrometheusWebSocketMiddleware(metrics, finalConfig);
}

/**
 * Environment-specific factory functions for HTTP middleware
 */
export const PROMETHEUS_FACTORIES = {
  /**
   * Development environment factory
   */
  forDevelopment(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.development,
      overrides
    );
  },

  /**
   * Production environment factory
   */
  forProduction(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.production,
      overrides
    );
  },

  /**
   * High-performance factory
   */
  forHighPerformance(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.highPerformance,
      overrides
    );
  },

  /**
   * API gateway factory
   */
  forApiGateway(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.apiGateway,
      overrides
    );
  },

  /**
   * Microservice factory
   */
  forMicroservice(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.microservice,
      overrides
    );
  },

  /**
   * Debug factory
   */
  forDebug(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusHttpMiddlewareConfig> = {}
  ): PrometheusHttpMiddleware {
    return createPrometheusHttpMiddlewareWithPreset(
      metrics,
      PROMETHEUS_PRESETS.debug,
      overrides
    );
  },
} as const;

/**
 * Environment-specific factory functions for WebSocket middleware
 */
export const PROMETHEUS_WS_FACTORIES = {
  /**
   * Development WebSocket factory
   */
  forDevelopment(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.development,
      overrides
    );
  },

  /**
   * Production WebSocket factory
   */
  forProduction(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.production,
      overrides
    );
  },

  /**
   * High-performance WebSocket factory
   */
  forHighPerformance(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.highPerformance,
      overrides
    );
  },

  /**
   * Real-time chat WebSocket factory
   */
  forRealtimeChat(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.realtimeChat,
      overrides
    );
  },

  /**
   * Gaming WebSocket factory
   */
  forGaming(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.gaming,
      overrides
    );
  },

  /**
   * IoT monitoring WebSocket factory
   */
  forIoT(
    metrics: IMetricsCollector,
    overrides: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ): PrometheusWebSocketMiddleware {
    return createPrometheusWebSocketMiddlewareWithPreset(
      metrics,
      PROMETHEUS_WS_PRESETS.iotMonitoring,
      overrides
    );
  },
} as const;

/**
 * Testing utilities for Prometheus middleware
 */
export const PROMETHEUS_TESTING_UTILS = {
  /**
   * Create a mock Prometheus HTTP middleware for testing
   */
  createMockMiddleware(config: Partial<PrometheusHttpMiddlewareConfig> = {}) {
    const mockMetrics = {
      getMetrics: jest.fn().mockResolvedValue("# Mock metrics"),
      recordApiRequest: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordHistogram: jest.fn(),
    } as any;

    const middleware = new PrometheusHttpMiddleware(mockMetrics, {
      name: "test-prometheus",
      enabled: true,
      priority: 100,
      ...config,
    });

    return {
      middleware,
      mocks: {
        metrics: mockMetrics,
      },
    };
  },

  /**
   * Create a mock Prometheus WebSocket middleware for testing
   */
  createMockWebSocketMiddleware(
    config: Partial<PrometheusWebSocketMiddlewareConfig> = {}
  ) {
    const mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordHistogram: jest.fn(),
    } as any;

    const middleware = new PrometheusWebSocketMiddleware(mockMetrics, {
      name: "test-prometheus-ws",
      enabled: true,
      priority: 100,
      ...config,
    });

    return {
      middleware,
      mocks: {
        metrics: mockMetrics,
      },
    };
  },

  /**
   * Create a test HTTP context for Prometheus middleware
   */
  createTestHttpContext(overrides: any = {}) {
    return {
      request: {
        method: "GET",
        url: "http://localhost:3000/test",
        headers: {
          "user-agent": "test-agent",
          "content-length": "100",
        },
        body: undefined,
        ip: "127.0.0.1",
        ...overrides.request,
      },
      response: {
        status: 200,
        headers: {},
        body: "test response",
        ...overrides.response,
      },
      requestId: "test-request-123",
      ...overrides,
    };
  },

  /**
   * Create a test WebSocket context for Prometheus middleware
   */
  createTestWebSocketContext(overrides: any = {}) {
    return {
      ws: {
        send: jest.fn(),
        close: jest.fn(),
      },
      connectionId: "test-connection-123",
      message: {
        type: "test_message",
        payload: { data: "test" },
        timestamp: new Date().toISOString(),
        ...overrides.message,
      },
      metadata: {
        connectedAt: new Date(),
        clientIp: "127.0.0.1",
        headers: {
          "user-agent": "test-agent",
        },
        ...overrides.metadata,
      },
      authenticated: false,
      rooms: [],
      ...overrides,
    };
  },
} as const;

// Export all types and classes
export * from "./prometheus.http.middleware";

export * from "./prometheus.websocket.middleware";
