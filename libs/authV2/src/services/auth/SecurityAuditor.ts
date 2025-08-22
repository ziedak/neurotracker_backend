/**
 * @fileoverview SecurityAuditor - Comprehensive security event logging and analysis
 * @module services/auth/SecurityAuditor
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 2.1 Service Architecture Refactoring
 */

import {
  IAuditService,
  IAuthenticationCredentials,
  IRegistrationData,
} from "../../contracts/services";
import {
  createTimestamp,
  EntityId,
  IAuditEvent,
  createSessionId,
} from "../../types/core";

/**
 * Security event ty  private calculateThreatLevel(riskScore: number): "low" | "medium" | "high" | "critical" {
    if (riskScore < 0.3) return "low";
    if (riskScore < this.HIGH_RISK_THRESHOLD) return "medium";
    if (riskScore < this.CRITICAL_RISK_THRESHOLD) return "high";
    return "critical";
  }hensive audit logging
 */
export enum SecurityEventType {
  AUTHENTICATION_ATTEMPT = "authentication_attempt",
  AUTHENTICATION_SUCCESS = "authentication_success",
  AUTHENTICATION_FAILURE = "authentication_failure",
  REGISTRATION_ATTEMPT = "registration_attempt",
  REGISTRATION_SUCCESS = "registration_success",
  REGISTRATION_FAILURE = "registration_failure",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",
  RATE_LIMIT_EXCEEDED = "rate_limit_exceeded",
  SESSION_HIJACK_ATTEMPT = "session_hijack_attempt",
  BRUTE_FORCE_DETECTED = "brute_force_detected",
}

/**
 * Security audit event interface
 */
export interface ISecurityAuditEvent {
  readonly eventType: SecurityEventType;
  readonly operationId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly success: boolean;
  readonly metadata: Record<string, unknown>;
  readonly riskScore: number;
  readonly threatLevel: "low" | "medium" | "high" | "critical";
  readonly userId?: string;
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly errorMessage?: string;
}

/**
 * Security Auditor
 *
 * Provides comprehensive security event logging and analysis for the authentication
 * system. Handles audit trail generation, threat detection, and security metrics.
 *
 * **Responsibilities:**
 * - Log all authentication and registration attempts
 * - Track security events and suspicious activities
 * - Generate threat analysis and risk scoring
 * - Provide audit trail for compliance and forensics
 * - Integrate with enterprise audit and monitoring systems
 */
export class SecurityAuditor {
  // Configuration constants
  private readonly THREAT_SCORE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly HIGH_RISK_THRESHOLD = 0.7;
  private readonly CRITICAL_RISK_THRESHOLD = 0.9;
  private readonly SUSPICIOUS_ACTIVITY_THRESHOLD = 0.8;
  private readonly BRUTE_FORCE_WINDOW = 10 * 60 * 1000; // 10 minutes

  // State management for threat tracking
  private readonly threatScoreCache = new Map<
    string,
    { score: number; timestamp: number }
  >();
  private readonly suspiciousIPs = new Set<string>();
  private readonly failedAttempts = new Map<string, number>();
  private readonly bruteForceAttempts = new Map<
    string,
    { count: number; firstAttempt: number }
  >();

  constructor(private readonly auditService: IAuditService) {}

  /**
   * Log authentication attempt with comprehensive details
   */
  async logAuthenticationAttempt(
    credentials: IAuthenticationCredentials,
    operationId: string
  ): Promise<void> {
    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.AUTHENTICATION_ATTEMPT,
      operationId,
      timestamp: createTimestamp(),
      method: this.extractAuthMethod(credentials),
      success: false, // Will be updated on success
      metadata: {
        hasEmail: "email" in credentials,
        hasUsername: "username" in credentials,
        hasPassword: "password" in credentials,
        hasToken: "token" in credentials,
        hasApiKey: "apiKey" in credentials,
      },
      riskScore: this.calculateInitialRiskScore(credentials),
      threatLevel: "low",
    };

    const auditEvent: IAuditEvent = {
      id: operationId as EntityId,
      userId: null,
      sessionId: null,
      action: "attempt",
      resource: "authentication",
      outcome: event.success ? "success" : "failure",
      ipAddress: "unknown",
      userAgent: "unknown",
      timestamp: createTimestamp(),
      details: event.metadata,
      metadata: {},
    };

