/**
 * WebSocket Audit Middleware Factory Functions and Presets
 * Production-grade factory functions following established patterns
 */

import { type IMetricsCollector } from "@libs/monitoring";
import { RedisClient, ClickHouseClient } from "@libs/database";
import {
  WebSocketAuditMiddleware,
  type WebSocketAuditMiddlewareConfig,
} from "./WebSocketAuditMiddleware";

/**
 * WebSocket audit middleware preset configurations
 * Pre-built configurations for common use cases and environments
 */
export const WS_AUDIT_PRESETS = {
  /**
   * Development environment preset
   * Includes detailed logging and payload capture
   */
  development(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-dev",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: true,
      includeMetadata: true,
      storageStrategy: "redis",
      redisTtl: 3600, // 1 hour
      maxPayloadSize: 1024 * 50, // 50KB
      enableRealTimeAnalytics: true,
      retentionDays: 7,
      anonymizePersonalData: false,
      complianceMode: "standard",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: false, // Immediate for development
      skipMessageTypes: ["ping", "pong"],
    };
  },

  /**
   * Production environment preset
   * Optimized for performance and security
   */
  production(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-prod",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: false,
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 7 * 24 * 3600, // 7 days
      maxPayloadSize: 1024 * 5, // 5KB
      enableRealTimeAnalytics: true,
      retentionDays: 90,
      anonymizePersonalData: true,
      complianceMode: "standard",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 100,
      flushInterval: 5000,
      skipMessageTypes: ["ping", "pong", "heartbeat"],
    };
  },

  /**
   * Real-time chat application preset
   * Optimized for chat and messaging applications
   */
  realtimeChat(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-chat",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: false, // Don't log chat content for privacy
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxPayloadSize: 1024 * 10, // 10KB
      enableRealTimeAnalytics: true,
      retentionDays: 365, // 1 year for compliance
      anonymizePersonalData: true,
      complianceMode: "GDPR",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 200,
      flushInterval: 3000,
      skipMessageTypes: ["ping", "pong", "heartbeat", "typing"],
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "email",
        "phone",
        "address",
        "credit_card",
        "message_content",
        "chat_content",
      ],
    };
  },

  /**
   * Gaming application preset
   * High-performance preset for gaming applications
   */
  gaming(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-gaming",
      logConnections: true,
      logMessages: false, // Too high volume for gaming
      logDisconnections: true,
      logErrors: true,
      includePayload: false,
      includeMetadata: false,
      storageStrategy: "clickhouse", // Analytics focused
      maxPayloadSize: 1024 * 2, // 2KB
      enableRealTimeAnalytics: true,
      retentionDays: 30,
      anonymizePersonalData: false,
      complianceMode: "standard",
      trackRooms: true,
      trackMessageSize: false,
      batchInserts: true,
      batchSize: 500,
      flushInterval: 2000,
      skipMessageTypes: [
        "ping",
        "pong",
        "heartbeat",
        "player_position",
        "game_state_update",
        "mouse_move",
        "key_press",
      ],
    };
  },

  /**
   * GDPR compliance preset
   * Enhanced data protection and retention policies
   */
  gdprCompliance(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-gdpr",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: true, // Need full audit trail for GDPR
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxPayloadSize: 1024 * 100, // 100KB
      enableRealTimeAnalytics: true,
      retentionDays: 2555, // 7 years
      anonymizePersonalData: true,
      complianceMode: "GDPR",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 50, // Smaller batches for GDPR
      flushInterval: 1000, // Fast flushing
      skipMessageTypes: [], // Audit everything for GDPR
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "ssn",
        "social_security",
        "passport",
        "drivers_license",
        "credit_card",
        "bank_account",
        "iban",
        "swift",
        "email",
        "phone",
        "address",
        "birth_date",
        "medical_record",
        "health_data",
        "biometric",
      ],
    };
  },

  /**
   * SOX compliance preset
   * Financial transaction auditing for WebSocket communications
   */
  soxCompliance(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-sox",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: true,
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 90 * 24 * 3600, // 90 days
      maxPayloadSize: 1024 * 50, // 50KB
      enableRealTimeAnalytics: true,
      retentionDays: 2555, // 7 years
      anonymizePersonalData: false, // SOX requires non-anonymized trails
      complianceMode: "SOX",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 50,
      flushInterval: 1000,
      skipMessageTypes: ["ping", "pong"],
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "account_number",
        "routing_number",
        "swift_code",
      ],
    };
  },

  /**
   * HIPAA compliance preset
   * Healthcare data protection for WebSocket communications
   */
  hipaaCompliance(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-hipaa",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: true,
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 6 * 30 * 24 * 3600, // 6 months
      maxPayloadSize: 1024 * 75, // 75KB
      enableRealTimeAnalytics: true,
      retentionDays: 2190, // 6 years
      anonymizePersonalData: true,
      complianceMode: "HIPAA",
      trackRooms: true,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 25,
      flushInterval: 500,
      skipMessageTypes: ["ping", "pong"],
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "ssn",
        "medical_record",
        "patient_id",
        "health_plan",
        "diagnosis",
        "treatment",
        "medication",
        "physician",
        "insurance",
        "medicare",
        "medicaid",
        "dob",
        "birth_date",
      ],
    };
  },

  /**
   * PCI DSS compliance preset
   * Payment card industry security for WebSocket communications
   */
  pciCompliance(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-pci",
      logConnections: true,
      logMessages: false, // Never log payment data
      logDisconnections: true,
      logErrors: true,
      includePayload: false, // Never include payment data
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 12 * 30 * 24 * 3600, // 12 months
      maxPayloadSize: 1024 * 5, // 5KB
      enableRealTimeAnalytics: true,
      retentionDays: 365, // 1 year minimum
      anonymizePersonalData: true,
      complianceMode: "PCI_DSS",
      trackRooms: false,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 100,
      flushInterval: 2000,
      skipMessageTypes: [
        "ping",
        "pong",
        "heartbeat",
        "payment",
        "card_data",
        "transaction",
      ],
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "credit_card",
        "card_number",
        "cvv",
        "cvc",
        "expiry",
        "pan",
        "track",
        "magnetic_stripe",
        "chip_data",
        "authorization_code",
        "merchant_id",
        "terminal_id",
      ],
    };
  },

  /**
   * High-performance preset
   * Minimal overhead for high-throughput WebSocket systems
   */
  highPerformance(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-perf",
      logConnections: true,
      logMessages: false, // Skip messages for performance
      logDisconnections: true,
      logErrors: true,
      includePayload: false,
      includeMetadata: false,
      storageStrategy: "clickhouse", // Skip Redis for performance
      maxPayloadSize: 512, // 512 bytes
      enableRealTimeAnalytics: false,
      retentionDays: 30,
      anonymizePersonalData: false,
      complianceMode: "standard",
      trackRooms: false,
      trackMessageSize: false,
      batchInserts: true,
      batchSize: 1000,
      flushInterval: 10000, // 10 seconds
      skipMessageTypes: [
        "ping",
        "pong",
        "heartbeat",
        "status",
        "update",
        "sync",
        "position",
        "state",
      ],
    };
  },

  /**
   * IoT device monitoring preset
   * Optimized for IoT device WebSocket connections
   */
  iotMonitoring(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-iot",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: false, // Large IoT payloads
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 7 * 24 * 3600, // 7 days
      maxPayloadSize: 1024 * 20, // 20KB
      enableRealTimeAnalytics: true,
      retentionDays: 365, // 1 year
      anonymizePersonalData: false,
      complianceMode: "standard",
      trackRooms: false,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 200,
      flushInterval: 5000,
      skipMessageTypes: [
        "ping",
        "pong",
        "heartbeat",
        "sensor_data",
        "telemetry",
      ],
    };
  },

  /**
   * API access monitoring preset
   * External API usage tracking via WebSocket
   */
  apiMonitoring(): Partial<WebSocketAuditMiddlewareConfig> {
    return {
      name: "ws-audit-api",
      logConnections: true,
      logMessages: true,
      logDisconnections: true,
      logErrors: true,
      includePayload: false,
      includeMetadata: true,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxPayloadSize: 1024 * 10, // 10KB
      enableRealTimeAnalytics: true,
      retentionDays: 90,
      anonymizePersonalData: false,
      complianceMode: "standard",
      trackRooms: false,
      trackMessageSize: true,
      batchInserts: true,
      batchSize: 100,
      flushInterval: 3000,
      skipMessageTypes: ["ping", "pong", "heartbeat"],
    };
  },
} as const;

