# SessionManager Architecture Design

## Overview

The SessionManager provides enterprise-grade session management with Redis primary storage, PostgreSQL backup, and automatic failover for high availability.

## Core Architecture

### 1. SessionManager Interface

```typescript
export interface SessionManager {
  // Core session operations
  createSession(
    userId: string,
    options: SessionCreateOptions
  ): Promise<SessionData>;
  getSession(sessionId: string): Promise<SessionData | null>;
  updateSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<SessionData>;
  deleteSession(sessionId: string): Promise<void>;

  // Session lifecycle management
  refreshSession(sessionId: string): Promise<SessionData>;
  extendSession(sessionId: string, duration?: number): Promise<SessionData>;
  invalidateSession(sessionId: string): Promise<void>;

  // User session management
  getUserSessions(userId: string): Promise<SessionData[]>;
  invalidateUserSessions(
    userId: string,
    excludeSessionId?: string
  ): Promise<number>;
  limitUserSessions(userId: string, maxSessions: number): Promise<void>;

  // Cross-protocol synchronization
  syncSessionAcrossProtocols(sessionId: string): Promise<void>;
  getOrCreateSession(
    userId: string,
    options: SessionCreateOptions
  ): Promise<SessionData>;
  migrateSession(
    oldSessionId: string,
    newProtocol: SessionProtocol
  ): Promise<SessionData>;

  // Performance optimization
  cacheSession(session: SessionData): Promise<void>;
  preloadUserSessions(userId: string): Promise<void>;
  warmupCache(sessionIds: string[]): Promise<void>;

  // Analytics and monitoring
  getActiveSessionCount(): Promise<number>;
  getSessionAnalytics(timeRange: TimeRange): Promise<SessionAnalytics>;
  getSessionHealth(): Promise<SessionHealthMetrics>;

  // Cleanup operations
  cleanupExpiredSessions(): Promise<number>;
  archiveInactiveSessions(olderThan: Date): Promise<number>;

  // Event system
  onSessionCreated(callback: (session: SessionData) => void): void;
  onSessionUpdated(callback: (session: SessionData) => void): void;
  onSessionExpired(callback: (sessionId: string) => void): void;
}

export interface SessionCreateOptions {
  authMethod: AuthMethod;
  protocol: SessionProtocol;
  ipAddress?: string;
  userAgent?: string;
  origin?: string;
  connectionId?: string; // For WebSocket
  expirationHours?: number; // Override default expiration
  metadata?: Record<string, unknown>;
  persistent?: boolean; // Whether to persist across browser sessions
}

export interface SessionUpdateData {
  lastActivity?: Date;
  protocol?: SessionProtocol;
  connectionId?: string;
  metadata?: Record<string, unknown>;
  refreshCount?: number;
}

export interface SessionAnalytics {
  totalSessions: number;
  activeSessions: number;
  sessionsCreated: number;
  sessionsExpired: number;
  averageSessionDuration: number;
  protocolBreakdown: Record<SessionProtocol, number>;
  authMethodBreakdown: Record<AuthMethod, number>;
  topUserAgents: Array<{ userAgent: string; count: number }>;
}

export interface SessionHealthMetrics {
  redis: {
    connected: boolean;
    latency: number;
    memoryUsage: number;
    keyCount: number;
  };
  postgresql: {
    connected: boolean;
    latency: number;
    activeConnections: number;
    backupSessionCount: number;
  };
  cache: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
    size: number;
  };
}

export interface TimeRange {
  start: Date;
  end: Date;
}
```

### 2. Redis Session Store Implementation

