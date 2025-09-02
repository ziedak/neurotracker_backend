/**
 * Session Management Service
 * Handles user session lifecycle, device tracking, and session security
 * Provides comprehensive session management with Redis storage
 */

import { uuidv4 } from "@libs/utils";
import {
  Session,
  DeviceInfo,
  AuthConfig,
  ServiceDependencies,
  AuthError,
} from "../types";

// ===================================================================
// SESSION SERVICE CLASS
// ===================================================================

export class SessionService {
  constructor(private config: AuthConfig, private deps: ServiceDependencies) {}

  /**
   * Create a new session for user
   */
  async createSession(
    userId: string,
    deviceInfo?: DeviceInfo,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Session> {
    try {
      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.config.session.ttl * 1000
      );

      const sessionData: Partial<Session> = {
        id: sessionId,
        userId,
        isActive: true,
        expiresAt,
        createdAt: now,
        lastActivity: now,
      };

      // Only add optional properties if they are defined
      if (deviceInfo) {
        sessionData.deviceInfo = deviceInfo;
      }
      if (ipAddress) {
        sessionData.ipAddress = ipAddress;
      }
      if (userAgent) {
        sessionData.userAgent = userAgent;
      }

      const session: Session = sessionData as Session;

      // Store session in Redis
      await this.storeSession(session);

      this.deps.monitoring.logger.info("Session created", {
        sessionId,
        userId,
        ipAddress,
      });

      return session;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to create session", {
        userId,
        error,
      });
      throw new AuthError("Failed to create session", "SESSION_CREATE_FAILED");
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const sessionData = await this.deps.redis.get(`session:${sessionId}`);
      if (!sessionData) {
        return null;
      }

      const session: Session = JSON.parse(sessionData);

      // Check if session is expired
      if (new Date() > new Date(session.expiresAt)) {
        await this.deleteSession(sessionId);
        return null;
      }

      return session;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get session", {
        sessionId,
        error,
      });
      return null;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return false;
      }

      session.lastActivity = new Date();

      // Extend session if within refresh threshold
      const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
      if (timeUntilExpiry < this.config.session.refreshThreshold * 1000) {
        session.expiresAt = new Date(
          Date.now() + this.config.session.ttl * 1000
        );
      }

      await this.storeSession(session);
      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to update session activity", {
        sessionId,
        error,
      });
      return false;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.deps.redis.del(`session:${sessionId}`);
      this.deps.monitoring.logger.info("Session deleted", { sessionId });
      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to delete session", {
        sessionId,
        error,
      });
      return false;
    }
  }

  /**
   * Delete all sessions for user
   */
  async deleteUserSessions(userId: string): Promise<boolean> {
    try {
      // Get all session keys for user
      const pattern = `session:*`;
      const keys = await this.deps.redis.keys(pattern);

      const userSessions = [];
      for (const key of keys) {
        const sessionData = await this.deps.redis.get(key);
        if (sessionData) {
          const session: Session = JSON.parse(sessionData);
          if (session.userId === userId) {
            userSessions.push(key);
          }
        }
      }

      // Delete all user sessions
      if (userSessions.length > 0) {
        await this.deps.redis.del(...userSessions);
      }

      this.deps.monitoring.logger.info("User sessions deleted", {
        userId,
        sessionCount: userSessions.length,
      });

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to delete user sessions", {
        userId,
        error,
      });
      return false;
    }
  }

  /**
   * Get all active sessions for user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    try {
      const pattern = `session:*`;
      const keys = await this.deps.redis.keys(pattern);

      const userSessions: Session[] = [];
      for (const key of keys) {
        const sessionData = await this.deps.redis.get(key);
        if (sessionData) {
          const session: Session = JSON.parse(sessionData);
          if (session.userId === userId && session.isActive) {
            // Check if session is expired
            if (new Date() <= new Date(session.expiresAt)) {
              userSessions.push(session);
            } else {
              // Clean up expired session
              await this.deps.redis.del(key);
            }
          }
        }
      }

      return userSessions;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get user sessions", {
        userId,
        error,
      });
      return [];
    }
  }

  /**
   * Validate session and return user ID
   */
  async validateSession(sessionId: string): Promise<string | null> {
    try {
      const session = await this.getSession(sessionId);
      if (!session || !session.isActive) {
        return null;
      }

      // Update activity
      await this.updateSessionActivity(sessionId);

      return session.userId;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to validate session", {
        sessionId,
        error,
      });
      return null;
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const pattern = `session:*`;
      const keys = await this.deps.redis.keys(pattern);

      let cleanedCount = 0;
      for (const key of keys) {
        const sessionData = await this.deps.redis.get(key);
        if (sessionData) {
          const session: Session = JSON.parse(sessionData);
          if (new Date() > new Date(session.expiresAt)) {
            await this.deps.redis.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.deps.monitoring.logger.info("Expired sessions cleaned up", {
          count: cleanedCount,
        });
      }

      return cleanedCount;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to cleanup expired sessions", {
        error,
      });
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    total: number;
    active: number;
    expired: number;
  }> {
    try {
      const pattern = `session:*`;
      const keys = await this.deps.redis.keys(pattern);

      let total = 0;
      let active = 0;
      let expired = 0;

      for (const key of keys) {
        const sessionData = await this.deps.redis.get(key);
        if (sessionData) {
          total++;
          const session: Session = JSON.parse(sessionData);
          if (new Date() <= new Date(session.expiresAt)) {
            active++;
          } else {
            expired++;
          }
        }
      }

      return { total, active, expired };
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get session stats", {
        error,
      });
      return { total: 0, active: 0, expired: 0 };
    }
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private async storeSession(session: Session): Promise<void> {
    const ttl = Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000);

    await this.deps.redis.setex(
      `session:${session.id}`,
      ttl,
      JSON.stringify(session)
    );
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create session service instance
 */
export function createSessionService(
  config: AuthConfig,
  deps: ServiceDependencies
): SessionService {
  return new SessionService(config, deps);
}

/**
 * Parse device info from user agent
 */
export function parseDeviceInfo(userAgent?: string): DeviceInfo | undefined {
  if (!userAgent) return undefined;

  // Simple device detection - in production you might want to use a library like ua-parser-js
  const deviceInfo: DeviceInfo = {};

  if (userAgent.includes("Mobile")) {
    deviceInfo.type = "mobile";
  } else if (userAgent.includes("Tablet")) {
    deviceInfo.type = "tablet";
  } else {
    deviceInfo.type = "desktop";
  }

  // Extract browser info
  if (userAgent.includes("Chrome")) {
    deviceInfo.browser = "Chrome";
  } else if (userAgent.includes("Firefox")) {
    deviceInfo.browser = "Firefox";
  } else if (userAgent.includes("Safari")) {
    deviceInfo.browser = "Safari";
  } else if (userAgent.includes("Edge")) {
    deviceInfo.browser = "Edge";
  }

  // Extract OS info
  if (userAgent.includes("Windows")) {
    deviceInfo.os = "Windows";
  } else if (userAgent.includes("Mac")) {
    deviceInfo.os = "macOS";
  } else if (userAgent.includes("Linux")) {
    deviceInfo.os = "Linux";
  } else if (userAgent.includes("Android")) {
    deviceInfo.os = "Android";
  } else if (userAgent.includes("iOS")) {
    deviceInfo.os = "iOS";
  }

  return deviceInfo;
}

export default SessionService;
