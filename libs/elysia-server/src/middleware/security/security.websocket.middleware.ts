/**
 * Security WebSocket Middleware
 * Production-grade WebSocket security middleware following BaseWebSocketMiddleware patterns
 *
 * Features:
 * - Connection-based security controls
 * - Message filtering and validation
 * - Rate limiting per connection
 * - Origin validation
 * - Protocol security enforcement
 * - Connection metadata sanitization
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base/BaseWebSocketMiddleware";
import type { WebSocketContext } from "../types";
import { Scheduler } from "@libs/utils";

/**
 * Configuration for WebSocket Security middleware
 * Extends WebSocketMiddlewareConfig with security-specific options
 */
export interface SecurityWebSocketMiddlewareConfig
  extends WebSocketMiddlewareConfig {
  readonly allowedOrigins: readonly string[]; // Allowed origins for CORS
  readonly maxConnectionsPerIP: number; // Max connections per IP address
  readonly maxMessageSize: number; // Max message size in bytes
  readonly allowedProtocols: readonly string[]; // Allowed WebSocket protocols
  readonly requireSecureConnection: boolean; // Require WSS in production
  readonly messageTypeWhitelist: readonly string[]; // Allowed message types
  readonly messageTypeBlacklist: readonly string[]; // Forbidden message types
  readonly rateLimitPerConnection: {
    readonly messagesPerMinute: number;
    readonly messagesPerHour: number;
    readonly bytesPerMinute: number;
  };
  readonly sanitizePayload?: boolean; // Sanitize message payloads
  readonly blockSuspiciousConnections?: boolean; // Block suspicious behavior
  readonly connectionTimeout: number; // Connection timeout in ms
  readonly heartbeatInterval: number; // Heartbeat interval in ms
  readonly validateHeaders?: boolean; // Validate WebSocket headers
  readonly customValidation?: (context: WebSocketContext) => boolean;
}

/**
 * WebSocket Security Middleware
 * Extends BaseWebSocketMiddleware for WebSocket connection and message security
 */
export class SecurityWebSocketMiddleware extends BaseWebSocketMiddleware<SecurityWebSocketMiddlewareConfig> {
  private readonly connectionRegistry = new Map<string, ConnectionInfo>();
  private readonly ipConnectionCounts = new Map<string, number>();
  private readonly messageRateLimits = new Map<string, RateLimitInfo>();
  private readonly scheduler = Scheduler.create();

  constructor(
    metrics: IMetricsCollector,
    config: Partial<SecurityWebSocketMiddlewareConfig>
  ) {
    const baseConfig = {
      name: config.name ?? "security-websocket",
      enabled: config.enabled ?? true,
      priority: config.priority ?? 100,
      allowedOrigins: config.allowedOrigins ?? ["*"],
      maxConnectionsPerIP: config.maxConnectionsPerIP ?? 10,
      maxMessageSize: config.maxMessageSize ?? 1024 * 1024, // 1MB
      allowedProtocols: config.allowedProtocols ?? [],
      requireSecureConnection: config.requireSecureConnection ?? true,
      messageTypeWhitelist: config.messageTypeWhitelist ?? [],
      messageTypeBlacklist: config.messageTypeBlacklist ?? [
        "eval",
        "script",
        "admin",
        "system",
      ],
      rateLimitPerConnection: {
        messagesPerMinute: 60,
        messagesPerHour: 1000,
        bytesPerMinute: 1024 * 1024, // 1MB per minute
        ...config.rateLimitPerConnection,
      },
      sanitizePayload: config.sanitizePayload ?? true,
      blockSuspiciousConnections: config.blockSuspiciousConnections ?? true,
      connectionTimeout: config.connectionTimeout ?? 30000, // 30 seconds
      heartbeatInterval: config.heartbeatInterval ?? 25000, // 25 seconds
      validateHeaders: config.validateHeaders ?? true,
      skipMessageTypes: config.skipMessageTypes ?? [
        "ping",
        "pong",
        "heartbeat",
      ],
    };

    const defaultConfig: SecurityWebSocketMiddlewareConfig =
      config.customValidation
        ? { ...baseConfig, customValidation: config.customValidation }
        : baseConfig;

    super(metrics, defaultConfig);

    // Start cleanup interval for stale connections
    this.startCleanupInterval();
  }

