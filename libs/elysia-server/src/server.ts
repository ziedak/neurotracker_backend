import { Elysia } from "elysia";
import { type IMetricsCollector } from "@libs/monitoring";
import { createLogger, type ILogger } from "@libs/utils";

import { ServerConfig, DEFAULT_SERVER_CONFIG } from "./config";
import { setupCorePlugins } from "./plugins";

// Import advanced middleware system
import {
  HttpMiddlewareChain,
  WebSocketMiddlewareChain,
  MiddlewareChainPatterns,
  ChainFactory,
  type HttpChainItem,

  // Import middleware classes (only the ones we actually use)
  LoggingHttpMiddleware,
  LoggingWebSocketMiddleware,
  RateLimitHttpMiddleware,
  RateLimitWebSocketMiddleware,
  SecurityHttpMiddleware,
  SecurityWebSocketMiddleware,
  CorsHttpMiddleware,
  PrometheusHttpMiddleware,

  // Import types
  type MiddlewareContext,
  type WebSocketContext,
  type WebSocketMessage,
  type AdvancedMiddlewareConfig,
} from "./middleware";

/**
 * Extended WebSocket interface with connection metadata
 */
interface ExtendedWebSocket {
  connectionId?: string;
  connectedAt?: number;
  send: (data: string | Buffer) => void;
  close: () => void;
  [key: string]: unknown;
}
/**
 * Advanced Elysia Server Builder with sophisticated middleware chaining
 *
 * Features:
 * - Priority-based middleware execution
 * - Factory patterns for common configurations
 * - WebSocket and HTTP middleware chains
 * - Metrics and monitoring integration
 * - Hot-swappable middleware configuration
 * - Production-ready patterns
 */
export class AdvancedElysiaServerBuilder {
  private app?: Elysia;
  private readonly config: ServerConfig;
  private readonly connections: Map<string, ExtendedWebSocket | unknown> =
    new Map();
  private readonly rooms: Map<string, Set<string>> = new Map();
  private readonly userConnections: Map<string, Set<string>> = new Map();
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;
  private readonly createdAt: number = Date.now();

  // Advanced middleware chains
  private httpChain?: HttpMiddlewareChain;
  private wsChain?: WebSocketMiddlewareChain;
  private middlewareConfig: AdvancedMiddlewareConfig | undefined;

