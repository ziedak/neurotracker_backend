import {
  ISecurityAuditor,
  ISecurityAuditEvent,
  IThreatAssessment,
  ISecurityMetrics,
  SecurityEventType,
  RiskLevel,
} from "../contracts/services/ISecurityAuditor";

import {
  IAuthenticationContext,
  EntityId,
  createTimestamp,
  IAuditEvent,
  createSessionId,
} from "../types/core";

import { IEnhancedUser } from "../types/enhanced";
import {
  IAuthenticationCredentials,
  IAuditService,
} from "../contracts/services";

/**
 * Security auditor service implementation
 * Handles security event logging, threat detection, and risk assessment
 * Extracted from AuthenticationService for better SRP compliance
 */
export class SecurityAuditor implements ISecurityAuditor {
  private readonly auditService: IAuditService;
  private readonly threatScoreCache = new Map<
    string,
    { score: number; timestamp: number }
  >();
  private readonly suspiciousIPs = new Set<string>();
  private readonly failedAttempts = new Map<string, number>();

  // Configuration constants
  private readonly THREAT_SCORE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly HIGH_RISK_THRESHOLD = 70;
  private readonly CRITICAL_RISK_THRESHOLD = 90;

  constructor(auditService: IAuditService) {
    this.auditService = auditService;
  }

  /**
   * Log authentication success event
   */
  async logAuthenticationSuccess(
    user: IEnhancedUser,
    credentials: IAuthenticationCredentials,
    context?: IAuthenticationContext
  ): Promise<void> {
    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId: user.id as EntityId,
      sessionId: context?.session?.id
        ? createSessionId(context.session.id)
        : null,
      action: "authenticate",
      resource: "authentication",
      outcome: "success",
      ipAddress: context?.ipAddress || "unknown",
      userAgent: context?.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {
        authMethod: this.extractAuthMethod(credentials),
        userEmail: user.email,
      },
      metadata: {
        previousLogin: user.lastLoginAt,
      },
    };

    await this.auditService.log(auditEvent);