    await this.auditService.log(auditEvent);
  }

  /**
   * Log successful authentication
   */
  async logAuthenticationSuccess(
    credentials: IAuthenticationCredentials,
    operationId: string,
    method: string,
    userId?: string,
    sessionId?: string
  ): Promise<void> {
    const identifier = this.extractCredentialIdentifier(credentials);

    // Reset failed attempts on successful authentication
    this.resetFailedAttempts(identifier);

    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.AUTHENTICATION_SUCCESS,
      operationId,
      timestamp: createTimestamp(),
      ...(userId && { userId }),
      ...(sessionId && { sessionId }),
      method,
      success: true,
      metadata: {
        authenticationMethod: method,
        credentialType: this.extractCredentialType(credentials),
        wasMarkedSuspicious: this.isSuspiciousIdentifier(identifier),
      },
      riskScore: this.calculateSuccessRiskScore(credentials, method),
      threatLevel: "low",
    };

    await this.logSecurityEventToAudit(event);
  }

  /**
   * Convert and log security event to audit service
   */
  private async logSecurityEventToAudit(
    event: ISecurityAuditEvent
  ): Promise<void> {
    const auditEvent: IAuditEvent = {
      id: event.operationId as EntityId,
      userId: event.userId ? (event.userId as EntityId) : null,
      sessionId: event.sessionId ? createSessionId(event.sessionId) : null,
      action: event.eventType,
      resource: "security",
      outcome: event.success ? "success" : "failure",
      ipAddress: event.ipAddress || "unknown",
      userAgent: event.userAgent || "unknown",
      timestamp: createTimestamp(),
      details: {
        method: event.method,
        riskScore: event.riskScore,
        threatLevel: event.threatLevel,
        errorMessage: event.errorMessage,
        ...event.metadata,
      },
      metadata: {},
    };

    await this.auditService.log(auditEvent);
  }

  /**
   * Log failed authentication with error analysis
   */
  async logAuthenticationFailure(
    credentials: IAuthenticationCredentials,
    operationId: string,
    error: Error
  ): Promise<void> {
    const riskScore = this.calculateFailureRiskScore(error);
    const identifier = this.extractCredentialIdentifier(credentials);
    const failedCount = this.incrementFailedAttempts(identifier);

    // Check for brute force patterns
    const isBruteForce = this.detectBruteForcePattern(identifier, error);

    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.AUTHENTICATION_FAILURE,
      operationId,
      timestamp: createTimestamp(),
      method: this.extractAuthMethod(credentials),
      success: false,
      errorMessage: error.message,
      metadata: {
        errorType: error.constructor.name,
        credentialType: this.extractCredentialType(credentials),
        potentialBruteForce: isBruteForce,
        failedAttempts: failedCount,
        suspiciousActivity: this.detectSuspiciousActivity(credentials, error),
      },
      riskScore,
      threatLevel: this.calculateThreatLevel(riskScore),
    };

    await this.logSecurityEventToAudit(event);

    // Mark IP as suspicious if too many failures
    if (failedCount >= this.MAX_FAILED_ATTEMPTS) {
      await this.handleSuspiciousActivity(
        identifier,
        "excessive_failed_attempts",
        {
          attempts: failedCount,
          credentialType: this.extractCredentialType(credentials),
        }
      );
    }
  }

  /**
   * Log registration attempt
   */
  async logRegistrationAttempt(
    registrationData: IRegistrationData,
    operationId: string
  ): Promise<void> {
    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.REGISTRATION_ATTEMPT,
      operationId,
      timestamp: createTimestamp(),
      method: "registration",
      success: false,
      metadata: {
        hasEmail: !!registrationData.email,
        hasUsername: !!registrationData.username,
        hasPassword: !!registrationData.password,
        hasPersonalInfo: !!(
          registrationData.firstName || registrationData.lastName
        ),
      },
      riskScore: this.calculateRegistrationRiskScore(registrationData),
      threatLevel: "low",
    };

    await this.logSecurityEventToAudit(event);
  }

  /**
   * Log successful registration
   */
  async logRegistrationSuccess(
    registrationData: IRegistrationData,
    operationId: string,
    userId?: string
  ): Promise<void> {
    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.REGISTRATION_SUCCESS,
      operationId,
      timestamp: createTimestamp(),
      ...(userId && { userId }),
      method: "registration",
      success: true,
      metadata: {
        email: registrationData.email,
        username: registrationData.username,
      },
      riskScore: 0.1, // Low risk for successful registration
      threatLevel: "low",
    };

    await this.logSecurityEventToAudit(event);
  }

  /**
   * Log failed registration
   */
  async logRegistrationFailure(
    registrationData: IRegistrationData,
    operationId: string,
    error: Error
  ): Promise<void> {
    const riskScore = this.calculateRegistrationFailureRiskScore(error);

    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.REGISTRATION_FAILURE,
      operationId,
      timestamp: createTimestamp(),
      method: "registration",
      success: false,
      errorMessage: error.message,
      metadata: {
        errorType: error.constructor.name,
        email: registrationData.email,
        username: registrationData.username,
      },
      riskScore,
      threatLevel: this.calculateThreatLevel(riskScore),
    };

    await this.logSecurityEventToAudit(event);
  }

  /**
   * Log suspicious activity detection
   */
  async logSuspiciousActivity(
    operationId: string,
    activityType: string,
    metadata: Record<string, unknown>,
    riskScore: number = this.SUSPICIOUS_ACTIVITY_THRESHOLD
  ): Promise<void> {
    const event: ISecurityAuditEvent = {
      eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
      operationId,
      timestamp: createTimestamp(),
      method: activityType,
      success: false,
      metadata: {
        activityType,
        ...metadata,
      },
      riskScore,
      threatLevel: this.calculateThreatLevel(riskScore),
    };

    await this.logSecurityEventToAudit(event);
  }

  /**
   * Private helper methods for risk analysis
   */
  private extractAuthMethod(credentials: IAuthenticationCredentials): string {
    if ("email" in credentials && "password" in credentials) {
      return "password";
    }
    if ("token" in credentials) {
      return "jwt";
    }
    if ("apiKey" in credentials) {
      return "apikey";
    }
    return "unknown";
  }

  private extractCredentialType(
    credentials: IAuthenticationCredentials
  ): string {
    const types: string[] = [];
    if ("email" in credentials) types.push("email");
    if ("username" in credentials) types.push("username");
    if ("password" in credentials) types.push("password");
    if ("token" in credentials) types.push("token");
    if ("apiKey" in credentials) types.push("apiKey");
    return types.join(",");
  }

  private calculateInitialRiskScore(
    credentials: IAuthenticationCredentials
  ): number {
    let riskScore = 0.1; // Base risk

    // Unknown authentication method increases risk
    if (this.extractAuthMethod(credentials) === "unknown") {
      riskScore += 0.3;
    }

    // Missing expected fields increases risk
    if ("email" in credentials && !credentials.email) {
      riskScore += 0.2;
    }

    return Math.min(riskScore, 1.0);
  }

  private calculateSuccessRiskScore(
    credentials: IAuthenticationCredentials,
    method: string
  ): number {
    const identifier = this.extractCredentialIdentifier(credentials);

    // Check cached threat score first
    const cachedScore = this.getCachedThreatScore(identifier);
    if (cachedScore !== null && cachedScore < 0.2) {
      return cachedScore;
    }

    // Successful authentication has low risk
    let riskScore = 0.05;

    // API key authentication has slightly higher monitoring
    if (method === "apikey") {
      riskScore += 0.05;
    }

    // Check for weak credential patterns
    if (this.isWeakCredentialPattern(credentials)) {
      riskScore += 0.1;
    }

    // Check for unusual time access
    if (this.isUnusualTimeAccess()) {
      riskScore += 0.05;
    }

    // Check if previously marked as suspicious
    if (this.isSuspiciousIdentifier(identifier)) {
      riskScore += 0.1;
    }

    // Cache the score
    this.cacheThreatScore(identifier, riskScore);

    return riskScore;
  }

  private calculateFailureRiskScore(error: Error): number {
    let riskScore = 0.3; // Base failure risk

    // Specific error patterns indicate higher risk
    if (error.message.includes("brute") || error.message.includes("too many")) {
      riskScore += 0.4;
    }

    if (
      error.message.includes("invalid") ||
      error.message.includes("not found")
    ) {
      riskScore += 0.2;
    }

    if (
      error.message.includes("expired") ||
      error.message.includes("timeout")
    ) {
      riskScore += 0.1;
    }

    return Math.min(riskScore, 1.0);
  }

  private calculateRegistrationRiskScore(
    registrationData: IRegistrationData
  ): number {
    let riskScore = 0.2; // Base registration risk

    // Suspicious patterns
    if (registrationData.email && registrationData.email.includes("temp")) {
      riskScore += 0.3;
    }

    if (registrationData.username && registrationData.username.length < 3) {
      riskScore += 0.2;
    }

    return Math.min(riskScore, 1.0);
  }

  private calculateRegistrationFailureRiskScore(error: Error): number {
    let riskScore = 0.4; // Higher risk for failed registration

    if (
      error.message.includes("already exists") ||
      error.message.includes("duplicate")
    ) {
      riskScore = 0.2; // Lower risk for legitimate conflicts
    }

    if (
      error.message.includes("validation") ||
      error.message.includes("invalid")
    ) {
      riskScore += 0.3;
    }

    return Math.min(riskScore, 1.0);
  }

  private calculateThreatLevel(
    riskScore: number
  ): "low" | "medium" | "high" | "critical" {
    if (riskScore < 0.3) return "low";
    if (riskScore < this.HIGH_RISK_THRESHOLD) return "medium";
    if (riskScore < this.CRITICAL_RISK_THRESHOLD) return "high";
    return "critical";
  }

  private detectSuspiciousActivity(
    credentials: IAuthenticationCredentials,
    error: Error
  ): boolean {
    // Detect patterns that might indicate suspicious activity
    const suspiciousPatterns = [
      "injection",
      "script",
      "eval",
      "javascript",
      "<",
      ">",
      "union",
      "select",
    ];

    const credentialString = JSON.stringify(credentials).toLowerCase();
    const errorString = error.message.toLowerCase();

    return suspiciousPatterns.some(
      (pattern) =>
        credentialString.includes(pattern) || errorString.includes(pattern)
    );
  }

  /**
   * Extract credential identifier for tracking
   */
  private extractCredentialIdentifier(
    credentials: IAuthenticationCredentials
  ): string {
    return credentials.identifier || "unknown";
  }

  /**
   * Increment failed attempts counter
   */
  private incrementFailedAttempts(identifier: string): number {
    const current = this.failedAttempts.get(identifier) || 0;
    const newCount = current + 1;
    this.failedAttempts.set(identifier, newCount);
    return newCount;
  }

  /**
   * Enhanced brute force detection with time windows
   */
  private detectBruteForcePattern(identifier: string, error: Error): boolean {
    const now = Date.now();
    const attempts = this.bruteForceAttempts.get(identifier);

    if (!attempts) {
      this.bruteForceAttempts.set(identifier, { count: 1, firstAttempt: now });
      return false;
    }

    // Check if within time window
    if (now - attempts.firstAttempt > this.BRUTE_FORCE_WINDOW) {
      // Reset counter for new window
      this.bruteForceAttempts.set(identifier, { count: 1, firstAttempt: now });
      return false;
    }

    attempts.count++;
    const isBruteForce = attempts.count >= this.MAX_FAILED_ATTEMPTS;

    // Also check error message patterns
    const hasErrorPattern =
      error.message.includes("too many attempts") ||
      error.message.includes("rate limit") ||
      error.message.includes("brute force");

    return isBruteForce || hasErrorPattern;
  }

  /**
   * Handle suspicious activity with enhanced tracking
   */
  private async handleSuspiciousActivity(
    identifier: string,
    activityType: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    // Mark as suspicious
    this.suspiciousIPs.add(identifier);

    // Log the suspicious activity
    await this.logSuspiciousActivity(
      `suspicious_${Date.now()}`,
      activityType,
      {
        ...metadata,
        identifier,
        detectedAt: createTimestamp(),
      },
      this.SUSPICIOUS_ACTIVITY_THRESHOLD
    );
  }

  /**
   * Reset failed attempts on successful authentication
   */
  private resetFailedAttempts(identifier: string): void {
    this.failedAttempts.delete(identifier);
    this.bruteForceAttempts.delete(identifier);
  }

  /**
   * Check if identifier is marked as suspicious
   */
  private isSuspiciousIdentifier(identifier: string): boolean {
    return this.suspiciousIPs.has(identifier);
  }

  /**
   * Cache threat score for performance optimization
   */
  private cacheThreatScore(identifier: string, score: number): void {
    this.threatScoreCache.set(identifier, {
      score,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached threat score if valid
   */
  private getCachedThreatScore(identifier: string): number | null {
    const cached = this.threatScoreCache.get(identifier);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.THREAT_SCORE_CACHE_TTL) {
      this.threatScoreCache.delete(identifier);
      return null;
    }

    return cached.score;
  }

  /**
   * Enhanced pattern-based weak credential detection
   */
  private isWeakCredentialPattern(
    credentials: IAuthenticationCredentials
  ): boolean {
    const credentialString = JSON.stringify(credentials).toLowerCase();
    const weakPatterns = [
      "password",
      "123456",
      "admin",
      "test",
      "default",
      "guest",
      "root",
      "user",
      "qwerty",
      "abc123",
    ];

    return weakPatterns.some((pattern) => credentialString.includes(pattern));
  }

  /**
   * Time-based risk assessment
   */
  private isUnusualTimeAccess(): boolean {
    const now = new Date();
    const hour = now.getHours();

    // Consider 2 AM - 6 AM as unusual hours for business systems
    return hour >= 2 && hour <= 6;
  }
}
