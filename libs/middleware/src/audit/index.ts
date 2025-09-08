/**
 * Audit Middleware Factory Functions and Presets
 * Production-grade factory functions following established patterns
 */

import { type IMetricsCollector } from "@libs/monitoring";
import { RedisClient, ClickHouseClient } from "@libs/database";
import { AuditMiddleware, type AuditMiddlewareConfig } from "./AuditMiddleware";

/**
 * Audit middleware preset configurations
 * Pre-built configurations for common use cases and environments
 */
export const AUDIT_PRESETS = {
  /**
   * Development environment preset
   * Includes detailed logging and body/response capture
   */
  development(): Partial<AuditMiddlewareConfig> {
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
  production(): Partial<AuditMiddlewareConfig> {
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
  gdprCompliance(): Partial<AuditMiddlewareConfig> {
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
  soxCompliance(): Partial<AuditMiddlewareConfig> {
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
  hipaaCompliance(): Partial<AuditMiddlewareConfig> {
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
  pciCompliance(): Partial<AuditMiddlewareConfig> {
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
  highPerformance(): Partial<AuditMiddlewareConfig> {
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
  securityMonitoring(): Partial<AuditMiddlewareConfig> {
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
  apiMonitoring(): Partial<AuditMiddlewareConfig> {
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
 * @param redisClient - Redis client for fast storage
 * @param clickhouseClient - ClickHouse client for analytics
 * @param config - Middleware configuration
 */
export function createAuditMiddleware(
  metrics: IMetricsCollector,
  redisClient: RedisClient,
  clickhouseClient: ClickHouseClient,
  config: Partial<AuditMiddlewareConfig> = {}
): AuditMiddleware {
  return new AuditMiddleware(metrics, redisClient, clickhouseClient, config);
}

/**
 * Create audit middleware with preset configuration
 * @param metrics - Metrics collector instance
 * @param redisClient - Redis client for fast storage
 * @param clickhouseClient - ClickHouse client for analytics
 * @param preset - Preset configuration function
 * @param overrides - Configuration overrides
 */
export function createAuditMiddlewareWithPreset(
  metrics: IMetricsCollector,
  redisClient: RedisClient,
  clickhouseClient: ClickHouseClient,
  preset: () => Partial<AuditMiddlewareConfig>,
  overrides: Partial<AuditMiddlewareConfig> = {}
): AuditMiddleware {
  const presetConfig = preset();
  const finalConfig = { ...presetConfig, ...overrides };

  return new AuditMiddleware(
    metrics,
    redisClient,
    clickhouseClient,
    finalConfig
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
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.development,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.production,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.gdprCompliance,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.soxCompliance,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.hipaaCompliance,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.pciCompliance,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.highPerformance,
      overrides
    );
  },

  /**
   * Security monitoring factory
   */
  forSecurity(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.securityMonitoring,
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
    overrides: Partial<AuditMiddlewareConfig> = {}
  ): AuditMiddleware {
    return createAuditMiddlewareWithPreset(
      metrics,
      redisClient,
      clickhouseClient,
      AUDIT_PRESETS.apiMonitoring,
      overrides
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
  createMockMiddleware(config: Partial<AuditMiddlewareConfig> = {}) {
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

    const middleware = new AuditMiddleware(
      mockMetrics,
      mockRedis,
      mockClickhouse,
      { name: "test-audit", ...config }
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
   * Create a test context for audit middleware
   */
  createTestContext(overrides: any = {}) {
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
      params: overrides.params || {},
      query: overrides.query || {},
      ...overrides,
    };
  },

  /**
   * Create a test audit event
   */
  createTestAuditEvent(overrides: any = {}) {
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
    };
  },
} as const;

// Export all types and classes
export { AuditMiddleware, type AuditMiddlewareConfig } from "./AuditMiddleware";

export type { AuditEvent, AuditQuery, AuditSummary } from "./AuditMiddleware";
