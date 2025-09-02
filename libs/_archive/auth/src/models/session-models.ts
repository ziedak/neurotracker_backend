/**
 * Session Management Data Models
 * Enterprise-grade session data structures with full type safety
 */

/**
 * Session authentication methods
 */
export enum SessionAuthMethod {
  JWT = "jwt",
  API_KEY = "api_key",
  SESSION_TOKEN = "session_token",
  OAUTH = "oauth",
  SAML = "saml",
}

/**
 * Session protocols
 */
export enum SessionProtocol {
  HTTP = "http",
  WEBSOCKET = "websocket",
  BOTH = "both",
}

/**
 * Session status enumeration
 */
export enum SessionStatus {
  ACTIVE = "active",
  EXPIRED = "expired",
  REVOKED = "revoked",
  SUSPENDED = "suspended",
}

/**
 * Core session data structure
 */
export interface SessionData {
  readonly sessionId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastActivity: Date;
  readonly expiresAt: Date;
  readonly status: SessionStatus;
  readonly protocol: SessionProtocol;
  readonly authMethod: SessionAuthMethod;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly origin?: string | undefined;
  readonly connectionId?: string | undefined;
  readonly refreshCount: number;
  readonly metadata: SessionMetadata;
}

/**
 * Session metadata for additional context
 */
export interface SessionMetadata {
  readonly deviceInfo?: DeviceInfo | undefined;
  readonly locationInfo?: LocationInfo | undefined;
  readonly securityInfo?: SecurityInfo | undefined;
  readonly customData?: Record<string, unknown> | undefined;
}

/**
 * Device information
 */
export interface DeviceInfo {
  readonly deviceId?: string;
  readonly deviceName?: string;
  readonly deviceType?: "desktop" | "mobile" | "tablet" | "server" | "unknown";
  readonly os?: string;
  readonly browser?: string;
  readonly appVersion?: string;
}

/**
 * Location information
 */
export interface LocationInfo {
  readonly country?: string;
  readonly region?: string;
  readonly city?: string;
  readonly timezone?: string;
  readonly isp?: string;
}

/**
 * Security information
 */
export interface SecurityInfo {
  readonly isTrustedDevice: boolean;
  readonly riskScore: number;
  readonly mfaVerified: boolean;
  readonly lastSecurityCheck: Date;
  readonly securityFlags: string[];
}

/**
 * Session creation options
 */
export interface SessionCreateOptions {
  readonly protocol: SessionProtocol;
  readonly authMethod: SessionAuthMethod;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly origin?: string | undefined;
  readonly connectionId?: string | undefined;
  readonly expirationHours?: number | undefined;
  readonly metadata?: Partial<SessionMetadata> | undefined;
  readonly persistent?: boolean | undefined;
  readonly deviceInfo?: DeviceInfo | undefined;
}

/**
 * Session update data
 */
export interface SessionUpdateData {
  readonly lastActivity?: Date;
  readonly protocol?: SessionProtocol;
  readonly connectionId?: string;
  readonly refreshCount?: number;
  readonly metadata?: Partial<SessionMetadata>;
  readonly status?: SessionStatus;
}

/**
 * Session analytics data
 */
export interface SessionAnalytics {
  readonly totalSessions: number;
  readonly activeSessions: number;
  readonly sessionsCreated: number;
  readonly sessionsExpired: number;
  readonly averageSessionDuration: number;
  readonly protocolBreakdown: Record<SessionProtocol, number>;
  readonly authMethodBreakdown: Record<SessionAuthMethod, number>;
  readonly topUserAgents: Array<{ userAgent: string; count: number }>;
  readonly topCountries: Array<{ country: string; count: number }>;
}

/**
 * Session health metrics
 */
export interface SessionHealthMetrics {
  readonly redis: RedisHealthMetrics;
  readonly postgresql: PostgreSQLHealthMetrics;
  readonly cache: CacheHealthMetrics;
  readonly performance: PerformanceMetrics;
}

