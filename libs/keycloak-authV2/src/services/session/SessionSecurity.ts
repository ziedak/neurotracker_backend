/**
 * SessionSecurity - Single Responsibility: Security enforcement and monitoring
 *
 * Handles:
 * - Concurrent session limits enforcement
 * - Advanced fingerprinting and device tracking
 * - Security policy enforcement
 * - Threat detection and response
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles security enforcement and monitoring
 * - Open/Closed: Extensible for different security policies
 * - Liskov Substitution: Implements standard security interface
 * - Interface Segregation: Clean separation of security concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService, UserSession } from "@libs/database";
import type { SecurityCheckResult, HealthCheckResult } from "./sessionTypes";

/**
 * Security configuration
 */
export interface SessionSecurityConfig {
  readonly maxConcurrentSessions: number;
  readonly deviceTrackingEnabled: boolean;
  readonly strictDeviceValidation: boolean;
  readonly suspiciousActivityThreshold: number;
  readonly blockSuspiciousUsers: boolean;
  readonly geoLocationTracking: boolean;
  readonly failedLoginThreshold: number;
  readonly lockoutDuration: number; // in milliseconds
  readonly rateLimitWindow: number; // in milliseconds
  readonly maxRequestsPerWindow: number;
}

const DEFAULT_SECURITY_CONFIG: SessionSecurityConfig = {
  maxConcurrentSessions: 5,
  deviceTrackingEnabled: true,
  strictDeviceValidation: false,
  suspiciousActivityThreshold: 10,
  blockSuspiciousUsers: true,
  geoLocationTracking: false,
  failedLoginThreshold: 5,
  lockoutDuration: 15 * 60 * 1000, // 15 minutes
  rateLimitWindow: 15 * 60 * 1000, // 15 minutes
  maxRequestsPerWindow: 100,
};

/**
 * Device fingerprint components
 */
interface DeviceFingerprint {
  browserFingerprint: string;
  screenFingerprint: string;
  timezoneFingerprint: string;
  languageFingerprint: string;
  platformFingerprint: string;
  hardwareFingerprint: string;
  networkFingerprint: string;
}

/**
 * Security event types
 */
export enum SecurityEventType {
  CONCURRENT_LIMIT_EXCEEDED = "concurrent_limit_exceeded",
  DEVICE_MISMATCH = "device_mismatch",
  SUSPICIOUS_LOGIN = "suspicious_login",
  RATE_LIMIT_EXCEEDED = "rate_limit_exceeded",
  GEO_ANOMALY = "geo_anomaly",
  TOKEN_THEFT_SUSPECTED = "token_theft_suspected",
  BRUTE_FORCE_DETECTED = "brute_force_detected",
  SESSION_HIJACK_DETECTED = "session_hijack_detected",
}

/**
 * Security violation record
 */
interface SecurityViolation {
  type: SecurityEventType;
  sessionId?: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, any>;
  resolved: boolean;
}

/**
 * Device information
 */
interface DeviceInfo {
  id: string;
  fingerprint: DeviceFingerprint;
  firstSeen: Date;
  lastSeen: Date;
  sessionCount: number;
  trusted: boolean;
  blocked: boolean;
}

/**
 * User security profile
 */
interface UserSecurityProfile {
  userId: string;
  activeSessions: number;
  devices: Map<string, DeviceInfo>;
  violations: SecurityViolation[];
  lastSecurityCheck: Date;
  riskScore: number; // 0-100
  blocked: boolean;
  lockoutUntil?: Date;
}

/**
 * Comprehensive security enforcement and monitoring
 */
