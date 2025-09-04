import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import type {
  WebSocketContext,
  WebSocketMiddlewareFunction,
  WebSocketMiddlewareOptions,
} from "../types";

/**
 * Base class for WebSocket middleware implementations
 * Provides common functionality for WebSocket-specific middleware
 */
export abstract class BaseWebSocketMiddleware<
  TConfig extends WebSocketMiddlewareOptions = WebSocketMiddlewareOptions
> {
  protected readonly logger: ILogger;
  protected readonly metrics: IMetricsCollector | undefined;
  protected readonly config: TConfig;
  protected readonly name: string;

  constructor(
    name: string,
    config: TConfig,
    logger: ILogger,
    metrics?: IMetricsCollector
  ) {
    this.name = name;
    this.logger = logger.child({ wsMiddleware: name });
    this.metrics = metrics;
    this.config = {
      enabled: true,
      priority: 0,
      skipMessageTypes: [],
      ...config,
      name,
    } as TConfig;

    this.logger.debug("WebSocket middleware initialized", {
      name: this.name,
      enabled: this.config.enabled,
      skipMessageTypes: this.config.skipMessageTypes?.length || 0,
    });
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  abstract execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void | any>;

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
      if (this.shouldSkipMessage(context)) {
        this.logger.debug("Message type matched skip pattern, skipping", {
          messageType: context.message.type,
          connectionId: context.connectionId,
        });
        return next();
      }

      // Execute middleware with error handling
      try {
        return await this.execute(context, next);
      } catch (error) {
        await this.handleError(error as Error, context);
        throw error;
      }
    };
  }

  /**
   * Check if the current message should skip this middleware
   */
  protected shouldSkipMessage(context: WebSocketContext): boolean {
    const messageType = context.message.type;

    return this.config.skipMessageTypes?.includes(messageType) || false;
  }

  /**
   * Handle errors that occur during middleware execution
   */
  protected async handleError(
    error: Error,
    context: WebSocketContext
  ): Promise<void> {
    this.logger.error(`${this.name} WebSocket middleware error`, error, {
      messageType: context.message.type,
      connectionId: context.connectionId,
      userId: context.userId,
    });

    await this.recordMetric(`${this.name}_ws_error`, 1, {
      messageType: context.message.type,
      authenticated: context.authenticated ? "true" : "false",
      realm: "websocket",
    });
  }

  /**
   * Record a metric counter
   */
  protected async recordMetric(
    name: string,
    value: number = 1,
    tags?: Record<string, string>
  ): Promise<void> {
    if (this.metrics) {
      await this.metrics.recordCounter(name, value, {
        middleware: this.name,
        type: "websocket",
        ...tags,
      });
    }
  }

  /**
   * Record a timing metric
   */
  protected async recordTimer(
    name: string,
    duration: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (this.metrics) {
      await this.metrics.recordTimer(name, duration, {
        middleware: this.name,
        type: "websocket",
        ...tags,
      });
    }
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
   * Send response message through WebSocket
   */
  protected sendResponse(context: WebSocketContext, message: any): void {
    try {
      context.ws.send(
        JSON.stringify({
          ...message,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      this.logger.error("Failed to send WebSocket response", error as Error, {
        connectionId: context.connectionId,
        messageType: message.type,
      });
    }
  }
}
