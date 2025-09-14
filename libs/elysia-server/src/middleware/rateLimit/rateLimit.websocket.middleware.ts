import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base/BaseWebSocketMiddleware";
import type { WebSocketContext } from "../types";
import { asWebSocket } from "../types";
import {
  RateLimitingCacheAdapter,
  type RateLimitAlgorithm,
  type RateLimitingAdapterConfig,
} from "@libs/ratelimit";
import { CacheService, type CacheConfigValidator } from "@libs/database";

/**
 * Internal WebSocket rate limit result interface
 */
export interface RateLimitWebSocketResult {
  allowed: boolean;
  totalHits: number;
  remaining: number;
  resetTime: number;
  windowStart: number;
  windowEnd: number;
  limit: number;
  retryAfter?: number;
  algorithm: RateLimitAlgorithm;
  cached: boolean;
  responseTime: number;
}
/**
 * Advanced WebSocket Rate limit configuration interface
 * Extends WebSocketMiddlewareConfig with comprehensive rate limiting options
 */
export interface AdvancedRateLimitWebSocketConfig
  extends WebSocketMiddlewareConfig {
  readonly algorithm: RateLimitAlgorithm;
  readonly maxMessagesPerMinute: number;
  readonly maxConnectionsPerIP?: number;
  readonly windowMs: number;
  readonly keyStrategy: "ip" | "user" | "connectionId" | "custom";
  readonly customKeyGenerator?: (context: WebSocketContext) => string;
  readonly countMessageTypes?: readonly string[];
  readonly excludeMessageTypes?: readonly string[];
  readonly enableConnectionLimiting?: boolean;
  readonly closeOnLimit?: boolean;
  readonly sendWarningMessage?: boolean;
  readonly warningThreshold?: number; // percentage of limit (e.g., 80 for 80%)
  readonly maxMessageSize?: number; // Maximum message size in bytes
  readonly redis: {
    readonly keyPrefix: string;
    readonly ttlBuffer: number;
  };
  readonly onLimitReached?: (
    result: RateLimitWebSocketResult,
    context: WebSocketContext
  ) => void;
  readonly message: {
    readonly rateLimitExceeded: string;
    readonly connectionLimitExceeded: string;
    readonly warningMessage: string;
  };
}

/**
 * WebSocket-specific rate limit strategy interface
 */
interface RateLimitWebSocketStrategy {
  generateKey(context: WebSocketContext): string;
}

/**
 * WebSocket-specific rate limit strategies
 */
class WebSocketIpStrategy implements RateLimitWebSocketStrategy {
  generateKey(context: WebSocketContext): string {
    return context.metadata.clientIp || "unknown";
  }
}

class WebSocketUserStrategy implements RateLimitWebSocketStrategy {
  generateKey(context: WebSocketContext): string {
    return (context.userId ?? context.connectionId) || "anonymous";
  }
}

class WebSocketConnectionStrategy implements RateLimitWebSocketStrategy {
  generateKey(context: WebSocketContext): string {
    return context.connectionId;
  }
}

/**
 * Default WebSocket rate limit configuration constants
 */
const DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS = {
  ALGORITHM: "sliding-window" as const,
  MAX_MESSAGES_PER_MINUTE: 60,
  MAX_CONNECTIONS_PER_IP: 10,
  WINDOW_MS: 60000, // 1 minute
  KEY_STRATEGY: "connectionId" as const,
  COUNT_MESSAGE_TYPES: [] as const, // Empty means count all
  EXCLUDE_MESSAGE_TYPES: ["ping", "pong", "heartbeat"] as const,
  ENABLE_CONNECTION_LIMITING: true,
  CLOSE_ON_LIMIT: false,
  SEND_WARNING_MESSAGE: true,
  WARNING_THRESHOLD: 80, // 80% of limit
  MAX_MESSAGE_SIZE: 1024 * 1024, // 1MB default
  REDIS_KEY_PREFIX: "ws_rl:",
  REDIS_TTL_BUFFER: 1000,
  PRIORITY: 15, // High priority for rate limiting
  MESSAGES: {
    RATE_LIMIT_EXCEEDED:
      "Rate limit exceeded. Please slow down your message frequency.",
    CONNECTION_LIMIT_EXCEEDED: "Connection limit exceeded for your IP address.",
    WARNING_MESSAGE: "You are approaching the rate limit. Please slow down.",
  },
} as const;

