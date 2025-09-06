import { UserEvent, RedisClient } from "@libs/database";
import { ClickHouseClient } from "@libs/database";
import { RoutingService } from "../processing/routing.service";
import { ValidationService } from "./validation.service";

import { createLogger } from "@libs/utils";
import { inject } from "tsyringe";

interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
}

export class WebSocketGateway {
  private logger = createLogger("WebSocketGateway");

  constructor(
    // Get services from container to avoid duplicate instantiation
    @inject("RedisClient") private redis: RedisClient,
    @inject("ClickHouseClient") private clickhouse: ClickHouseClient,
    @inject("RoutingService") private routingService: RoutingService,
    @inject("ValidationService") private validationService: ValidationService
  ) {}

  async handleConnection(ws: any) {
    this.logger.info("WebSocket connection opened", {
      remoteAddress: ws.remoteAddress,
      readyState: ws.readyState,
    });

    // Send welcome message using Elysia's WebSocket API
    ws.send(
      JSON.stringify({
        type: "connection",
        payload: {
          message: "Connected to event-pipeline WebSocket gateway",
          status: "connected",
        },
        timestamp: new Date().toISOString(),
      })
    );
  }

  async handleEventMessage(ws: any, message: WebSocketMessage) {
    try {
      // Parse message if it's a string (from Elysia WebSocket)
      let parsedMessage: WebSocketMessage;
      if (typeof message === "string") {
        parsedMessage = JSON.parse(message);
      } else {
        parsedMessage = message;
      }

      if (parsedMessage.type !== "cart_event") {
        ws.send(
          JSON.stringify({
            type: "error",
            payload: {
              message: "Unsupported message type. Expected 'cart_event'",
            },
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // Validate event
      const event: UserEvent = this.validationService.validate(
        parsedMessage.payload
      );

      // Deduplication (assume eventType+timestamp+userId as unique key)
      const eventKey = `event:${event.userId}:${event.eventType}:${event.timestamp}`;
      const existingValue = await this.redis.safeGet(eventKey);
      if (existingValue) {
        this.logger.info("Duplicate event ignored", { eventKey });
        ws.send(
          JSON.stringify({
            type: "event_ack",
            payload: { status: "duplicate", eventKey },
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // Prepare event for ClickHouse (serialize metadata as JSON string)
      const clickhouseEvent = {
        ...event,
        metadata: JSON.stringify(event.metadata || {}),
      };

      // Store event in ClickHouse using static method
      await this.clickhouse.insert("raw_events", [clickhouseEvent]);

      // Cache event in Redis for deduplication
      await this.redis.safeSetEx(eventKey, 3600, JSON.stringify(event));

      // Route event to downstream services
      await this.routingService.route(event);

      // Send acknowledgment using Elysia WebSocket API
      ws.send(
        JSON.stringify({
          type: "event_ack",
          payload: { status: "accepted", eventKey },
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error: any) {
      this.logger.error("Event processing failed", error);
      ws.send(
        JSON.stringify({
          type: "error",
          payload: { message: error.message },
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  async handleDisconnection(ws: any, code: number, reason: string) {
    this.logger.info("WebSocket disconnected", {
      code,
      reason,
      remoteAddress: ws.remoteAddress,
    });
  }

  // Utility method for broadcasting to all connected clients (if needed)
  public broadcastMessage(message: any) {
    // This would be implemented if we need to broadcast to all connections
    // Elysia WebSocket doesn't provide a built-in broadcast method,
    // but we could maintain a connections set if needed
    this.logger.info("Broadcast requested", { messageType: message.type });
  }
}
