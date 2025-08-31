/**
 * PostgreSQL Session Backup Store Implementation
 * High-availability session backup persistence with enterprise features:
 * - Clean architecture with proper separation of concerns
 * - Reusable database operations through helper methods
 * - Type-safe query builders and abstractions
 * - Comprehensive error handling and metrics
 */

import { PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  SessionData,
  SessionUpdateData,
  PostgreSQLHealthMetrics,
  SessionStatus,
  SessionProtocol,
  SessionAuthMethod,
  SessionValidator,
  SessionValidationError,
} from "../../models/session-models";

/**
 * PostgreSQL session backup configuration
 */
export interface PostgreSQLSessionConfig {
  readonly tableName: string;
  readonly analyticsTableName: string;
  readonly enableBackupSync: boolean;
  readonly enableAnalytics: boolean;
  readonly batchSize: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly queryTimeout: number;
  readonly cleanupInterval: number; // hours
}

/**
 * Default PostgreSQL session configuration
 */
export const DEFAULT_POSTGRESQL_SESSION_CONFIG: PostgreSQLSessionConfig = {
  tableName: "sessions_backup",
  analyticsTableName: "session_analytics",
  enableBackupSync: true,
  enableAnalytics: true,
  batchSize: 1000,
  maxRetries: 3,
  retryDelayMs: 1000,
  queryTimeout: 30000,
  cleanupInterval: 24, // 24 hours
};

/**
 * Session database row structure
 */
interface SessionRow {
  readonly session_id: string;
  readonly user_id: string;
  readonly session_data: string;
  readonly created_at: Date;
  readonly last_activity: Date;
  readonly expires_at: Date;
  readonly status: SessionStatus;
  readonly protocol: SessionProtocol;
  readonly auth_method: SessionAuthMethod;
  readonly ip_address?: string | undefined;
  readonly user_agent?: string | undefined;
  readonly origin?: string | undefined;
  readonly connection_id?: string | undefined;
  readonly refresh_count: number;
  readonly metadata_json?: string | undefined;
  readonly backup_source: "redis" | "direct" | "recovery";
  readonly backup_timestamp: Date;
  readonly is_active: boolean;
}

/**
 * Database operation result wrapper
 */
interface DatabaseOperationResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error;
  readonly duration: number;
}

/**
 * Metrics operation helper
 */
interface MetricsOperation {
  readonly name: string;
  readonly startTime: number;
  readonly context: Record<string, unknown>;
}

/**
 * Database helper for PostgreSQL operations
 * Implements single responsibility and DRY principles
 */