  /**
   * Main execution method for WebSocket security enforcement
   */
  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Register or update connection
      await this.registerConnection(context);

      // Validate connection security
       this.validateConnectionSecurity(context);

      // Validate message security
       this.validateMessageSecurity(context);

      // Apply rate limiting
       this.applyRateLimit(context);

      // Sanitize payload if enabled
      if (this.config.sanitizePayload) {
        this.sanitizeMessagePayload(context);
      }

      // Record security metrics
      await this.recordSecurityMetrics(context);

      // Continue with next middleware
      await next();

      // Record successful processing
      await this.recordMetric("websocket_security_success", 1, {
        messageType: context.message.type,
        origin: this.getOrigin(context),
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordTimer("websocket_security_error_duration", duration);

      this.logger.error("WebSocket security middleware error", error as Error, {
        connectionId: context.connectionId,
        messageType: context.message.type,
        clientIp: context.metadata.clientIp,
      });

      // Record security violation
      await this.recordSecurityViolation(context, error as Error);

      throw error;
    } finally {
      await this.recordTimer(
        "websocket_security_duration",
        Date.now() - startTime,
        {
          messageType: context.message.type,
        }
      );
    }
  }

  /**
   * Register or update connection information
   */
  private async registerConnection(context: WebSocketContext): Promise<void> {
    const { connectionId, metadata } = context;
    const { clientIp } = metadata;

    // Check IP connection limits
    const currentCount = this.ipConnectionCounts.get(clientIp) ?? 0;
    if (currentCount >= this.config.maxConnectionsPerIP) {
      await this.recordMetric("websocket_security_ip_limit_exceeded", 1, {
        clientIp,
      });
      throw new Error(`Too many connections from IP: ${clientIp}`);
    }

    // Register connection if new
    if (!this.connectionRegistry.has(connectionId)) {
      this.connectionRegistry.set(connectionId, {
        connectionId,
        clientIp,
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        totalBytes: 0,
        securityViolations: 0,
        origin: this.getOrigin(context),
        userAgent: metadata.userAgent ?? "unknown",
      });

      this.ipConnectionCounts.set(clientIp, currentCount + 1);

      await this.recordMetric("websocket_security_connection_registered", 1, {
        clientIp,
        origin: this.getOrigin(context),
      });
    }

    // Update last activity
    const connectionInfo = this.connectionRegistry.get(connectionId);
    if (connectionInfo) {
      connectionInfo.lastActivity = new Date();
      connectionInfo.messageCount++;
    }
  }

  /**
   * Validate connection-level security
   */
  private validateConnectionSecurity(context: WebSocketContext): void {
    // Validate origin
    if (!this.isOriginAllowed(context)) {
      throw new Error("Origin not allowed");
    }

    // Validate secure connection requirement
    if (
      this.config.requireSecureConnection &&
      !this.isSecureConnection(context)
    ) {
      throw new Error("Secure connection required");
    }

    // Validate protocol
    if (!this.isProtocolAllowed(context)) {
      throw new Error("Protocol not allowed");
    }

    // Validate headers
    if (this.config.validateHeaders && !this.areHeadersValid(context)) {
      throw new Error("Invalid headers");
    }

    // Custom validation
    if (
      this.config.customValidation &&
      !this.config.customValidation(context)
    ) {
      throw new Error("Custom validation failed");
    }
  }

  /**
   * Validate message-level security
   */
  private validateMessageSecurity(context: WebSocketContext): void {
    const { message } = context;

    // Check message size
    const messageSize = this.calculateMessageSize(message);
    if (messageSize > this.config.maxMessageSize) {
      throw new Error(`Message too large: ${messageSize} bytes`);
    }

    // Check message type whitelist
    if (
      this.config.messageTypeWhitelist &&
      this.config.messageTypeWhitelist.length > 0 &&
      !this.config.messageTypeWhitelist.includes(message.type)
    ) {
      throw new Error(`Message type not in whitelist: ${message.type}`);
    }

    // Check message type blacklist
    if (this.config.messageTypeBlacklist?.includes(message.type)) {
      throw new Error(`Message type blacklisted: ${message.type}`);
    }

    // Update connection info with message size
    const connectionInfo = this.connectionRegistry.get(context.connectionId);
    if (connectionInfo) {
      connectionInfo.totalBytes += messageSize;
    }
  }