export class SessionSecurity {
  private readonly logger: ILogger;
  private readonly config: SessionSecurityConfig;
  private readonly userProfiles = new Map<string, UserSecurityProfile>();
  private readonly deviceRegistry = new Map<string, DeviceInfo>();
  private readonly recentViolations = new Map<string, SecurityViolation[]>();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionSecurityConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionSecurity");
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };

    this.logger.info("SessionSecurity initialized", {
      maxConcurrentSessions: this.config.maxConcurrentSessions,
      deviceTrackingEnabled: this.config.deviceTrackingEnabled,
      suspiciousActivityThreshold: this.config.suspiciousActivityThreshold,
    });

    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Enforce concurrent session limits
   */
  async enforceConcurrentSessionLimits(
    userId: string,
    newSessionId: string,
    activeSessions: UserSession[]
  ): Promise<{
    allowed: boolean;
    sessionsToTerminate: string[];
    reason?: string;
  }> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Enforcing concurrent session limits", {
        operationId,
        userId,
        newSessionId: this.hashSessionId(newSessionId),
        currentSessionCount: activeSessions.length,
        maxAllowed: this.config.maxConcurrentSessions,
      });

      const profile = this.getUserSecurityProfile(userId);

      // Check if user is currently blocked
      if (profile.blocked) {
        this.recordSecurityViolation({
          type: SecurityEventType.CONCURRENT_LIMIT_EXCEEDED,
          userId,
          ipAddress: "",
          userAgent: "",
          timestamp: new Date(),
          severity: "high",
          details: {
            reason: "user_blocked",
            sessionCount: activeSessions.length,
          },
          resolved: false,
        });

        return {
          allowed: false,
          sessionsToTerminate: [],
          reason: "User is currently blocked due to security violations",
        };
      }

      // Check lockout status
      if (profile.lockoutUntil && profile.lockoutUntil > new Date()) {
        return {
          allowed: false,
          sessionsToTerminate: [],
          reason: `User is locked out until ${profile.lockoutUntil.toISOString()}`,
        };
      }

      // If within limits, allow the session
      if (activeSessions.length < this.config.maxConcurrentSessions) {
        profile.activeSessions = activeSessions.length + 1;
        profile.lastSecurityCheck = new Date();

        this.metrics?.recordTimer(
          "session.security.concurrent_check.duration",
          performance.now() - startTime
        );

        return {
          allowed: true,
          sessionsToTerminate: [],
        };
      }

      // Determine which sessions to terminate
      const sessionsToTerminate =
        this.selectSessionsToTerminate(activeSessions);

      // Record security event
      this.recordSecurityViolation({
        type: SecurityEventType.CONCURRENT_LIMIT_EXCEEDED,
        sessionId: newSessionId,
        userId,
        ipAddress: "",
        userAgent: "",
        timestamp: new Date(),
        severity: "medium",
        details: {
          requestedSessions: activeSessions.length + 1,
          maxAllowed: this.config.maxConcurrentSessions,
          terminatedSessions: sessionsToTerminate.length,
        },
        resolved: false,
      });

      profile.activeSessions = this.config.maxConcurrentSessions;
      profile.riskScore = Math.min(profile.riskScore + 10, 100);

      this.metrics?.recordCounter(
        "session.security.concurrent_limit_enforced",
        1
      );
      this.metrics?.recordTimer(
        "session.security.concurrent_check.duration",
        performance.now() - startTime
      );

      this.logger.info("Concurrent session limit enforced", {
        operationId,
        userId,
        terminatedSessions: sessionsToTerminate.length,
        duration: performance.now() - startTime,
      });

      return {
        allowed: true,
        sessionsToTerminate,
        reason: `Exceeded concurrent session limit (${this.config.maxConcurrentSessions})`,
      };
    } catch (error) {
      this.logger.error("Failed to enforce concurrent session limits", {
        operationId,
        error,
        userId,
      });
      this.metrics?.recordCounter("session.security.concurrent_check.error", 1);
      return {
        allowed: false,
        sessionsToTerminate: [],
        reason: "Security check failed",
      };
    }
  }

  /**
   * Generate and validate device fingerprint
   */
  async validateDeviceFingerprint(
    sessionData: UserSession,
    requestContext: {
      ipAddress: string;
      userAgent: string;
      acceptLanguage?: string;
      acceptEncoding?: string;
      headers?: Record<string, string>;
    }
  ): Promise<SecurityCheckResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      if (!this.config.deviceTrackingEnabled) {
        return {
          isValid: true,
          message: "Device tracking disabled",
          shouldTerminate: false,
        };
      }

      this.logger.debug("Validating device fingerprint", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId: sessionData.userId,
      });

      // Generate device fingerprint
      const currentFingerprint = this.generateDeviceFingerprint(requestContext);
      const deviceId = this.generateDeviceId(currentFingerprint);

      // Get or create device info
      let deviceInfo = this.deviceRegistry.get(deviceId);
      if (!deviceInfo) {
        deviceInfo = {
          id: deviceId,
          fingerprint: currentFingerprint,
          firstSeen: new Date(),
          lastSeen: new Date(),
          sessionCount: 1,
          trusted: false,
          blocked: false,
        };
        this.deviceRegistry.set(deviceId, deviceInfo);

        this.logger.info("New device registered", {
          operationId,
          deviceId: this.hashDeviceId(deviceId),
          userId: sessionData.userId,
        });
      } else {
        deviceInfo.lastSeen = new Date();
        deviceInfo.sessionCount++;

        // Check for device anomalies in strict mode
        if (this.config.strictDeviceValidation) {
          const fingerprintMatch = this.compareFingerprints(
            deviceInfo.fingerprint,
            currentFingerprint
          );

          if (!fingerprintMatch.isMatch) {
            this.recordSecurityViolation({
              type: SecurityEventType.DEVICE_MISMATCH,
              sessionId: sessionData.id,
              userId: sessionData.userId,
              ipAddress: requestContext.ipAddress,
              userAgent: requestContext.userAgent,
              timestamp: new Date(),
              severity: "medium",
              details: {
                deviceId: this.hashDeviceId(deviceId),
                mismatchedComponents: fingerprintMatch.mismatchedComponents,
              },
              resolved: false,
            });

            if (!deviceInfo.trusted) {
              return {
                isValid: false,
                reason: SecurityEventType.DEVICE_MISMATCH,
                message: "Device fingerprint mismatch detected",
                shouldTerminate: true,
              };
            }
          }
        }
      }

      // Check if device is blocked
      if (deviceInfo.blocked) {
        return {
          isValid: false,
          reason: SecurityEventType.DEVICE_MISMATCH,
          message: "Device is blocked",
          shouldTerminate: true,
        };
      }

      // Update user profile with device info
      const profile = this.getUserSecurityProfile(sessionData.userId);
      profile.devices.set(deviceId, deviceInfo);

      this.metrics?.recordTimer(
        "session.security.device_validation.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.security.device_validated", 1);

      this.logger.debug("Device fingerprint validation successful", {
        operationId,
        deviceId: this.hashDeviceId(deviceId),
        trusted: deviceInfo.trusted,
        duration: performance.now() - startTime,
      });

      return {
        isValid: true,
        message: "Device fingerprint validated",
        shouldTerminate: false,
      };
    } catch (error) {
      this.logger.error("Device fingerprint validation failed", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionData.id),
      });
      this.metrics?.recordCounter(
        "session.security.device_validation.error",
        1
      );
      return {
        isValid: false,
        reason: SecurityEventType.DEVICE_MISMATCH,
        message: "Device validation error",
        shouldTerminate: false,
      };
    }
  }

  /**
   * Detect and handle suspicious activity
   */
  async detectSuspiciousActivity(
    sessionData: UserSession,
    requestContext: {
      ipAddress: string;
      userAgent: string;
      endpoint?: string;
      method?: string;
    }
  ): Promise<SecurityCheckResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Detecting suspicious activity", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId: sessionData.userId,
      });

      const profile = this.getUserSecurityProfile(sessionData.userId);
      const suspiciousFactors: string[] = [];

      // Check rate limiting
      const rateLimitResult = await this.checkRateLimit(
        sessionData.userId,
        requestContext.ipAddress
      );

      if (!rateLimitResult.allowed) {
        suspiciousFactors.push("rate_limit_exceeded");

        this.recordSecurityViolation({
          type: SecurityEventType.RATE_LIMIT_EXCEEDED,
          sessionId: sessionData.id,
          userId: sessionData.userId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          timestamp: new Date(),
          severity: "medium",
          details: {
            requestCount: rateLimitResult.currentCount,
            windowLimit: this.config.maxRequestsPerWindow,
          },
          resolved: false,
        });
      }

      // Check for unusual access patterns
      const accessPatternResult = this.analyzeAccessPattern(
        sessionData,
        requestContext
      );

      if (accessPatternResult.suspicious) {
        suspiciousFactors.push(...accessPatternResult.reasons);
      }

      // Check geographic anomalies (if enabled)
      if (this.config.geoLocationTracking) {
        const geoResult = await this.checkGeographicAnomaly(
          sessionData.userId,
          requestContext.ipAddress
        );
        if (geoResult.anomalous) {
          suspiciousFactors.push("geographic_anomaly");
        }
      }

      // Calculate risk score increase
      let riskIncrease = 0;
      if (suspiciousFactors.length > 0) {
        riskIncrease = suspiciousFactors.length * 15;
        profile.riskScore = Math.min(profile.riskScore + riskIncrease, 100);
      }

      // Determine response based on risk score and violations
      const totalViolations = profile.violations.filter(
        (v) =>
          !v.resolved &&
          v.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length;

      const shouldBlock =
        profile.riskScore >= 80 ||
        totalViolations >= this.config.suspiciousActivityThreshold ||
        suspiciousFactors.includes("rate_limit_exceeded");

      if (shouldBlock && this.config.blockSuspiciousUsers) {
        await this.blockUser(
          sessionData.userId,
          "Suspicious activity detected"
        );

        return {
          isValid: false,
          reason: SecurityEventType.SUSPICIOUS_LOGIN,
          message: `Suspicious activity detected: ${suspiciousFactors.join(
            ", "
          )}`,
          shouldTerminate: true,
        };
      }

      this.metrics?.recordTimer(
        "session.security.suspicious_activity.duration",
        performance.now() - startTime
      );

      if (suspiciousFactors.length > 0) {
        this.metrics?.recordCounter(
          "session.security.suspicious_activity_detected",
          1,
          {
            factors: suspiciousFactors.join(","),
          }
        );

        this.logger.warn("Suspicious activity detected", {
          operationId,
          sessionId: this.hashSessionId(sessionData.id),
          userId: sessionData.userId,
          factors: suspiciousFactors,
          riskScore: profile.riskScore,
        });
      }

      this.metrics?.recordTimer(
        "session.security.suspicious_activity.duration",
        performance.now() - startTime
      );

      return {
        isValid: true,
        message:
          suspiciousFactors.length > 0
            ? `Monitoring: ${suspiciousFactors.join(", ")}`
            : "No suspicious activity detected",
        shouldTerminate: false,
      };
    } catch (error) {
      this.logger.error("Suspicious activity detection failed", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionData.id),
      });
      this.metrics?.recordCounter(
        "session.security.suspicious_activity.error",
        1
      );
      return {
        isValid: true, // Fail open for this check
        message: "Suspicious activity check failed",
        shouldTerminate: false,
      };
    }
  }

  /**
   * Block user for security reasons
   */
  async blockUser(userId: string, reason: string): Promise<void> {
    const operationId = crypto.randomUUID();

    try {
      this.logger.warn("Blocking user for security reasons", {
        operationId,
        userId,
        reason,
      });

      const profile = this.getUserSecurityProfile(userId);
      profile.blocked = true;
      profile.lockoutUntil = new Date(Date.now() + this.config.lockoutDuration);

      // Cache the block status
      if (this.cacheService) {
        await this.cacheService.set(
          `user_blocked:${userId}`,
          { blocked: true, reason, until: profile.lockoutUntil },
          Math.floor(this.config.lockoutDuration / 1000)
        );
      }

      this.recordSecurityViolation({
        type: SecurityEventType.SUSPICIOUS_LOGIN,
        userId,
        ipAddress: "",
        userAgent: "",
        timestamp: new Date(),
        severity: "critical",
        details: { reason, lockoutDuration: this.config.lockoutDuration },
        resolved: false,
      });

      this.metrics?.recordCounter("session.security.user_blocked", 1);

      this.logger.info("User blocked successfully", {
        operationId,
        userId,
        lockoutUntil: profile.lockoutUntil.toISOString(),
      });
    } catch (error) {
      this.logger.error("Failed to block user", {
        operationId,
        error,
        userId,
        reason,
      });
    }
  }

  /**
   * Get security statistics
   */
  getSecurityStats(): {
    totalUsers: number;
    blockedUsers: number;
    registeredDevices: number;
    recentViolations: number;
    averageRiskScore: number;
  } {
    const blockedUsers = Array.from(this.userProfiles.values()).filter(
      (p) => p.blocked
    ).length;
    const totalViolations = Array.from(this.recentViolations.values())
      .flat()
      .filter(
        (v) => v.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length;

    const riskScores = Array.from(this.userProfiles.values()).map(
      (p) => p.riskScore
    );
    const averageRiskScore =
      riskScores.length > 0
        ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length
        : 0;

    return {
      totalUsers: this.userProfiles.size,
      blockedUsers,
      registeredDevices: this.deviceRegistry.size,
      recentViolations: totalViolations,
      averageRiskScore: Math.round(averageRiskScore),
    };
  }

  /**
   * Perform security health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Test device fingerprint generation
      const testFingerprint = this.generateDeviceFingerprint({
        userAgent: "Test",
        acceptLanguage: "en-US",
      });

      if (!testFingerprint.browserFingerprint) {
        throw new Error("Device fingerprint generation failed");
      }

      // Test rate limiting
      const rateLimitResult = await this.checkRateLimit(
        "test_user",
        "127.0.0.1"
      );
      if (!("allowed" in rateLimitResult)) {
        throw new Error("Rate limiting check failed");
      }

      const responseTime = performance.now() - startTime;
      const stats = this.getSecurityStats();

      return {
        status: "healthy",
        details: {
          fingerprinting: "healthy",
          rateLimiting: "healthy",
          deviceTracking: this.config.deviceTrackingEnabled
            ? "enabled"
            : "disabled",
          ...stats,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Security health check failed", { error });
      return {
        status: "unhealthy",
        details: {
          fingerprinting: "unhealthy",
          rateLimiting: "unknown",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Private helper methods
   */
  private selectSessionsToTerminate(sessions: UserSession[]): string[] {
    // Sort by last accessed time (oldest first) and select excess sessions
    const sorted = sessions.sort(
      (a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime()
    );

    const excessCount = sessions.length - this.config.maxConcurrentSessions + 1;
    return sorted.slice(0, excessCount).map((s) => s.id);
  }

  private generateDeviceFingerprint(requestContext: {
    userAgent: string;
    acceptLanguage?: string;
    acceptEncoding?: string;
    headers?: Record<string, string>;
  }): DeviceFingerprint {
    return {
      browserFingerprint: this.hashString(requestContext.userAgent),
      screenFingerprint: this.hashString(
        requestContext.headers?.["screen-resolution"] || "unknown"
      ),
      timezoneFingerprint: this.hashString(
        requestContext.headers?.["timezone"] || "unknown"
      ),
      languageFingerprint: this.hashString(
        requestContext.acceptLanguage || "unknown"
      ),
      platformFingerprint: this.hashString(
        requestContext.headers?.["platform"] || "unknown"
      ),
      hardwareFingerprint: this.hashString(
        requestContext.headers?.["hardware-concurrency"] || "unknown"
      ),
      networkFingerprint: this.hashString(
        requestContext.acceptEncoding || "unknown"
      ),
    };
  }

  private generateDeviceId(fingerprint: DeviceFingerprint): string {
    const components = [
      fingerprint.browserFingerprint,
      fingerprint.platformFingerprint,
      fingerprint.hardwareFingerprint,
    ].join("|");

    return crypto.createHash("sha256").update(components).digest("hex");
  }

  private compareFingerprints(
    stored: DeviceFingerprint,
    current: DeviceFingerprint
  ): {
    isMatch: boolean;
    mismatchedComponents: string[];
  } {
    const mismatched: string[] = [];

    if (stored.browserFingerprint !== current.browserFingerprint)
      mismatched.push("browser");
    if (stored.platformFingerprint !== current.platformFingerprint)
      mismatched.push("platform");
    if (stored.hardwareFingerprint !== current.hardwareFingerprint)
      mismatched.push("hardware");

    // Allow some minor changes
    const majorMismatch = mismatched.some((c) =>
      ["browser", "platform", "hardware"].includes(c)
    );

    return {
      isMatch: !majorMismatch,
      mismatchedComponents: mismatched,
    };
  }

  private async checkRateLimit(
    userId: string,
    ipAddress: string
  ): Promise<{
    allowed: boolean;
    currentCount: number;
    resetTime: Date;
  }> {
    const windowStart = new Date(
      Math.floor(Date.now() / this.config.rateLimitWindow) *
        this.config.rateLimitWindow
    );
    const key = `rate_limit:${userId}:${ipAddress}:${windowStart.getTime()}`;

    try {
      if (this.cacheService) {
        const result = await this.cacheService.get<{ count: number }>(key);
        const currentCount = result.data?.count || 0;
        const newCount = currentCount + 1;

        await this.cacheService.set(
          key,
          { count: newCount },
          Math.floor(this.config.rateLimitWindow / 1000)
        );

        return {
          allowed: newCount <= this.config.maxRequestsPerWindow,
          currentCount: newCount,
          resetTime: new Date(
            windowStart.getTime() + this.config.rateLimitWindow
          ),
        };
      }
    } catch (error) {
      this.logger.warn("Rate limit check failed", { error });
    }

    // Fallback: allow if cache unavailable
    return {
      allowed: true,
      currentCount: 1,
      resetTime: new Date(Date.now() + this.config.rateLimitWindow),
    };
  }

  private analyzeAccessPattern(
    sessionData: UserSession,
    requestContext: { ipAddress: string; userAgent: string }
  ): { suspicious: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // DEBUG logging
    this.logger.info("🔍 Analyzing access pattern", {
      sessionIp: sessionData.ipAddress,
      requestIp: requestContext.ipAddress,
      sessionUA: sessionData.userAgent,
      requestUA: requestContext.userAgent,
      lastAccess: sessionData.lastAccessedAt,
    });

    // Check for rapid IP changes
    if (
      sessionData.ipAddress &&
      sessionData.ipAddress !== requestContext.ipAddress
    ) {
      const timeSinceLastAccess =
        Date.now() - sessionData.lastAccessedAt.getTime();
      if (timeSinceLastAccess < 5 * 60 * 1000) {
        // 5 minutes
        reasons.push("rapid_ip_change");
      }
    }

    // Check for user agent changes
    if (
      sessionData.userAgent &&
      sessionData.userAgent !== requestContext.userAgent
    ) {
      reasons.push("user_agent_change");
    }

    return {
      suspicious: reasons.length > 0,
      reasons,
    };
  }

  private async checkGeographicAnomaly(
    _userId: string,
    _ipAddress: string
  ): Promise<{
    anomalous: boolean;
    reason?: string;
  }> {
    // Placeholder for geographic analysis
    // In a real implementation, you would use a GeoIP service
    return { anomalous: false };
  }

  private getUserSecurityProfile(userId: string): UserSecurityProfile {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, {
        userId,
        activeSessions: 0,
        devices: new Map(),
        violations: [],
        lastSecurityCheck: new Date(),
        riskScore: 0,
        blocked: false,
      });
    }
    return this.userProfiles.get(userId)!;
  }

  private recordSecurityViolation(violation: SecurityViolation): void {
    const violations = this.recentViolations.get(violation.userId) || [];
    violations.push(violation);
    this.recentViolations.set(violation.userId, violations);

    // Update user profile
    const profile = this.getUserSecurityProfile(violation.userId);
    profile.violations.push(violation);

    this.logger.warn("Security violation recorded", {
      type: violation.type,
      userId: violation.userId,
      severity: violation.severity,
      details: violation.details,
    });

    this.metrics?.recordCounter("session.security.violation", 1, {
      type: violation.type,
      severity: violation.severity,
    });
  }

  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredData();
    }, 60 * 60 * 1000); // Every hour
  }

  private cleanupExpiredData(): void {
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;

    // Cleanup expired user profiles
    for (const [_userId, profile] of this.userProfiles) {
      if (profile.lockoutUntil && profile.lockoutUntil <= now) {
        profile.blocked = false;
        delete profile.lockoutUntil;
      }

      // Remove old violations
      profile.violations = profile.violations.filter(
        (v) => now.getTime() - v.timestamp.getTime() < oneDay
      );
    }

    // Cleanup recent violations
    for (const [userId, violations] of this.recentViolations) {
      const recentViolations = violations.filter(
        (v) => now.getTime() - v.timestamp.getTime() < oneDay
      );

      if (recentViolations.length === 0) {
        this.recentViolations.delete(userId);
      } else {
        this.recentViolations.set(userId, recentViolations);
      }
    }
  }

  private hashString(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
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

  private hashDeviceId(deviceId: string): string {
    return (
      crypto
        .createHash("sha256")
        .update(deviceId)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.userProfiles.clear();
    this.deviceRegistry.clear();
    this.recentViolations.clear();
    this.logger.info("SessionSecurity cleanup completed");
  }
}