/**
 * Production-grade WebSocket Rate Limiting Middleware
 * Provides comprehensive rate limiting for WebSocket connections and messages
 *
 * Features:
 * - Framework-agnostic WebSocket implementation
 * - Multiple rate limiting algorithms (sliding-window, fixed-window, token-bucket, leaky-bucket)
 * - Connection-level and message-level rate limiting
 * - Flexible key generation strategies (IP, user, connectionId, custom)
 * - Enterprise-grade cache adapter integration
 * - Message type filtering (include/exclude specific types)
 * - Warning system before limits are reached
 * - Comprehensive metrics and monitoring
 * - Built-in error handling and failover
 * - Configurable connection closure on limit breach
 *
 * @template AdvancedRateLimitWebSocketConfig - WebSocket rate limiting-specific configuration
 */
export class RateLimitWebSocketMiddleware extends BaseWebSocketMiddleware<AdvancedRateLimitWebSocketConfig> {
  private readonly rateLimiter: RateLimitingCacheAdapter;
  private readonly connectionLimiter?: RateLimitingCacheAdapter;
  private readonly strategies: Map<string, RateLimitWebSocketStrategy>;
  private readonly cacheService: CacheService;

  constructor(
    metrics: IMetricsCollector,
    config: Partial<AdvancedRateLimitWebSocketConfig> = {}
  ) {
    // Create complete configuration with validated defaults
    const completeConfig = {
      name: config.name ?? "websocket-rate-limit",
      enabled: config.enabled ?? true,
      priority:
        config.priority ?? DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
      skipMessageTypes: config.skipMessageTypes ?? [],
      algorithm:
        config.algorithm ?? DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.ALGORITHM,
      maxMessagesPerMinute:
        config.maxMessagesPerMinute ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MAX_MESSAGES_PER_MINUTE,
      maxConnectionsPerIP:
        config.maxConnectionsPerIP ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MAX_CONNECTIONS_PER_IP,
      windowMs:
        config.windowMs ?? DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.WINDOW_MS,
      keyStrategy:
        config.keyStrategy ?? DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.KEY_STRATEGY,
      customKeyGenerator: config.customKeyGenerator,
      countMessageTypes:
        config.countMessageTypes ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.COUNT_MESSAGE_TYPES,
      excludeMessageTypes:
        config.excludeMessageTypes ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.EXCLUDE_MESSAGE_TYPES,
      enableConnectionLimiting:
        config.enableConnectionLimiting ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.ENABLE_CONNECTION_LIMITING,
      closeOnLimit:
        config.closeOnLimit ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.CLOSE_ON_LIMIT,
      sendWarningMessage:
        config.sendWarningMessage ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.SEND_WARNING_MESSAGE,
      warningThreshold:
        config.warningThreshold ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.WARNING_THRESHOLD,
      maxMessageSize:
        config.maxMessageSize ??
        DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MAX_MESSAGE_SIZE,
      redis: {
        keyPrefix:
          config.redis?.keyPrefix ??
          DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.REDIS_KEY_PREFIX,
        ttlBuffer:
          config.redis?.ttlBuffer ??
          DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.REDIS_TTL_BUFFER,
      },
      onLimitReached: config.onLimitReached,
      message: {
        rateLimitExceeded:
          config.message?.rateLimitExceeded ??
          DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MESSAGES.RATE_LIMIT_EXCEEDED,
        connectionLimitExceeded:
          config.message?.connectionLimitExceeded ??
          DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MESSAGES
            .CONNECTION_LIMIT_EXCEEDED,
        warningMessage:
          config.message?.warningMessage ??
          DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.MESSAGES.WARNING_MESSAGE,
      },
    } as AdvancedRateLimitWebSocketConfig;

    super(metrics, completeConfig, completeConfig.name);

    // Initialize cache service (this should be managed internally or through a service locator)
    this.cacheService = this.initializeCacheService();

    // Initialize enterprise cache adapter for message rate limiting
    const messageAdapterConfig: Partial<RateLimitingAdapterConfig> = {
      ...(completeConfig.algorithm
        ? { defaultAlgorithm: completeConfig.algorithm }
        : {}),
      keyPrefix: `${completeConfig.redis.keyPrefix}msg:`,
      ttlBufferMs: completeConfig.redis.ttlBuffer,
      enableBatchProcessing: true,
      enableMetrics: true,
      enableCompression: true,
    };

    this.rateLimiter = new RateLimitingCacheAdapter(
      this.cacheService,
      {} as CacheConfigValidator,
      messageAdapterConfig
    );

    // Initialize connection rate limiter if enabled
    if (completeConfig.enableConnectionLimiting) {
      const connectionAdapterConfig: Partial<RateLimitingAdapterConfig> = {
        ...(completeConfig.algorithm
          ? { defaultAlgorithm: completeConfig.algorithm }
          : {}),
        keyPrefix: `${completeConfig.redis.keyPrefix}conn:`,
        ttlBufferMs: completeConfig.redis.ttlBuffer,
        enableBatchProcessing: true,
        enableMetrics: true,
        enableCompression: true,
      };

      this.connectionLimiter = new RateLimitingCacheAdapter(
        this.cacheService,
        {} as CacheConfigValidator,
        connectionAdapterConfig
      );
    }

    // Initialize key generation strategies
    this.strategies = new Map<string, RateLimitWebSocketStrategy>();
    this.strategies.set("ip", new WebSocketIpStrategy());
    this.strategies.set("user", new WebSocketUserStrategy());
    this.strategies.set("connectionId", new WebSocketConnectionStrategy());

    // Add custom strategy if provided
    if (
      completeConfig.keyStrategy === "custom" &&
      completeConfig.customKeyGenerator
    ) {
      this.strategies.set("custom", {
        generateKey: completeConfig.customKeyGenerator,
      });
    }

    this.validateConfiguration();
  }