  /**
   * Apply rate limiting per connection
   */
  private applyRateLimit(context: WebSocketContext): void {
    const { connectionId } = context;
    const now = Date.now();
    const rateLimitConfig = this.config.rateLimitPerConnection;

    // Get or create rate limit info
    let rateLimitInfo = this.messageRateLimits.get(connectionId);
    if (!rateLimitInfo) {
      rateLimitInfo = {
        minuteWindow: now,
        hourWindow: now,
        messagesThisMinute: 0,
        messagesThisHour: 0,
        bytesThisMinute: 0,
      };
      this.messageRateLimits.set(connectionId, rateLimitInfo);
    }

    // Reset windows if needed
    if (now - rateLimitInfo.minuteWindow >= 60000) {
      rateLimitInfo.minuteWindow = now;
      rateLimitInfo.messagesThisMinute = 0;
      rateLimitInfo.bytesThisMinute = 0;
    }

    if (now - rateLimitInfo.hourWindow >= 3600000) {
      rateLimitInfo.hourWindow = now;
      rateLimitInfo.messagesThisHour = 0;
    }

    // Check rate limits
    const messageSize = this.calculateMessageSize(context.message);

    if (rateLimitInfo.messagesThisMinute >= rateLimitConfig.messagesPerMinute) {
      throw new Error("Message rate limit exceeded (per minute)");
    }

    if (rateLimitInfo.messagesThisHour >= rateLimitConfig.messagesPerHour) {
      throw new Error("Message rate limit exceeded (per hour)");
    }

    if (
      rateLimitInfo.bytesThisMinute + messageSize >
      rateLimitConfig.bytesPerMinute
    ) {
      throw new Error("Byte rate limit exceeded (per minute)");
    }

    // Update counters
    rateLimitInfo.messagesThisMinute++;
    rateLimitInfo.messagesThisHour++;
    rateLimitInfo.bytesThisMinute += messageSize;
  }

  /**
   * Sanitize message payload
   */
  private sanitizeMessagePayload(context: WebSocketContext): void {
    if (
      context.message.payload &&
      typeof context.message.payload === "object"
    ) {
      context.message.payload = this.sanitizeObject(context.message.payload, [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "credential",
      ]);
    }
  }

  /**
   * Record security metrics
   */
  private async recordSecurityMetrics(
    context: WebSocketContext
  ): Promise<void> {
    await this.recordMetric("websocket_security_message_processed", 1, {
      messageType: context.message.type,
      origin: this.getOrigin(context),
      clientIp: context.metadata.clientIp,
    });

    await this.recordHistogram(
      "websocket_security_message_size",
      this.calculateMessageSize(context.message),
      {
        messageType: context.message.type,
      }
    );
  }

  /**
   * Record security violation
   */
  private async recordSecurityViolation(
    context: WebSocketContext,
    error: Error
  ): Promise<void> {
    const connectionInfo = this.connectionRegistry.get(context.connectionId);
    if (connectionInfo) {
      connectionInfo.securityViolations++;
    }

    await this.recordMetric("websocket_security_violation", 1, {
      violationType: error.message,
      messageType: context.message.type,
      origin: this.getOrigin(context),
      clientIp: context.metadata.clientIp,
    });

    this.logger.warn("WebSocket security violation", {
      connectionId: context.connectionId,
      error: error.message,
      messageType: context.message.type,
      clientIp: context.metadata.clientIp,
    });
  }

  /**
   * Helper methods
   */
  private isOriginAllowed(context: WebSocketContext): boolean {
    const { allowedOrigins } = this.config;
    if (allowedOrigins.includes("*")) return true;

    const origin = this.getOrigin(context);
    return allowedOrigins.includes(origin);
  }

  private isSecureConnection(context: WebSocketContext): boolean {
    // Check if connection is over WSS
    return (
      context.metadata.headers["x-forwarded-proto"] === "https" ||
      context.metadata.headers["origin"]?.startsWith("https://") ||
      process.env["NODE_ENV"] === "development"
    );
  }

  private isProtocolAllowed(context: WebSocketContext): boolean {
    if (
      !this.config.allowedProtocols ||
      this.config.allowedProtocols.length === 0
    )
      return true;

    const protocol = context.metadata.headers["sec-websocket-protocol"] ?? "";
    return this.config.allowedProtocols.includes(protocol);
  }

