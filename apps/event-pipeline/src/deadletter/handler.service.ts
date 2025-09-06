import type { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { inject } from "tsyringe";

export class DeadLetterHandler {
  private logger = createLogger("event-pipeline-deadletter");
  constructor(@inject("RedisClient") private redis: RedisClient) {}
  async handle(event: any) {
    this.logger.warn("Dead letter event", { event });
    // Store failed event in Redis for later analysis/retry
    this.redis.getRedis().lpush("deadletter:events", JSON.stringify(event));
  }
}
