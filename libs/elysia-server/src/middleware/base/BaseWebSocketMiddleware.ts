import { IMetricsCollector } from "@libs/monitoring";
import type {
  WebSocketContext,
  WebSocketMessage,
  WebSocketMiddlewareFunction,
} from "../types";
import { asWebSocket } from "../types";
import {
  AbstractMiddleware,
  type BaseMiddlewareConfig,
} from "./AbstractMiddleware";

/**
 * WebSocket Middleware configuration interface
 */
export interface WebSocketMiddlewareConfig extends BaseMiddlewareConfig {
  readonly skipMessageTypes?: readonly string[];
}

/**
 * Base class for WebSocket middleware implementations
 * Provides WebSocket-specific functionality while leveraging shared abstractions
 *
 * @template TConfig - Configuration type extending WebSocketMiddlewareConfig
 *
 * Features:
 * - Message type filtering
 * - Safe JSON serialization
 * - Connection context management
 * - WebSocket-specific error handling
 * - Immutable configuration management
 *
 * Usage:
 * ```typescript
 * class AuthMiddleware extends BaseWebSocketMiddleware<AuthConfig> {
 *   protected async execute(context: WebSocketContext, next: () => Promise<void>) {
 *     // Auth logic here
 *     await next();
 *   }
 * }
 *
 * // Usage
 * const middleware = new AuthMiddleware(metrics, config);
 * const middlewareFunction = middleware.middleware();
 * ```
 */
export abstract class BaseWebSocketMiddleware<
  TConfig extends WebSocketMiddlewareConfig = WebSocketMiddlewareConfig