```typescript
/**
 * Redis-based session store with clustering support
 */
export class RedisSessionStore {
  private redis: Redis.Cluster | Redis;
  private keyPrefix = "session:";
  private userSessionsKeyPrefix = "user_sessions:";

  constructor(
    private config: RedisSessionConfig,
    private logger: ILogger,
    private metrics: MetricsCollector
  ) {
    this.redis = this.createRedisConnection();
  }

  async storeSession(session: SessionData): Promise<void> {
    const key = this.getSessionKey(session.sessionId);
    const userSessionsKey = this.getUserSessionsKey(session.userId);
    const expirationSeconds = this.getExpirationSeconds(session);

    const pipeline = this.redis.pipeline();

    // Store session data
    pipeline.setex(
      key,
      expirationSeconds,
      JSON.stringify(this.serializeSession(session))
    );

    // Add to user sessions set
    pipeline.sadd(userSessionsKey, session.sessionId);
    pipeline.expire(userSessionsKey, expirationSeconds);

    // Store session metadata for analytics
    if (this.config.enableAnalytics) {
      const analyticsKey = `analytics:session:${session.sessionId}`;
      pipeline.hmset(analyticsKey, {
        userId: session.userId,
        protocol: session.protocol,
        authMethod: session.authMethod,
        createdAt: session.createdAt.toISOString(),
        userAgent: session.userAgent || "",
      });
      pipeline.expire(analyticsKey, expirationSeconds);
    }

    await pipeline.exec();

    this.logger.debug("Session stored in Redis", {
      sessionId: session.sessionId,
      userId: session.userId,
      expirationSeconds,
    });

    await this.metrics.increment("redis_session_store");
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const key = this.getSessionKey(sessionId);

    try {
      const data = await this.redis.get(key);
      if (!data) {
        await this.metrics.increment("redis_session_miss");
        return null;
      }

      const session = this.deserializeSession(JSON.parse(data));
      await this.metrics.increment("redis_session_hit");

      return session;
    } catch (error) {
      this.logger.error("Redis session retrieval failed", error as Error, {
        sessionId,
      });
      await this.metrics.increment("redis_session_error");
      return null;
    }
  }

  async updateSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedSession: SessionData = {
      ...session,
      ...updates,
      lastActivity: updates.lastActivity || new Date(),
    };

    await this.storeSession(updatedSession);

    this.logger.debug("Session updated in Redis", {
      sessionId,
      updates: Object.keys(updates),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const key = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(session.userId);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(userSessionsKey, sessionId);

    if (this.config.enableAnalytics) {
      pipeline.del(`analytics:session:${sessionId}`);
    }

    await pipeline.exec();

    this.logger.debug("Session deleted from Redis", { sessionId });
    await this.metrics.increment("redis_session_delete");
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    return this.redis.smembers(userSessionsKey);
  }

  async getActiveSessionCount(): Promise<number> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    return keys.length;
  }

  private createRedisConnection(): Redis.Cluster | Redis {
    if (this.config.cluster) {
      return new Redis.Cluster(this.config.cluster.nodes, {
        ...this.config.cluster.options,
        keyPrefix: this.config.keyPrefix,
      });
    } else {
      return new Redis({
        ...this.config.standalone,
        keyPrefix: this.config.keyPrefix,
      });
    }
  }

  private getSessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `${this.userSessionsKeyPrefix}${userId}`;
  }

  private getExpirationSeconds(session: SessionData): number {
    const now = Date.now();
    const expiresAt = session.expiresAt.getTime();
    return Math.max(0, Math.floor((expiresAt - now) / 1000));
  }

  private serializeSession(session: SessionData): any {
    return {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  private deserializeSession(data: any): SessionData {
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      lastActivity: new Date(data.lastActivity),
      expiresAt: new Date(data.expiresAt),
    };
  }
}

export interface RedisSessionConfig {
  keyPrefix?: string;
  enableAnalytics: boolean;
  cluster?: {
    nodes: Array<{ host: string; port: number }>;
    options?: Redis.ClusterOptions;
  };
  standalone?: Redis.RedisOptions;
}
```

### 3. PostgreSQL Session Backup Store

