/**
 * Security Audit Integration Helper (Fixed)
 * 
 * Provides helper functions to easily integrate security audit
 * logging into existing Keycloak authentication services.
 * This version handles exactOptionalPropertyTypes correctly.
 */

import {
  SecurityAuditLogger,
  SecurityEventType,
} from "./SecurityAuditLogger";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * Security audit integration for Keycloak services
 */
export class SecurityAuditIntegration {
  private readonly auditLogger: SecurityAuditLogger;

  constructor(
    auditLogger: SecurityAuditLogger,
    _metrics?: IMetricsCollector
  ) {
    this.auditLogger = auditLogger;
  }

  /**
   * Log authentication events
   */
  logLogin = {
    attempt: (clientIP: string, userAgent?: string, clientId?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.LOGIN_ATTEMPT,
        success: true,
        clientIP,
        authMethod: "password",
        message: "Login attempt initiated",
        ...(userAgent && { userAgent }),
        ...(clientId && { clientId }),
      });
    },

    success: (userId: string, sessionId: string, clientIP: string, userAgent?: string, clientId?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.LOGIN_SUCCESS,
        success: true,
        userId,
        sessionId,
        clientIP,
        authMethod: "password",
        message: "Login successful",
        ...(userAgent && { userAgent }),
        ...(clientId && { clientId }),
      });
    },

    failure: (clientIP: string, failureReason: string, userAgent?: string, clientId?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.LOGIN_FAILURE,
        success: false,
        clientIP,
        authMethod: "password",
        failureReason,
        message: `Login failed: ${failureReason}`,
        ...(userAgent && { userAgent }),
        ...(clientId && { clientId }),
      });
    },
  };

  /**
   * Log token events
   */
  logToken = {
    refreshSuccess: (userId: string, sessionId: string, clientIP: string, userAgent?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.TOKEN_REFRESH,
        success: true,
        userId,
        sessionId,
        clientIP,
        authMethod: "refresh_token",
        message: "Token refresh successful",
        ...(userAgent && { userAgent }),
      });
    },

    refreshFailure: (clientIP: string, failureReason: string, sessionId?: string, userAgent?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.TOKEN_REFRESH_FAILURE,
        success: false,
        clientIP,
        authMethod: "refresh_token",
        failureReason,
        message: `Token refresh failed: ${failureReason}`,
        ...(sessionId && { sessionId }),
        ...(userAgent && { userAgent }),
      });
    },

    validationSuccess: (userId: string, sessionId: string, clientIP: string, resource: string) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.TOKEN_VALIDATION_SUCCESS,
        severity: "low" as any,
        timestamp: new Date(),
        userId,
        sessionId,
        clientIP,
        resource,
        success: true,
        message: "Token validation successful",
      });
    },

    validationFailure: (clientIP: string, failureReason: string, resource: string) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.TOKEN_VALIDATION_FAILURE,
        severity: "medium" as any,
        timestamp: new Date(),
        clientIP,
        resource,
        success: false,
        message: `Token validation failed: ${failureReason}`,
      });
    },
  };

  /**
   * Log session events
   */
  logSession = {
    created: (userId: string, sessionId: string, clientIP: string, userAgent?: string, maxAge?: number) => {
      this.auditLogger.logSession({
        type: SecurityEventType.SESSION_CREATED,
        success: true,
        userId,
        sessionId,
        clientIP,
        message: "Session created",
        ...(userAgent && { userAgent }),
        ...(maxAge !== undefined && { sessionInfo: { maxAge } }),
      });
    },

    destroyed: (userId: string, sessionId: string, clientIP: string, reason: string) => {
      this.auditLogger.logSession({
        type: SecurityEventType.SESSION_DESTROYED,
        success: true,
        userId,
        sessionId,
        clientIP,
        message: `Session destroyed: ${reason}`,
      });
    },

    rotated: (userId: string, oldSessionId: string, newSessionId: string, clientIP: string) => {
      this.auditLogger.logSession({
        type: SecurityEventType.SESSION_ROTATED,
        success: true,
        userId,
        sessionId: newSessionId,
        clientIP,
        message: "Session rotated for security",
        sessionInfo: { rotationReason: "scheduled_rotation" },
        metadata: { oldSessionId: oldSessionId.substring(0, 8) + "..." },
      });
    },

    expired: (userId?: string, sessionId?: string, clientIP?: string) => {
      this.auditLogger.logSession({
        type: SecurityEventType.SESSION_EXPIRED,
        success: false,
        sessionId: sessionId || "unknown",
        clientIP: clientIP || "unknown",
        message: "Session expired",
        ...(userId && { userId }),
      });
    },

    hijackAttempt: (userId: string, sessionId: string, suspiciousIP: string, originalIP: string) => {
      this.auditLogger.logSession({
        type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
        success: false,
        userId,
        sessionId,
        clientIP: suspiciousIP,
        message: "Potential session hijacking detected",
        metadata: {
          originalIP,
          suspiciousIP,
          securityViolation: true,
        },
      });
    },

    concurrentLimitExceeded: (userId: string, clientIP: string, currentSessions: number, maxSessions: number) => {
      this.auditLogger.logSession({
        type: SecurityEventType.CONCURRENT_SESSION_LIMIT,
        success: false,
        userId,
        sessionId: "pending",
        clientIP,
        message: "Concurrent session limit exceeded",
        sessionInfo: {
          concurrentSessions: currentSessions,
          maxConcurrentSessions: maxSessions,
        },
      });
    },
  };

  /**
   * Log authorization events
   */
  logAuthorization = {
    granted: (
      userId: string,
      sessionId: string,
      clientIP: string,
      resource: string,
      action: string,
      requiredPermissions: string[],
      grantedPermissions: string[],
      roles: string[]
    ) => {
      this.auditLogger.logAuthorization({
        type: SecurityEventType.PERMISSION_GRANTED,
        success: true,
        userId,
        sessionId,
        clientIP,
        resource,
        action,
        requiredPermissions,
        grantedPermissions,
        roles,
        message: `Access granted to ${resource}`,
      });
    },

    denied: (
      userId: string,
      sessionId: string,
      clientIP: string,
      resource: string,
      action: string,
      requiredPermissions: string[],
      grantedPermissions: string[],
      roles: string[],
      deniedReason: string
    ) => {
      this.auditLogger.logAuthorization({
        type: SecurityEventType.PERMISSION_DENIED,
        success: false,
        userId,
        sessionId,
        clientIP,
        resource,
        action,
        requiredPermissions,
        grantedPermissions,
        roles,
        deniedReason,
        message: `Access denied to ${resource}: ${deniedReason}`,
      });
    },
  };

  /**
   * Log API key events
   */
  logAPIKey = {
    created: (userId: string, apiKeyId: string, clientIP: string, permissions: string[]) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.API_KEY_CREATED,
        severity: "medium" as any,
        timestamp: new Date(),
        userId,
        clientIP,
        success: true,
        message: "API key created",
        metadata: {
          apiKeyId: apiKeyId.substring(0, 8) + "...",
          permissions,
        },
      });
    },

    used: (userId: string, apiKeyId: string, clientIP: string, resource: string, userAgent?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.API_KEY_USED,
        success: true,
        userId,
        clientIP,
        authMethod: "api_key",
        message: "API key authentication successful",
        metadata: {
          apiKeyId: apiKeyId.substring(0, 8) + "...",
          resource,
        },
        ...(userAgent && { userAgent }),
      });
    },

    invalid: (apiKeyId: string, clientIP: string, failureReason: string, userAgent?: string) => {
      this.auditLogger.logAuthentication({
        type: SecurityEventType.API_KEY_INVALID,
        success: false,
        clientIP,
        authMethod: "api_key",
        failureReason,
        message: `API key authentication failed: ${failureReason}`,
        metadata: {
          apiKeyId: apiKeyId ? apiKeyId.substring(0, 8) + "..." : "unknown",
        },
        ...(userAgent && { userAgent }),
      });
    },

    revoked: (userId: string, apiKeyId: string, clientIP: string, reason: string) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.API_KEY_REVOKED,
        severity: "medium" as any,
        timestamp: new Date(),
        userId,
        clientIP,
        success: true,
        message: `API key revoked: ${reason}`,
        metadata: {
          apiKeyId: apiKeyId.substring(0, 8) + "...",
          reason,
        },
      });
    },
  };

  /**
   * Log security violations
   */
  logSecurityViolation = {
    rateLimitExceeded: (clientIP: string, attemptCount: number, blockDuration: number, userAgent?: string) => {
      this.auditLogger.logSecurityViolation({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        clientIP,
        violationType: "rate_limit",
        violationDetails: {
          attemptCount,
          blockDuration,
          thresholdExceeded: true,
        },
        message: "Rate limit exceeded, IP temporarily blocked",
        ...(userAgent && { userAgent }),
      });
    },

    bruteForceAttempt: (clientIP: string, attemptCount: number, targetUserId?: string, userAgent?: string) => {
      this.auditLogger.logSecurityViolation({
        type: SecurityEventType.BRUTE_FORCE_ATTEMPT,
        clientIP,
        violationType: "brute_force",
        violationDetails: {
          attemptCount,
          patterns: ["repeated_failed_logins"],
        },
        message: "Potential brute force attack detected",
        ...(targetUserId && { userId: targetUserId }),
        ...(userAgent && { userAgent }),
      });
    },

    suspiciousActivity: (
      clientIP: string,
      patterns: string[],
      userId?: string,
      sessionId?: string,
      userAgent?: string
    ) => {
      this.auditLogger.logSecurityViolation({
        type: SecurityEventType.SUSPICIOUS_ACTIVITY,
        clientIP,
        violationType: "suspicious_behavior",
        violationDetails: {
          patterns,
          thresholdExceeded: true,
        },
        message: `Suspicious activity detected: ${patterns.join(", ")}`,
        ...(userId && { userId }),
        ...(sessionId && { sessionId }),
        ...(userAgent && { userAgent }),
      });
    },

    ipBlocked: (clientIP: string, violations: number, blockDuration: number) => {
      this.auditLogger.logSecurityViolation({
        type: SecurityEventType.IP_BLOCKED,
        clientIP,
        violationType: "policy_violation",
        violationDetails: {
          attemptCount: violations,
          blockDuration,
        },
        message: "IP address blocked due to security violations",
      });
    },

    userAgentBlocked: (clientIP: string, userAgent: string) => {
      this.auditLogger.logSecurityViolation({
        type: SecurityEventType.USER_AGENT_BLOCKED,
        clientIP,
        userAgent,
        violationType: "policy_violation",
        violationDetails: {
          patterns: ["blacklisted_user_agent"],
        },
        message: "Request blocked due to blacklisted user agent",
      });
    },
  };

  /**
   * Log system events
   */
  logSystem = {
    authServiceError: (error: Error, context?: Record<string, any>) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.AUTHENTICATION_SERVICE_ERROR,
        severity: "high" as any,
        timestamp: new Date(),
        clientIP: "system",
        success: false,
        message: `Authentication service error: ${error.message}`,
        metadata: {
          errorStack: error.stack,
          context,
        },
      });
    },

    keycloakConnectionError: (error: Error, keycloakUrl?: string) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.KEYCLOAK_CONNECTION_ERROR,
        severity: "high" as any,
        timestamp: new Date(),
        clientIP: "system",
        success: false,
        message: `Keycloak connection error: ${error.message}`,
        metadata: {
          keycloakUrl,
          errorMessage: error.message,
        },
      });
    },

    cacheError: (error: Error, operation: string) => {
      this.auditLogger.logEvent({
        eventType: SecurityEventType.CACHE_ERROR,
        severity: "medium" as any,
        timestamp: new Date(),
        clientIP: "system",
        success: false,
        message: `Cache operation failed: ${operation}`,
        metadata: {
          operation,
          errorMessage: error.message,
        },
      });
    },
  };

  /**
   * Get audit statistics
   */
  getStats() {
    return this.auditLogger.getStats();
  }
}

/**
 * Factory function to create security audit integration
 */
export function createSecurityAuditIntegration(
  auditLogger: SecurityAuditLogger,
  metrics?: IMetricsCollector
): SecurityAuditIntegration {
  return new SecurityAuditIntegration(auditLogger, metrics);
}