/**
 * Create WebSocket audit middleware with comprehensive dependency injection
 * @param metrics - Metrics collector instance
 * @param redisClient - Redis client for fast storage
 * @param clickhouseClient - ClickHouse client for analytics
 * @param config - Middleware configuration
 */
export function createWebSocketAuditMiddleware(
  metrics: IMetricsCollector,
  redisClient: RedisClient,
  clickhouseClient: ClickHouseClient,
  config: Partial<WebSocketAuditMiddlewareConfig> = {}
): WebSocketAuditMiddleware {
  return new WebSocketAuditMiddleware(
    metrics,
    redisClient,
    clickhouseClient,
    config
  );
}

/**
 * Create WebSocket audit middleware with preset configuration
 * @param metrics - Metrics collector instance
 * @param redisClient - Redis client for fast storage
 * @param clickhouseClient - ClickHouse client for analytics
 * @param preset - Preset configuration function
 * @param overrides - Configuration overrides
 */
export function createWebSocketAuditMiddlewareWithPreset(
  metrics: IMetricsCollector,
  redisClient: RedisClient,
  clickhouseClient: ClickHouseClient,
  preset: () => Partial<WebSocketAuditMiddlewareConfig>,
  overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
): WebSocketAuditMiddleware {
  const presetConfig = preset();
  const finalConfig = { ...presetConfig, ...overrides };

  return new WebSocketAuditMiddleware(
    metrics,
    redisClient,
    clickhouseClient,
    finalConfig
  );
}

