/**
 * Audit Middleware Factory Functions and Presets
 * Production-grade factory functions following established patterns
 */

import { type IMetricsCollector } from "@libs/monitoring";
import { RedisClient, ClickHouseClient } from "@libs/database";
import type { MiddlewareContext } from "../types/context.types";
import {
  AuditHttpMiddleware,
  type AuditHttpMiddlewareConfig,
  type AuditEvent,
} from "./audit.http.middleware";

/**
 * Audit middleware preset configurations
 * Pre-built configurations for common use cases and environments
 */
export const AUDIT_PRESETS = {
  /**
   * Development environment preset
   * Includes detailed logging and body/response capture
   */
  development(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-dev",
      includeBody: true,
      includeResponse: true,
      storageStrategy: "redis",
      redisTtl: 3600, // 1 hour
      maxBodySize: 1024 * 50, // 50KB
      enableRealTimeAnalytics: true,
      retentionDays: 7,
      anonymizePersonalData: false,
      complianceMode: "standard",
    };
  },

  /**
   * Production environment preset
   * Optimized for performance and security
   */
  production(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-prod",
      includeBody: false,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 7 * 24 * 3600, // 7 days
      maxBodySize: 1024 * 5, // 5KB
      enableRealTimeAnalytics: true,
      retentionDays: 90,
      anonymizePersonalData: true,
      complianceMode: "standard",
      skipRoutes: ["/health", "/metrics", "/docs", "/favicon.ico"],
    };
  },

  /**
   * GDPR compliance preset
   * Enhanced data protection and retention policies
   */
  gdprCompliance(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-gdpr",
      includeBody: true,
      includeResponse: true,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxBodySize: 1024 * 100, // 100KB
      enableRealTimeAnalytics: true,
      retentionDays: 2555, // 7 years
      anonymizePersonalData: true,
      complianceMode: "GDPR",
      skipRoutes: [], // Audit everything for GDPR
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
   * Financial transaction auditing
   */
  soxCompliance(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-sox",
      includeBody: true,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 90 * 24 * 3600, // 90 days
      maxBodySize: 1024 * 25, // 25KB
      enableRealTimeAnalytics: true,
      retentionDays: 2555, // 7 years
      anonymizePersonalData: false, // SOX requires non-anonymized trails
      complianceMode: "SOX",
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
   * Healthcare data protection
   */
  hipaaCompliance(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-hipaa",
      includeBody: true,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 6 * 30 * 24 * 3600, // 6 months
      maxBodySize: 1024 * 50, // 50KB
      enableRealTimeAnalytics: true,
      retentionDays: 2190, // 6 years
      anonymizePersonalData: true,
      complianceMode: "HIPAA",
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
   * Payment card industry security
   */
  pciCompliance(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-pci",
      includeBody: false, // Never log payment data
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 12 * 30 * 24 * 3600, // 12 months
      maxBodySize: 1024 * 10, // 10KB
      enableRealTimeAnalytics: true,
      retentionDays: 365, // 1 year minimum
      anonymizePersonalData: true,
      complianceMode: "PCI_DSS",
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
   * Minimal overhead for high-throughput systems
   */
  highPerformance(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-perf",
      includeBody: false,
      includeResponse: false,
      storageStrategy: "clickhouse", // Skip Redis for performance
      maxBodySize: 1024, // 1KB
      enableRealTimeAnalytics: false,
      retentionDays: 30,
      anonymizePersonalData: false,
      complianceMode: "standard",
      skipRoutes: ["/health", "/metrics", "/docs", "/ping", "/status"],
    };
  },

  /**
   * Security monitoring preset
   * Enhanced security event tracking
   */
  securityMonitoring(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-security",
      includeBody: true,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxBodySize: 1024 * 20, // 20KB
      enableRealTimeAnalytics: true,
      retentionDays: 365, // 1 year
      anonymizePersonalData: false,
      complianceMode: "standard",
      sensitiveFields: ["password", "token", "secret", "key"],
      skipRoutes: ["/health", "/metrics"],
    };
  },

  /**
   * API access monitoring preset
   * External API usage tracking
   */
  apiMonitoring(): Partial<AuditHttpMiddlewareConfig> {
    return {
      name: "audit-api",
      includeBody: false,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 7 * 24 * 3600, // 7 days
      maxBodySize: 1024 * 5, // 5KB
      enableRealTimeAnalytics: true,
      retentionDays: 90,
      anonymizePersonalData: false,
      complianceMode: "standard",
      skipRoutes: ["/health", "/metrics", "/docs"],
    };
  },
} as const;

/**
 * Create audit middleware with comprehensive dependency injection
 * @param metrics - Metrics collector instance
 * @param config - Middleware configuration
 * @param redisClient - Optional Redis client (uses default if not provided)
 * @param clickhouseClient - Optional ClickHouse client (uses default if not provided)
 */
export function createAuditHttpMiddleware(
  metrics: IMetricsCollector,
  config: Partial<AuditHttpMiddlewareConfig> = {},
  redisClient?: RedisClient,
  clickhouseClient?: ClickHouseClient
): AuditHttpMiddleware {
  return new AuditHttpMiddleware(
    metrics,
    config,
    redisClient,
    clickhouseClient
  );
}

/**
 * Create audit middleware with preset configuration
 * @param metrics - Metrics collector instance
 * @param preset - Preset configuration function
 * @param overrides - Configuration overrides
 * @param redisClient - Optional Redis client (uses default if not provided)
 * @param clickhouseClient - Optional ClickHouse client (uses default if not provided)
 */
export function createAuditHttpMiddlewareWithPreset(
  metrics: IMetricsCollector,
  preset: () => Partial<AuditHttpMiddlewareConfig>,
  overrides: Partial<AuditHttpMiddlewareConfig> = {},
  redisClient?: RedisClient,
  clickhouseClient?: ClickHouseClient
): AuditHttpMiddleware {
  const presetConfig = preset();
  const finalConfig = { ...presetConfig, ...overrides };

  return new AuditHttpMiddleware(
    metrics,
    finalConfig,
    redisClient,
    clickhouseClient
  );
}

/**
 * Environment-specific factory functions
 */
export const AUDIT_FACTORIES = {
  /**
   * Development environment factory
   */
  forDevelopment(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.development,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * Production environment factory
   */
  forProduction(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.production,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * GDPR compliance factory
   */
  forGDPR(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.gdprCompliance,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * SOX compliance factory
   */
  forSOX(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.soxCompliance,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * HIPAA compliance factory
   */
  forHIPAA(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.hipaaCompliance,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * PCI DSS compliance factory
   */
  forPCI(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.pciCompliance,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * High-performance factory
   */
  forHighPerformance(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.highPerformance,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * Security monitoring factory
   */
  forSecurity(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.securityMonitoring,
      overrides,
      redisClient,
      clickhouseClient
    );
  },

  /**
   * API monitoring factory
   */
  forAPI(
    metrics: IMetricsCollector,
    overrides: Partial<AuditHttpMiddlewareConfig> = {},
    redisClient?: RedisClient,
    clickhouseClient?: ClickHouseClient
  ): AuditHttpMiddleware {
    return createAuditHttpMiddlewareWithPreset(
      metrics,
      AUDIT_PRESETS.apiMonitoring,
      overrides,
      redisClient,
      clickhouseClient
    );
  },
} as const;

/**
 * Testing utilities for audit middleware
 */
export const AUDIT_TESTING_UTILS = {
  /**
   * Create a mock audit middleware for testing
   */
  createMockMiddleware(config: Partial<AuditHttpMiddlewareConfig> = {}) {
    const mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordHistogram: jest.fn(),
      recordGauge: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      measureEventLoopLag: jest.fn(),
    } as unknown as IMetricsCollector;

    const middleware = new AuditHttpMiddleware(mockMetrics, {
      name: "test-audit",
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
   * Create a test context for audit middleware
   */
  createTestContext(overrides: Partial<MiddlewareContext> = {}) {
    return {
      request: {
        method: "GET",
        url: "/test",
        headers: {},
        body: null,
        ip: "127.0.0.1",
        ...overrides.request,
      },
      response: {
        status: 200,
        headers: {},
        body: null,
        ...overrides.response,
      },
      user: overrides.user || null,
      session: overrides.session || null,
      params: overrides["params"] || {},
      query: overrides["query"] || {},
      ...overrides,
    } as MiddlewareContext;
  },

  /**
   * Create a test audit event
   */
  createTestAuditEvent(overrides: Partial<AuditEvent> = {}) {
    return {
      id: "test-audit-123",
      userId: "user-123",
      sessionId: "session-123",
      action: "test_action",
      resource: "test_resource",
      resourceId: "resource-123",
      ip: "127.0.0.1",
      userAgent: "test-agent",
      timestamp: new Date(),
      metadata: {},
      result: "success" as const,
      statusCode: 200,
      duration: 100,
      ...overrides,
    } as AuditEvent;
  },
} as const;

// Export all types and classes
export * from "./audit.http.middleware";

export * from "./audit.websocket.middleware";
