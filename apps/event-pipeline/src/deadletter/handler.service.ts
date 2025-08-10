import { Logger } from "@libs/monitoring";
import { RedisClient } from "@libs/database";

const logger = new Logger("event-pipeline-deadletter");
const redis = RedisClient.getInstance();

export class DeadLetterHandler {
  async handle(event: any) {
    logger.warn("Dead letter event", { event });
    // Store failed event in Redis for later analysis/retry
    await redis.lpush("deadletter:events", JSON.stringify(event));
  }
}
