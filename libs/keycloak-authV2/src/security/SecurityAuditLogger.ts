/**
 * Security Audit Logger
 *
 * Comprehensive security event logging for authentication, authorization,
 * and security-related activities. Provides structured logging for monitoring,
 * threat detection, and compliance requirements.
 */

import type { IMetricsCollector } from "@libs/monitoring";
import { createLogger } from "@libs/utils";

/**
 * Security event types
 */
export enum SecurityEventType {
  // Authentication Events
  LOGIN_ATTEMPT = "login_attempt",
  LOGIN_SUCCESS = "login_success",
  LOGIN_FAILURE = "login_failure",
  LOGOUT = "logout",
  TOKEN_REFRESH = "token_refresh",
  TOKEN_REFRESH_FAILURE = "token_refresh_failure",

  // Authorization Events
  PERMISSION_GRANTED = "permission_granted",
  PERMISSION_DENIED = "permission_denied",
  ROLE_ASSIGNED = "role_assigned",
  ROLE_REMOVED = "role_removed",

  // API Key Events
  API_KEY_CREATED = "api_key_created",
  API_KEY_USED = "api_key_used",
  API_KEY_REVOKED = "api_key_revoked",
  API_KEY_EXPIRED = "api_key_expired",
  API_KEY_INVALID = "api_key_invalid",

  // Session Events
  SESSION_CREATED = "session_created",
  SESSION_DESTROYED = "session_destroyed",
  SESSION_ROTATED = "session_rotated",
  SESSION_EXPIRED = "session_expired",
  SESSION_HIJACK_ATTEMPT = "session_hijack_attempt",
  CONCURRENT_SESSION_LIMIT = "concurrent_session_limit",

  // Security Violations
  BRUTE_FORCE_ATTEMPT = "brute_force_attempt",
  RATE_LIMIT_EXCEEDED = "rate_limit_exceeded",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",
  IP_BLOCKED = "ip_blocked",
  USER_AGENT_BLOCKED = "user_agent_blocked",

  // Token Events
  TOKEN_VALIDATION_SUCCESS = "token_validation_success",
  TOKEN_VALIDATION_FAILURE = "token_validation_failure",
  TOKEN_EXPIRED = "token_expired",
  TOKEN_INTROSPECTION = "token_introspection",

  // System Events
  AUTHENTICATION_SERVICE_ERROR = "auth_service_error",
  KEYCLOAK_CONNECTION_ERROR = "keycloak_connection_error",
  CACHE_ERROR = "cache_error",
}

/**
 * Security event severity levels
 */
export enum SecurityEventSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Base security event interface
 */
export interface BaseSecurityEvent {
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  timestamp: Date;
  userId?: string | undefined;
  sessionId?: string | undefined;
  clientIP: string;
  userAgent?: string | undefined;
  resource?: string | undefined;
  action?: string | undefined;
  success: boolean;
  message: string;
  metadata?: Record<string, any> | undefined;
}

/**
 * Authentication-specific event
 */
export interface AuthenticationEvent extends BaseSecurityEvent {
  authMethod: "password" | "api_key" | "jwt" | "refresh_token";
  clientId?: string;
  realm?: string;
  failureReason?: string;
}

/**
 * Authorization-specific event
 */
export interface AuthorizationEvent extends BaseSecurityEvent {
  requiredPermissions: string[];
  grantedPermissions: string[];
  roles: string[];
  deniedReason?: string;
}

/**
 * Session-specific event
 */
export interface SessionEvent extends BaseSecurityEvent {
  sessionInfo?:
    | {
        maxAge?: number;
        rotationReason?: string;
        concurrentSessions?: number;
        maxConcurrentSessions?: number;
      }
    | undefined;
}

/**
 * Security violation event
 */
export interface SecurityViolationEvent extends BaseSecurityEvent {
  violationType:
    | "rate_limit"
    | "brute_force"
    | "suspicious_behavior"
    | "policy_violation";
  violationDetails: {
    attemptCount?: number;
    blockDuration?: number;
    thresholdExceeded?: boolean;
    patterns?: string[];
  };
}

/**
 * Union type for all security events
 */
export type SecurityEvent =
  | AuthenticationEvent
  | AuthorizationEvent
  | SessionEvent
  | SecurityViolationEvent
  | BaseSecurityEvent;

/**
 * Security audit logging configuration
 */
export interface SecurityAuditConfig {
  // Enable/disable different event categories
  logAuthentication: boolean;
  logAuthorization: boolean;
  logSessions: boolean;
  logApiKeys: boolean;
  logSecurityViolations: boolean;
  logSystemEvents: boolean;

  // Filtering options
  minimumSeverity: SecurityEventSeverity;
  excludeEvents?: SecurityEventType[];
  includeOnlyEvents?: SecurityEventType[];

