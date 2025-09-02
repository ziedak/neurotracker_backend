import { IAuthenticationContext, EntityId } from "../../types/core";

import { IEnhancedUser } from "../../types/enhanced";
import { IAuthenticationCredentials } from "../services";

/**
 * Security event types for authentication auditing
 */
export enum SecurityEventType {
  LOGIN_SUCCESS = "LOGIN_SUCCESS",
  LOGIN_FAILURE = "LOGIN_FAILURE",
  LOGOUT = "LOGOUT",
  PASSWORD_CHANGE = "PASSWORD_CHANGE",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  UNAUTHORIZED_ACCESS = "UNAUTHORIZED_ACCESS",
}

/**
 * Risk level assessment for security events
 */
export enum RiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

/**
 * Security audit event interface
 */
export interface ISecurityAuditEvent {
  readonly eventId: string;
  readonly eventType: SecurityEventType;
  readonly timestamp: string; // ISO string timestamp
  readonly riskLevel: RiskLevel;
  readonly message: string;
  readonly userId?: EntityId;
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly context?: IAuthenticationContext;
  readonly additionalData?: Record<string, unknown>;
}

/**
 * Threat assessment result interface
 */
export interface IThreatAssessment {
  readonly threatScore: number; // 0-100
  readonly riskLevel: RiskLevel;
  readonly indicators: ReadonlyArray<string>;
  readonly recommendedActions: ReadonlyArray<string>;
  readonly blockedAction: boolean;
}

/**
 * Security metrics interface
 */
export interface ISecurityMetrics {
  readonly totalEvents: number;
  readonly eventsByType: Record<SecurityEventType, number>;
  readonly eventsByRisk: Record<RiskLevel, number>;
  readonly suspiciousActivitiesCount: number;
  readonly blockedAttemptsCount: number;
  readonly timeRange: {
    readonly start: string;
    readonly end: string;
  };
}

/**
 * Security auditor service interface
 * Handles security event logging, threat detection, and risk assessment
 * Following Single Responsibility Principle - focused on security auditing only
 */
export interface ISecurityAuditor {
  /**
   * Log authentication success event
   */
  logAuthenticationSuccess(
    user: IEnhancedUser,
    credentials: IAuthenticationCredentials,
    context?: IAuthenticationContext
  ): Promise<void>;

  /**
   * Log authentication failure event
   */
  logAuthenticationFailure(
    credentials: IAuthenticationCredentials,
    reason: string,
    context?: IAuthenticationContext
  ): Promise<void>;

  /**
   * Log logout event
   */
  logLogout(
    userId: EntityId,
    sessionId?: string,
    context?: IAuthenticationContext
  ): Promise<void>;

  /**
   * Log password change event
   */
  logPasswordChange(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<void>;

  /**
   * Log suspicious activity
   */
  logSuspiciousActivity(
    description: string,
    userId?: EntityId,
    context?: IAuthenticationContext,
    additionalData?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Assess threat level for authentication attempt
   */
  assessThreat(
    credentials: IAuthenticationCredentials,
    context?: IAuthenticationContext
  ): Promise<IThreatAssessment>;

  /**
   * Get security metrics for time period
   */
  getSecurityMetrics(
    startTime: string,
    endTime: string,
    userId?: EntityId
  ): Promise<ISecurityMetrics>;

  /**
   * Check if user/IP should be blocked due to suspicious activity
   */
  shouldBlockAccess(
    identifier: string, // userId, IP, etc.
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Record a generic security event
   */
  recordSecurityEvent(event: ISecurityAuditEvent): Promise<void>;
}
