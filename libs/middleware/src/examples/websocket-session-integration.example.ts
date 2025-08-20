/**
 * WebSocket Session Integration Example
 * Shows how to use the enhanced WebSocketAuthMiddleware with UnifiedSessionManager
 */

import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  UnifiedSessionManager,
  DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG,
} from "@libs/auth";
import {
  WebSocketAuthMiddleware,
  type WebSocketSessionContext,
} from "../websocket/WebSocketAuthMiddleware";
import { type WebSocketAuthConfig } from "../types";

/**
 * Example WebSocket server setup with session integration
 */
export class WebSocketServerExample {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly sessionManager: UnifiedSessionManager;
  private readonly authMiddleware: WebSocketAuthMiddleware;

  constructor() {
    this.logger = Logger.getInstance("WebSocketServerExample");
    this.metrics = MetricsCollector.getInstance();

    // Initialize session manager
    this.sessionManager = new UnifiedSessionManager(
      DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG,
      this.logger,
      this.metrics
    );

    // Configure WebSocket authentication with session support
    const authConfig: WebSocketAuthConfig = {
      name: "websocket-session-auth",
      enabled: true,
      requireAuth: true,
      closeOnAuthFailure: true,
      jwtSecret: process.env.JWT_SECRET || "your-jwt-secret",
      skipAuthenticationForTypes: ["ping", "pong"],
      messagePermissions: {
        send_message: ["chat:send", "websocket:message"],
        join_room: ["chat:join", "room:access"],
        admin_command: ["admin:execute", "system:control"],
      },
      messageRoles: {
        admin_command: ["admin", "superuser"],
        moderate_chat: ["moderator", "admin"],
      },
    };

    this.authMiddleware = new WebSocketAuthMiddleware(
      authConfig,
      this.sessionManager,
      this.logger,
      this.metrics
    );
  }

  /**
   * Initialize the WebSocket server
   */
  async initialize(): Promise<void> {
    try {
      // Initialize session manager first
      await this.sessionManager.initialize();

      this.logger.info("WebSocket server with session integration initialized");
    } catch (error) {
      this.logger.error(
        "Failed to initialize WebSocket server",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Handle incoming WebSocket connection
   */
  async handleConnection(ws: any, request: any): Promise<void> {
    const connectionId = `ws_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create WebSocket context
    const context: WebSocketSessionContext = {
      ws,
      connectionId,
      message: { type: "connection", payload: {} },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        clientIp: request.socket.remoteAddress,
        userAgent: request.headers["user-agent"],
        headers: request.headers,
        query: this.parseQuery(request.url),
      },
      authenticated: false,
    };

    try {
      // Execute authentication middleware
      await this.authMiddleware.execute(context, async () => {
        this.logger.info("WebSocket connection authenticated", {
          connectionId,
          userId: context.userId,
          sessionId: context.sessionId,
          authMethod: context.authMethod,
        });

        // Set up message handlers
        this.setupMessageHandlers(ws, context);
      });
    } catch (error) {
      this.logger.error("WebSocket authentication failed", error as Error, {
        connectionId,
      });

      ws.close(1008, "Authentication failed");
    }
  }

  /**
   * Set up message handlers for authenticated connections
   */
  private setupMessageHandlers(
    ws: any,
    context: WebSocketSessionContext
  ): void {
    ws.on("message", async (data: string) => {
      try {
        const message = JSON.parse(data);
        context.message = message;
        context.metadata.lastActivity = new Date();
        context.metadata.messageCount++;

        // Execute middleware for each message
        await this.authMiddleware.execute(context, async () => {
          await this.handleMessage(context, message);
        });
      } catch (error) {
        this.logger.error("Message processing failed", error as Error, {
          connectionId: context.connectionId,
          userId: context.userId,
        });
      }
    });

    ws.on("close", async () => {
      await this.handleDisconnection(context);
    });

    ws.on("error", (error: Error) => {
      this.logger.error("WebSocket error", error, {
        connectionId: context.connectionId,
        userId: context.userId,
      });
    });
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(
    context: WebSocketSessionContext,
    message: any
  ): Promise<void> {
    // Update session activity
    if (context.sessionId) {
      await this.sessionManager.updateSession(context.sessionId, {
        lastActivity: new Date(),
      });
    }

    // Route message based on type
    switch (message.type) {
      case "send_message":
        await this.handleSendMessage(context, message);
        break;
      case "join_room":
        await this.handleJoinRoom(context, message);
        break;
      case "admin_command":
        await this.handleAdminCommand(context, message);
        break;
      default:
        this.logger.warn("Unknown message type", {
          type: message.type,
          connectionId: context.connectionId,
        });
    }
  }

  /**
   * Handle disconnection and cleanup
   */
  private async handleDisconnection(
    context: WebSocketSessionContext
  ): Promise<void> {
    this.logger.info("WebSocket disconnected", {
      connectionId: context.connectionId,
      userId: context.userId,
      messageCount: context.metadata.messageCount,
    });

    // Update session to reflect WebSocket disconnect
    if (context.sessionId) {
      try {
        await this.sessionManager.updateSession(context.sessionId, {
          lastActivity: new Date(),
          // Note: Don't delete session, just update activity
          // Session may still be valid for HTTP requests
        });
      } catch (error) {
        this.logger.error(
          "Failed to update session on disconnect",
          error as Error,
          {
            sessionId: context.sessionId,
          }
        );
      }
    }
  }

  /**
   * Example message handlers
   */
  private async handleSendMessage(
    context: WebSocketSessionContext,
    message: any
  ): Promise<void> {
    // Implementation would send message to chat room
    this.logger.debug("Message sent", {
      userId: context.userId,
      room: message.room,
      content: message.content,
    });
  }

  private async handleJoinRoom(
    context: WebSocketSessionContext,
    message: any
  ): Promise<void> {
    // Implementation would add user to room
    this.logger.debug("User joined room", {
      userId: context.userId,
      room: message.room,
    });
  }

  private async handleAdminCommand(
    context: WebSocketSessionContext,
    message: any
  ): Promise<void> {
    // Implementation would execute admin command
    this.logger.info("Admin command executed", {
      userId: context.userId,
      command: message.command,
      roles: context.userRoles,
    });
  }

  /**
   * Parse query parameters from URL
   */
  private parseQuery(url: string): Record<string, string> {
    const query: Record<string, string> = {};

    if (url && url.includes("?")) {
      const queryString = url.split("?")[1];
      const params = new URLSearchParams(queryString);

      for (const [key, value] of params) {
        query[key] = value;
      }
    }

    return query;
  }
}

/**
 * Example usage
 */
export async function startWebSocketServer(): Promise<void> {
  const server = new WebSocketServerExample();

  try {
    await server.initialize();

    // In a real implementation, you would set up your WebSocket server here
    // For example, with 'ws' library:
    // const wss = new WebSocketServer({ port: 8080 });
    // wss.on('connection', (ws, request) => {
    //   server.handleConnection(ws, request);
    // });

    console.log("WebSocket server with session integration started");
  } catch (error) {
    console.error("Failed to start WebSocket server:", error);
    process.exit(1);
  }
}

// Export the enhanced middleware and context type for external use
export { WebSocketAuthMiddleware, type WebSocketSessionContext };