  // PII handling
  maskSensitiveData: boolean;
  retainIPAddress: boolean;
  retainUserAgent: boolean;

  // Storage options
  logToFile: boolean;
  logToDatabase: boolean;
  logToSIEM: boolean;

  // Retention
  retentionDays: number;

  // Alert thresholds
  alertThresholds: {
    failedLoginsPerMinute: number;
    rateLimitViolationsPerHour: number;
    suspiciousActivitiesPerDay: number;
  };
}

/**
 * Default security audit configuration
 */
export const DEFAULT_SECURITY_AUDIT_CONFIG: SecurityAuditConfig = {
  logAuthentication: true,
  logAuthorization: true,
  logSessions: true,
  logApiKeys: true,
  logSecurityViolations: true,
  logSystemEvents: true,
  minimumSeverity: SecurityEventSeverity.LOW,
  maskSensitiveData: true,
  retainIPAddress: true,
  retainUserAgent: true,
  logToFile: true,
  logToDatabase: false,
  logToSIEM: false,
  retentionDays: 90,
  alertThresholds: {
    failedLoginsPerMinute: 10,
    rateLimitViolationsPerHour: 50,
    suspiciousActivitiesPerDay: 100,
  },
};

/**
 * Security audit logger implementation
 */
export class SecurityAuditLogger {
  private readonly config: SecurityAuditConfig;

  // Track event counts for alerting
  private readonly eventCounts = new Map<
    string,
    { count: number; lastReset: number }
  >();
  logger: import("/home/zied/workspace/backend/libs/utils/src/Logger").ILogger;

  constructor(
    config: Partial<SecurityAuditConfig> = {},
    private readonly metrics?: IMetricsCollector
  ) {
    this.config = { ...DEFAULT_SECURITY_AUDIT_CONFIG, ...config };
    this.logger = createLogger("SecurityAudit");
  }

  /**
   * Log a security event
   */
  logEvent(event: SecurityEvent): void {
    // Check if event should be logged based on configuration
    if (!this.shouldLogEvent(event)) {
      return;
    }

    // Sanitize event data
    const sanitizedEvent = this.sanitizeEvent(event);

    // Log the event
    this.writeEvent(sanitizedEvent);

    // Record metrics
    this.recordMetrics(sanitizedEvent);

    // Check alert thresholds
    this.checkAlertThresholds(sanitizedEvent);
  }

  /**
   * Log authentication event
   */
  logAuthentication(eventData: {
    type: SecurityEventType;
    success: boolean;
    userId?: string;
    sessionId?: string;
    clientIP: string;
    userAgent?: string;
    authMethod: AuthenticationEvent["authMethod"];
    clientId?: string;
    realm?: string;
    failureReason?: string;
    message?: string;
    metadata?: Record<string, any>;
  }): void {
    const event: AuthenticationEvent = {
      ...eventData,
      eventType: eventData.type,
      severity: eventData.success
        ? SecurityEventSeverity.LOW
        : SecurityEventSeverity.MEDIUM,
      timestamp: new Date(),
      message:
        eventData.message ||
        this.getDefaultMessage(eventData.type, eventData.success),
    };

    this.logEvent(event);
  }

  /**
   * Log authorization event
   */
  logAuthorization(eventData: {
    type: SecurityEventType;
    success: boolean;
    userId: string;
    sessionId?: string;
    clientIP: string;
    userAgent?: string;
    resource: string;
    action: string;
    requiredPermissions: string[];
    grantedPermissions: string[];
    roles: string[];
    deniedReason?: string;
    message?: string;
    metadata?: Record<string, any>;
  }): void {
    const event: AuthorizationEvent = {
      ...eventData,
      eventType: eventData.type,
      severity: eventData.success
        ? SecurityEventSeverity.LOW
        : SecurityEventSeverity.MEDIUM,
      timestamp: new Date(),
      message:
        eventData.message ||
        this.getDefaultMessage(eventData.type, eventData.success),
    };

    this.logEvent(event);
  }

  /**
   * Log session event
   */
  logSession(eventData: {
    type: SecurityEventType;
    success: boolean;
    userId?: string;
    sessionId: string;
    clientIP: string;
    userAgent?: string;
    sessionInfo?: SessionEvent["sessionInfo"];
    message?: string;
    metadata?: Record<string, any>;
  }): void {
    const event: SessionEvent = {
      ...eventData,
      eventType: eventData.type,
      severity: this.getSeverityForSessionEvent(eventData.type),
      timestamp: new Date(),
      message:
        eventData.message ||
        this.getDefaultMessage(eventData.type, eventData.success),
    };

    this.logEvent(event);
  }