  /**
   * Core WebSocket rate limiting middleware execution logic
   * Handles both connection and message rate limiting
   */
  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // Check connection limits first (if enabled)
      if (this.config.enableConnectionLimiting) {
        const connectionAllowed = await this.checkConnectionLimit(
          context,
          requestId
        );
        if (!connectionAllowed) {
          return; // Connection limit exceeded, connection should be closed
        }
      }

      // Check if message type should be counted
      if (!this.shouldCountMessage(context.message.type)) {
        await next();
        return;
      }

      // Generate rate limit key for messages
      const key = this.generateKey(context);

      // Check message rate limit
      const result = await this.checkMessageRateLimit(key);

      // Check if limit exceeded
      if (!result.allowed) {
        await this.handleRateLimitExceeded(
          context,
          result,
          key,
          requestId,
          "message"
        );
        return;
      }

      // Check if warning should be sent
      if (this.config.sendWarningMessage) {
        await this.checkAndSendWarning(context, result);
      }

      // Process the message
      await next();

      // Record successful message processing
      await this.recordRateLimitMetrics("message_allowed", {
        algorithm: this.config.algorithm,
        keyStrategy: this.config.keyStrategy,
        messageType: context.message.type,
        connectionId: context.connectionId,
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordMetric("websocket_rate_limit_error_duration", duration, {
        error_type: error instanceof Error ? error.constructor.name : "unknown",
        connectionId: context.connectionId,
      });

      this.logger.error(
        "WebSocket rate limit middleware error",
        error as Error,
        {
          requestId,
          connectionId: context.connectionId,
          duration: Math.round(duration),
        }
      );

      // Continue processing on error (fail open)
      await next();
    } finally {
      const executionTime = performance.now() - startTime;
      await this.recordMetric(
        "websocket_rate_limit_execution_time",
        executionTime,
        {
          algorithm: this.config.algorithm,
          keyStrategy: this.config.keyStrategy,
          connectionId: context.connectionId,
        }
      );
    }
  }