  constructor(
    config: Partial<ServerConfig>,
    metrics: IMetricsCollector,
    middlewareConfig?: AdvancedMiddlewareConfig
  ) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config } as ServerConfig;
    this.metrics = metrics;
    this.middlewareConfig = middlewareConfig;
    this.logger = createLogger(`AdvancedElysiaServer:${this.config.name}`);

    // Initialize middleware chains
    this.initializeMiddlewareChains();
  }

  /**
   * Initialize middleware chains with configuration
   */
  private initializeMiddlewareChains(): void {
    try {
      // Initialize HTTP middleware chain
      if (this.middlewareConfig?.http?.enabled !== false) {
        this.httpChain = this.createHttpChain();
      }

      // Initialize WebSocket middleware chain
      if (this.middlewareConfig?.websocket?.enabled !== false) {
        this.wsChain = this.createWebSocketChain();
      }

      this.logger.info("Advanced middleware chains initialized", {
        httpEnabled: !!this.httpChain,
        wsEnabled: !!this.wsChain,
        httpMiddlewares: this.httpChain?.getCount() ?? 0,
        wsMiddlewares: this.wsChain ? this.getWebSocketMiddlewareCount() : 0,
      });
    } catch (error) {
      this.logger.error(
        "Failed to initialize middleware chains",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Get WebSocket middleware count
   */
  private getWebSocketMiddlewareCount(): number {
    return this.wsChain?.getCount() ?? 0;
  }

  /**
   * Create HTTP middleware chain with factory patterns or custom configuration
   */
  private createHttpChain(): HttpMiddlewareChain {
    const middlewares: HttpChainItem[] = [];

    // Use factory pattern if specified
    if (this.middlewareConfig?.http?.factoryPattern) {
      const pattern = this.middlewareConfig.http.factoryPattern;
      const patternConfig = MiddlewareChainPatterns[pattern]?.();

      if (patternConfig) {
        // Add logging middleware with factory priority
        if (
          this.middlewareConfig?.logging?.enabled !== false &&
          "logging" in patternConfig.priorities
        ) {
          middlewares.push({
            name: "logging",
            middleware: new LoggingHttpMiddleware(
              this.metrics,
              this.middlewareConfig?.logging?.config ??
                this.middlewareConfig?.logging ??
                {}
            ),
            priority: patternConfig.priorities.logging ?? 150,
            enabled: true,
          });
        }

        // Add CORS middleware with factory priority (only if pattern supports it)
        if (
          this.middlewareConfig?.cors?.enabled !== false &&
          "cors" in patternConfig.priorities
        ) {
          middlewares.push({
            name: "cors",
            middleware: new CorsHttpMiddleware(
              this.metrics,
              this.middlewareConfig?.cors?.config ??
                this.middlewareConfig?.cors ??
                {}
            ),
            priority: patternConfig.priorities.cors ?? 140,
            enabled: true,
          });
        }

        // Add security middleware with factory priority (only if pattern supports it)
        if (
          this.middlewareConfig?.security?.enabled !== false &&
          "security" in patternConfig.priorities
        ) {
          middlewares.push({
            name: "security",
            middleware: new SecurityHttpMiddleware(
              this.metrics,
              this.middlewareConfig?.security?.config ??
                this.middlewareConfig?.security ??
                {}
            ),
            priority: patternConfig.priorities.security ?? 130,
            enabled: true,
          });
        }

        // Add rate limiting middleware with factory priority
        if (this.middlewareConfig?.rateLimit?.enabled !== false) {
          middlewares.push({
            name: "rateLimit",
            middleware: new RateLimitHttpMiddleware(
              this.metrics,
              this.middlewareConfig?.rateLimit?.config ??
                this.middlewareConfig?.rateLimit ??
                {}
            ),
            priority: patternConfig.priorities.rateLimit ?? 120,
            enabled: true,
          });
        }

        // Add Prometheus middleware if enabled and pattern supports metrics
        if (
          this.middlewareConfig?.prometheus?.enabled !== false &&
          "metrics" in patternConfig.priorities
        ) {
          middlewares.push({
            name: "prometheus",
            middleware: new PrometheusHttpMiddleware(
              this.metrics,
              this.middlewareConfig?.prometheus?.config ??
                this.middlewareConfig?.prometheus ??
                {}
            ),
            priority: patternConfig.priorities.metrics ?? 10,
            enabled: true,
          });
        }
      }
    }

    // Create chain using factory
    return ChainFactory.createHttpChain(
      this.metrics,
      "advanced-http-chain",
      middlewares
    );
  }

  /**
   * Create WebSocket middleware chain with factory patterns or custom configuration
   */
  private createWebSocketChain(): WebSocketMiddlewareChain {
    // Create basic WebSocket chain
    const chain = new WebSocketMiddlewareChain(
      this.metrics,
      "advanced-websocket-chain"
    );

    // Use factory pattern if specified
    if (this.middlewareConfig?.websocket?.factoryPattern) {
      const pattern = this.middlewareConfig.websocket.factoryPattern;
      const patternConfig = MiddlewareChainPatterns[pattern]?.();

      if (patternConfig) {
        // Add logging middleware with factory priority
        if (
          this.middlewareConfig?.logging?.enabled !== false &&
          "logging" in patternConfig.priorities
        ) {
          const loggingMiddleware = new LoggingWebSocketMiddleware(
            this.metrics,
            this.middlewareConfig?.logging?.config ??
              this.middlewareConfig?.logging ??
              {}
          );

          chain.register(
            {
              name: "ws-logging",
              priority: patternConfig.priorities.logging ?? 150,
            },
            loggingMiddleware.middleware()
          );
        }

        // Add rate limiting middleware with factory priority
        if (this.middlewareConfig?.rateLimit?.enabled !== false) {
          const rateLimitMiddleware = new RateLimitWebSocketMiddleware(
            this.metrics,
            this.middlewareConfig?.rateLimit?.config ??
              this.middlewareConfig?.rateLimit ??
              {}
          );

          chain.register(
            {
              name: "ws-rateLimit",
              priority: patternConfig.priorities.rateLimit ?? 130,
            },
            rateLimitMiddleware.middleware()
          );
        }

        // Add security middleware with factory priority (using validation priority for WebSocket security)
        if (
          this.middlewareConfig?.security?.enabled !== false &&
          "validation" in patternConfig.priorities
        ) {
          const securityMiddleware = new SecurityWebSocketMiddleware(
            this.metrics,
            this.middlewareConfig?.security?.config ??
              this.middlewareConfig?.security ??
              {}
          );

          chain.register(
            {
              name: "ws-security",
              priority: patternConfig.priorities.validation ?? 120,
            },
            securityMiddleware.middleware()
          );
        }
      }
    }

    return chain;
  }

  /**
   * Build the advanced Elysia server with middleware chains
   */
  public build(): Elysia {
    this.app = new Elysia({
      name: this.config.name,
      serve: {
        port: this.config.port,
        hostname: "localhost",
      },
    });

    // Setup core plugins
    setupCorePlugins(this.app, this.config);

    // Apply HTTP middleware chain
    if (this.httpChain) {
      this.setupHttpMiddleware();
    }

    // Setup WebSocket with middleware chain
    if (this.config.websocket?.enabled && this.wsChain) {
      this.setupWebSocketWithMiddleware().catch((error) => {
        this.logger.error("Failed to setup WebSocket with middleware", error);
        this.logger.error("Failed to setup WebSocket with middleware", error);
      });
    }

    // Health check endpoint
    this.app.get("/health", () => this.getHealthStatus());

    // Advanced middleware management endpoints
    this.app.get("/middleware/status", () => this.getMiddlewareStatus());

    this.logger.info("Advanced Elysia server built successfully", {
      name: this.config.name,
      port: this.config.port,
      httpMiddleware: !!this.httpChain,
      wsMiddleware: !!this.wsChain,
      wsEnabled: this.config.websocket?.enabled ?? false,
    });

    return this.app;
  }

  /**
   * Setup HTTP middleware chain
   */
  private setupHttpMiddleware(): void {
    if (!this.httpChain || !this.app) return;

    const chainMiddleware = this.httpChain.execute();

    this.app.onBeforeHandle(async ({ request, set }) => {
      const context: MiddlewareContext = {
        request: {
          method: request.method,
          url: request.url,
          headers: request.headers as unknown as Record<string, string>,
          body: undefined,
        },
        headers: request.headers as unknown as Record<string, string>,
        response: {
          status: 200,
          headers: {},
          body: undefined,
        },
        timestamp: new Date().toISOString(),
        set: {
          headers: {},
          status: 200,
        },
      };

      try {
        await chainMiddleware(context, (): Promise<void> => {
          // Middleware chain completed successfully
          this.logger.debug("HTTP middleware chain executed successfully", {
            path: request.url,
          });
          return Promise.resolve();
        });

        // Apply response modifications
        if (context.response?.status) {
          set.status = context.response.status;
        }

        if (context.response?.headers) {
          Object.entries(context.response.headers).forEach(([key, value]) => {
            set.headers[key] = value;
          });
        }

        // Middleware chain completed successfully
        return undefined;
      } catch (error) {
        this.logger.error("HTTP middleware chain failed", error as Error, {
          path: request.url,
        });

        set.status = 500;
        return { error: "Internal server error" };
      }
    });
  }

  /**
   * Setup WebSocket with advanced middleware chain
   */
  private setupWebSocketWithMiddleware(): void {
    if (!this.wsChain || !this.app) return;

    this.app.ws("/ws", {
      open: async (ws) => {
        const connectionId = this.generateConnectionId();
        this.connections.set(connectionId, ws);

        // Set connection metadata
        (ws as unknown as ExtendedWebSocket).connectionId = connectionId;
        (ws as unknown as ExtendedWebSocket).connectedAt = Date.now();

        this.logger.info("WebSocket connection opened", { connectionId });

        // Record metric if available
        await this.metrics.recordCounter("websocket_connections_opened", 1);
      },

      message: async (ws, message) => {
        const { connectionId } = ws as unknown as ExtendedWebSocket;

        if (!connectionId) {
          this.logger.warn("WebSocket message received without connection ID");
          return;
        }

        // Parse message into WebSocketMessage format
        let parsedMessage: WebSocketMessage;
        try {
          if (typeof message === "string") {
            parsedMessage = JSON.parse(message);
          } else if (Buffer.isBuffer(message)) {
            // Handle binary messages - convert to base64 string for now
            parsedMessage = {
              type: "binary",
              payload: message.toString("base64"),
            };
          } else {
            parsedMessage = {
              type: "unknown",
              payload: message,
            };
          }
        } catch (error) {
          this.logger.warn("Failed to parse WebSocket message", {
            error: (error as Error).message,
            connectionId,
          });
          parsedMessage = {
            type: "unknown",
            payload: message,
          };
        }

        const context: WebSocketContext = {
          ws,
          message: parsedMessage,
          connectionId,
          timestamp: new Date().toISOString(),
          authenticated: false, // Default to unauthenticated
          metadata: {
            connectedAt: new Date(
              (ws as unknown as ExtendedWebSocket).connectedAt ?? Date.now()
            ),
            lastActivity: new Date(),
            messageCount: 1,
            clientIp: "127.0.0.1", // Default IP, should be extracted from request
            headers: {},
            query: {},
          },
        };

        try {
          // Execute WebSocket middleware chain
          if (this.wsChain) {
            await this.wsChain.execute(context);
          }

          // Default message handling
          this.handleDefaultWebSocketMessage(
            ws,
            message as string | Buffer,
            connectionId
          );
        } catch (error) {
          this.logger.error(
            "WebSocket middleware chain failed",
            error as Error,
            {
              connectionId,
              message:
                typeof message === "string"
                  ? message.slice(0, 100)
                  : "[binary]",
            }
          );

          // Send error response
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Message processing failed",
              timestamp: new Date().toISOString(),
            })
          );
        }
      },

      close: async (ws) => {
        const { connectionId } = ws as unknown as ExtendedWebSocket;

        if (connectionId) {
          this.connections.delete(connectionId);
          this.cleanupUserConnection(connectionId);

          this.logger.info("WebSocket connection closed", { connectionId });

          // Record metric if available
          await this.metrics.recordCounter("websocket_connections_closed", 1);
        }
      },
    });
  }

  /**
   * Default WebSocket message handler (called after middleware chain)
   */
  private handleDefaultWebSocketMessage(
    ws: ExtendedWebSocket,
    message: string | Buffer,
    connectionId: string
  ): void {
    try {
      if (typeof message === "string") {
        const parsed = JSON.parse(message);

        switch (parsed.type) {
          case "ping":
            ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
            break;

          case "join_room":
            this.joinRoom(connectionId, parsed.room);
            ws.send(
              JSON.stringify({
                type: "room_joined",
                room: parsed.room,
                timestamp: Date.now(),
              })
            );
            break;

          case "leave_room":
            this.leaveRoom(connectionId, parsed.room);
            ws.send(
              JSON.stringify({
                type: "room_left",
                room: parsed.room,
                timestamp: Date.now(),
              })
            );
            break;

          default:
            this.logger.debug("Unknown message type", {
              type: parsed.type,
              connectionId,
            });
        }
      }
    } catch (error) {
      this.logger.error("Failed to handle WebSocket message", error as Error, {
        connectionId,
      });
    }
  }

  /**
   * Join a room
   */
  private joinRoom(connectionId: string, room: string): void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    const roomSet = this.rooms.get(room);
    if (roomSet) {
      roomSet.add(connectionId);
    }

    this.logger.debug("Connection joined room", { connectionId, room });
  }

  /**
   * Leave a room
   */
  private leaveRoom(connectionId: string, room: string): void {
    const roomConnections = this.rooms.get(room);
    if (roomConnections) {
      roomConnections.delete(connectionId);
      if (roomConnections.size === 0) {
        this.rooms.delete(room);
      }
    }

    this.logger.debug("Connection left room", { connectionId, room });
  }

  /**
   * Cleanup user connections on disconnect
   */
  private cleanupUserConnection(connectionId: string): void {
    // Remove from all rooms
    for (const [room, connections] of this.rooms.entries()) {
      if (connections.has(connectionId)) {
        connections.delete(connectionId);
        if (connections.size === 0) {
          this.rooms.delete(room);
        }
      }
    }

    // Remove from user connections
    for (const [userId, connections] of this.userConnections.entries()) {
      if (connections.has(connectionId)) {
        connections.delete(connectionId);
        if (connections.size === 0) {
          this.userConnections.delete(userId);
        }
      }
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get health status including middleware information
   */
  private getHealthStatus(): {
    status: string;
    timestamp: string;
    uptime: number;
    server: {
      name: string;
      port: number;
      websocket: boolean;
    };
    middleware: {
      http: {
        enabled: boolean;
        count: number;
      };
      websocket: {
        enabled: boolean;
        count: number;
      };
    };
    connections: {
      total: number;
      rooms: number;
      users: number;
    };
  } {
    const now = Date.now();

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: now - this.createdAt,
      server: {
        name: this.config.name,
        port: this.config.port,
        websocket: this.config.websocket?.enabled ?? false,
      },
      middleware: {
        http: {
          enabled: !!this.httpChain,
          count: this.httpChain?.getCount() ?? 0,
        },
        websocket: {
          enabled: !!this.wsChain,
          count: this.getWebSocketMiddlewareCount(),
        },
      },
      connections: {
        total: this.connections.size,
        rooms: this.rooms.size,
        users: this.userConnections.size,
      },
    };
  }

  /**
   * Get detailed middleware status
   */
  private getMiddlewareStatus(): {
    timestamp: string;
    http: {
      enabled: boolean;
      count: number;
      middlewares: Array<{
        name: string;
        priority: number;
        enabled: boolean;
      }>;
    };
    websocket: {
      enabled: boolean;
      count: number;
      middlewares: unknown[];
    };
  } {
    return {
      timestamp: new Date().toISOString(),
      http: {
        enabled: !!this.httpChain,
        count: this.httpChain?.getCount() ?? 0,
        middlewares: this.httpChain?.getMiddlewares() ?? [],
      },
      websocket: {
        enabled: !!this.wsChain,
        count: this.getWebSocketMiddlewareCount(),
        middlewares: [], // WebSocket chain doesn't expose middleware list
      },
    };
  }

  /**
   * Hot-swap middleware configuration
   */
  public updateMiddlewareConfig(
    newConfig: Partial<AdvancedMiddlewareConfig>
  ): void {
    this.middlewareConfig = { ...this.middlewareConfig, ...newConfig };

    // Reinitialize chains with new configuration
    this.initializeMiddlewareChains();

    this.logger.info("Middleware configuration updated", {
      httpEnabled: !!this.httpChain,
      wsEnabled: !!this.wsChain,
    });
  }

  /**
   * Get middleware configuration
   */
  public getMiddlewareConfig(): AdvancedMiddlewareConfig | undefined {
    return this.middlewareConfig;
  }

  /**
   * Enable/disable specific middleware
   */
  public toggleMiddleware(
    type: "http" | "websocket",
    name: string,
    enabled: boolean
  ): boolean {
    if (type === "http" && this.httpChain) {
      return this.httpChain.toggle(name, enabled);
    } else if (type === "websocket" && this.wsChain) {
      // WebSocket chain doesn't have toggle method in current implementation
      this.logger.warn("WebSocket middleware toggle not supported yet", {
        name,
        enabled,
      });
      return false;
    }

    return false;
  }

  /**
   * Get server instance
   */
  public getApp(): Elysia | undefined {
    return this.app;
  }

  /**
   * Get server configuration
   */
  public getConfig(): ServerConfig {
    return this.config;
  }

  /**
   * Cleanup method for testing - clears all internal state
   */
  public cleanup(): void {
    this.connections.clear();
    this.rooms.clear();
    this.userConnections.clear();
  }
}