  /**
   * Log security violation event
   */
  logSecurityViolation(eventData: {
    type: SecurityEventType;
    clientIP: string;
    userAgent?: string;
    userId?: string;
    sessionId?: string;
    violationType: SecurityViolationEvent["violationType"];
    violationDetails: SecurityViolationEvent["violationDetails"];
    message?: string;
    metadata?: Record<string, any>;
  }): void {
    const event: SecurityViolationEvent = {
      ...eventData,
      eventType: eventData.type,
      severity: SecurityEventSeverity.HIGH, // Security violations are always high severity
      timestamp: new Date(),
      success: false, // Security violations are never "successful"
      message:
        eventData.message || this.getDefaultMessage(eventData.type, false),
    };

    this.logEvent(event);
  }

  /**
   * Check if event should be logged based on configuration
   */
  private shouldLogEvent(event: SecurityEvent): boolean {
    // Check minimum severity
    if (!this.meetsSeverityThreshold(event.severity)) {
      return false;
    }

    // Check event category filters
    if (!this.isEventCategoryEnabled(event.eventType)) {
      return false;
    }

    // Check include/exclude filters
    if (
      this.config.includeOnlyEvents &&
      !this.config.includeOnlyEvents.includes(event.eventType)
    ) {
      return false;
    }

    if (
      this.config.excludeEvents &&
      this.config.excludeEvents.includes(event.eventType)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Sanitize event data based on configuration
   */
  private sanitizeEvent(event: SecurityEvent): SecurityEvent {
    const sanitized = { ...event };

    if (this.config.maskSensitiveData) {
      // Mask sensitive data in metadata
      if (sanitized.metadata) {
        sanitized.metadata = this.maskSensitiveFields(sanitized.metadata);
      }

      // Mask IP if configured
      if (!this.config.retainIPAddress) {
        sanitized.clientIP = this.maskIP(sanitized.clientIP);
      }

      // Mask user agent if configured
      if (!this.config.retainUserAgent && sanitized.userAgent) {
        sanitized.userAgent = this.maskUserAgent(sanitized.userAgent);
      }
    }

    return sanitized;
  }

  /**
   * Write event to configured destinations
   */
  private writeEvent(event: SecurityEvent): void {
    const logData = {
      timestamp: event.timestamp.toISOString(),
      eventType: event.eventType,
      severity: event.severity,
      success: event.success,
      message: event.message,
      userId: event.userId,
      sessionId: event.sessionId,
      clientIP: event.clientIP,
      userAgent: event.userAgent,
      resource: event.resource,
      action: event.action,
      metadata: event.metadata,
    };

    // Log based on severity level
    switch (event.severity) {
      case SecurityEventSeverity.LOW:
        this.logger.info("Security Event", logData);
        break;
      case SecurityEventSeverity.MEDIUM:
        this.logger.warn("Security Event", logData);
        break;
      case SecurityEventSeverity.HIGH:
        this.logger.error("Security Event", logData);
        break;
      case SecurityEventSeverity.CRITICAL:
        this.logger.error("CRITICAL Security Event", logData);
        break;
    }
  }

  /**
   * Record metrics for the event
   */
  private recordMetrics(event: SecurityEvent): void {
    if (!this.metrics) return;

    const tags = {
      eventType: event.eventType,
      severity: event.severity,
      success: event.success.toString(),
    };

    this.metrics.recordCounter("security_audit.event", 1, tags);

    // Record specific metrics for different event types
    if (event.eventType.includes("login")) {
      this.metrics.recordCounter("security_audit.login_event", 1, {
        ...tags,
        success: event.success.toString(),
      });
    }

    if (event.eventType.includes("permission")) {
      this.metrics.recordCounter("security_audit.authorization_event", 1, tags);
    }
  }

  /**
   * Check alert thresholds and trigger alerts if necessary
   */
  private checkAlertThresholds(event: SecurityEvent): void {
    const now = Date.now();

    // Check failed login threshold
    if (event.eventType === SecurityEventType.LOGIN_FAILURE) {
      this.incrementEventCount("failed_logins", 60 * 1000, now); // 1 minute window
      const failedLogins = this.getEventCount("failed_logins");

      if (failedLogins >= this.config.alertThresholds.failedLoginsPerMinute) {
        this.triggerAlert("High number of failed logins detected", {
          count: failedLogins,
          threshold: this.config.alertThresholds.failedLoginsPerMinute,
          windowMinutes: 1,
        });
      }
    }

    // Check rate limit violations
    if (event.eventType === SecurityEventType.RATE_LIMIT_EXCEEDED) {
      this.incrementEventCount("rate_limit_violations", 60 * 60 * 1000, now); // 1 hour window
      const violations = this.getEventCount("rate_limit_violations");

      if (
        violations >= this.config.alertThresholds.rateLimitViolationsPerHour
      ) {
        this.triggerAlert("High number of rate limit violations", {
          count: violations,
          threshold: this.config.alertThresholds.rateLimitViolationsPerHour,
          windowHours: 1,
        });
      }
    }
  }

  /**
   * Helper methods
   */
  private meetsSeverityThreshold(severity: SecurityEventSeverity): boolean {
    const severityLevels = [
      SecurityEventSeverity.LOW,
      SecurityEventSeverity.MEDIUM,
      SecurityEventSeverity.HIGH,
      SecurityEventSeverity.CRITICAL,
    ];

    const eventLevel = severityLevels.indexOf(severity);
    const configLevel = severityLevels.indexOf(this.config.minimumSeverity);

    return eventLevel >= configLevel;
  }

  private isEventCategoryEnabled(eventType: SecurityEventType): boolean {
    if (eventType.includes("login") || eventType.includes("token")) {
      return this.config.logAuthentication;
    }
    if (eventType.includes("permission") || eventType.includes("role")) {
      return this.config.logAuthorization;
    }
    if (eventType.includes("session")) {
      return this.config.logSessions;
    }
    if (eventType.includes("api_key")) {
      return this.config.logApiKeys;
    }
    if (eventType.includes("rate_limit") || eventType.includes("brute_force")) {
      return this.config.logSecurityViolations;
    }
    return this.config.logSystemEvents;
  }

  private getSeverityForSessionEvent(
    eventType: SecurityEventType
  ): SecurityEventSeverity {
    switch (eventType) {
      case SecurityEventType.SESSION_HIJACK_ATTEMPT:
        return SecurityEventSeverity.CRITICAL;
      case SecurityEventType.CONCURRENT_SESSION_LIMIT:
        return SecurityEventSeverity.HIGH;
      case SecurityEventType.SESSION_EXPIRED:
        return SecurityEventSeverity.MEDIUM;
      default:
        return SecurityEventSeverity.LOW;
    }
  }

  private getDefaultMessage(
    eventType: SecurityEventType,
    success: boolean
  ): string {
    const action = eventType.replace(/_/g, " ");
    return success ? `${action} successful` : `${action} failed`;
  }

  private maskSensitiveFields(
    metadata: Record<string, any>
  ): Record<string, any> {
    const sensitiveFields = [
      "password",
      "token",
      "secret",
      "key",
      "credential",
    ];
    const masked = { ...metadata };

    for (const [key] of Object.entries(masked)) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        masked[key] = "***MASKED***";
      }
    }

    return masked;
  }