    // Reset failed attempts on success
    const identifier = this.getIdentifier(context);
    if (identifier) {
      this.failedAttempts.delete(identifier);
    }
  }
  /**
   * Log authentication failure event
   */
  async logAuthenticationFailure(
    credentials: IAuthenticationCredentials,
    reason: string,
    context?: IAuthenticationContext
  ): Promise<void> {
    const identifier = this.getIdentifier(context);
    const failedCount = this.incrementFailedAttempts(identifier);

    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId: null,
      sessionId: null,
      action: "authenticate",
      resource: "authentication",
      outcome: "failure",
      ipAddress: context?.ipAddress || "unknown",
      userAgent: context?.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {
        authMethod: this.extractAuthMethod(credentials),
        failureReason: reason,
        failedAttempts: failedCount,
        identifier: credentials.identifier,
      },
      metadata: {},
    };

    await this.auditService.log(auditEvent);

    // Mark IP as suspicious if too many failures
    if (failedCount >= this.MAX_FAILED_ATTEMPTS && context?.ipAddress) {
      this.suspiciousIPs.add(context.ipAddress);
    }
  }

  /**
   * Log logout event
   */
  async logLogout(
    userId: EntityId,
    sessionId?: string,
    context?: IAuthenticationContext
  ): Promise<void> {
    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId,
      sessionId: sessionId ? createSessionId(sessionId) : null,
      action: "logout",
      resource: "authentication",
      outcome: "success",
      ipAddress: context?.ipAddress || "unknown",
      userAgent: context?.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {},
      metadata: {},
    };

    await this.auditService.log(auditEvent);
  }

  /**
   * Log password change event
   */
  async logPasswordChange(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<void> {
    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId,
      sessionId: context?.session?.id
        ? createSessionId(context.session.id)
        : null,
      action: "password_change",
      resource: "user_account",
      outcome: "success",
      ipAddress: context?.ipAddress || "unknown",
      userAgent: context?.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {},
      metadata: {},
    };

    await this.auditService.log(auditEvent);
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(
    description: string,
    userId?: EntityId,
    context?: IAuthenticationContext,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId: userId || null,
      sessionId: context?.session?.id
        ? createSessionId(context.session.id)
        : null,
      action: "suspicious_activity",
      resource: "security",
      outcome: "failure",
      ipAddress: context?.ipAddress || "unknown",
      userAgent: context?.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {
        description,
        additionalData: additionalData || {},
      },
      metadata: {},
    };

    await this.auditService.log(auditEvent);

    // Mark IP as suspicious
    if (context?.ipAddress) {
      this.suspiciousIPs.add(context.ipAddress);
    }
  }

  /**
   * Assess threat level for authentication attempt
   */
  async assessThreat(
    credentials: IAuthenticationCredentials,
    context?: IAuthenticationContext
  ): Promise<IThreatAssessment> {
    const indicators: string[] = [];
    let threatScore = 0;

    // Check cached threat score
    const identifier = this.getIdentifier(context);
    const cachedScore = this.getCachedThreatScore(identifier);
    if (cachedScore !== null) {
      threatScore = Math.max(threatScore, cachedScore);
      indicators.push("Cached threat score applied");
    }

    // Check failed attempts
    const failedAttempts = this.failedAttempts.get(identifier || "") || 0;
    if (failedAttempts > 0) {
      threatScore += Math.min(failedAttempts * 15, 60);
      indicators.push(`${failedAttempts} recent failed attempts`);
    }

    // Check suspicious IP
    if (context?.ipAddress && this.suspiciousIPs.has(context.ipAddress)) {
      threatScore += 40;
      indicators.push("IP marked as suspicious");
    }

    // Check credential patterns
    if (this.isWeakCredentialPattern(credentials)) {
      threatScore += 20;
      indicators.push("Weak credential pattern detected");
    }

    // Check time-based anomalies
    if (this.isUnusualTimeAccess(context)) {
      threatScore += 15;
      indicators.push("Unusual access time");
    }

    // Cache the threat score
    if (identifier) {
      this.cacheThreatScore(identifier, threatScore);
    }

    const riskLevel = this.calculateRiskLevel(threatScore);
    const recommendedActions = this.getRecommendedActions(
      threatScore,
      indicators
    );
    const blockedAction = threatScore >= this.CRITICAL_RISK_THRESHOLD;

    return {
      threatScore: Math.min(threatScore, 100),
      riskLevel,
      indicators,
      recommendedActions,
      blockedAction,
    };
  }

  /**
   * Get security metrics for time period
   */
  async getSecurityMetrics(
    startTime: string,
    endTime: string,
    _userId?: EntityId
  ): Promise<ISecurityMetrics> {
    // Implementation would query audit service for events in time range
    // For now, providing basic structure with placeholder data
    const eventsByType: Record<SecurityEventType, number> = {
      [SecurityEventType.LOGIN_SUCCESS]: 0,
      [SecurityEventType.LOGIN_FAILURE]: 0,
      [SecurityEventType.LOGOUT]: 0,
      [SecurityEventType.PASSWORD_CHANGE]: 0,
      [SecurityEventType.ACCOUNT_LOCKED]: 0,
      [SecurityEventType.SUSPICIOUS_ACTIVITY]: 0,
      [SecurityEventType.RATE_LIMIT_EXCEEDED]: 0,
      [SecurityEventType.INVALID_CREDENTIALS]: 0,
      [SecurityEventType.SESSION_EXPIRED]: 0,
      [SecurityEventType.UNAUTHORIZED_ACCESS]: 0,
    };

    const eventsByRisk: Record<RiskLevel, number> = {
      [RiskLevel.LOW]: 0,
      [RiskLevel.MEDIUM]: 0,
      [RiskLevel.HIGH]: 0,
      [RiskLevel.CRITICAL]: 0,
    };

    return {
      totalEvents: 0,
      eventsByType,
      eventsByRisk,
      suspiciousActivitiesCount: this.suspiciousIPs.size,
      blockedAttemptsCount: 0,
      timeRange: { start: startTime, end: endTime },
    };
  }

  /**
   * Check if user/IP should be blocked due to suspicious activity
   */
  async shouldBlockAccess(
    identifier: string,
    context?: IAuthenticationContext
  ): Promise<boolean> {
    // Check failed attempts threshold
    const failedAttempts = this.failedAttempts.get(identifier) || 0;
    if (failedAttempts >= this.MAX_FAILED_ATTEMPTS) {
      return true;
    }

    // Check suspicious IP list
    if (context?.ipAddress && this.suspiciousIPs.has(context.ipAddress)) {
      return true;
    }

    // Check threat assessment - create a more specific credentials object
    const mockCredentials: IAuthenticationCredentials = {
      type: "email",
      identifier,
      password: "",
    };

    const threatAssessment = await this.assessThreat(mockCredentials, context);

    return threatAssessment.blockedAction;
  }

  /**
   * Record a generic security event
   */
  async recordSecurityEvent(event: ISecurityAuditEvent): Promise<void> {
    // Convert security audit event to standard audit event
    const auditEvent: IAuditEvent = {
      id: this.generateEventId() as EntityId,
      userId: event.userId || null,
      sessionId: event.sessionId ? createSessionId(event.sessionId) : null,
      action: event.eventType,
      resource: "security",
      outcome: event.riskLevel === RiskLevel.CRITICAL ? "failure" : "success",
      ipAddress: event.ipAddress || "unknown",
      userAgent: event.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {
        eventType: event.eventType,
        riskLevel: event.riskLevel,
        message: event.message,
        additionalData: event.additionalData,
      },
      metadata: {},
    };

    await this.auditService.log(auditEvent);
  }

  // Private helper methods

  private generateEventId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractAuthMethod(credentials: IAuthenticationCredentials): string {
    if ("email" in credentials && "password" in credentials) return "password";
    if ("apiKey" in credentials) return "api_key";
    if ("token" in credentials) return "jwt";
    return "unknown";
  }

  private getIdentifier(context?: IAuthenticationContext): string {
    return context?.ipAddress || "unknown";
  }

  private incrementFailedAttempts(identifier?: string): number {
    if (!identifier) return 1;

    const current = this.failedAttempts.get(identifier) || 0;
    const updated = current + 1;
    this.failedAttempts.set(identifier, updated);
    return updated;
  }

  private getCachedThreatScore(identifier?: string): number | null {
    if (!identifier) return null;

    const cached = this.threatScoreCache.get(identifier);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.THREAT_SCORE_CACHE_TTL) {
      this.threatScoreCache.delete(identifier);
      return null;
    }

    return cached.score;
  }

  private cacheThreatScore(identifier: string, score: number): void {
    this.threatScoreCache.set(identifier, {
      score,
      timestamp: Date.now(),
    });
  }

  private isWeakCredentialPattern(
    credentials: IAuthenticationCredentials
  ): boolean {
    const credentialString = JSON.stringify(credentials).toLowerCase();
    const weakPatterns = ["password", "123456", "admin", "test", "default"];

    return weakPatterns.some((pattern) => credentialString.includes(pattern));
  }

  private isUnusualTimeAccess(_context?: IAuthenticationContext): boolean {
    const now = new Date();
    const hour = now.getHours();

    // Consider 2 AM - 6 AM as unusual hours
    return hour >= 2 && hour <= 6;
  }
  private calculateRiskLevel(threatScore: number): RiskLevel {
    if (threatScore >= this.CRITICAL_RISK_THRESHOLD) return RiskLevel.CRITICAL;
    if (threatScore >= this.HIGH_RISK_THRESHOLD) return RiskLevel.HIGH;
    if (threatScore >= 30) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private getRecommendedActions(
    threatScore: number,
    indicators: string[]
  ): ReadonlyArray<string> {
    const actions: string[] = [];

    if (threatScore >= this.CRITICAL_RISK_THRESHOLD) {
      actions.push("Block access immediately");
      actions.push("Trigger security alert");
      actions.push("Require additional verification");
    } else if (threatScore >= this.HIGH_RISK_THRESHOLD) {
      actions.push("Require MFA");
      actions.push("Increase monitoring");
      actions.push("Log detailed audit trail");
    } else if (threatScore >= 30) {
      actions.push("Log security event");
      actions.push("Monitor for patterns");
    }

    if (indicators.some((i) => i.includes("failed attempts"))) {
      actions.push("Implement progressive delays");
    }

    if (indicators.some((i) => i.includes("suspicious"))) {
      actions.push("Review IP reputation");
    }

    return actions;
  }
}