/**
 * Environment-specific factory functions
 */
export const WS_AUDIT_FACTORIES = {
  /**
   * Development environment factory
   */
  forDevelopment(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.development,
      overrides
    );
  },

  /**
   * Production environment factory
   */
  forProduction(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.production,
      overrides
    );
  },

  /**
   * Real-time chat factory
   */
  forRealtimeChat(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.realtimeChat,
      overrides
    );
  },

  /**
   * Gaming factory
   */
  forGaming(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.gaming,
      overrides
    );
  },

  /**
   * GDPR compliance factory
   */
  forGDPR(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.gdprCompliance,
      overrides
    );
  },

  /**
   * SOX compliance factory
   */
  forSOX(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.soxCompliance,
      overrides
    );
  },

  /**
   * HIPAA compliance factory
   */
  forHIPAA(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.hipaaCompliance,
      overrides
    );
  },

  /**
   * PCI DSS compliance factory
   */
  forPCI(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.pciCompliance,
      overrides
    );
  },

  /**
   * High-performance factory
   */
  forHighPerformance(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.highPerformance,
      overrides
    );
  },

  /**
   * IoT monitoring factory
   */
  forIoT(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.iotMonitoring,
      overrides
    );
  },

  /**
   * API monitoring factory
   */
  forAPI(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<WebSocketAuditMiddlewareConfig> = {}
  ): WebSocketAuditMiddleware {
    return createWebSocketAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      WS_AUDIT_PRESETS.apiMonitoring,
      overrides
    );
  },
} as const;

/**
 * Testing utilities for WebSocket audit middleware
 */
export const WS_AUDIT_TESTING_UTILS = {
  /**
   * Create a mock WebSocket audit middleware for testing
   */
  createMockMiddleware(config: Partial<WebSocketAuditMiddlewareConfig> = {}) {
    const mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordHistogram: jest.fn(),
    } as any;

    const mockRedis = {
      getRedis: () => ({
        setex: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
      }),
    } as any;

    const mockClickhouse = {
      insert: jest.fn(),
      execute: jest.fn(),
    } as any;

    const middleware = new WebSocketAuditMiddleware(
      mockMetrics,
      mockRedis,
      mockClickhouse,
      { name: "test-ws-audit", ...config }
    );

    return {
      middleware,
      mocks: {
        metrics: mockMetrics,
        redis: mockRedis,
        clickhouse: mockClickhouse,
      },
    };
  },

  /**
   * Create a test WebSocket context for audit middleware
   */
  createTestContext(overrides: any = {}) {
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
        id: "msg-123",
        ...overrides.message,
      },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 1,
        clientIp: "127.0.0.1",
        userAgent: "test-agent",
        headers: {},
        query: {},
        ...overrides.metadata,
      },
      authenticated: false,
      userId: undefined,
      userRoles: [],
      userPermissions: [],
      rooms: [],
      ...overrides,
    };
  },

  /**
   * Create a test WebSocket audit event
   */
  createTestAuditEvent(overrides: any = {}) {
    return {
      id: "ws-audit-test-123",
      eventType: "message" as const,
      connectionId: "test-connection-123",
      userId: "user-123",
      sessionId: "session-123",
      messageType: "test_message",
      action: "send_message",
      resource: "websocket",
      resourceId: "resource-123",
      ip: "127.0.0.1",
      userAgent: "test-agent",
      timestamp: new Date(),
      metadata: {},
      result: "success" as const,
      duration: 100,
      messageSize: 150,
      rooms: ["room1", "room2"],
      ...overrides,
    };
  },
} as const;

// Export all types and classes
export {
  WebSocketAuditMiddleware,
  type WebSocketAuditMiddlewareConfig,
} from "./WebSocketAuditMiddleware";

export type {
  WebSocketAuditEvent,
  WebSocketAuditQuery,
  WebSocketAuditSummary,
} from "./WebSocketAuditMiddleware";