/**
 * Factory function for creating advanced Elysia server
 */
export function createAdvancedElysiaServer(
  config: Partial<ServerConfig>,
  metrics: IMetricsCollector,
  middlewareConfig?: AdvancedMiddlewareConfig
): AdvancedElysiaServerBuilder {
  return new AdvancedElysiaServerBuilder(config, metrics, middlewareConfig);
}

/**
 * Convenience function for creating production-ready server
 */
export function createProductionServer(
  config: Partial<ServerConfig>,
  metrics: IMetricsCollector,
  customConfig?: Partial<AdvancedMiddlewareConfig>
): AdvancedElysiaServerBuilder {
  const productionMiddlewareConfig: AdvancedMiddlewareConfig = {
    http: {
      enabled: true,
      factoryPattern: "PRODUCTION_HTTP",
    },
    websocket: {
      enabled: true,
      factoryPattern: "PRODUCTION_WS",
    },
    cors: { enabled: true },
    rateLimit: { enabled: true },
    security: { enabled: true },
    logging: { enabled: true, logLevel: "info" as const },
    prometheus: { enabled: true },
    ...customConfig,
  };

  return new AdvancedElysiaServerBuilder(
    config,
    metrics,
    productionMiddlewareConfig
  );
}

/**
 * Convenience function for creating development server
 */
export function createDevelopmentServer(
  config: Partial<ServerConfig>,
  metrics: IMetricsCollector,
  customConfig?: Partial<AdvancedMiddlewareConfig>
): AdvancedElysiaServerBuilder {
  const developmentMiddlewareConfig: AdvancedMiddlewareConfig = {
    http: {
      enabled: true,
      factoryPattern: "DEVELOPMENT",
    },
    websocket: {
      enabled: true,
      factoryPattern: "DEVELOPMENT",
    },
    cors: { enabled: true },
    rateLimit: { enabled: false },
    security: { enabled: false },
    logging: { enabled: true, logLevel: "debug" as const },
    prometheus: { enabled: true },
    ...customConfig,
  };

  return new AdvancedElysiaServerBuilder(
    config,
    metrics,
    developmentMiddlewareConfig
  );
}
