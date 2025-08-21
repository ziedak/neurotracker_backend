/**
 * @fileoverview SessionServiceV2 - Enterprise session management service
 * @module services/SessionService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, SessionId, Timestamp } from "../types/core";
import { createSessionId } from "../types/core";
import type { IEnhancedSession, IServiceHealth } from "../types/enhanced";
import type {
  ISessionService,
  ISessionCreateData,
  ISessionUpdateData,
  ISessionValidationResult,
  ISessionAnalytics,
} from "../contracts/services";
import { ValidationError } from "../errors/core";
import * as crypto from "crypto";

/**
 * Session metrics for performance tracking
 */
interface ISessionMetrics {
  sessionsCreated: number;
  sessionsValidated: number;
  sessionsEnded: number;
  validationFailures: number;
  cleanupOperations: number;
  operationsTotal: number;
  errorsTotal: number;
}

/**
 * Session cache entry
 */
interface ISessionCacheEntry {
  session: IEnhancedSession;
  cachedAt: Date;
  accessCount: number;
}

/**
 * SessionServiceV2 Implementation
 *
 * Enterprise-grade session management service with:
 * - Secure session creation and validation
 * - Device fingerprinting and IP tracking
 * - Automatic session cleanup and expiration
 * - Session analytics and reporting
 * - Health monitoring and metrics
 * - Comprehensive caching and performance optimization
 */