```typescript
/**
 * PostgreSQL backup session store for persistence and recovery
 */
export class PostgreSQLSessionStore {
  constructor(
    private db: DatabaseUtils,
    private logger: ILogger,
    private metrics: MetricsCollector
  ) {}

  async backupSession(session: SessionData): Promise<void> {
    try {
      await this.db.storeFeatures(
        "sessions",
        {
          session_id: session.sessionId,
          user_id: session.userId,
          created_at: session.createdAt.toISOString(),
          last_activity: session.lastActivity.toISOString(),
          expires_at: session.expiresAt.toISOString(),
          protocol: session.protocol,
          auth_method: session.authMethod,
          ip_address: session.ipAddress,
          user_agent: session.userAgent,
          origin: session.origin,
          connection_id: session.connectionId,
          refresh_count: session.refreshCount,
          metadata: JSON.stringify(session.metadata),
          updated_at: new Date().toISOString(),
        },
        {
          upsertConflictFields: ["session_id"],
          skipCache: true, // Don't cache backup operations
        }
      );

      await this.metrics.increment("postgresql_session_backup");
    } catch (error) {
      this.logger.error("PostgreSQL session backup failed", error as Error, {
        sessionId: session.sessionId,
      });
      await this.metrics.increment("postgresql_session_backup_error");
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const results = await this.db.exportData(
        "sessions",
        { session_id: sessionId },
        { limit: 1 }
      );

      if (!results || results.length === 0) {
        return null;
      }

      const row = results[0];
      return this.deserializeSessionRow(row);
    } catch (error) {
      this.logger.error("PostgreSQL session retrieval failed", error as Error, {
        sessionId,
      });
      return null;
    }
  }

  async getUserSessions(userId: string): Promise<SessionData[]> {
    try {
      const results = await this.db.exportData(
        "sessions",
        {
          user_id: userId,
          expires_at: { operator: ">", value: new Date().toISOString() },
        },
        { orderBy: [{ field: "last_activity", direction: "DESC" }] }
      );

      return results.map((row) => this.deserializeSessionRow(row));
    } catch (error) {
      this.logger.error(
        "PostgreSQL user sessions retrieval failed",
        error as Error,
        {
          userId,
        }
      );
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.db.deleteData("sessions", { session_id: sessionId });
      await this.metrics.increment("postgresql_session_delete");
    } catch (error) {
      this.logger.error("PostgreSQL session deletion failed", error as Error, {
        sessionId,
      });
      throw error;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await this.db.deleteData("sessions", {
        expires_at: { operator: "<", value: new Date().toISOString() },
      });

      const deletedCount = Array.isArray(result) ? result.length : 0;

      this.logger.info("Expired sessions cleaned up", { deletedCount });
      await this.metrics.gauge("postgresql_sessions_cleaned", deletedCount);

      return deletedCount;
    } catch (error) {
      this.logger.error("PostgreSQL session cleanup failed", error as Error);
      return 0;
    }
  }

  async getSessionAnalytics(timeRange: TimeRange): Promise<SessionAnalytics> {
    try {
      // This would use complex SQL queries to generate analytics
      // Implementation depends on specific PostgreSQL query capabilities
      const totalSessions = await this.getSessionCount(timeRange);
      const activeSessions = await this.getActiveSessionCount();

      return {
        totalSessions,
        activeSessions,
        sessionsCreated: 0, // Would require time-series data
        sessionsExpired: 0, // Would require time-series data
        averageSessionDuration: 0, // Would calculate from session data
        protocolBreakdown: await this.getProtocolBreakdown(timeRange),
        authMethodBreakdown: await this.getAuthMethodBreakdown(timeRange),
        topUserAgents: await this.getTopUserAgents(timeRange),
      };
    } catch (error) {
      this.logger.error("PostgreSQL analytics query failed", error as Error);
      throw error;
    }
  }

  private deserializeSessionRow(row: any): SessionData {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      createdAt: new Date(row.created_at),
      lastActivity: new Date(row.last_activity),
      expiresAt: new Date(row.expires_at),
      protocol: row.protocol,
      authMethod: row.auth_method,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      origin: row.origin,
      connectionId: row.connection_id,
      refreshCount: row.refresh_count || 0,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }

  private async getSessionCount(timeRange: TimeRange): Promise<number> {
    // Implementation would count sessions in time range
    return 0;
  }

  private async getActiveSessionCount(): Promise<number> {
    // Implementation would count non-expired sessions
    return 0;
  }

  private async getProtocolBreakdown(
    timeRange: TimeRange
  ): Promise<Record<SessionProtocol, number>> {
    // Implementation would group by protocol
    return { http: 0, websocket: 0, both: 0 };
  }

  private async getAuthMethodBreakdown(
    timeRange: TimeRange
  ): Promise<Record<AuthMethod, number>> {
    // Implementation would group by auth method
    return { jwt: 0, api_key: 0, session: 0, anonymous: 0 };
  }

  private async getTopUserAgents(
    timeRange: TimeRange
  ): Promise<Array<{ userAgent: string; count: number }>> {
    // Implementation would analyze user agents
    return [];
  }
}
```

### 4. Unified SessionManager Implementation