export interface RedisHealthMetrics {
  readonly connected: boolean;
  readonly latency: number;
  readonly memoryUsage: number;
  readonly keyCount: number;
  readonly commandsPerSecond: number;
}

export interface PostgreSQLHealthMetrics {
  readonly connected: boolean;
  readonly latency: number;
  readonly activeConnections: number;
  readonly backupSessionCount: number;
  readonly queryPerformance: number;
}

export interface CacheHealthMetrics {
  readonly hitRate: number;
  readonly missRate: number;
  readonly evictionRate: number;
  readonly size: number;
  readonly avgResponseTime: number;
}

export interface PerformanceMetrics {
  readonly sessionCreationTime: number;
  readonly sessionRetrievalTime: number;
  readonly sessionUpdateTime: number;
  readonly sessionDeletionTime: number;
}

/**
 * Time range for analytics queries
 */
export interface TimeRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Session validation errors
 */
export class SessionValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "SessionValidationError";
  }
}

/**
 * Session model validator utility class
 */
export class SessionValidator {
  /**
   * Validate session data
   */
  static validateSessionData(data: unknown): SessionData {
    if (!data || typeof data !== "object") {
      throw new SessionValidationError("Session data must be an object");
    }

    const session = data as Record<string, unknown>;

    // Validate required fields
    if (!session.sessionId || typeof session.sessionId !== "string") {
      throw new SessionValidationError(
        "Session ID is required and must be a string",
        "sessionId"
      );
    }

    if (!session.userId || typeof session.userId !== "string") {
      throw new SessionValidationError(
        "User ID is required and must be a string",
        "userId"
      );
    }

    if (!session.createdAt || !(session.createdAt instanceof Date)) {
      throw new SessionValidationError(
        "Created at must be a valid Date",
        "createdAt"
      );
    }

    if (!session.lastActivity || !(session.lastActivity instanceof Date)) {
      throw new SessionValidationError(
        "Last activity must be a valid Date",
        "lastActivity"
      );
    }

    if (!session.expiresAt || !(session.expiresAt instanceof Date)) {
      throw new SessionValidationError(
        "Expires at must be a valid Date",
        "expiresAt"
      );
    }

    if (
      !Object.values(SessionStatus).includes(session.status as SessionStatus)
    ) {
      throw new SessionValidationError(
        "Status must be a valid SessionStatus",
        "status"
      );
    }

    if (
      !Object.values(SessionProtocol).includes(
        session.protocol as SessionProtocol
      )
    ) {
      throw new SessionValidationError(
        "Protocol must be a valid SessionProtocol",
        "protocol"
      );
    }

    if (
      !Object.values(SessionAuthMethod).includes(
        session.authMethod as SessionAuthMethod
      )
    ) {
      throw new SessionValidationError(
        "Auth method must be a valid SessionAuthMethod",
        "authMethod"
      );
    }

    if (typeof session.refreshCount !== "number" || session.refreshCount < 0) {
      throw new SessionValidationError(
        "Refresh count must be a non-negative number",
        "refreshCount"
      );
    }

    if (!session.metadata || typeof session.metadata !== "object") {
      throw new SessionValidationError(
        "Metadata must be an object",
        "metadata"
      );
    }

    return session as unknown as SessionData;
  }

  /**
   * Validate session creation options
   */
  static validateCreateOptions(options: unknown): SessionCreateOptions {
    if (!options || typeof options !== "object") {
      throw new SessionValidationError(
        "Session create options must be an object"
      );
    }

    const opts = options as Record<string, unknown>;

    if (
      !Object.values(SessionProtocol).includes(opts.protocol as SessionProtocol)
    ) {
      throw new SessionValidationError(
        "Protocol must be a valid SessionProtocol",
        "protocol"
      );
    }

    if (
      !Object.values(SessionAuthMethod).includes(
        opts.authMethod as SessionAuthMethod
      )
    ) {
      throw new SessionValidationError(
        "Auth method must be a valid SessionAuthMethod",
        "authMethod"
      );
    }

    if (opts.expirationHours !== undefined) {
      if (
        typeof opts.expirationHours !== "number" ||
        opts.expirationHours <= 0
      ) {
        throw new SessionValidationError(
          "Expiration hours must be a positive number",
          "expirationHours"
        );
      }
    }

    return opts as unknown as SessionCreateOptions;
  }

