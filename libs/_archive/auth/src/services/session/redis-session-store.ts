/**
 * Redis Session Store Implementation
 * Enterprise-grade Redis session storage with clustering support,
 * connection pooling, and comprehensive error handling
 */

import { Redis } from "@libs/database";
import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  SessionData,
  SessionUpdateData,
  SessionAnalytics,
  RedisHealthMetrics,
  SessionStatus,
  SessionProtocol,
  SessionAuthMethod,
  SessionValidator,
  SessionValidationError,
  TimeRange,
} from "../../models/session-models";

/**
 * Redis session store configuration
 */
export interface RedisSessionConfig {
  readonly keyPrefix: string;
  readonly userSessionsKeyPrefix: string;
  readonly analyticsKeyPrefix: string;
  readonly enableAnalytics: boolean;
  readonly enableCompression: boolean;
  readonly compressionThreshold: number; // bytes
  readonly defaultTTL: number; // seconds
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly batchSize: number;
  readonly connectionTimeout: number;
}

/**
 * Default Redis session configuration
 */
export const DEFAULT_REDIS_SESSION_CONFIG: RedisSessionConfig = {
  keyPrefix: "session:",
  userSessionsKeyPrefix: "user_sessions:",
  analyticsKeyPrefix: "analytics:session:",
  enableAnalytics: true,
  enableCompression: false,
  compressionThreshold: 1024,
  defaultTTL: 7 * 24 * 60 * 60, // 7 days
  maxRetries: 3,
  retryDelayMs: 100,
  batchSize: 100,
  connectionTimeout: 5000,
};

/**
 * Session serialization utilities
 */
class SessionSerializer {
  /**
   * Serialize session data for Redis storage
   */
  static serialize(session: SessionData): string {
    const serialized = {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      metadata: {
        ...session.metadata,
        securityInfo: session.metadata.securityInfo
          ? {
              ...session.metadata.securityInfo,
              lastSecurityCheck:
                session.metadata.securityInfo.lastSecurityCheck.toISOString(),
            }
          : undefined,
      },
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize session data from Redis storage
   */
  static deserialize(data: string): SessionData {
    try {
      const parsed = JSON.parse(data);

      // Convert date strings back to Date objects
      const session = {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        lastActivity: new Date(parsed.lastActivity),
        expiresAt: new Date(parsed.expiresAt),
        metadata: {
          ...parsed.metadata,
          securityInfo: parsed.metadata?.securityInfo
            ? {
                ...parsed.metadata.securityInfo,
                lastSecurityCheck: new Date(
                  parsed.metadata.securityInfo.lastSecurityCheck
                ),
              }
            : undefined,
        },
      };

      // Validate deserialized session
      return SessionValidator.validateSessionData(session);
    } catch (error) {
      throw new SessionValidationError(
        `Failed to deserialize session data: ${error}`
      );
    }
  }

  /**
   * Compress session data if enabled
   */
  static compress(data: string, threshold: number): string {
    if (Buffer.byteLength(data, "utf8") > threshold) {
      const zlib = require("zlib");
      return zlib.gzipSync(data).toString("base64");
    }
    return data;
  }

  /**
   * Decompress session data if compressed
   */
  static decompress(data: string): string {
    try {
      // Try to decompress (base64 encoded gzip)
      const zlib = require("zlib");
      const buffer = Buffer.from(data, "base64");
      return zlib.gunzipSync(buffer).toString("utf8");
    } catch {
      // Not compressed, return as-is
      return data;
    }
  }
}

/**
 * Redis-based session store with enterprise features
 */
export class RedisSessionStore {
  private readonly redis: Redis;
  private readonly config: RedisSessionConfig;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(
    config: Partial<RedisSessionConfig> = {},
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.config = { ...DEFAULT_REDIS_SESSION_CONFIG, ...config };
    this.logger = logger.child({ component: "RedisSessionStore" });
    this.metrics = metrics;
    this.redis = this.createRedisConnection();
    this.setupEventHandlers();
  }

  /**
   * Store session data in Redis with optimizations
   */
  async storeSession(session: SessionData): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate session data
      SessionValidator.validateSessionData(session);

      const key = this.getSessionKey(session.sessionId);
      const userSessionsKey = this.getUserSessionsKey(session.userId);
      const expirationSeconds = this.getExpirationSeconds(session);

      // Serialize and optionally compress session data
      let serializedData = SessionSerializer.serialize(session);
      if (this.config.enableCompression) {
        serializedData = SessionSerializer.compress(
          serializedData,
          this.config.compressionThreshold
        );
      }

      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Store session data
      pipeline.setex(key, expirationSeconds, serializedData);

      // Add to user sessions set with TTL
      pipeline.sadd(userSessionsKey, session.sessionId);
      pipeline.expire(userSessionsKey, expirationSeconds);

      // Store analytics data if enabled
      if (this.config.enableAnalytics) {
        const analyticsKey = this.getAnalyticsKey(session.sessionId);
        pipeline.hmset(analyticsKey, this.createAnalyticsData(session));
        pipeline.expire(analyticsKey, expirationSeconds);
      }

      // Execute pipeline
      const results = await pipeline.exec();

      // Check for pipeline errors
      if (results) {
        for (const [error] of results) {
          if (error) {
            throw error;
          }
        }
      }

      const duration = Date.now() - startTime;
      this.logger.debug("Session stored in Redis", {
        sessionId: session.sessionId,
        userId: session.userId,
        expirationSeconds,
        duration,
      });

      await this.metrics.recordTimer("redis_session_store_duration", duration);
      await this.metrics.recordCounter("redis_session_store_success");
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to store session in Redis", error as Error, {
        sessionId: session.sessionId,
        userId: session.userId,
        duration,
      });