  private areHeadersValid(context: WebSocketContext): boolean {
    const { headers } = context.metadata;

    // Check for required WebSocket headers
    if (!headers["sec-websocket-key"] || !headers["sec-websocket-version"]) {
      return false;
    }

    // Check for suspicious patterns
    // eslint-disable-next-line no-script-url
    const suspiciousPatterns = ["<script", "javascript:", "data:"];
    for (const [, value] of Object.entries(headers)) {
      if (typeof value === "string") {
        for (const pattern of suspiciousPatterns) {
          if (value.toLowerCase().includes(pattern)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private getOrigin(context: WebSocketContext): string {
    return (
      context.metadata.headers["origin"] ??
      context.metadata.headers["sec-websocket-origin"] ??
      "unknown"
    );
  }

  private calculateMessageSize(message: unknown): number {
    return JSON.stringify(message).length;
  }

  /**
   * Cleanup stale connections and rate limit data
   */
  private startCleanupInterval(): void {
    this.scheduler.setInterval("cleanup", 60000, () => {
      this.cleanupStaleConnections();
      this.cleanupRateLimitData();
    });
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const timeout = this.config.connectionTimeout;

    for (const [connectionId, info] of this.connectionRegistry.entries()) {
      if (now - info.lastActivity.getTime() > timeout) {
        // Remove stale connection
        this.connectionRegistry.delete(connectionId);

        // Update IP connection count
        const currentCount = this.ipConnectionCounts.get(info.clientIp) ?? 0;
        if (currentCount > 1) {
          this.ipConnectionCounts.set(info.clientIp, currentCount - 1);
        } else {
          this.ipConnectionCounts.delete(info.clientIp);
        }

        this.logger.debug("Cleaned up stale WebSocket connection", {
          connectionId,
          clientIp: info.clientIp,
          lastActivity: info.lastActivity,
        });
      }
    }
  }

  private cleanupRateLimitData(): void {
    const now = Date.now();

    for (const [
      connectionId,
      rateLimitInfo,
    ] of this.messageRateLimits.entries()) {
      // Remove rate limit data for connections that no longer exist
      if (!this.connectionRegistry.has(connectionId)) {
        this.messageRateLimits.delete(connectionId);
      }
      // Or if data is too old
      else if (now - rateLimitInfo.hourWindow > 7200000) {
        // 2 hours
        this.messageRateLimits.delete(connectionId);
      }
    }
  }

  /**
   * Check if the current context should skip this middleware
   */
  protected override shouldSkip(context: WebSocketContext): boolean {
    const messageType = context.message.type;

    return (
      this.config.skipMessageTypes?.some((skipType) => {
        if (skipType.endsWith("*")) {
          return messageType.startsWith(skipType.slice(0, -1));
        }
        return messageType === skipType;
      }) ?? false
    );
  }

  /**
   * Extract relevant information from WebSocket context for logging
   */
  protected override extractContextInfo(context: WebSocketContext): {
    connectionId: string;
    messageType: string;
    clientIp: string;
    origin: string;
    messageCount: number;
  } {
    return {
      connectionId: context.connectionId,
      messageType: context.message.type,
      clientIp: context.metadata.clientIp,
      origin: this.getOrigin(context),
      messageCount: context.metadata.messageCount,
    };
  }

  /**
   * Cleanup method to clear all timers and resources
   */
  public override cleanup(): void {
    this.scheduler.clearAll();
    this.connectionRegistry.clear();
    this.ipConnectionCounts.clear();
    this.messageRateLimits.clear();
  }

  /**
   * Create preset configurations
   */
  static createDevelopmentConfig(): Partial<SecurityWebSocketMiddlewareConfig> {
    return {
      allowedOrigins: ["*"], // Allow all origins in development
      maxConnectionsPerIP: 50, // Higher limit for development
      requireSecureConnection: false, // Allow insecure connections
      blockSuspiciousConnections: false, // Don't block in development
      rateLimitPerConnection: {
        messagesPerMinute: 120,
        messagesPerHour: 5000,
        bytesPerMinute: 2 * 1024 * 1024, // 2MB
      },
      validateHeaders: false, // Relaxed header validation
    };
  }

  static createProductionConfig(): Partial<SecurityWebSocketMiddlewareConfig> {
    return {
      allowedOrigins: [], // Must be explicitly configured
      maxConnectionsPerIP: 5, // Strict connection limit
      requireSecureConnection: true, // Require WSS
      blockSuspiciousConnections: true, // Block suspicious behavior
      messageTypeBlacklist: [
        "eval",
        "script",
        "admin",
        "system",
        "debug",
        "test",
      ],
      rateLimitPerConnection: {
        messagesPerMinute: 30,
        messagesPerHour: 500,
        bytesPerMinute: 512 * 1024, // 512KB
      },
      validateHeaders: true,
      sanitizePayload: true,
      connectionTimeout: 15000, // 15 seconds
    };
  }

  static createHighSecurityConfig(): Partial<SecurityWebSocketMiddlewareConfig> {
    return {
      allowedOrigins: [], // Must be explicitly configured
      maxConnectionsPerIP: 2, // Very strict connection limit
      requireSecureConnection: true,
      blockSuspiciousConnections: true,
      messageTypeWhitelist: ["chat", "heartbeat", "auth"], // Only allowed types
      rateLimitPerConnection: {
        messagesPerMinute: 10,
        messagesPerHour: 100,
        bytesPerMinute: 128 * 1024, // 128KB
      },
      validateHeaders: true,
      sanitizePayload: true,
      connectionTimeout: 10000, // 10 seconds
      heartbeatInterval: 5000, // 5 seconds
      maxMessageSize: 512 * 1024, // 512KB max message
    };
  }

  static createApiGatewayConfig(): Partial<SecurityWebSocketMiddlewareConfig> {
    return {
      allowedOrigins: ["*"], // Usually configured at load balancer
      maxConnectionsPerIP: 20,
      requireSecureConnection: true,
      messageTypeBlacklist: ["admin", "system", "debug"],
      rateLimitPerConnection: {
        messagesPerMinute: 60,
        messagesPerHour: 2000,
        bytesPerMinute: 1024 * 1024, // 1MB
      },
      validateHeaders: true,
      sanitizePayload: true,
      skipMessageTypes: ["ping", "pong", "heartbeat", "metrics"],
    };
  }

  /**
   * Factory methods for creating SecurityWebSocketMiddleware with different configs
   */
  static createDevelopment(
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>
  ): SecurityWebSocketMiddleware {
    const devConfig = SecurityWebSocketMiddleware.createDevelopmentConfig();
    const config = {
      ...devConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-websocket-dev",
      priority: 100,
    };
    return new SecurityWebSocketMiddleware(metrics, config);
  }

  static createProduction(
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>
  ): SecurityWebSocketMiddleware {
    const prodConfig = SecurityWebSocketMiddleware.createProductionConfig();
    const config = {
      ...prodConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-websocket-prod",
      priority: 100,
    };
    return new SecurityWebSocketMiddleware(metrics, config);
  }

  static createHighSecurity(
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>
  ): SecurityWebSocketMiddleware {
    const highSecConfig =
      SecurityWebSocketMiddleware.createHighSecurityConfig();
    const config = {
      ...highSecConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-websocket-strict",
      priority: 100,
    };
    return new SecurityWebSocketMiddleware(metrics, config);
  }

  static createApiGateway(
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityWebSocketMiddlewareConfig>
  ): SecurityWebSocketMiddleware {
    const apiConfig = SecurityWebSocketMiddleware.createApiGatewayConfig();
    const config = {
      ...apiConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-websocket-api",
      priority: 100,
    };
    return new SecurityWebSocketMiddleware(metrics, config);
  }
}

/**
 * Helper interfaces
 */
interface ConnectionInfo {
  connectionId: string;
  clientIp: string;
  connectedAt: Date;
  lastActivity: Date;
  messageCount: number;
  totalBytes: number;
  securityViolations: number;
  origin: string;
  userAgent: string;
}

interface RateLimitInfo {
  minuteWindow: number;
  hourWindow: number;
  messagesThisMinute: number;
  messagesThisHour: number;
  bytesThisMinute: number;
}

/**
 * Factory function for easy middleware creation
 * @deprecated Use SecurityWebSocketMiddleware.createDevelopment, createProduction, etc. instead
 */
export function createSecurityWebSocketMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<SecurityWebSocketMiddlewareConfig>
): SecurityWebSocketMiddleware {
  const finalConfig = {
    enabled: true,
    name: "security-websocket",
    priority: 100,
    ...config,
  };
  return new SecurityWebSocketMiddleware(metrics, finalConfig);
}