  /**
   * Check connection rate limits (per IP)
   */
  private async checkConnectionLimit(
    context: WebSocketContext,
    requestId: string
  ): Promise<boolean> {
    if (!this.connectionLimiter || !this.config.maxConnectionsPerIP) {
      return true;
    }

    try {
      const ipKey = `${this.config.redis.keyPrefix}conn:ip:${context.metadata.clientIp}`;

      const result = await this.connectionLimiter.checkRateLimit(
        ipKey,
        this.config.maxConnectionsPerIP,
        this.config.windowMs,
        this.config.algorithm
      );

      if (!result.allowed) {
        await this.handleRateLimitExceeded(
          context,
          result,
          ipKey,
          requestId,
          "connection"
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Connection rate limit check failed", error as Error, {
        requestId,
        connectionId: context.connectionId,
        clientIp: context.metadata.clientIp,
      });
      return true; // Fail open
    }
  }

  /**
   * Check message rate limits
   */
  private async checkMessageRateLimit(
    key: string
  ): Promise<RateLimitWebSocketResult> {
    const adapterResult = await this.rateLimiter.checkRateLimit(
      key,
      this.config.maxMessagesPerMinute,
      this.config.windowMs,
      this.config.algorithm
    );

    // Convert adapter result to WebSocket result format
    // Handle both number and Date types for resetTime
    const resetTime =
      typeof adapterResult.resetTime === "number"
        ? adapterResult.resetTime
        : (adapterResult.resetTime as Date).getTime();

    const windowStart = adapterResult.windowStart
      ? typeof adapterResult.windowStart === "number"
        ? adapterResult.windowStart
        : (adapterResult.windowStart as Date).getTime()
      : Date.now() - this.config.windowMs;

    const windowEnd = adapterResult.windowEnd
      ? typeof adapterResult.windowEnd === "number"
        ? adapterResult.windowEnd
        : (adapterResult.windowEnd as Date).getTime()
      : resetTime;

    const result: RateLimitWebSocketResult = {
      allowed: adapterResult.allowed,
      totalHits: adapterResult.totalHits || 0,
      remaining: adapterResult.remaining,
      resetTime,
      algorithm: adapterResult.algorithm,
      windowStart,
      windowEnd,
      limit: adapterResult.limit || this.config.maxMessagesPerMinute,
      cached: adapterResult.cached || false,
      responseTime: adapterResult.responseTime || 0,
    };

    // Add retryAfter only if rate limited
    if (!adapterResult.allowed) {
      result.retryAfter = Math.max(0, resetTime - Date.now());
    }

    return result;
  }

  /**
   * Handle rate limit exceeded scenario
   */
  private async handleRateLimitExceeded(
    context: WebSocketContext,
    result: RateLimitWebSocketResult,
    key: string,
    requestId: string,
    limitType: "message" | "connection"
  ): Promise<void> {
    // Execute callback if configured
    if (this.config.onLimitReached) {
      try {
        this.config.onLimitReached(result, context);
      } catch (callbackError) {
        this.logger.warn("Rate limit callback error", {
          error:
            callbackError instanceof Error ? callbackError.message : "unknown",
          requestId,
          connectionId: context.connectionId,
        });
      }
    }

    // Log rate limit exceeded
    this.logger.warn(`WebSocket ${limitType} rate limit exceeded`, {
      key,
      algorithm: result.algorithm,
      limit: result.limit,
      remaining: result.remaining,
      resetTime: new Date(result.resetTime).toISOString(),
      connectionId: context.connectionId,
      clientIp: context.metadata.clientIp,
      userId: context.userId,
      messageType: context.message?.type,
      requestId,
    });

    // Send rate limit message to client
    const errorMessage =
      limitType === "connection"
        ? this.config.message.connectionLimitExceeded
        : this.config.message.rateLimitExceeded;

    this.sendErrorMessage(context, {
      type: "rate_limit_exceeded",
      error: errorMessage,
      limitType,
      retryAfter: result.retryAfter
        ? Math.ceil(result.retryAfter / 1000)
        : undefined,
      resetTime: new Date(result.resetTime).toISOString(),
      limit: result.limit,
      remaining: result.remaining,
      requestId,
    });

    // Close connection if configured
    if (this.config.closeOnLimit) {
      this.logger.info("Closing WebSocket connection due to rate limit", {
        connectionId: context.connectionId,
        limitType,
      });

      try {
        const closeResult = asWebSocket(context.ws).close(
          1008,
          `Rate limit exceeded: ${errorMessage}`
        );
        if (closeResult && typeof closeResult.then === "function") {
          closeResult.catch((err) =>
            console.error("WebSocket close failed:", err)
          );
        }
      } catch (closeError) {
        this.logger.warn("Failed to close WebSocket connection", {
          error: closeError instanceof Error ? closeError.message : "unknown",
          connectionId: context.connectionId,
        });
      }
    }

    // Record metrics
    await this.recordRateLimitMetrics(`${limitType}_denied`, {
      algorithm: this.config.algorithm,
      keyStrategy: this.config.keyStrategy,
      reason: "limit_exceeded",
      connectionId: context.connectionId,
    });
  }