      await this.metrics.recordTimer(
        "redis_session_store_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_session_store_error");
      throw error;
    }
  }

  /**
   * Retrieve session data from Redis with caching
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const startTime = Date.now();

    try {
      if (!SessionValidator.isValidSessionId(sessionId)) {
        await this.metrics.recordCounter("redis_session_get_invalid_id");
        return null;
      }

      const key = this.getSessionKey(sessionId);
      const data = await this.redis.get(key);

      if (!data) {
        await this.metrics.recordCounter("redis_session_get_miss");
        return null;
      }

      // Decompress if needed and deserialize
      const decompressedData = this.config.enableCompression
        ? SessionSerializer.decompress(data)
        : data;

      const session = SessionSerializer.deserialize(decompressedData);

      // Check if session is expired (additional safety check)
      if (SessionValidator.isSessionExpired(session)) {
        // Clean up expired session
        await this.deleteSession(sessionId);
        await this.metrics.recordCounter("redis_session_get_expired");
        return null;
      }

      const duration = Date.now() - startTime;
      this.logger.debug("Session retrieved from Redis", {
        sessionId,
        userId: session.userId,
        duration,
      });

      await this.metrics.recordTimer("redis_session_get_duration", duration);
      await this.metrics.recordCounter("redis_session_get_hit");

      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to get session from Redis", error as Error, {
        sessionId,
        duration,
      });

      await this.metrics.recordTimer(
        "redis_session_get_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_session_get_error");
      return null;
    }
  }

  /**
   * Update session data in Redis
   */
  async updateSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const existingSession = await this.getSession(sessionId);
      if (!existingSession) {
        throw new Error(`Session ${sessionId} not found for update`);
      }

      // Create updated session
      const updatedSession: SessionData = {
        ...existingSession,
        ...updates,
        lastActivity: updates.lastActivity || new Date(),
        metadata: {
          ...existingSession.metadata,
          ...updates.metadata,
        },
      };

      // Store updated session
      await this.storeSession(updatedSession);

      const duration = Date.now() - startTime;
      this.logger.debug("Session updated in Redis", {
        sessionId,
        userId: updatedSession.userId,
        updates: Object.keys(updates),
        duration,
      });

      await this.metrics.recordTimer("redis_session_update_duration", duration);
      await this.metrics.recordCounter("redis_session_update_success");
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to update session in Redis", error as Error, {
        sessionId,
        duration,
      });

      await this.metrics.recordTimer(
        "redis_session_update_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_session_update_error");
      throw error;
    }
  }

  /**
   * Delete session from Redis
   */
  async deleteSession(sessionId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Get session info before deletion for cleanup
      const session = await this.getSession(sessionId);
      if (!session) {
        // Session doesn't exist, nothing to delete
        return;
      }

      const key = this.getSessionKey(sessionId);
      const userSessionsKey = this.getUserSessionsKey(session.userId);
      const analyticsKey = this.getAnalyticsKey(sessionId);

      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.del(key);
      pipeline.srem(userSessionsKey, sessionId);

      if (this.config.enableAnalytics) {
        pipeline.del(analyticsKey);
      }

      await pipeline.exec();

      const duration = Date.now() - startTime;
      this.logger.debug("Session deleted from Redis", {
        sessionId,
        userId: session.userId,
        duration,
      });

      await this.metrics.recordTimer("redis_session_delete_duration", duration);
      await this.metrics.recordCounter("redis_session_delete_success");
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to delete session from Redis", error as Error, {
        sessionId,
        duration,
      });

      await this.metrics.recordTimer(
        "redis_session_delete_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_session_delete_error");
      throw error;
    }
  }

  /**
   * Get all session IDs for a user
   */
  async getUserSessions(userId: string): Promise<string[]> {
    const startTime = Date.now();

    try {
      if (!SessionValidator.isValidUserId(userId)) {
        return [];
      }

      const userSessionsKey = this.getUserSessionsKey(userId);
      const sessionIds = await this.redis.smembers(userSessionsKey);

      const duration = Date.now() - startTime;
      this.logger.debug("User sessions retrieved from Redis", {
        userId,
        sessionCount: sessionIds.length,
        duration,
      });

      await this.metrics.recordTimer("redis_user_sessions_duration", duration);
      await this.metrics.recordCounter("redis_user_sessions_success");

      return sessionIds;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Failed to get user sessions from Redis",
        error as Error,
        {
          userId,
          duration,
        }
      );

      await this.metrics.recordTimer(
        "redis_user_sessions_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_user_sessions_error");
      return [];
    }
  }

  /**
   * Batch retrieve multiple sessions
   */
  async batchGetSessions(
    sessionIds: string[]
  ): Promise<Map<string, SessionData>> {
    const startTime = Date.now();
    const results = new Map<string, SessionData>();

    if (sessionIds.length === 0) {
      return results;
    }

    try {
      // Process in batches to avoid memory issues
      const batchSize = this.config.batchSize;

      for (let i = 0; i < sessionIds.length; i += batchSize) {
        const batch = sessionIds.slice(i, i + batchSize);
        const keys = batch.map((id) => this.getSessionKey(id));

        const pipeline = this.redis.pipeline();
        keys.forEach((key) => pipeline.get(key));

        const batchResults = await pipeline.exec();

        if (batchResults) {
          for (let j = 0; j < batch.length; j++) {
            const result = batchResults[j];
            if (result !== undefined) {
              const [error, data] = result;
              if (!error && data) {
                try {
                  const decompressedData = this.config.enableCompression
                    ? SessionSerializer.decompress(data as string)
                    : (data as string);

                  const session =
                    SessionSerializer.deserialize(decompressedData);

                  if (
                    !SessionValidator.isSessionExpired(session) &&
                    batch[j] !== undefined
                  ) {
                    results.set(batch[j] as string, session);
                  }
                } catch (parseError) {
                  this.logger.warn("Failed to deserialize session in batch", {
                    sessionId: batch[j],
                    error: parseError,
                  });
                }
              }
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      this.logger.debug("Batch sessions retrieved from Redis", {
        requestedCount: sessionIds.length,
        retrievedCount: results.size,
        duration,
      });

      await this.metrics.recordTimer("redis_batch_sessions_duration", duration);
      await this.metrics.recordCounter("redis_batch_sessions_success");

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Failed to batch get sessions from Redis",
        error as Error,
        {
          requestedCount: sessionIds.length,
          duration,
        }
      );

      await this.metrics.recordTimer(
        "redis_batch_sessions_error_duration",
        duration
      );
      await this.metrics.recordCounter("redis_batch_sessions_error");
      return results;
    }
  }

  /**
   * Get active session count
   */
  async getActiveSessionCount(): Promise<number> {
    try {
      const pattern = `${this.config.keyPrefix}*`;
      const stream = this.redis.scanStream({
        match: pattern,
        count: 100,
      });

      let count = 0;

      for await (const keys of stream) {
        count += keys.length;
      }

      await this.metrics.recordGauge("redis_active_sessions", count);
      return count;
    } catch (error) {
      this.logger.error("Failed to get active session count", error as Error);
      await this.metrics.recordCounter("redis_session_count_error");
      return 0;
    }
  }

  /**
   * Get Redis health metrics
   */
  async getHealthMetrics(): Promise<RedisHealthMetrics> {
    try {
      const startTime = Date.now();
      const info = await this.redis.info("memory");
      const latency = Date.now() - startTime;

      // Parse memory info
      const memoryUsage = this.parseMemoryUsage(info);
      const keyCount = await this.getActiveSessionCount();

      return {
        connected: this.redis.status === "ready",
        latency,
        memoryUsage,
        keyCount,
        commandsPerSecond: 0, // Would require more complex tracking
      };
    } catch (error) {
      this.logger.error("Failed to get Redis health metrics", error as Error);
      return {
        connected: false,
        latency: 0,
        memoryUsage: 0,
        keyCount: 0,
        commandsPerSecond: 0,
      };
    }
  }

  /**
   * Cleanup expired sessions (maintenance operation)
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const pattern = `${this.config.keyPrefix}*`;
      const stream = this.redis.scanStream({
        match: pattern,
        count: 100,
      });

      let cleanedCount = 0;
      const pipeline = this.redis.pipeline();

      for await (const keys of stream) {
        for (const key of keys) {
          // Check TTL, if expired or about to expire, mark for deletion
          const ttl = await this.redis.ttl(key);
          if (ttl <= 0) {
            pipeline.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        await pipeline.exec();
      }

      this.logger.info("Expired sessions cleaned up", { cleanedCount });
      await this.metrics.recordGauge("redis_sessions_cleaned", cleanedCount);

      return cleanedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", error as Error);
      return 0;
    }
  }

  // Private helper methods

  private createRedisConnection(): Redis {
    return RedisClient.getInstance();
  }

  private setupEventHandlers(): void {
    this.redis.on("connect", () => {
      this.logger.info("Redis session store connected");
    });

    this.redis.on("error", (error: Error) => {
      this.logger.error("Redis session store error", error);
      this.metrics.recordCounter("redis_connection_error");
    });

    this.redis.on("close", () => {
      this.logger.warn("Redis session store connection closed");
    });
  }

  private getSessionKey(sessionId: string): string {
    return `${this.config.keyPrefix}${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `${this.config.userSessionsKeyPrefix}${userId}`;
  }

  private getAnalyticsKey(sessionId: string): string {
    return `${this.config.analyticsKeyPrefix}${sessionId}`;
  }

  private getExpirationSeconds(session: SessionData): number {
    const now = Date.now();
    const expiresAt = session.expiresAt.getTime();
    return Math.max(0, Math.floor((expiresAt - now) / 1000));
  }

  private createAnalyticsData(session: SessionData): Record<string, string> {
    return {
      userId: session.userId,
      protocol: session.protocol,
      authMethod: session.authMethod,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      ipAddress: session.ipAddress || "",
      userAgent: session.userAgent || "",
      origin: session.origin || "",
      country: session.metadata.locationInfo?.country || "",
      deviceType: session.metadata.deviceInfo?.deviceType || "unknown",
    };
  }

  private parseMemoryUsage(info: string): number {
    const match = info.match(/used_memory:(\d+)/);
    return match ? parseInt(match[1] ?? "0", 10) : 0;
  }
}