class DatabaseHelper {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(logger: ILogger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Execute query with comprehensive error handling and metrics
   */
  async executeQuery<T = unknown>(
    query: string,
    params: unknown[] = [],
    operation: MetricsOperation
  ): Promise<DatabaseOperationResult<T>> {
    const startTime = Date.now();

    try {
      const db = PostgreSQLClient.getInstance();
      const data = (await db.$queryRawUnsafe(query, ...params)) as T;
      const duration = Date.now() - startTime;

      this.logger.debug(`Database operation successful: ${operation.name}`, {
        ...operation.context,
        duration,
      });

      await this.metrics.recordTimer(
        `postgresql_${operation.name}_duration`,
        duration
      );
      await this.metrics.recordCounter(`postgresql_${operation.name}_success`);

      return { success: true, data, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = error as Error;

      this.logger.error(
        `Database operation failed: ${operation.name}`,
        dbError,
        {
          ...operation.context,
          duration,
        }
      );

      await this.metrics.recordTimer(
        `postgresql_${operation.name}_error_duration`,
        duration
      );
      await this.metrics.recordCounter(`postgresql_${operation.name}_error`);

      return { success: false, error: dbError, duration };
    }
  }

  /**
   * Execute transaction with automatic rollback
   */
  async executeTransaction<T>(
    transactionCallback: (db: any) => Promise<T>,
    operation: MetricsOperation
  ): Promise<DatabaseOperationResult<T>> {
    const startTime = Date.now();

    try {
      const db = PostgreSQLClient.getInstance();
      const result = await db.$transaction(transactionCallback);
      const duration = Date.now() - startTime;

      this.logger.debug(`Transaction successful: ${operation.name}`, {
        ...operation.context,
        duration,
      });

      await this.metrics.recordTimer(
        `postgresql_transaction_${operation.name}_duration`,
        duration
      );
      await this.metrics.recordCounter(
        `postgresql_transaction_${operation.name}_success`
      );

      return { success: true, data: result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const dbError = error as Error;

      this.logger.error(`Transaction failed: ${operation.name}`, dbError, {
        ...operation.context,
        duration,
      });

      await this.metrics.recordTimer(
        `postgresql_transaction_${operation.name}_error_duration`,
        duration
      );
      await this.metrics.recordCounter(
        `postgresql_transaction_${operation.name}_error`
      );

      return { success: false, error: dbError, duration };
    }
  }
}

/**
 * Query builder for session operations
 * Implements single responsibility principle
 */
class SessionQueryBuilder {
  constructor(private readonly config: PostgreSQLSessionConfig) {}

  /**
   * Build upsert session query
   */
  buildUpsertQuery(): string {
    return `
      INSERT INTO ${this.config.tableName} (
        session_id, user_id, session_data, created_at, last_activity,
        expires_at, status, protocol, auth_method, ip_address, user_agent,
        origin, connection_id, refresh_count, metadata_json, backup_source,
        backup_timestamp, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      ON CONFLICT (session_id) 
      DO UPDATE SET
        session_data = EXCLUDED.session_data,
        last_activity = EXCLUDED.last_activity,
        expires_at = EXCLUDED.expires_at,
        status = EXCLUDED.status,
        protocol = EXCLUDED.protocol,
        connection_id = EXCLUDED.connection_id,
        refresh_count = EXCLUDED.refresh_count,
        metadata_json = EXCLUDED.metadata_json,
        backup_source = EXCLUDED.backup_source,
        backup_timestamp = EXCLUDED.backup_timestamp,
        is_active = EXCLUDED.is_active
    `;
  }

  /**
   * Build select session query
   */
  buildSelectQuery(): string {
    return `
      SELECT * FROM ${this.config.tableName}
      WHERE session_id = $1 AND is_active = true AND expires_at > NOW()
    `;
  }

  /**
   * Build user sessions query
   */
  buildUserSessionsQuery(): string {
    return `
      SELECT session_id FROM ${this.config.tableName}
      WHERE user_id = $1 AND is_active = true AND expires_at > NOW()
      ORDER BY last_activity DESC
    `;
  }

  /**
   * Build soft delete query
   */
  buildSoftDeleteQuery(): string {
    return `
      UPDATE ${this.config.tableName}
      SET is_active = false, status = $1, backup_timestamp = NOW()
      WHERE session_id = $2 AND is_active = true
    `;
  }

  /**
   * Build cleanup expired sessions query
   */
  buildCleanupExpiredQuery(): string {
    return `
      UPDATE ${this.config.tableName}
      SET is_active = false, status = $1, backup_timestamp = NOW()
      WHERE expires_at < NOW() AND is_active = true
    `;
  }

  /**
   * Build hard delete old sessions query
   */
  buildHardDeleteQuery(): string {
    return `
      DELETE FROM ${this.config.tableName}
      WHERE is_active = false AND backup_timestamp < NOW() - INTERVAL '7 days'
    `;
  }

  /**
   * Build session count query
   */
  buildSessionCountQuery(): string {
    return `
      SELECT count(*) as backup_sessions FROM ${this.config.tableName} WHERE is_active = true
    `;
  }

  /**
   * Build create table query
   */
  buildCreateTableQuery(): string {
    return `
      CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        session_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        last_activity TIMESTAMP WITH TIME ZONE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) NOT NULL,
        protocol VARCHAR(20) NOT NULL,
        auth_method VARCHAR(20) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        origin TEXT,
        connection_id VARCHAR(50),
        refresh_count INTEGER NOT NULL DEFAULT 0,
        metadata_json JSONB,
        backup_source VARCHAR(20) NOT NULL DEFAULT 'redis',
        backup_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT true,
        
        CONSTRAINT valid_status CHECK (status IN ('active', 'expired', 'revoked', 'suspended')),
        CONSTRAINT valid_protocol CHECK (protocol IN ('http', 'websocket', 'both')),
        CONSTRAINT valid_auth_method CHECK (auth_method IN ('jwt', 'api_key', 'session_token', 'oauth', 'saml')),
        CONSTRAINT valid_backup_source CHECK (backup_source IN ('redis', 'direct', 'recovery'))
      )
    `;
  }

  /**
   * Build analytics table creation query
   */
  buildCreateAnalyticsTableQuery(): string {
    return `
      CREATE TABLE IF NOT EXISTS ${this.config.analyticsTableName} (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(50) NOT NULL,
        event_type VARCHAR(20) NOT NULL,
        event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        protocol VARCHAR(20) NOT NULL,
        auth_method VARCHAR(20) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        country VARCHAR(3),
        device_type VARCHAR(20),
        session_duration INTEGER,
        metadata_json JSONB,
        
        CONSTRAINT valid_event_type CHECK (event_type IN ('created', 'updated', 'expired', 'revoked', 'deleted'))
      )
    `;
  }

  /**
   * Build indexes creation queries
   */
  buildIndexQueries(): string[] {
    const baseIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_user_id ON ${this.config.tableName} (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_expires_at ON ${this.config.tableName} (expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_status ON ${this.config.tableName} (status)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_last_activity ON ${this.config.tableName} (last_activity)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_active_sessions ON ${this.config.tableName} (is_active, expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_backup_timestamp ON ${this.config.tableName} (backup_timestamp)`,
    ];

    if (this.config.enableAnalytics) {
      baseIndexes.push(
        `CREATE INDEX IF NOT EXISTS idx_${this.config.analyticsTableName}_session_id ON ${this.config.analyticsTableName} (session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.config.analyticsTableName}_user_id ON ${this.config.analyticsTableName} (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.config.analyticsTableName}_timestamp ON ${this.config.analyticsTableName} (event_timestamp)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.config.analyticsTableName}_event_type ON ${this.config.analyticsTableName} (event_type)`
      );
    }

    return baseIndexes;
  }

  /**
   * Build analytics insert query
   */
  buildAnalyticsInsertQuery(): string {
    return `
      INSERT INTO ${this.config.analyticsTableName} (
        session_id, user_id, event_type, event_timestamp, protocol, auth_method,
        ip_address, user_agent, country, device_type, session_duration, metadata_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
    `;
  }
}

/**
 * Session data transformer
 * Implements single responsibility principle
 */
class SessionDataTransformer {
  /**
   * Transform session to database row
   */
  static sessionToRow(
    session: SessionData,
    source: "redis" | "direct" = "redis"
  ): SessionRow {
    return {
      session_id: session.sessionId,
      user_id: session.userId,
      session_data: JSON.stringify(session),
      created_at: session.createdAt,
      last_activity: session.lastActivity,
      expires_at: session.expiresAt,
      status: session.status,
      protocol: session.protocol,
      auth_method: session.authMethod,
      ip_address: session.ipAddress,
      user_agent: session.userAgent,
      origin: session.origin,
      connection_id: session.connectionId,
      refresh_count: session.refreshCount,
      metadata_json: JSON.stringify(session.metadata),
      backup_source: source,
      backup_timestamp: new Date(),
      is_active: session.status === SessionStatus.ACTIVE,
    };
  }

  /**
   * Transform database row to session
   */
  static rowToSession(row: SessionRow): SessionData {
    const sessionData = JSON.parse(row.session_data);

    // Ensure dates are properly converted
    return {
      ...sessionData,
      createdAt: new Date(sessionData.createdAt),
      lastActivity: new Date(sessionData.lastActivity),
      expiresAt: new Date(sessionData.expiresAt),
      metadata: {
        ...sessionData.metadata,
        securityInfo: sessionData.metadata?.securityInfo
          ? {
              ...sessionData.metadata.securityInfo,
              lastSecurityCheck: new Date(
                sessionData.metadata.securityInfo.lastSecurityCheck
              ),
            }
          : undefined,
      },
    };
  }

  /**
   * Extract session row values for query
   */
  static extractRowValues(row: SessionRow): unknown[] {
    return [
      row.session_id,
      row.user_id,
      row.session_data,
      row.created_at,
      row.last_activity,
      row.expires_at,
      row.status,
      row.protocol,
      row.auth_method,
      row.ip_address,
      row.user_agent,
      row.origin,
      row.connection_id,
      row.refresh_count,
      row.metadata_json,
      row.backup_source,
      row.backup_timestamp,
      row.is_active,
    ];
  }

  /**
   * Extract analytics values for query
   */
  static extractAnalyticsValues(
    session: SessionData,
    eventType: "created" | "updated" | "expired" | "revoked" | "deleted"
  ): unknown[] {
    const sessionDuration =
      eventType === "deleted" || eventType === "expired"
        ? Math.floor((Date.now() - session.createdAt.getTime()) / 1000)
        : null;

    return [
      session.sessionId,
      session.userId,
      eventType,
      new Date(),
      session.protocol,
      session.authMethod,
      session.ipAddress,
      session.userAgent,
      session.metadata.locationInfo?.country,
      session.metadata.deviceInfo?.deviceType,
      sessionDuration,
      JSON.stringify(session.metadata),
    ];
  }
}

/**
 * PostgreSQL-based session backup store with clean architecture
 * Implements SOLID principles, DRY, KISS with proper separation of concerns
 */
export class PostgreSQLSessionStore {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;
  private readonly config: PostgreSQLSessionConfig;
  private readonly dbHelper: DatabaseHelper;
  private readonly queryBuilder: SessionQueryBuilder;
  private isInitialized = false;

  constructor(
    config: Partial<PostgreSQLSessionConfig> = {},
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.config = { ...DEFAULT_POSTGRESQL_SESSION_CONFIG, ...config };
    this.logger = logger.child({ component: "PostgreSQLSessionStore" });
    this.metrics = metrics;
    this.dbHelper = new DatabaseHelper(this.logger, this.metrics);
    this.queryBuilder = new SessionQueryBuilder(this.config);
  }

  /**
   * Initialize PostgreSQL session backup store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const operation: MetricsOperation = {
      name: "initialize",
      startTime: Date.now(),
      context: { tableName: this.config.tableName },
    };

    try {
      await this.createTablesIfNotExists();
      await this.createIndexes();
      this.isInitialized = true;

      this.logger.info("PostgreSQL session store initialized successfully");
    } catch (error) {
      this.logger.error(
        "Failed to initialize PostgreSQL session store",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Backup session to PostgreSQL
   */
  async backupSession(
    session: SessionData,
    source: "redis" | "direct" = "redis"
  ): Promise<void> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "backup_session",
      startTime: Date.now(),
      context: { sessionId: session.sessionId, userId: session.userId, source },
    };

    try {
      SessionValidator.validateSessionData(session);

      const sessionRow = SessionDataTransformer.sessionToRow(session, source);
      const query = this.queryBuilder.buildUpsertQuery();
      const values = SessionDataTransformer.extractRowValues(sessionRow);

      const result = await this.dbHelper.executeQuery(query, values, operation);

      if (!result.success) {
        throw result.error || new Error("Failed to backup session");
      }

      // Record analytics if enabled
      if (this.config.enableAnalytics) {
        await this.recordSessionAnalytics(session, "created");
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Retrieve session from PostgreSQL backup
   */
  async getBackupSession(sessionId: string): Promise<SessionData | null> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "get_backup_session",
      startTime: Date.now(),
      context: { sessionId },
    };

    try {
      if (!SessionValidator.isValidSessionId(sessionId)) {
        await this.metrics.recordCounter("postgresql_session_get_invalid_id");
        return null;
      }

      const query = this.queryBuilder.buildSelectQuery();
      const result = await this.dbHelper.executeQuery<SessionRow[]>(
        query,
        [sessionId],
        operation
      );

      if (!result.success || !result.data || result.data.length === 0) {
        await this.metrics.recordCounter("postgresql_session_get_miss");
        return null;
      }

      const sessionRow = result.data[0];
      if (!sessionRow) {
        return null;
      }
      return SessionDataTransformer.rowToSession(sessionRow);
    } catch (error) {
      this.logger.error("Failed to get session from backup", error as Error, {
        sessionId,
      });
      return null;
    }
  }

  /**
   * Update session in PostgreSQL backup
   */
  async updateBackupSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<void> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "update_backup_session",
      startTime: Date.now(),
      context: { sessionId, updates: Object.keys(updates) },
    };

    try {
      const existingSession = await this.getBackupSession(sessionId);
      if (!existingSession) {
        throw new Error(`Session ${sessionId} not found in backup for update`);
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

      await this.backupSession(updatedSession, "direct");

      // Record analytics if enabled
      if (this.config.enableAnalytics) {
        await this.recordSessionAnalytics(updatedSession, "updated");
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete session from PostgreSQL backup (soft delete)
   */
  async deleteBackupSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "delete_backup_session",
      startTime: Date.now(),
      context: { sessionId },
    };

    try {
      const query = this.queryBuilder.buildSoftDeleteQuery();
      const result = await this.dbHelper.executeQuery(
        query,
        [SessionStatus.REVOKED, sessionId],
        operation
      );

      if (!result.success) {
        throw result.error || new Error("Failed to delete session");
      }

      // Record analytics if enabled
      if (this.config.enableAnalytics) {
        const session = await this.getBackupSession(sessionId);
        if (session) {
          await this.recordSessionAnalytics(session, "deleted");
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user sessions from PostgreSQL backup
   */
  async getUserBackupSessions(userId: string): Promise<string[]> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "get_user_backup_sessions",
      startTime: Date.now(),
      context: { userId },
    };

    try {
      if (!SessionValidator.isValidUserId(userId)) {
        return [];
      }

      const query = this.queryBuilder.buildUserSessionsQuery();
      const result = await this.dbHelper.executeQuery<
        Array<{ session_id: string }>
      >(query, [userId], operation);

      if (!result.success || !result.data) {
        return [];
      }

      return result.data.map((row) => row.session_id);
    } catch (error) {
      this.logger.error("Failed to get user backup sessions", error as Error, {
        userId,
      });
      return [];
    }
  }

  /**
   * Batch backup multiple sessions from Redis
   */
  async batchBackupSessions(sessions: SessionData[]): Promise<void> {
    await this.ensureInitialized();

    if (sessions.length === 0) {
      return;
    }

    const operation: MetricsOperation = {
      name: "batch_backup_sessions",
      startTime: Date.now(),
      context: { sessionCount: sessions.length },
    };

    try {
      // Process in batches to avoid memory issues
      const batchSize = this.config.batchSize;

      for (let i = 0; i < sessions.length; i += batchSize) {
        const batch = sessions.slice(i, i + batchSize);
        await this.processBatchBackup(batch);
      }

      this.logger.info("Sessions batch backed up successfully", {
        sessionCount: sessions.length,
      });
    } catch (error) {
      this.logger.error("Failed to batch backup sessions", error as Error, {
        sessionCount: sessions.length,
      });
      throw error;
    }
  }

  /**
   * Get PostgreSQL health metrics
   */
  async getHealthMetrics(): Promise<PostgreSQLHealthMetrics> {
    const operation: MetricsOperation = {
      name: "get_health_metrics",
      startTime: Date.now(),
      context: {},
    };

    try {
      // Test connection
      const testResult = await this.dbHelper.executeQuery(
        "SELECT 1 as connected",
        [],
        operation
      );

      if (!testResult.success) {
        return {
          connected: false,
          latency: 0,
          activeConnections: 0,
          backupSessionCount: 0,
          queryPerformance: 0,
        };
      }

      // Get active connections
      const connectionsResult = await this.dbHelper.executeQuery<
        Array<{ active_connections: bigint }>
      >(
        "SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active'",
        [],
        operation
      );

      // Get backup session count
      const sessionCountQuery = this.queryBuilder.buildSessionCountQuery();
      const sessionCountResult = await this.dbHelper.executeQuery<
        Array<{ backup_sessions: bigint }>
      >(sessionCountQuery, [], operation);

      const activeConnections = connectionsResult.success
        ? Number(connectionsResult.data?.[0]?.active_connections || 0)
        : 0;
      const backupSessionCount = sessionCountResult.success
        ? Number(sessionCountResult.data?.[0]?.backup_sessions || 0)
        : 0;

      return {
        connected: true,
        latency: testResult.duration,
        activeConnections,
        backupSessionCount,
        queryPerformance: testResult.duration,
      };
    } catch (error) {
      this.logger.error("Failed to get health metrics", error as Error);
      return {
        connected: false,
        latency: 0,
        activeConnections: 0,
        backupSessionCount: 0,
        queryPerformance: 0,
      };
    }
  }

  /**
   * Cleanup expired sessions (maintenance operation)
   */
  async cleanupExpiredSessions(): Promise<number> {
    await this.ensureInitialized();

    const operation: MetricsOperation = {
      name: "cleanup_expired_sessions",
      startTime: Date.now(),
      context: {},
    };

    try {
      // Mark expired sessions as inactive (soft delete)
      const expiredQuery = this.queryBuilder.buildCleanupExpiredQuery();
      const expiredResult = await this.dbHelper.executeQuery(
        expiredQuery,
        [SessionStatus.EXPIRED],
        operation
      );

      // Hard delete old inactive sessions
      const hardDeleteQuery = this.queryBuilder.buildHardDeleteQuery();
      const hardDeleteResult = await this.dbHelper.executeQuery(
        hardDeleteQuery,
        [],
        operation
      );

      const expiredCount = expiredResult.success
        ? (expiredResult.data as any)?.length || 0
        : 0;
      const deletedCount = hardDeleteResult.success
        ? (hardDeleteResult.data as any)?.length || 0
        : 0;
      const totalCleaned = expiredCount + deletedCount;

      this.logger.info("Session cleanup completed", {
        expiredCount,
        deletedCount,
        totalCleaned,
      });

      await this.metrics.recordGauge(
        "postgresql_sessions_expired",
        expiredCount
      );
      await this.metrics.recordGauge(
        "postgresql_sessions_deleted",
        deletedCount
      );

      return totalCleaned;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", error as Error);
      return 0;
    }
  }

  // Private helper methods following single responsibility principle

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private async createTablesIfNotExists(): Promise<void> {
    const operation: MetricsOperation = {
      name: "create_tables",
      startTime: Date.now(),
      context: { tableName: this.config.tableName },
    };

    // Create main sessions table
    const sessionTableQuery = this.queryBuilder.buildCreateTableQuery();
    const sessionResult = await this.dbHelper.executeQuery(
      sessionTableQuery,
      [],
      operation
    );

    if (!sessionResult.success) {
      throw sessionResult.error || new Error("Failed to create sessions table");
    }

    // Create analytics table if enabled
    if (this.config.enableAnalytics) {
      const analyticsTableQuery =
        this.queryBuilder.buildCreateAnalyticsTableQuery();
      const analyticsResult = await this.dbHelper.executeQuery(
        analyticsTableQuery,
        [],
        operation
      );

      if (!analyticsResult.success) {
        throw (
          analyticsResult.error || new Error("Failed to create analytics table")
        );
      }
    }
  }

  private async createIndexes(): Promise<void> {
    const operation: MetricsOperation = {
      name: "create_indexes",
      startTime: Date.now(),
      context: { tableName: this.config.tableName },
    };

    const indexQueries = this.queryBuilder.buildIndexQueries();

    for (const indexQuery of indexQueries) {
      const result = await this.dbHelper.executeQuery(
        indexQuery,
        [],
        operation
      );
      if (!result.success) {
        this.logger.warn("Failed to create index", {
          query: indexQuery,
          error: result.error,
        });
      }
    }
  }

  private async processBatchBackup(sessions: SessionData[]): Promise<void> {
    const operation: MetricsOperation = {
      name: "process_batch_backup",
      startTime: Date.now(),
      context: { batchSize: sessions.length },
    };

    const transactionCallback = async (db: any) => {
      const query = this.queryBuilder.buildUpsertQuery();

      for (const session of sessions) {
        const sessionRow = SessionDataTransformer.sessionToRow(
          session,
          "redis"
        );
        const values = SessionDataTransformer.extractRowValues(sessionRow);
        await db.$queryRawUnsafe(query, ...values);
      }

      return sessions.length;
    };

    const result = await this.dbHelper.executeTransaction(
      transactionCallback,
      operation
    );

    if (!result.success) {
      throw result.error || new Error("Failed to process batch backup");
    }
  }

  private async recordSessionAnalytics(
    session: SessionData,
    eventType: "created" | "updated" | "expired" | "revoked" | "deleted"
  ): Promise<void> {
    if (!this.config.enableAnalytics) {
      return;
    }

    const operation: MetricsOperation = {
      name: "record_session_analytics",
      startTime: Date.now(),
      context: { sessionId: session.sessionId, eventType },
    };

    try {
      const query = this.queryBuilder.buildAnalyticsInsertQuery();
      const values = SessionDataTransformer.extractAnalyticsValues(
        session,
        eventType
      );

      await this.dbHelper.executeQuery(query, values, operation);
    } catch (error) {
      this.logger.warn("Failed to record session analytics", {
        error,
        sessionId: session.sessionId,
      });
    }
  }
}
