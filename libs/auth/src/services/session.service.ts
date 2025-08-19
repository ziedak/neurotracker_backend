/**
 * Production-ready SessionManager for Authentication Library
 * Handles user session lifecycle with proper database integration
 */

import { PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { getEnv, getNumberEnv } from "@libs/config";
import { randomBytes, createHash } from "crypto";

// Use the actual Prisma generated types
type UserSession = {
  id: string;
  sessionId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: any;
  isActive: boolean;
  endedAt: Date | null;
};

type UserWithMetadata = {
  id: string;
  email: string;
  status: string;
  auditLog: any;
};

export interface SessionInfo {
  sessionId: string;
  userId: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

export interface SessionValidationResult {
  valid: boolean;
  session?: SessionInfo;
  reason?: string;
}

/**
 * Production SessionManager implementation
 */
export class SessionManager {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly sessionTTL: number;
  private readonly maxSessionsPerUser: number;

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
    this.sessionTTL = getNumberEnv("SESSION_TTL_SECONDS", 7 * 24 * 60 * 60); // 7 days
    this.maxSessionsPerUser = getNumberEnv("MAX_SESSIONS_PER_USER", 5);
  }

  /**
   * Create a new user session
   */
  async createSession(
    userId: string,
    deviceInfo?: {
      ipAddress?: string;
      userAgent?: string;
      deviceName?: string;
    },
    metadata: Record<string, unknown> = {}
  ): Promise<SessionInfo> {
    try {
      if (!userId || typeof userId !== "string") {
        throw new Error("Valid user ID is required");
      }

      await this.metrics.recordCounter("auth_session_create_requests");

      // Generate secure session ID
      const sessionId = this.generateSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.sessionTTL * 1000);

      // Cleanup old sessions if user has too many
      await this.cleanupUserSessions(userId);

      // Create session in database
      const db = PostgreSQLClient.getInstance();
      const session = await db.userSession.create({
        data: {
          sessionId,
          userId,
          expiresAt,
          metadata: {
            ...metadata,
            ipAddress: deviceInfo?.ipAddress,
            userAgent: deviceInfo?.userAgent,
            deviceName: deviceInfo?.deviceName,
            createdAt: now.toISOString(),
          },
        },
      });

      // Log session event
      await this.logSessionEvent(userId, "session_created", {
        sessionId,
        ipAddress: deviceInfo?.ipAddress,
        userAgent: deviceInfo?.userAgent,
      });

      this.logger.info("Session created successfully", {
        userId,
        sessionId,
        expiresAt,
      });

      await this.metrics.recordCounter("auth_session_create_success");

      return this.mapToSessionInfo(session);
    } catch (error) {
      this.logger.error("Failed to create session", error as Error, {
        userId,
        deviceInfo,
      });
      await this.metrics.recordCounter("auth_session_errors");
      throw error;
    }
  }

  /**
   * Validate session and update last activity
   */
  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    try {
      if (!sessionId || typeof sessionId !== "string") {
        return { valid: false, reason: "Invalid session ID" };
      }

      await this.metrics.recordCounter("auth_session_validate_requests");

      const db = PostgreSQLClient.getInstance();
      const session = await db.userSession.findUnique({
        where: { sessionId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              auditLog: true,
            },
          },
        },
      });

      if (!session) {
        await this.metrics.recordCounter("auth_session_validate_not_found");
        return { valid: false, reason: "Session not found" };
      }

      // Check if session is expired
      if (!session.expiresAt || session.expiresAt < new Date()) {
        // Clean up expired session
        await this.destroySession(sessionId);
        await this.metrics.recordCounter("auth_session_validate_expired");
        return { valid: false, reason: "Session expired" };
      }

      // Check if user is active
      const userStatus = this.extractUserStatus(session.user);
      if (userStatus !== "ACTIVE") {
        await this.destroySession(sessionId);
        await this.metrics.recordCounter("auth_session_validate_user_inactive");
        return { valid: false, reason: "User account inactive" };
      }

      // Update last activity
      await this.updateLastActivity(sessionId);

      await this.metrics.recordCounter("auth_session_validate_success");

      return {
        valid: true,
        session: this.mapToSessionInfo(session),
      };
    } catch (error) {
      this.logger.error("Failed to validate session", error as Error, {
        sessionId,
      });
      await this.metrics.recordCounter("auth_session_errors");
      return { valid: false, reason: "Validation error" };
    }
  }

  /**
   * Destroy a specific session
   */
  async destroySession(sessionId: string): Promise<void> {
    try {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      await this.metrics.recordCounter("auth_session_destroy_requests");

      const db = PostgreSQLClient.getInstance();
      // Get session info before deletion for logging
      const session = await db.userSession.findUnique({
        where: { sessionId },
        select: { userId: true, sessionId: true },
      });

      if (session) {
        // Log session event
        await this.logSessionEvent(session.userId, "session_destroyed", {
          sessionId,
        });
      }

      // Delete session
      await db.userSession.delete({
        where: { sessionId },
      });

      this.logger.info("Session destroyed", { sessionId });
      await this.metrics.recordCounter("auth_session_destroy_success");
    } catch (error) {
      this.logger.error("Failed to destroy session", error as Error, {
        sessionId,
      });
      await this.metrics.recordCounter("auth_session_errors");
      throw error;
    }
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyUserSessions(userId: string): Promise<void> {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      await this.metrics.recordCounter("auth_session_destroy_user_requests");

      const db = PostgreSQLClient.getInstance();
      const deletedSessions = await db.userSession.deleteMany({
        where: { userId },
      });

      // Log session event
      await this.logSessionEvent(userId, "all_sessions_destroyed", {
        sessionCount: deletedSessions.count,
      });

      this.logger.info("All user sessions destroyed", {
        userId,
        sessionCount: deletedSessions.count,
      });

      await this.metrics.recordCounter("auth_session_destroy_user_success");
    } catch (error) {
      this.logger.error("Failed to destroy user sessions", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("auth_session_errors");
      throw error;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionInfo[]> {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      await this.metrics.recordCounter(
        "auth_session_get_user_sessions_requests"
      );

      const db = PostgreSQLClient.getInstance();
      const sessions = await db.userSession.findMany({
        where: {
          userId,
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      await this.metrics.recordCounter(
        "auth_session_get_user_sessions_success"
      );

      return sessions.map((session: UserSession) =>
        this.mapToSessionInfo(session)
      );
    } catch (error) {
      this.logger.error("Failed to get user sessions", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("auth_session_errors");
      throw error;
    }
  }

  /**
   * Update session metadata
   */
  async updateSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      await this.metrics.recordCounter("auth_session_update_metadata_requests");

      const db = PostgreSQLClient.getInstance();
      await db.userSession.update({
        where: { sessionId },
        data: {
          metadata: {
            ...metadata,
            updatedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.debug("Session metadata updated", { sessionId });
      await this.metrics.recordCounter("auth_session_update_metadata_success");
    } catch (error) {
      this.logger.error("Failed to update session metadata", error as Error, {
        sessionId,
      });
      await this.metrics.recordCounter("auth_session_errors");
      throw error;
    }
  }

  /**
   * Cleanup expired sessions (should be run periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      await this.metrics.recordCounter("auth_session_cleanup_requests");

      const db = PostgreSQLClient.getInstance();
      const deletedSessions = await db.userSession.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      this.logger.info("Expired sessions cleaned up", {
        sessionCount: deletedSessions.count,
      });

      await this.metrics.recordCounter("auth_session_cleanup_success");

      return deletedSessions.count;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", error as Error);
      await this.metrics.recordCounter("auth_session_errors");
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
  }> {
    try {
      const now = new Date();
      const db = PostgreSQLClient.getInstance();

      const [totalSessions, activeSessions] = await Promise.all([
        db.userSession.count(),
        db.userSession.count({
          where: {
            expiresAt: {
              gt: now,
            },
          },
        }),
      ]);

      const expiredSessions = totalSessions - activeSessions;

      return {
        totalSessions,
        activeSessions,
        expiredSessions,
      };
    } catch (error) {
      this.logger.error("Failed to get session statistics", error as Error);
      return {
        totalSessions: 0,
        activeSessions: 0,
        expiredSessions: 0,
      };
    }
  }

  // Private helper methods

  private generateSessionId(): string {
    const randomData = randomBytes(32);
    const timestamp = Date.now().toString();
    const hash = createHash("sha256");
    hash.update(randomData);
    hash.update(timestamp);
    return hash.digest("hex");
  }

  private async updateLastActivity(sessionId: string): Promise<void> {
    try {
      const db = PostgreSQLClient.getInstance();
      await db.userSession.update({
        where: { sessionId },
        data: {
          metadata: {
            lastActivity: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      // Log but don't throw - this is not critical
      this.logger.debug("Failed to update last activity", { sessionId });
    }
  }

  private async cleanupUserSessions(userId: string): Promise<void> {
    try {
      const db = PostgreSQLClient.getInstance();
      const userSessions = await db.userSession.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      if (userSessions.length >= this.maxSessionsPerUser) {
        // Delete oldest sessions
        const sessionsToDelete = userSessions.slice(
          this.maxSessionsPerUser - 1
        );
        const sessionIds = sessionsToDelete.map((s) => s.sessionId);

        await db.userSession.deleteMany({
          where: {
            sessionId: {
              in: sessionIds,
            },
          },
        });

        this.logger.debug("Cleaned up old user sessions", {
          userId,
          deletedCount: sessionsToDelete.length,
        });
      }
    } catch (error) {
      // Log but don't throw - this is not critical
      this.logger.debug("Failed to cleanup user sessions", { userId });
    }
  }

  private async logSessionEvent(
    userId: string,
    event: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = PostgreSQLClient.getInstance();
      await db.userEvent.create({
        data: {
          userId,
          eventType: event,
          metadata: metadata as any, // Cast to any for JSON compatibility
        },
      });
    } catch (error) {
      // Log but don't throw - this is not critical for session operation
      this.logger.debug("Failed to log session event", { userId, event });
    }
  }

  private mapToSessionInfo(session: UserSession): SessionInfo {
    const metadata = (session.metadata as Record<string, unknown>) || {};
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      deviceInfo: metadata.deviceName as string | undefined,
      ipAddress: metadata.ipAddress as string | undefined,
      userAgent: metadata.userAgent as string | undefined,
      createdAt: session.createdAt,
      lastActivity: metadata.lastActivity
        ? new Date(metadata.lastActivity as string)
        : session.createdAt,
      expiresAt: session.expiresAt || new Date(), // Provide fallback for null
      metadata: metadata,
    };
  }

  private extractUserStatus(user: UserWithMetadata | null | undefined): string {
    if (!user) {
      return "ACTIVE";
    }

    return user.status || "ACTIVE";
  }
}
