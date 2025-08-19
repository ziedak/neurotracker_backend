import { ValidationService } from "./validation.service";
import { RoutingService } from "../processing/routing.service";
import { RedisClient, ClickHouseClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { UserEvent } from "@libs/models";

const logger = Logger.getInstance("event-pipeline-batch");

export class BatchController {
  private validationService = new ValidationService();
  private routingService = new RoutingService();
  private redis = RedisClient.getInstance();

  async processBatch(events: any[]): Promise<any> {
    if (!Array.isArray(events))
      throw new Error("Batch payload must be an array");
    if (events.length > 1000)
      throw new Error("Batch size exceeds limit (1000)");

    const results = await Promise.allSettled(
      events.map(async (raw) => {
        try {
          const event: UserEvent = this.validationService.validate(raw);
          const eventKey = `event:${event.userId}:${event.eventType}:${event.timestamp}`;
          const isDuplicate = await this.redis.exists(eventKey);
          if (isDuplicate) return { status: "duplicate", eventKey };
          await ClickHouseClient.insert("raw_events", [event]);
          await this.redis.setex(eventKey, 3600, JSON.stringify(event));
          await this.routingService.route(event);
          return { status: "accepted", eventKey };
        } catch (error: any) {
          logger.error("Batch event failed", error);
          return { status: "error", message: error.message };
        }
      })
    );
    return {
      status: "batch_processed",
      count: events.length,
      results,
      timestamp: new Date().toISOString(),
    };
  }
}