export class SessionServiceV2 implements ISessionService {
  private readonly sessionCache = new Map<SessionId, ISessionCacheEntry>();
  private readonly userSessionsCache = new Map<EntityId, Set<SessionId>>();
  private readonly sessionStore = new Map<SessionId, IEnhancedSession>();
  private readonly metrics: ISessionMetrics;
  private readonly startTime: number;
  private readonly defaultExpirationMs = 24 * 60 * 60 * 1000; // 24 hours
  private readonly maxSessionsPerUser = 5;
  private readonly cacheMaxSize = 10000;
  private readonly cacheCleanupThreshold = 0.8;

  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      sessionsCreated: 0,
      sessionsValidated: 0,
      sessionsEnded: 0,
      validationFailures: 0,
      cleanupOperations: 0,
      operationsTotal: 0,
      errorsTotal: 0,
    };

    // Start background maintenance tasks
    this.startCleanupJob();
    this.startCacheMaintenanceJob();
  }

  /**
   * Create new session
   */
  async create(sessionData: ISessionCreateData): Promise<IEnhancedSession> {
    try {
      this.metrics.operationsTotal++;
      this.validateCreateData(sessionData);

      // Check if user has too many active sessions
      await this.enforceSessionLimit(sessionData.userId);

      // Generate secure session ID and create session
      const sessionId = this.generateSecureSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.defaultExpirationMs);

      const session: IEnhancedSession = {
        id: sessionId as unknown as EntityId,
        userId: sessionData.userId,
        sessionId,
        createdAt: now.toISOString() as Timestamp,
        updatedAt: now.toISOString() as Timestamp,
        expiresAt: expiresAt.toISOString() as Timestamp,
        isActive: true,
        securityContext: this.createSecurityContext(sessionData),
        metrics: this.initializeSessionMetrics(),
      };

      // Store session
      this.sessionStore.set(sessionId, session);

      // Update caches
      this.addSessionToCache(session);
      this.addUserSessionToCache(sessionData.userId, sessionId);

      this.metrics.sessionsCreated++;
      return session;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to create session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Find session by ID
   */
  async findById(sessionId: SessionId): Promise<IEnhancedSession | null> {
    try {
      this.metrics.operationsTotal++;

      // Check cache first
      const cached = this.getSessionFromCache(sessionId);
      if (cached) {
        return cached.session;
      }

      // Fetch from store
      const session = this.sessionStore.get(sessionId);

      if (session && this.isSessionValid(session)) {
        this.addSessionToCache(session);
        return session;
      }

      return null;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to find session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Find active sessions for user
   */
  async findActiveByUserId(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedSession>> {
    try {
      this.metrics.operationsTotal++;

      const sessions = Array.from(this.sessionStore.values()).filter(
        (session) =>
          session.userId === userId &&
          session.isActive &&
          this.isSessionValid(session)
      );

      // Update cache
      sessions.forEach((session) => this.addSessionToCache(session));

      return Object.freeze(sessions);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to find active sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Validate session and update last access
   */
  async validate(sessionId: SessionId): Promise<ISessionValidationResult> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.sessionsValidated++;

      const session = await this.findById(sessionId);

      if (!session) {
        this.metrics.validationFailures++;
        return {
          isValid: false,
          session: null,
          failureReason: "Session not found",
          remainingTtl: 0,
        };
      }

      if (!this.isSessionValid(session)) {
        this.metrics.validationFailures++;
        // Clean up invalid session
        await this.end(sessionId);
        return {
          isValid: false,
          session: null,
          failureReason: "Session expired or inactive",
          remainingTtl: 0,
        };
      }

      // Enhanced security validation
      const securityValidation = await this.validateSessionSecurity(session);
      if (!securityValidation.isValid) {
        this.metrics.validationFailures++;
        await this.end(sessionId);
        return {
          isValid: false,
          session: null,
          failureReason:
            securityValidation.reason || "Security validation failed",
          remainingTtl: 0,
        };
      }

      // Update last access time
      const now = new Date();
      const updatedSession = await this.update(sessionId, {
        lastAccessedAt: now,
      });

      const expiresAt = new Date(updatedSession.expiresAt);
      const remainingTtl = Math.max(0, expiresAt.getTime() - Date.now());

      return {
        isValid: true,
        session: updatedSession,
        failureReason: null,
        remainingTtl,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      this.metrics.validationFailures++;
      return {
        isValid: false,
        session: null,
        failureReason:
          error instanceof Error ? error.message : "Validation error",
        remainingTtl: 0,
      };
    }
  }

  /**
   * Update session information
   */
  async update(
    sessionId: SessionId,
    updateData: ISessionUpdateData
  ): Promise<IEnhancedSession> {
    try {
      this.metrics.operationsTotal++;

      const session = await this.findById(sessionId);
      if (!session) {
        throw new ValidationError(`Session not found: ${sessionId}`);
      }

      const updatedSession: IEnhancedSession = {
        ...session,
        updatedAt: new Date().toISOString() as Timestamp,
        ...(updateData.lastAccessedAt && {
          metrics: {
            ...session.metrics,
            lastActivityAt:
              updateData.lastAccessedAt.toISOString() as Timestamp,
          },
        }),
        ...(updateData.metadata && {
          securityContext: {
            ...session.securityContext,
            ...updateData.metadata,
          },
        }),
      };

      // Update store and cache
      this.sessionStore.set(sessionId, updatedSession);
      this.addSessionToCache(updatedSession);

      return updatedSession;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to update session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * End session (logout)
   */
  async end(sessionId: SessionId): Promise<boolean> {
    try {
      this.metrics.operationsTotal++;

      const session = await this.findById(sessionId);
      if (!session) {
        return false;
      }

      const updatedSession: IEnhancedSession = {
        ...session,
        isActive: false,
        updatedAt: new Date().toISOString() as Timestamp,
      };

      // Update store
      this.sessionStore.set(sessionId, updatedSession);

      // Remove from caches
      this.removeSessionFromCache(sessionId);
      this.removeUserSessionFromCache(session.userId, sessionId);

      this.metrics.sessionsEnded++;
      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      return false;
    }
  }

  /**
   * End all sessions for user
   */
  async endAllForUser(userId: EntityId): Promise<number> {
    try {
      this.metrics.operationsTotal++;

      const activeSessions = await this.findActiveByUserId(userId);
      let endedCount = 0;

      for (const session of activeSessions) {
        const success = await this.end(session.sessionId);
        if (success) {
          endedCount++;
        }
      }

      // Clear user cache
      this.userSessionsCache.delete(userId);

      return endedCount;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to end user sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * End all sessions for user except specific session
   */
  async endAllForUserExcept(
    userId: EntityId,
    keepSessionId: SessionId
  ): Promise<number> {
    try {
      this.metrics.operationsTotal++;

      const activeSessions = await this.findActiveByUserId(userId);
      let endedCount = 0;

      for (const session of activeSessions) {
        // Skip the session we want to keep
        if (session.sessionId === keepSessionId) {
          continue;
        }

        const success = await this.end(session.sessionId);
        if (success) {
          endedCount++;
        }
      }

      // Update user cache to only include the kept session
      const keptSession = activeSessions.find(
        (s) => s.sessionId === keepSessionId
      );
      if (keptSession) {
        this.userSessionsCache.set(userId, new Set([keepSessionId]));
      } else {
        this.userSessionsCache.delete(userId);
      }

      return endedCount;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to end user sessions except ${keepSessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * End multiple specific sessions
   */
  async endSessions(sessionIds: ReadonlyArray<SessionId>): Promise<number> {
    try {
      this.metrics.operationsTotal++;

      let endedCount = 0;
      const affectedUsers = new Set<EntityId>();

      for (const sessionId of sessionIds) {
        const session = await this.findById(sessionId);
        if (session) {
          affectedUsers.add(session.userId);
        }

        const success = await this.end(sessionId);
        if (success) {
          endedCount++;
        }
      }

      // Clear caches for affected users
      for (const userId of affectedUsers) {
        this.userSessionsCache.delete(userId);
      }

      return endedCount;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to end sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get active session count for user
   */
  async getActiveSessionCount(userId: EntityId): Promise<number> {
    try {
      this.metrics.operationsTotal++;

      const activeSessions = await this.findActiveByUserId(userId);
      return activeSessions.length;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to get active session count for user ${userId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpired(): Promise<number> {
    try {
      this.metrics.operationsTotal++;

      let cleanedCount = 0;
      const now = Date.now();

      for (const [sessionId, session] of this.sessionStore.entries()) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (expiresAt < now || !session.isActive) {
          this.sessionStore.delete(sessionId);
          this.removeSessionFromCache(sessionId);
          this.removeUserSessionFromCache(session.userId, sessionId);
          cleanedCount++;
        }
      }

      this.metrics.cleanupOperations++;
      return cleanedCount;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to cleanup sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get session analytics
   */
  async getAnalytics(
    userId: EntityId,
    days: number = 30
  ): Promise<ISessionAnalytics> {
    try {
      this.metrics.operationsTotal++;

      const sessions = Array.from(this.sessionStore.values()).filter(
        (session) => session.userId === userId
      );

      // Filter sessions within the time range
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const recentSessions = sessions.filter(
        (session) => new Date(session.createdAt) > cutoffDate
      );

      const activeSessions = recentSessions.filter(
        (session) => session.isActive && this.isSessionValid(session)
      );

      // Calculate analytics
      const totalDuration = recentSessions.reduce((sum, session) => {
        const start = new Date(session.createdAt).getTime();
        const end = session.isActive
          ? Date.now()
          : new Date(session.updatedAt).getTime();
        return sum + (end - start);
      }, 0);

      const averageDuration =
        recentSessions.length > 0 ? totalDuration / recentSessions.length : 0;

      // Device breakdown (simplified)
      const deviceBreakdown: Record<string, number> = {};
      recentSessions.forEach((session) => {
        const device =
          session.securityContext?.deviceFingerprint?.substring(0, 8) ||
          "unknown";
        deviceBreakdown[device] = (deviceBreakdown[device] || 0) + 1;
      });

      // Location breakdown (simplified)
      const locationBreakdown: Record<string, number> = {
        local: recentSessions.filter(
          (s) => s.securityContext?.locationData?.country === "local"
        ).length,
        external: recentSessions.filter(
          (s) => s.securityContext?.locationData?.country === "external"
        ).length,
      };

      return {
        userId,
        totalSessions: recentSessions.length,
        activeSessions: activeSessions.length,
        averageDuration: Math.round(averageDuration),
        deviceBreakdown,
        locationBreakdown,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to get analytics: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      return {
        service: "SessionServiceV2",
        status: "healthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          sessionsCreated: this.metrics.sessionsCreated,
          sessionsValidated: this.metrics.sessionsValidated,
          sessionsEnded: this.metrics.sessionsEnded,
          validationFailures: this.metrics.validationFailures,
          cleanupOperations: this.metrics.cleanupOperations,
          cacheSize: this.sessionCache.size,
          userCacheSize: this.userSessionsCache.size,
          totalSessionsStored: this.sessionStore.size,
        },
      };
    } catch (error) {
      return {
        service: "SessionServiceV2",
        status: "unhealthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
        },
      };
    }
  }

  /**
   * Private utility methods
   */
  private validateCreateData(data: ISessionCreateData): void {
    if (!data.userId) {
      throw new ValidationError("User ID is required");
    }
    if (!data.deviceId) {
      throw new ValidationError("Device ID is required");
    }
    if (!data.ipAddress) {
      throw new ValidationError("IP address is required");
    }
    if (!data.userAgent) {
      throw new ValidationError("User agent is required");
    }
  }

  private generateSecureSessionId(): SessionId {
    const randomBytes = crypto.randomBytes(32);
    const timestamp = Date.now().toString(36);
    const hash = crypto
      .createHash("sha256")
      .update(randomBytes)
      .update(timestamp)
      .digest("hex");
    return createSessionId(`ses_${hash.substring(0, 32)}`);
  }

  private createSecurityContext(data: ISessionCreateData): any {
    const deviceFingerprint = this.generateDeviceFingerprint(data);
    const riskScore = this.calculateRiskScore(data);

    return {
      deviceFingerprint,
      locationData: {
        country: this.extractLocationFromIP(data.ipAddress),
        region: "",
        city: "",
        coordinates: null,
        timezone: "UTC",
        isVpn: this.detectVPN(data.ipAddress),
        isTor: this.detectTor(data.ipAddress),
      },
      securityFlags: this.generateSecurityFlags(data, riskScore),
      riskScore,
      validationLevel:
        riskScore > 0.7 ? "HIGH" : riskScore > 0.4 ? "MEDIUM" : "BASIC",
      bruteForceAttempts: 0,
      suspiciousActivityFlags: [],
      lastSecurityCheck: new Date().toISOString() as Timestamp,
    };
  }

  private initializeSessionMetrics(): any {
    return {
      requestCount: 0,
      dataTransferred: 0,
      averageResponseTime: 0,
      errorCount: 0,
      lastActivityAt: new Date().toISOString() as Timestamp,
    };
  }

  private generateDeviceFingerprint(data: ISessionCreateData): string {
    const input = `${data.deviceId}:${data.userAgent}:${data.ipAddress}`;
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  private extractLocationFromIP(ipAddress: string): string {
    // Simplified location extraction
    if (
      ipAddress.startsWith("127.") ||
      ipAddress.startsWith("192.168.") ||
      ipAddress.startsWith("10.")
    ) {
      return "local";
    }
    return "external";
  }

  private calculateRiskScore(data: ISessionCreateData): number {
    let riskScore = 0;

    // Check for suspicious IP patterns
    if (this.detectVPN(data.ipAddress)) riskScore += 0.3;
    if (this.detectTor(data.ipAddress)) riskScore += 0.5;

    // Check for unusual user agent patterns
    if (this.isUnusualUserAgent(data.userAgent)) riskScore += 0.2;

    // Check for geographic anomalies (simplified)
    if (this.isGeographicAnomaly(data.ipAddress)) riskScore += 0.25;

    return Math.min(riskScore, 1.0);
  }

  private detectVPN(ipAddress: string): boolean {
    // Simplified VPN detection - in production use proper VPN detection service
    const vpnPatterns = [
      /^10\./, // Private IP ranges (often VPN)
      /^192\.168\./, // Private IP ranges
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private IP ranges
    ];

    return vpnPatterns.some((pattern) => pattern.test(ipAddress));
  }

  private detectTor(ipAddress: string): boolean {
    // Simplified Tor detection - in production use proper Tor exit node lists
    const torExitNodes = [
      "127.0.0.1", // Placeholder - would contain actual known Tor exit nodes
    ];

    return torExitNodes.includes(ipAddress);
  }

  private generateSecurityFlags(
    data: ISessionCreateData,
    riskScore: number
  ): string[] {
    const flags: string[] = [];

    if (this.detectVPN(data.ipAddress)) flags.push("VPN_DETECTED");
    if (this.detectTor(data.ipAddress)) flags.push("TOR_DETECTED");
    if (this.isUnusualUserAgent(data.userAgent))
      flags.push("UNUSUAL_USER_AGENT");
    if (this.isGeographicAnomaly(data.ipAddress))
      flags.push("GEOGRAPHIC_ANOMALY");
    if (riskScore > 0.7) flags.push("HIGH_RISK");
    if (this.isNewDevice(data.deviceId)) flags.push("NEW_DEVICE");

    return flags;
  }

  private isUnusualUserAgent(userAgent: string): boolean {
    // Check for unusual or suspicious user agent patterns
    const suspiciousPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /^$/, // Empty user agent
      /python|curl|wget/i, // Automated tools
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(userAgent));
  }

  private isGeographicAnomaly(ipAddress: string): boolean {
    // Simplified geographic anomaly detection
    // In production, compare with user's typical locations
    const country = this.extractLocationFromIP(ipAddress);

    // For now, flag if no country could be determined
    return country === "UNKNOWN";
  }

  private isNewDevice(deviceId: string): boolean {
    // Simplified new device detection
    // In production, check against user's known devices
    return deviceId.length === 0 || deviceId === "unknown";
  }

  /**
   * Enhanced security validation for session hijacking detection
   */
  private async validateSessionSecurity(
    session: IEnhancedSession
  ): Promise<{ isValid: boolean; reason?: string }> {
    // Check for excessive activity patterns
    const activityCheck = this.detectSuspiciousActivity(session);
    if (!activityCheck.isValid) {
      return activityCheck;
    }

    // Check risk score
    if (session.securityContext.riskScore > 0.8) {
      return { isValid: false, reason: "High risk score detected" };
    }

    // Check security flags for suspicious patterns
    const suspiciousFlags = ["VPN_DETECTED", "TOR_DETECTED", "HIGH_RISK"];
    const hasSuspiciousFlag = session.securityContext.securityFlags.some(
      (flag) => suspiciousFlags.includes(flag as string)
    );

    if (hasSuspiciousFlag) {
      return { isValid: false, reason: "Suspicious security flags detected" };
    }

    return { isValid: true };
  }

  private detectSuspiciousActivity(session: IEnhancedSession): {
    isValid: boolean;
    reason?: string;
  } {
    const metrics = session.metrics;

    // Check for excessive request rate
    if (metrics.requestCount > 1000) {
      const sessionAge = Date.now() - new Date(session.createdAt).getTime();
      const requestRate = metrics.requestCount / (sessionAge / 1000); // requests per second

      if (requestRate > 10) {
        // More than 10 requests per second
        return { isValid: false, reason: "Excessive request rate detected" };
      }
    }

    // Check for unusual error patterns
    if (metrics.errorCount > 50) {
      return { isValid: false, reason: "Excessive error rate detected" };
    }

    return { isValid: true };
  }

  private isSessionValid(session: IEnhancedSession): boolean {
    const now = Date.now();
    const expiresAt = new Date(session.expiresAt).getTime();
    return session.isActive && expiresAt > now;
  }

  private async enforceSessionLimit(userId: EntityId): Promise<void> {
    const activeSessions = await this.findActiveByUserId(userId);
    if (activeSessions.length >= this.maxSessionsPerUser) {
      // End oldest session to make room
      const oldestSession = [...activeSessions].sort(
        (a: IEnhancedSession, b: IEnhancedSession) =>
          new Date(a.metrics.lastActivityAt).getTime() -
          new Date(b.metrics.lastActivityAt).getTime()
      )[0];

      if (oldestSession) {
        await this.end(oldestSession.sessionId);
      }
    }
  }

  private getSessionFromCache(sessionId: SessionId): ISessionCacheEntry | null {
    const entry = this.sessionCache.get(sessionId);
    if (entry) {
      entry.accessCount++;
      return entry;
    }
    return null;
  }

  private addSessionToCache(session: IEnhancedSession): void {
    if (
      this.sessionCache.size >=
      this.cacheMaxSize * this.cacheCleanupThreshold
    ) {
      this.cleanupCache();
    }

    this.sessionCache.set(session.sessionId, {
      session,
      cachedAt: new Date(),
      accessCount: 1,
    });
  }

  private removeSessionFromCache(sessionId: SessionId): void {
    this.sessionCache.delete(sessionId);
  }

  private addUserSessionToCache(userId: EntityId, sessionId: SessionId): void {
    if (!this.userSessionsCache.has(userId)) {
      this.userSessionsCache.set(userId, new Set());
    }
    this.userSessionsCache.get(userId)!.add(sessionId);
  }

  private removeUserSessionFromCache(
    userId: EntityId,
    sessionId: SessionId
  ): void {
    const userSessions = this.userSessionsCache.get(userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessionsCache.delete(userId);
      }
    }
  }

  private cleanupCache(): void {
    // Remove least recently accessed entries
    const entries = Array.from(this.sessionCache.entries());
    entries.sort(([, a], [, b]) => a.cachedAt.getTime() - b.cachedAt.getTime());

    const removeCount = Math.floor(this.sessionCache.size * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        this.sessionCache.delete(entry[0]);
      }
    }
  }

  private startCleanupJob(): void {
    // Run cleanup every hour
    setInterval(async () => {
      try {
        await this.cleanupExpired();
      } catch (error) {
        // Log error in production
        console.error("Session cleanup job failed:", error);
      }
    }, 60 * 60 * 1000);
  }

  private startCacheMaintenanceJob(): void {
    // Run cache maintenance every 30 minutes
    setInterval(() => {
      try {
        this.cleanupCache();
      } catch (error) {
        console.error("Cache maintenance failed:", error);
      }
    }, 30 * 60 * 1000);
  }
}