> extends AbstractMiddleware<TConfig, WebSocketContext> {
  constructor(
    metrics: IMetricsCollector,
    config: Partial<TConfig>,
    name?: string
  ) {
    const wsDefaults = {
      skipMessageTypes: [] as readonly string[],
      enabled: true,
      priority: 0,
    };

    // Set default name if not provided
    const defaultName =
      name ||
      (config as Partial<BaseMiddlewareConfig>).name ||
      "base-websocket";
    const configWithDefaults = {
      ...wsDefaults,
      ...config,
      name: defaultName,
    } as TConfig;

    // Validate configuration after merging defaults
    BaseWebSocketMiddleware.validateConfig(configWithDefaults);

    super(metrics, configWithDefaults, defaultName);
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  protected abstract override execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void>;

  /**
   * Create middleware function for use in WebSocket handlers
   */
  public middleware(): WebSocketMiddlewareFunction {
    return async (context: WebSocketContext, next: () => Promise<void>) => {
      // Check if middleware is enabled
      if (!this.config.enabled) {
        this.logger.debug("WebSocket middleware disabled, skipping");
        return next();
      }

      // Check if message type should be skipped
      if (this.shouldSkip(context)) {
        this.logger.debug("Message type matched skip pattern, skipping", {
          messageType: context.message.type,
          connectionId: context.connectionId,
        });
        return next();
      }

      // Execute middleware with error handling and timing
      const startTime = Date.now();
      try {
        await this.execute(context, next);
        await this.recordTimer(
          `${this.config.name}_duration`,
          Date.now() - startTime,
          {
            messageType: context.message.type,
          }
        );
      } catch (error) {
        await this.handleError(error as Error, context);
        throw error;
      }
    };
  }

  /**
   * Check if the current message should skip this middleware
   */
  protected override shouldSkip(context: WebSocketContext): boolean {
    const messageType = context.message.type;
    return this.config.skipMessageTypes?.includes(messageType) ?? false;
  }

  /**
   * Extract relevant information from WebSocket context for logging
   */
  protected override extractContextInfo(
    context: WebSocketContext,
    extraInfoContext?: Record<string, unknown>
  ): Record<string, unknown> {
    const contextInfo: Record<string, unknown> = {
      messageType: context.message.type,
      connectionId: context.connectionId,
      userId: context.userId,
      authenticated: context.authenticated,
      clientIp: this.getClientIp(context),
    };

    // Add extra context if provided
    if (extraInfoContext) {
      Object.assign(contextInfo, extraInfoContext);
    }

    return contextInfo;
  }

  /**
   * Get connection ID from context
   */
  protected getConnectionId(context: WebSocketContext): string {
    return context.connectionId;
  }

  /**
   * Get user ID from context
   */
  protected getUserId(context: WebSocketContext): string | undefined {
    return context.userId;
  }

  /**
   * Get client IP from context
   */
  protected getClientIp(context: WebSocketContext): string {
    return context.metadata.clientIp;
  }

  /**
   * Check if connection is authenticated
   */
  protected isAuthenticated(context: WebSocketContext): boolean {
    return context.authenticated;
  }

  /**
   * Send response message through WebSocket with safe serialization
   * @param context - WebSocket context
   * @param message - Message to send
   * @param options - Send options
   */
  protected async sendResponse(
    context: WebSocketContext,
    message: WebSocketMessage,
    options: {
      addTimestamp?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<boolean> {
    const { addTimestamp = true, maxRetries = 1 } = options;

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const payload = addTimestamp
          ? typeof message === "object" && message !== null
            ? { ...message, timestamp: new Date().toISOString() }
            : { value: message, timestamp: new Date().toISOString() }
          : message;

        const serialized = this.safeJsonStringify(payload);
        if (!serialized) {
          this.logger.error("Failed to serialize WebSocket message", {
            connectionId: context.connectionId,
            messageType:
              typeof message === "object" &&
              message !== null &&
              "type" in message
                ? (message as { type: string }).type
                : undefined,
            attempt: attempt + 1,
          });
          return false;
        }

        // Send message (may be async)
        const sendResult = asWebSocket(context.ws).send(serialized);
        if (sendResult && typeof sendResult.then === "function") {
          sendResult.catch((err) =>
            this.logger.error("WebSocket send failed:", err)
          );
        }
        return true;
      } catch (error) {
        attempt++;
        this.logger.error("Failed to send WebSocket response", error as Error, {
          connectionId: context.connectionId,
          messageType:
            typeof message === "object" && message !== null && "type" in message
              ? (message as { type: string }).type
              : undefined,
          attempt,
          willRetry: attempt < maxRetries,
        });

        if (attempt >= maxRetries) {
          await this.recordMetric(`${this.config.name}_send_failed`, 1, {
            connectionId: context.connectionId,
            messageType: message.type,
          });
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Safe JSON stringification with circular reference handling
   * @param obj - Object to stringify
   */
  private safeJsonStringify(obj: unknown): string | null {
    const seen = new Set();

    try {
      return JSON.stringify(obj, (_key, value) => {
        // Handle circular references
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      });
    } catch (error) {
      this.logger.warn("JSON stringification failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Cleanup method for WebSocket middleware
   * Default implementation - override in subclasses if needed
   */
  public cleanup(): void {
    this.logger.debug("WebSocket middleware cleanup completed", {
      middlewareName: this.config.name,
    });
  }

  /**
   * Update configuration with validation
   */
  public updateConfig(configOverrides: Partial<TConfig>): void {
    const newConfig = { ...this.config, ...configOverrides } as TConfig;
    // Call static validateConfig for validation
    (this.constructor as typeof BaseWebSocketMiddleware).validateConfig(
      newConfig
    );
    // Update config via property assignment
    Object.assign(this as unknown as { config: TConfig }, {
      config: Object.freeze(newConfig),
    });
  }

  /**
   * Static method to validate configuration
   * Override in subclasses for custom validation
   */
  static validateConfig(config: unknown): void {
    if (!config || typeof config !== "object") {
      throw new Error("Configuration must be an object");
    }

    const configObj = config as Record<string, unknown>;

    if (!configObj["name"] || typeof configObj["name"] !== "string") {
      throw new Error("Configuration must have a valid name");
    }

    if (
      configObj["enabled"] !== undefined &&
      typeof configObj["enabled"] !== "boolean"
    ) {
      throw new Error("Configuration enabled must be a boolean");
    }

    // WebSocket-specific validation
    if (
      configObj["priority"] !== undefined &&
      (typeof configObj["priority"] !== "number" || configObj["priority"] < 0)
    ) {
      throw new Error("Base WebSocket priority must be a non-negative integer");
    }

    if (
      configObj["skipMessageTypes"] !== undefined &&
      (!Array.isArray(configObj["skipMessageTypes"]) ||
        !configObj["skipMessageTypes"].every(
          (type: unknown) => typeof type === "string"
        ))
    ) {
      throw new Error(
        "Configuration skipMessageTypes must be an array of strings"
      );
    }
  }

  /**
   * Sort middleware instances by priority (lower priority numbers first = higher priority)
   */
  static sortByPriority<T extends BaseWebSocketMiddleware>(
    middlewares: T[]
  ): T[] {
    return middlewares.sort((a, b) => a.config.priority - b.config.priority);
  }

  /**
   * Factory method to create middleware instances
   */
  static create<
    TConfig extends WebSocketMiddlewareConfig,
    T extends BaseWebSocketMiddleware<TConfig>
  >(
    metrics: IMetricsCollector,
    config: TConfig,
    MiddlewareClass: new (
      metrics: IMetricsCollector,
      config: TConfig,
      name?: string
    ) => T
  ): T {
    return new MiddlewareClass(metrics, config, config.name);
  }

  // Instance methods expected by tests
  protected beforeProcessing(context: WebSocketContext): void {
    this.logger.debug("Before processing WebSocket message", {
      connectionId: context.connectionId,
      messageType: context.message?.type,
    });
  }

  protected afterProcessing(context: WebSocketContext): void {
    this.logger.debug("After processing WebSocket message", {
      connectionId: context.connectionId,
      messageType: context.message?.type,
    });
  }

  // Alias methods for backward compatibility with tests
  protected async beforeExecute(context: WebSocketContext): Promise<void> {
    this.beforeProcessing(context);
    return Promise.resolve();
  }

  protected async afterExecute(context: WebSocketContext): Promise<void> {
    this.afterProcessing(context);
    return Promise.resolve();
  }
}