  /**
   * Check if warning should be sent and send it
   */
  private async checkAndSendWarning(
    context: WebSocketContext,
    result: RateLimitWebSocketResult
  ): Promise<void> {
    const usagePercentage =
      ((result.limit - result.remaining) / result.limit) * 100;

    if (usagePercentage >= (this.config.warningThreshold ?? 80)) {
      this.sendWarningMessage(context, {
        type: "rate_limit_warning",
        message: this.config.message.warningMessage,
        usagePercentage: Math.round(usagePercentage),
        remaining: result.remaining,
        limit: result.limit,
        resetTime: new Date(result.resetTime).toISOString(),
      });

      await this.recordRateLimitMetrics("warning_sent", {
        connectionId: context.connectionId,
        usagePercentage: Math.round(usagePercentage).toString(),
      });
    }
  }

  /**
   * Send error message to WebSocket client
   */
  private sendErrorMessage(
    context: WebSocketContext,
    errorData: Record<string, unknown>
  ): void {
    try {
      if (asWebSocket(context.ws).readyState === 1) {
        // WebSocket.OPEN
        const sendResult = asWebSocket(context.ws).send(
          JSON.stringify(errorData)
        );
        if (sendResult && typeof sendResult.then === "function") {
          sendResult.catch((err) =>
            console.error("WebSocket send failed:", err)
          );
        }
      }
    } catch (error) {
      this.logger.warn("Failed to send error message to WebSocket client", {
        error: error instanceof Error ? error.message : "unknown",
        connectionId: context.connectionId,
      });
    }
  }

  /**
   * Send warning message to WebSocket client
   */
  private sendWarningMessage(
    context: WebSocketContext,
    warningData: Record<string, unknown>
  ): void {
    try {
      if (asWebSocket(context.ws).readyState === 1) {
        // WebSocket.OPEN
        const sendResult = asWebSocket(context.ws).send(
          JSON.stringify(warningData)
        );
        if (sendResult && typeof sendResult.then === "function") {
          sendResult.catch((err) =>
            console.error("WebSocket send failed:", err)
          );
        }
      }
    } catch (error) {
      this.logger.warn("Failed to send warning message to WebSocket client", {
        error: error instanceof Error ? error.message : "unknown",
        connectionId: context.connectionId,
      });
    }
  }

  /**
   * Generate rate limit key using configured strategy
   */
  private generateKey(context: WebSocketContext): string {
    const strategy = this.strategies.get(this.config.keyStrategy);
    if (!strategy) {
      this.logger.warn(
        "Unknown WebSocket rate limit strategy, falling back to connectionId",
        {
          strategy: this.config.keyStrategy,
          connectionId: context.connectionId,
        }
      );
      return (
        this.strategies.get("connectionId")?.generateKey(context) ?? "unknown"
      );
    }

    const baseKey = strategy.generateKey(context);
    const prefix = this.config.redis.keyPrefix;
    return `${prefix}msg:${this.config.keyStrategy}:${baseKey}`;
  }

