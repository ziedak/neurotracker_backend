/**
 * Production-ready type definitions for Advanced Elysia Server
 */
import {
  WebSocketConnection as BaseWebSocketConnection,
  ConnectionMetadata,
  JsonValue,
} from "./validation.types";

// Generic details type for error context and health check data
export type ErrorDetails = Record<string, JsonValue>;
export type HealthCheckDetails = Record<string, JsonValue>;

// =============================================================================
// CONNECTION MANAGEMENT TYPES
// =============================================================================

export interface WebSocketConnection {
  readonly id: string;
  readonly socket: BaseWebSocketConnection; // Elysia WebSocket instance
  readonly userId?: string;
  readonly sessionId?: string;
  readonly connectedAt: number;
  readonly lastActivity: number;
  readonly remoteAddress?: string;
  readonly userAgent?: string;
  readonly rooms: Set<string>;
  readonly subscriptions: Set<string>;
  readonly metadata: ConnectionMetadata;
  isAlive: boolean;
  messageCount: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface RoomInfo {
  readonly name: string;
  readonly createdAt: number;
  readonly connections: Set<string>;
  readonly metadata: ConnectionMetadata;
  readonly maxConnections?: number;
  isPrivate: boolean;
}

// =============================================================================
// SERVER STATE MANAGEMENT
// =============================================================================

export interface ServerState {
  readonly startedAt: number;
  readonly version: string;
  isShuttingDown: boolean;
  isHealthy: boolean;
  lastHealthCheck: number;
  activeConnections: number;
  totalMessages: number;
  errors: number;
  uptime: number;
}

export interface ConnectionLimits {
  readonly maxConnections: number;
  readonly maxConnectionsPerIP: number;
  readonly maxRooms: number;
  readonly maxRoomSize: number;
  readonly messageRateLimit: number;
  readonly messageSizeLimit: number;
  readonly idleTimeout: number;
  readonly connectionTimeout: number;
}

// =============================================================================
// PRODUCTION CONFIGURATION
// =============================================================================

export interface ProductionConfig {
  // Security settings
  readonly security: {
    readonly enableRateLimiting: boolean;
    readonly enableDDOSProtection: boolean;
    readonly allowedOrigins: string[];
    readonly requireAuthentication: boolean;
    readonly enableCORS: boolean;
    readonly maxPayloadSize: number;
  };

  // Performance settings
  readonly performance: {
    readonly enableCompression: boolean;
    readonly enableKeepAlive: boolean;
    readonly connectionPoolSize: number;
    readonly workerThreads: number;
    readonly enableCaching: boolean;
    readonly cacheSize: number;
  };

  // Monitoring settings
  readonly monitoring: {
    readonly enableMetrics: boolean;
    readonly enableTracing: boolean;
    readonly enableHealthChecks: boolean;
    readonly metricsInterval: number;
    readonly alertingEnabled: boolean;
  };

  // Resource limits
  readonly limits: ConnectionLimits;

  // Environment settings
  readonly environment: "development" | "staging" | "production";
  readonly deployment: {
    readonly region: string;
    readonly zone: string;
    readonly cluster: string;
    readonly nodeId: string;
  };
}

// =============================================================================
// ERROR HANDLING TYPES
// =============================================================================

export enum ServerErrorCode {
  // Connection errors
  CONNECTION_LIMIT_EXCEEDED = "CONNECTION_LIMIT_EXCEEDED",
  CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
  INVALID_CONNECTION = "INVALID_CONNECTION",

  // Authentication errors
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  AUTHORIZATION_FAILED = "AUTHORIZATION_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",

  // Rate limiting errors
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  MESSAGE_SIZE_EXCEEDED = "MESSAGE_SIZE_EXCEEDED",

  // Room errors
  ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
  ROOM_FULL = "ROOM_FULL",
  ROOM_ACCESS_DENIED = "ROOM_ACCESS_DENIED",

  // Server errors
  SERVER_OVERLOADED = "SERVER_OVERLOADED",
  MAINTENANCE_MODE = "MAINTENANCE_MODE",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  HEALTH_CHECK_FAILED = "HEALTH_CHECK_FAILED",
}

export class ProductionServerError extends Error {
  constructor(
    public readonly code: ServerErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "ProductionServerError";
  }
}

// =============================================================================
// HEALTH CHECK TYPES
// =============================================================================

export enum HealthState {
  STARTING = "starting",
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
}

export interface HealthCheckResult {
  readonly name: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly timestamp: number;
  readonly duration: number;
  readonly message?: string;
  readonly details?: HealthCheckDetails;
  readonly error?: string;
  readonly metadata?: ConnectionMetadata;
}

export interface SystemResources {
  readonly cpu: {
    readonly usage: number;
    readonly load: number[];
  };
  readonly memory: {
    readonly total: number;
    readonly used: number;
    readonly free: number;
    readonly heap: {
      readonly total: number;
      readonly used: number;
    };
  };
  readonly disk: {
    readonly total: number;
    readonly used: number;
    readonly free: number;
  };
  readonly network: {
    readonly connectionsActive: number;
    readonly throughput: {
      readonly in: number;
      readonly out: number;
    };
  };
}

export interface PerformanceMetrics {
  readonly timestamp?: number;
  readonly responseTime: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly requestRate: number;
  readonly errorRate: number;
  readonly throughput: number;
}

export interface HealthStatus {
  readonly state: HealthState;
  readonly timestamp: number;
  readonly uptime: number;
  readonly version: string;
  readonly environment: string;
  readonly checks: Record<string, HealthCheckResult>;
  readonly resources: SystemResources;
  readonly performance: PerformanceMetrics;
}

export interface SystemHealthStatus {
  readonly overall: "healthy" | "degraded" | "unhealthy";
  readonly timestamp: number;
  readonly checks: HealthCheckResult[];
  readonly metrics: {
    readonly uptime: number;
    readonly memoryUsage: NodeJS.MemoryUsage;
    readonly cpuUsage: NodeJS.CpuUsage;
    readonly connections: number;
    readonly requestsPerMinute: number;
    readonly errorRate: number;
  };
}

// =============================================================================
// MIDDLEWARE CHAIN TYPES
// =============================================================================

export interface MiddlewareMetrics {
  readonly name: string;
  readonly executionCount: number;
  readonly totalExecutionTime: number;
  readonly averageExecutionTime: number;
  readonly errorCount: number;
  readonly lastExecuted: number;
  readonly isEnabled: boolean;
}

export interface ChainMetrics {
  readonly name: string;
  readonly middleware: MiddlewareMetrics[];
  readonly totalExecutionTime: number;
  readonly averageExecutionTime: number;
  readonly executionCount: number;
  readonly errorCount: number;
}

// =============================================================================
// GRACEFUL SHUTDOWN TYPES
// =============================================================================

export interface ShutdownHook {
  readonly name: string;
  readonly priority: number; // Lower numbers execute first
  readonly timeout: number; // Max time to wait in ms
  readonly handler: () => Promise<void>;
}

export interface ShutdownOptions {
  readonly gracePeriod: number; // Time to wait for connections to close
  readonly forceTimeout: number; // Max time before force shutdown
  readonly signal: NodeJS.Signals;
}
