/**
 * SessionValidator - Single Responsibility: Session validation and security
 *
 * Handles:
 * - Session expiration validation
 * - Security checks and fingerprinting
 * - Session rotation logic
 * - Validation rule enforcement
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles session validation and security
 * - Open/Closed: Extensible for different validation rules
 * - Liskov Substitution: Implements standard validation interface
 * - Interface Segregation: Clean separation of validation concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  KeycloakSessionData,
  SessionValidationResult,
  SecurityCheckResult,
  HealthCheckResult,
} from "./sessionTypes";

/**
 * Session validation configuration
 */
export interface SessionValidatorConfig {
  readonly sessionTimeout: number; // Max session duration (ms)
  readonly maxIdleTime: number; // Max time without activity (ms)
  readonly requireFingerprint: boolean;
  readonly allowFingerprintRotation: boolean;
  readonly maxSessionsPerUser: number;
  readonly sessionRotationInterval: number; // Force rotation after this time (ms)
  readonly strictIpValidation: boolean;
  readonly allowedIpChanges: number; // Max IP changes per session
  readonly suspiciousActivityThreshold: number;
}

const DEFAULT_VALIDATOR_CONFIG: SessionValidatorConfig = {
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  maxIdleTime: 4 * 60 * 60 * 1000, // 4 hours
  requireFingerprint: true,
  allowFingerprintRotation: false,
  maxSessionsPerUser: 5,
  sessionRotationInterval: 8 * 60 * 60 * 1000, // 8 hours
  strictIpValidation: false,
  allowedIpChanges: 3,
  suspiciousActivityThreshold: 10,
};

/**
 * Security check reasons enumeration
 */
export enum SecurityCheckReason {
  EXPIRED = "expired",
  IDLE_TIMEOUT = "idle_timeout",
  FINGERPRINT_MISMATCH = "fingerprint_mismatch",
  IP_VIOLATION = "ip_violation",
  SESSION_LIMIT_EXCEEDED = "session_limit_exceeded",
  ROTATION_REQUIRED = "rotation_required",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",
  INVALID_TOKEN = "invalid_token",
  CONCURRENT_LIMIT = "concurrent_limit",
}

/**
 * Session fingerprint components
 */
interface SessionFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  screenResolution?: string;
  timezone?: string;
  platform?: string;
}

/**
 * Activity tracking for suspicious behavior detection
 */
interface ActivityTracker {
  ipChanges: number;
  lastIpChange: Date;
  fingerprintChanges: number;
  lastFingerprintChange: Date;
  suspiciousEvents: number;
  lastSuspiciousEvent: Date;
}

/**
 * Comprehensive session validation with security enforcement
 */
export class SessionValidator {
  private readonly logger: ILogger;
  private readonly config: SessionValidatorConfig;
  private readonly activityTrackers = new Map<string, ActivityTracker>();

  constructor(
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionValidatorConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionValidator");
    this.config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };

    this.logger.info("SessionValidator initialized", {
      sessionTimeout: this.config.sessionTimeout,
      maxIdleTime: this.config.maxIdleTime,
      requireFingerprint: this.config.requireFingerprint,
      maxSessionsPerUser: this.config.maxSessionsPerUser,
    });
  }

  /**
   * Comprehensive session validation
   */
  async validateSession(
    sessionData: KeycloakSessionData,
    currentRequest?: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: SessionFingerprint;
    }
  ): Promise<SessionValidationResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Validating session", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId: sessionData.userId,
      });

      // Basic session state validation
      if (!sessionData.isActive) {
        return this.createValidationResult(false, SecurityCheckReason.EXPIRED, {
          message: "Session is marked inactive",
        });
      }

      // Expiration validation
      const expirationResult = this.validateExpiration(sessionData);
      if (!expirationResult.isValid) {
        this.metrics?.recordCounter("session.validation.expired", 1);
        return expirationResult;
      }

      // Idle timeout validation
      const idleResult = this.validateIdleTimeout(sessionData);
      if (!idleResult.isValid) {
        this.metrics?.recordCounter("session.validation.idle_timeout", 1);
        return idleResult;
      }

      // Security checks if request context is provided
      if (currentRequest) {
        const securityResult = await this.performSecurityChecks(
          sessionData,
          currentRequest
        );
        if (!securityResult.isValid) {
          this.metrics?.recordCounter("session.validation.security_failed", 1);
          return this.createValidationResult(
            false,
            SecurityCheckReason.SUSPICIOUS_ACTIVITY,
            {
              message: securityResult.message,
              shouldTerminate: securityResult.shouldTerminate,
            }
          );
        }
      }

      // Session rotation check
      const rotationResult = this.checkSessionRotation(sessionData);
      if (
        !rotationResult.isValid &&
        rotationResult.reason === SecurityCheckReason.ROTATION_REQUIRED
      ) {
        this.metrics?.recordCounter("session.validation.rotation_required", 1);
        return rotationResult;
      }

      this.metrics?.recordTimer(
        "session.validate.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.validated", 1);

      this.logger.debug("Session validation successful", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        duration: performance.now() - startTime,
      });

      return this.createValidationResult(true, undefined, {
        shouldRefreshToken: rotationResult.shouldRefreshToken,
        nextValidation: this.calculateNextValidation(sessionData),
      });
    } catch (error) {
      this.logger.error("Session validation failed", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionData.id),
      });
      this.metrics?.recordCounter("session.validation.error", 1);
      return this.createValidationResult(
        false,
        SecurityCheckReason.SUSPICIOUS_ACTIVITY,
        {
          message: "Validation error occurred",
          shouldTerminate: false,
        }
      );
    }
  }

  /**
   * Validate session expiration
   */
  private validateExpiration(
    sessionData: KeycloakSessionData
  ): SessionValidationResult {
    const now = new Date();

    // Check absolute expiration
    if (sessionData.expiresAt && sessionData.expiresAt <= now) {
      return this.createValidationResult(false, SecurityCheckReason.EXPIRED, {
        message: "Session has expired",
        expirationTime: sessionData.expiresAt,
      });
    }

    // Check session timeout (max duration since creation)
    const sessionAge = now.getTime() - sessionData.createdAt.getTime();
    if (sessionAge > this.config.sessionTimeout) {
      return this.createValidationResult(false, SecurityCheckReason.EXPIRED, {
        message: "Session exceeded maximum duration",
        sessionAge: Math.floor(sessionAge / 1000),
      });
    }

    return this.createValidationResult(true);
  }

  /**
   * Validate idle timeout
   */
  private validateIdleTimeout(
    sessionData: KeycloakSessionData
  ): SessionValidationResult {
    const now = new Date();
    const idleTime = now.getTime() - sessionData.lastAccessedAt.getTime();

    if (idleTime > this.config.maxIdleTime) {
      return this.createValidationResult(
        false,
        SecurityCheckReason.IDLE_TIMEOUT,
        {
          message: "Session exceeded idle timeout",
          idleTime: Math.floor(idleTime / 1000),
          maxIdleTime: Math.floor(this.config.maxIdleTime / 1000),
        }
      );
    }

    return this.createValidationResult(true);
  }

  /**
   * Perform comprehensive security checks
   */
  private async performSecurityChecks(
    sessionData: KeycloakSessionData,
    currentRequest: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: SessionFingerprint;
    }
  ): Promise<SecurityCheckResult> {
    const checks: Promise<SecurityCheckResult>[] = [];

    // Fingerprint validation
    if (this.config.requireFingerprint) {
      checks.push(this.validateFingerprint(sessionData, currentRequest));
    }

    // IP address validation
    if (this.config.strictIpValidation) {
      checks.push(
        this.validateIpAddress(sessionData, currentRequest.ipAddress)
      );
    }

    // User agent validation
    checks.push(this.validateUserAgent(sessionData, currentRequest.userAgent));

    // Suspicious activity detection
    checks.push(this.detectSuspiciousActivity(sessionData, currentRequest));

    // Execute all checks
    const results = await Promise.all(checks);

    // Find first failed check
    const failedCheck = results.find((result) => !result.isValid);
    if (failedCheck) {
      return failedCheck;
    }

    return {
      isValid: true,
      message: "All security checks passed",
      shouldTerminate: false,
    };
  }

  /**
   * Validate session fingerprint
   */
  private async validateFingerprint(
    sessionData: KeycloakSessionData,
    currentRequest: { fingerprint?: SessionFingerprint }
  ): Promise<SecurityCheckResult> {
    if (!sessionData.fingerprint || !currentRequest.fingerprint) {
      return {
        isValid: !this.config.requireFingerprint,
        reason: SecurityCheckReason.FINGERPRINT_MISMATCH,
        message: "Missing fingerprint data",
        shouldTerminate: this.config.requireFingerprint,
      };
    }

    const storedFingerprint = this.parseFingerprint(sessionData.fingerprint);
    const currentFingerprint = currentRequest.fingerprint;

    // Compare critical fingerprint components
    const criticalMismatch =
      storedFingerprint.userAgent !== currentFingerprint.userAgent ||
      storedFingerprint.platform !== currentFingerprint.platform;

    if (criticalMismatch) {
      this.trackSuspiciousActivity(sessionData.id, "fingerprint_mismatch");
      return {
        isValid: false,
        reason: SecurityCheckReason.FINGERPRINT_MISMATCH,
        message: "Critical fingerprint components do not match",
        shouldTerminate: !this.config.allowFingerprintRotation,
      };
    }

    // Check for minor changes (acceptable in some cases)
    const minorChanges =
      storedFingerprint.screenResolution !==
        currentFingerprint.screenResolution ||
      storedFingerprint.timezone !== currentFingerprint.timezone;

    if (minorChanges && !this.config.allowFingerprintRotation) {
      this.logger.warn("Minor fingerprint changes detected", {
        sessionId: this.hashSessionId(sessionData.id),
        changes: "non-critical components",
      });
    }

    return {
      isValid: true,
      message: "Fingerprint validation passed",
      shouldTerminate: false,
    };
  }

  /**
   * Validate IP address consistency
   */
  private async validateIpAddress(
    sessionData: KeycloakSessionData,
    currentIpAddress: string
  ): Promise<SecurityCheckResult> {
    if (!sessionData.ipAddress) {
      // First time IP recording
      return {
        isValid: true,
        message: "IP address recorded",
        shouldTerminate: false,
      };
    }

    if (sessionData.ipAddress !== currentIpAddress) {
      const tracker = this.getActivityTracker(sessionData.id);
      tracker.ipChanges++;
      tracker.lastIpChange = new Date();

      this.logger.info("IP address change detected", {
        sessionId: this.hashSessionId(sessionData.id),
        previousIp: this.hashIp(sessionData.ipAddress),
        currentIp: this.hashIp(currentIpAddress),
        totalChanges: tracker.ipChanges,
      });

      if (tracker.ipChanges > this.config.allowedIpChanges) {
        this.trackSuspiciousActivity(sessionData.id, "excessive_ip_changes");
        return {
          isValid: false,
          reason: SecurityCheckReason.IP_VIOLATION,
          message: `Too many IP address changes: ${tracker.ipChanges}`,
          shouldTerminate: true,
        };
      }
    }

    return {
      isValid: true,
      message: "IP address validation passed",
      shouldTerminate: false,
    };
  }

  /**
   * Validate user agent consistency
   */
  private async validateUserAgent(
    sessionData: KeycloakSessionData,
    currentUserAgent: string
  ): Promise<SecurityCheckResult> {
    if (!sessionData.userAgent || !currentUserAgent) {
      return {
        isValid: true,
        message: "User agent validation skipped",
        shouldTerminate: false,
      };
    }

    // Extract browser and version for comparison
    const storedBrowser = this.extractBrowserInfo(sessionData.userAgent);
    const currentBrowser = this.extractBrowserInfo(currentUserAgent);

    // Allow minor version changes but detect major changes
    if (storedBrowser.name !== currentBrowser.name) {
      this.trackSuspiciousActivity(sessionData.id, "browser_change");
      this.logger.warn("Browser change detected", {
        sessionId: this.hashSessionId(sessionData.id),
        previousBrowser: storedBrowser.name,
        currentBrowser: currentBrowser.name,
      });
    }

    return {
      isValid: true,
      message: "User agent validation passed",
      shouldTerminate: false,
    };
  }

  /**
   * Detect suspicious activity patterns
   */
  private async detectSuspiciousActivity(
    sessionData: KeycloakSessionData,
    _currentRequest: { ipAddress: string; userAgent: string }
  ): Promise<SecurityCheckResult> {
    const tracker = this.getActivityTracker(sessionData.id);
    const now = new Date();
    const recentThreshold = 5 * 60 * 1000; // 5 minutes

    // Check for rapid changes
    const recentChanges =
      (tracker.lastIpChange &&
        now.getTime() - tracker.lastIpChange.getTime() < recentThreshold) ||
      (tracker.lastFingerprintChange &&
        now.getTime() - tracker.lastFingerprintChange.getTime() <
          recentThreshold);

    if (
      recentChanges &&
      tracker.suspiciousEvents >= this.config.suspiciousActivityThreshold
    ) {
      return {
        isValid: false,
        reason: SecurityCheckReason.SUSPICIOUS_ACTIVITY,
        message: "Suspicious activity pattern detected",
        shouldTerminate: true,
      };
    }

    return {
      isValid: true,
      message: "No suspicious activity detected",
      shouldTerminate: false,
    };
  }

  /**
   * Check if session needs rotation
   */
  private checkSessionRotation(
    sessionData: KeycloakSessionData
  ): SessionValidationResult {
    const now = new Date();
    const sessionAge = now.getTime() - sessionData.createdAt.getTime();

    if (sessionAge > this.config.sessionRotationInterval) {
      return this.createValidationResult(
        false,
        SecurityCheckReason.ROTATION_REQUIRED,
        {
          message: "Session rotation required",
          shouldRefreshToken: true,
          sessionAge: Math.floor(sessionAge / 1000),
        }
      );
    }

    // Check if rotation is recommended soon
    const timeToRotation = this.config.sessionRotationInterval - sessionAge;
    const shouldRefreshToken = timeToRotation < 30 * 60 * 1000; // 30 minutes

    return this.createValidationResult(true, undefined, {
      shouldRefreshToken,
      timeToRotation: Math.floor(timeToRotation / 1000),
    });
  }

  /**
   * Generate secure fingerprint
   */
  generateFingerprint(components: SessionFingerprint): string {
    const fingerprintData = JSON.stringify({
      userAgent: components.userAgent,
      acceptLanguage: components.acceptLanguage,
      acceptEncoding: components.acceptEncoding,
      screenResolution: components.screenResolution,
      timezone: components.timezone,
      platform: components.platform,
    });

    return crypto.createHash("sha256").update(fingerprintData).digest("hex");
  }

  /**
   * Validate concurrent session limits
   */
  async validateConcurrentSessions(
    _userId: string,
    activeSessionCount: number
  ): Promise<SessionValidationResult> {
    if (activeSessionCount > this.config.maxSessionsPerUser) {
      this.metrics?.recordCounter("session.concurrent_limit_exceeded", 1);
      return this.createValidationResult(
        false,
        SecurityCheckReason.CONCURRENT_LIMIT,
        {
          message: `User has ${activeSessionCount} active sessions (max: ${this.config.maxSessionsPerUser})`,
          activeSessionCount,
          maxAllowed: this.config.maxSessionsPerUser,
        }
      );
    }

    return this.createValidationResult(true);
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalValidations: number;
    activeSessions: number;
    securityViolations: number;
    rotationsRequired: number;
  } {
    // Note: In a real implementation, these would be tracked metrics
    return {
      totalValidations: 0,
      activeSessions: this.activityTrackers.size,
      securityViolations: 0,
      rotationsRequired: 0,
    };
  }

  /**
   * Perform health check on validation systems
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Test fingerprint generation
      const testFingerprint = this.generateFingerprint({
        userAgent: "test",
        acceptLanguage: "en-US",
        acceptEncoding: "gzip",
      });

      if (!testFingerprint || testFingerprint.length !== 64) {
        throw new Error("Fingerprint generation test failed");
      }

      // Test browser info extraction
      const browserInfo = this.extractBrowserInfo(
        "Mozilla/5.0 (Test) Chrome/91.0"
      );
      if (!browserInfo.name) {
        throw new Error("Browser info extraction test failed");
      }

      const responseTime = performance.now() - startTime;

      return {
        status: "healthy",
        details: {
          fingerprinting: "healthy",
          validation: "healthy",
          activityTrackers: this.activityTrackers.size,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Session validator health check failed", { error });
      return {
        status: "unhealthy",
        details: {
          fingerprinting: "unhealthy",
          validation: "unknown",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Private helper methods
   */
  private createValidationResult(
    isValid: boolean,
    reason?: SecurityCheckReason,
    additionalData?: Record<string, any>
  ): SessionValidationResult {
    return {
      isValid,
      ...(reason !== undefined && { reason }),
      timestamp: new Date(),
      ...additionalData,
    };
  }

  private calculateNextValidation(_sessionData: KeycloakSessionData): Date {
    const now = new Date();
    const validationInterval = Math.min(
      this.config.maxIdleTime / 4, // Check 4 times during idle period
      30 * 60 * 1000 // Max 30 minutes
    );
    return new Date(now.getTime() + validationInterval);
  }

  private getActivityTracker(sessionId: string): ActivityTracker {
    if (!this.activityTrackers.has(sessionId)) {
      this.activityTrackers.set(sessionId, {
        ipChanges: 0,
        lastIpChange: new Date(0),
        fingerprintChanges: 0,
        lastFingerprintChange: new Date(0),
        suspiciousEvents: 0,
        lastSuspiciousEvent: new Date(0),
      });
    }
    return this.activityTrackers.get(sessionId)!;
  }

  private trackSuspiciousActivity(sessionId: string, activity: string): void {
    const tracker = this.getActivityTracker(sessionId);
    tracker.suspiciousEvents++;
    tracker.lastSuspiciousEvent = new Date();

    this.logger.warn("Suspicious activity tracked", {
      sessionId: this.hashSessionId(sessionId),
      activity,
      totalEvents: tracker.suspiciousEvents,
    });

    this.metrics?.recordCounter("session.suspicious_activity", 1, {
      activity,
    });
  }

  private parseFingerprint(_fingerprintHash: string): SessionFingerprint {
    // In a real implementation, you might store components separately
    // For now, return a default structure
    return {
      userAgent: "",
      acceptLanguage: "",
      acceptEncoding: "",
    };
  }

  private extractBrowserInfo(userAgent: string): {
    name: string;
    version: string;
  } {
    const patterns = [
      { name: "Chrome", pattern: /Chrome\/([0-9.]+)/ },
      { name: "Firefox", pattern: /Firefox\/([0-9.]+)/ },
      { name: "Safari", pattern: /Safari\/([0-9.]+)/ },
      { name: "Edge", pattern: /Edge\/([0-9.]+)/ },
    ];

    for (const { name, pattern } of patterns) {
      const match = userAgent.match(pattern);
      if (match && match[1]) {
        return { name, version: match[1] };
      }
    }

    return { name: "Unknown", version: "0" };
  }

  private hashSessionId(sessionId: string): string {
    return (
      crypto
        .createHash("sha256")
        .update(sessionId)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }

  private hashIp(ipAddress: string): string {
    return (
      crypto
        .createHash("sha256")
        .update(ipAddress)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.activityTrackers.clear();
    this.logger.info("SessionValidator cleanup completed");
  }
}
