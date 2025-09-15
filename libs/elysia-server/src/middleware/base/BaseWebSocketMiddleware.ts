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
  constructor(metrics: IMetricsCollector, config: TConfig, name?: string) {
    const wsDefaults = {
      skipMessageTypes: [] as readonly string[],
    };

    super(metrics, { ...wsDefaults, ...config } as TConfig, name);
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
            console.error("WebSocket send failed:", err)
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
}