  /**
   * Validate session ID format
   */
  static isValidSessionId(sessionId: string): boolean {
    // Session IDs should be 64-character hex strings (SHA-256)
    return /^[a-f0-9]{64}$/.test(sessionId);
  }

  /**
   * Validate user ID format
   */
  static isValidUserId(userId: string): boolean {
    // User IDs should be UUIDs or similar secure identifiers
    return (
      /^[a-fA-F0-9-]{36}$/.test(userId) || /^[a-zA-Z0-9_-]{1,50}$/.test(userId)
    );
  }

  /**
   * Check if session is expired
   */
  static isSessionExpired(session: SessionData): boolean {
    return (
      session.expiresAt < new Date() || session.status !== SessionStatus.ACTIVE
    );
  }

  /**
   * Check if session needs refresh
   */
  static needsRefresh(
    session: SessionData,
    refreshThreshold: number = 300000
  ): boolean {
    const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
    return timeUntilExpiry < refreshThreshold;
  }

  /**
   * Generate secure session ID
   */
  static generateSessionId(): string {
    const crypto = require("crypto");
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Generate connection ID for WebSocket sessions
   */
  static generateConnectionId(): string {
    const crypto = require("crypto");
    return `conn_${crypto.randomBytes(16).toString("hex")}`;
  }

  /**
   * Sanitize session data for logging
   */
  static sanitizeForLogging(session: SessionData): Record<string, unknown> {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      protocol: session.protocol,
      authMethod: session.authMethod,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      refreshCount: session.refreshCount,
      // Exclude sensitive metadata
      hasMetadata: Boolean(session.metadata),
    };
  }

  /**
   * Validate device info
   */
  static validateDeviceInfo(deviceInfo: unknown): DeviceInfo | undefined {
    if (!deviceInfo || typeof deviceInfo !== "object") {
      return undefined;
    }

    const device = deviceInfo as Record<string, unknown>;
    const validDeviceTypes = [
      "desktop",
      "mobile",
      "tablet",
      "server",
      "unknown",
    ];

    if (
      device.deviceType &&
      !validDeviceTypes.includes(device.deviceType as string)
    ) {
      throw new SessionValidationError("Invalid device type", "deviceType");
    }

    return device as unknown as DeviceInfo;
  }

  /**
   * Validate security info
   */
  static validateSecurityInfo(securityInfo: unknown): SecurityInfo | undefined {
    if (!securityInfo || typeof securityInfo !== "object") {
      return undefined;
    }

    const security = securityInfo as Record<string, unknown>;

    if (typeof security.isTrustedDevice !== "boolean") {
      throw new SessionValidationError(
        "isTrustedDevice must be a boolean",
        "isTrustedDevice"
      );
    }

    if (
      typeof security.riskScore !== "number" ||
      security.riskScore < 0 ||
      security.riskScore > 100
    ) {
      throw new SessionValidationError(
        "riskScore must be a number between 0 and 100",
        "riskScore"
      );
    }

    if (typeof security.mfaVerified !== "boolean") {
      throw new SessionValidationError(
        "mfaVerified must be a boolean",
        "mfaVerified"
      );
    }

    if (!(security.lastSecurityCheck instanceof Date)) {
      throw new SessionValidationError(
        "lastSecurityCheck must be a valid Date",
        "lastSecurityCheck"
      );
    }

    if (!Array.isArray(security.securityFlags)) {
      throw new SessionValidationError(
        "securityFlags must be an array",
        "securityFlags"
      );
    }

    return security as unknown as SecurityInfo;
  }
}