  private maskIP(ip: string): string {
    if (ip.includes(".")) {
      // IPv4
      const parts = ip.split(".");
      return `${parts[0]}.${parts[1]}.*.***`;
    } else if (ip.includes(":")) {
      // IPv6
      const parts = ip.split(":");
      return `${parts[0]}:${parts[1]}:****:****`;
    }
    return "***.***.***";
  }

  private maskUserAgent(userAgent: string): string {
    // Keep only the first part (browser name) and mask the rest
    const parts = userAgent.split(" ");
    return parts.length > 0 ? `${parts[0]} ***MASKED***` : "***MASKED***";
  }

  private incrementEventCount(
    key: string,
    windowMs: number,
    now: number
  ): void {
    const eventCount = this.eventCounts.get(key) || {
      count: 0,
      lastReset: now,
    };

    // Reset count if window has passed
    if (now - eventCount.lastReset > windowMs) {
      eventCount.count = 1;
      eventCount.lastReset = now;
    } else {
      eventCount.count++;
    }

    this.eventCounts.set(key, eventCount);
  }

  private getEventCount(key: string): number {
    return this.eventCounts.get(key)?.count || 0;
  }

  private triggerAlert(message: string, details: Record<string, any>): void {
    this.logger.error("SECURITY ALERT", { message, details });
    this.metrics?.recordCounter("security_audit.alert", 1, {
      alertType: "threshold_exceeded",
    });
  }

  /**
   * Get audit statistics
   */
  getStats() {
    return {
      config: {
        minimumSeverity: this.config.minimumSeverity,
        categoriesEnabled: {
          authentication: this.config.logAuthentication,
          authorization: this.config.logAuthorization,
          sessions: this.config.logSessions,
          apiKeys: this.config.logApiKeys,
          securityViolations: this.config.logSecurityViolations,
          systemEvents: this.config.logSystemEvents,
        },
      },
      eventCounts: Object.fromEntries(this.eventCounts),
      alertThresholds: this.config.alertThresholds,
    };
  }
}

/**
 * Factory function to create security audit logger
 */
export function createSecurityAuditLogger(
  config: Partial<SecurityAuditConfig> = {},
  metrics?: IMetricsCollector
): SecurityAuditLogger {
  return new SecurityAuditLogger(config, metrics);
}