  /**
   * Determine if message type should be counted towards rate limit
   */
  private shouldCountMessage(messageType: string): boolean {
    // If countMessageTypes is specified and not empty, only count those types
    if (
      this.config.countMessageTypes &&
      this.config.countMessageTypes.length > 0
    ) {
      return this.config.countMessageTypes.includes(messageType);
    }

    // If excludeMessageTypes is specified, exclude those types
    if (
      this.config.excludeMessageTypes &&
      this.config.excludeMessageTypes.length > 0
    ) {
      return !this.config.excludeMessageTypes.includes(messageType);
    }

    // Default: count all messages
    return true;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `ws_req_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 15)}`;
  }

  /**
   * Initialize cache service
   */
  private initializeCacheService(): CacheService {
    try {
      return CacheService.create(this.metrics);
    } catch (error) {
      this.logger.error("Failed to create CacheService", error as Error);
      throw new Error(
        `CacheService initialization failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Record rate limiting-specific metrics
   */
  private async recordRateLimitMetrics(
    action: string,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    await this.recordMetric(
      `websocket_rate_limit_${action}`,
      1,
      additionalTags
    );
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    const {
      maxMessagesPerMinute,
      maxConnectionsPerIP,
      windowMs,
      keyStrategy,
      customKeyGenerator,
      warningThreshold,
    } = this.config;

    if (maxMessagesPerMinute <= 0 || !Number.isInteger(maxMessagesPerMinute)) {
      throw new Error(
        "WebSocket rate limit maxMessagesPerMinute must be a positive integer"
      );
    }

    if (
      maxConnectionsPerIP !== undefined &&
      (maxConnectionsPerIP <= 0 || !Number.isInteger(maxConnectionsPerIP))
    ) {
      throw new Error(
        "WebSocket rate limit maxConnectionsPerIP must be a positive integer"
      );
    }

    if (windowMs <= 0 || !Number.isInteger(windowMs)) {
      throw new Error(
        "WebSocket rate limit windowMs must be a positive integer"
      );
    }

    if (keyStrategy === "custom" && !customKeyGenerator) {
      throw new Error(
        "WebSocket rate limit customKeyGenerator is required when keyStrategy is 'custom'"
      );
    }

    if (!["ip", "user", "connectionId", "custom"].includes(keyStrategy)) {
      throw new Error(
        "WebSocket rate limit keyStrategy must be one of: ip, user, connectionId, custom"
      );
    }

    if (
      warningThreshold !== undefined &&
      (warningThreshold < 0 || warningThreshold > 100)
    ) {
      throw new Error(
        "WebSocket rate limit warningThreshold must be between 0 and 100"
      );
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  public async resetRateLimit(
    identifier: string,
    limitType: "message" | "connection" = "message"
  ): Promise<void> {
    try {
      const limiter =
        limitType === "connection" ? this.connectionLimiter : this.rateLimiter;
      if (!limiter) {
        throw new Error(`${limitType} rate limiter not initialized`);
      }

      await limiter.resetRateLimit(identifier, this.config.algorithm);

      this.logger.info("WebSocket rate limit reset", {
        identifier,
        limitType,
        algorithm: this.config.algorithm,
      });
    } catch (error) {
      this.logger.error(
        "Failed to reset WebSocket rate limit",
        error as Error,
        {
          identifier,
          limitType,
        }
      );
      throw error;
    }
  }

  /**
   * Get rate limit statistics with proper typing
   */
  public getRateLimitStats(): {
    messageStats: import("@libs/ratelimit").RateLimitingStats | null;
    connectionStats?: import("@libs/ratelimit").RateLimitingStats;
  } {
    try {
      const messageStats = this.rateLimiter.getRateLimitingStats();
      const connectionStats = this.connectionLimiter?.getRateLimitingStats();

      return {
        messageStats,
        ...(connectionStats && { connectionStats }),
      };
    } catch (error) {
      this.logger.error(
        "Failed to get WebSocket rate limit stats",
        error as Error
      );
      return { messageStats: null };
    }
  }

  /**
   * Get adapter health status
   */
  public async getHealth(): Promise<{
    messageRateLimiter: Record<string, unknown>;
    connectionRateLimiter?: Record<string, unknown>;
  }> {
    try {
      const messageHealth = await this.rateLimiter.getHealth();
      const connectionHealth = this.connectionLimiter
        ? await this.connectionLimiter.getHealth()
        : undefined;

      return {
        messageRateLimiter: messageHealth,
        ...(connectionHealth && { connectionRateLimiter: connectionHealth }),
      };
    } catch (error) {
      this.logger.error(
        "Failed to get WebSocket rate limit health",
        error as Error
      );
      return {
        messageRateLimiter: {
          healthy: false,
          error: error instanceof Error ? error.message : "unknown",
        },
      };
    }
  }

  /**
   * Create general WebSocket rate limiting configuration preset
   */
  static createGeneralConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-general",
      algorithm: "sliding-window",
      maxMessagesPerMinute: 120,
      maxConnectionsPerIP: 10,
      windowMs: 60000, // 1 minute
      keyStrategy: "connectionId",
      enableConnectionLimiting: true,
      closeOnLimit: false,
      sendWarningMessage: true,
      warningThreshold: 80,
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create strict WebSocket rate limiting configuration preset
   */
  static createStrictConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-strict",
      algorithm: "fixed-window",
      maxMessagesPerMinute: 30,
      maxConnectionsPerIP: 3,
      windowMs: 60000, // 1 minute
      keyStrategy: "user",
      enableConnectionLimiting: true,
      closeOnLimit: true,
      sendWarningMessage: true,
      warningThreshold: 70,
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create gaming WebSocket rate limiting configuration preset
   */
  static createGamingConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-gaming",
      algorithm: "token-bucket",
      maxMessagesPerMinute: 600, // High frequency for gaming
      maxConnectionsPerIP: 5,
      windowMs: 60000, // 1 minute
      keyStrategy: "user",
      enableConnectionLimiting: true,
      closeOnLimit: false,
      sendWarningMessage: false, // No warnings in gaming
      excludeMessageTypes: ["ping", "pong", "heartbeat", "game_tick"],
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create chat WebSocket rate limiting configuration preset
   */
  static createChatConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-chat",
      algorithm: "leaky-bucket",
      maxMessagesPerMinute: 60,
      maxConnectionsPerIP: 10,
      windowMs: 60000, // 1 minute
      keyStrategy: "user",
      enableConnectionLimiting: true,
      closeOnLimit: false,
      sendWarningMessage: true,
      warningThreshold: 85,
      countMessageTypes: ["chat_message", "typing", "emoji_reaction"],
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create development configuration preset
   */
  static createDevelopmentConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-dev",
      algorithm: "sliding-window",
      maxMessagesPerMinute: 1000,
      maxConnectionsPerIP: 50,
      windowMs: 60000, // 1 minute
      keyStrategy: "connectionId",
      enableConnectionLimiting: false,
      closeOnLimit: false,
      sendWarningMessage: false,
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create production configuration preset
   */
  static createProductionConfig(): Partial<AdvancedRateLimitWebSocketConfig> {
    return {
      name: "websocket-rate-limit-prod",
      algorithm: "sliding-window",
      maxMessagesPerMinute: 120,
      maxConnectionsPerIP: 10,
      windowMs: 60000, // 1 minute
      keyStrategy: "user",
      enableConnectionLimiting: true,
      closeOnLimit: false,
      sendWarningMessage: true,
      warningThreshold: 80,
      excludeMessageTypes: ["ping", "pong", "heartbeat"],
      enabled: true,
      priority: DEFAULT_WEBSOCKET_RATE_LIMIT_OPTIONS.PRIORITY,
    };
  }
}

/**
 * Factory function for WebSocket rate limit middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createRateLimitWebSocketMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<AdvancedRateLimitWebSocketConfig>
): RateLimitWebSocketMiddleware {
  return new RateLimitWebSocketMiddleware(metrics, config);
}

/**
 * Preset configurations for common WebSocket rate limiting scenarios
 * Immutable configuration objects for different environments and use cases
 */
export const WEBSOCKET_RATE_LIMIT_PRESETS = {
  general: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createGeneralConfig(),

  strict: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createStrictConfig(),

  gaming: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createGamingConfig(),

  chat: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createChatConfig(),

  development: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createDevelopmentConfig(),

  production: (): Partial<AdvancedRateLimitWebSocketConfig> =>
    RateLimitWebSocketMiddleware.createProductionConfig(),
} as const;