```typescript
/**
 * Production SessionManager with Redis primary, PostgreSQL backup
 * Provides high availability and performance optimization
 */
export class UnifiedSessionManager implements SessionManager {
  private eventEmitter = new EventEmitter();

  constructor(
    private redisStore: RedisSessionStore,
    private postgresStore: PostgreSQLSessionStore,
    private config: SessionManagerConfig,
    private logger: ILogger,
    private metrics: MetricsCollector
  ) {}

  async createSession(
    userId: string,
    options: SessionCreateOptions
  ): Promise<SessionData> {
    const sessionId = this.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        (options.expirationHours || this.config.defaultExpirationHours) *
          60 *
          60 *
          1000
    );

    const session: SessionData = {
      sessionId,
      userId,
      createdAt: now,
      lastActivity: now,
      expiresAt,
      protocol: options.protocol,
      authMethod: options.authMethod,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      origin: options.origin,
      connectionId: options.connectionId,
      refreshCount: 0,
      metadata: options.metadata || {},
    };

    // Store in both Redis (primary) and PostgreSQL (backup)
    await Promise.all([
      this.redisStore.storeSession(session),
      this.config.enablePostgreSQLBackup
        ? this.postgresStore.backupSession(session)
        : Promise.resolve(),
    ]);

    // Emit event
    this.eventEmitter.emit("session:created", session);

    this.logger.info("Session created", {
      sessionId,
      userId,
      protocol: options.protocol,
      authMethod: options.authMethod,
    });

    await this.metrics.increment("session_created");
    return session;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    // Try Redis first (primary store)
    let session = await this.redisStore.getSession(sessionId);

    if (!session && this.config.enablePostgreSQLBackup) {
      // Fallback to PostgreSQL
      session = await this.postgresStore.getSession(sessionId);

      if (session) {
        // Restore to Redis cache
        await this.redisStore.storeSession(session);
        this.logger.debug("Session restored from PostgreSQL to Redis", {
          sessionId,
        });
        await this.metrics.increment("session_restored_from_backup");
      }
    }

    return session;
  }

  async updateSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<SessionData> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedSession: SessionData = {
      ...session,
      ...updates,
      lastActivity: updates.lastActivity || new Date(),
    };

    // Update both stores
    await Promise.all([
      this.redisStore.storeSession(updatedSession),
      this.config.enablePostgreSQLBackup
        ? this.postgresStore.backupSession(updatedSession)
        : Promise.resolve(),
    ]);

    // Emit event
    this.eventEmitter.emit("session:updated", updatedSession);

    await this.metrics.increment("session_updated");
    return updatedSession;
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Delete from both stores
    await Promise.all([
      this.redisStore.deleteSession(sessionId),
      this.config.enablePostgreSQLBackup
        ? this.postgresStore.deleteSession(sessionId)
        : Promise.resolve(),
    ]);

    // Emit event
    this.eventEmitter.emit("session:deleted", sessionId);

    this.logger.info("Session deleted", { sessionId });
    await this.metrics.increment("session_deleted");
  }

  async refreshSession(sessionId: string): Promise<SessionData> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const now = new Date();
    const newExpiresAt = new Date(
      now.getTime() + this.config.defaultExpirationHours * 60 * 60 * 1000
    );

    return this.updateSession(sessionId, {
      lastActivity: now,
      refreshCount: session.refreshCount + 1,
    });
  }

  async getOrCreateSession(
    userId: string,
    options: SessionCreateOptions
  ): Promise<SessionData> {
    // Check if user already has a session for this protocol
    const existingSessions = await this.getUserSessions(userId);
    const compatibleSession = existingSessions.find(
      (session) =>
        session.protocol === options.protocol || session.protocol === "both"
    );

    if (compatibleSession && !this.isSessionExpired(compatibleSession)) {
      return this.updateSession(compatibleSession.sessionId, {
        lastActivity: new Date(),
        protocol: "both", // Mark as supporting both protocols
      });
    }

    return this.createSession(userId, options);
  }

  // ... implement remaining interface methods

  private generateSessionId(): string {
    return `sess_${crypto.randomUUID()}`;
  }

  private isSessionExpired(session: SessionData): boolean {
    return session.expiresAt < new Date();
  }

  // Event system implementation
  onSessionCreated(callback: (session: SessionData) => void): void {
    this.eventEmitter.on("session:created", callback);
  }

  onSessionUpdated(callback: (session: SessionData) => void): void {
    this.eventEmitter.on("session:updated", callback);
  }

  onSessionExpired(callback: (sessionId: string) => void): void {
    this.eventEmitter.on("session:expired", callback);
  }
}

export interface SessionManagerConfig {
  defaultExpirationHours: number;
  enablePostgreSQLBackup: boolean;
  maxSessionsPerUser: number;
  cleanupIntervalMinutes: number;
  enableAnalytics: boolean;
}
```

## Integration Points

### 1. Redis Configuration

- Cluster mode for high availability
- Memory optimization for session data
- Automatic failover configuration
- Performance monitoring

### 2. PostgreSQL Schema

```sql
CREATE TABLE sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_activity TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  protocol VARCHAR(50) NOT NULL,
  auth_method VARCHAR(50) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  origin VARCHAR(255),
  connection_id VARCHAR(255),
  refresh_count INTEGER DEFAULT 0,
  metadata JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity);
```

### 3. Performance Optimizations

- Connection pooling for both Redis and PostgreSQL
- Batch operations for bulk session operations
- LRU cache for frequently accessed sessions
- Background cleanup processes

This architecture provides enterprise-grade session management with high availability, performance, and comprehensive monitoring.
