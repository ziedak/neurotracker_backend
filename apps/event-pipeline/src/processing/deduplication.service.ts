import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { inject } from "tsyringe";

export class DeduplicationService {
  private logger = createLogger("DeduplicationService");
  constructor(@inject("RedisClient") private redis: RedisClient) {}

  async isDuplicate(event: any): Promise<boolean> {
    try {
      const key = `event:${event.eventId}`;
      const exists = await this.redis.safeGet(key);
      if (exists) {
        this.logger.info("Duplicate event detected", {
          eventId: event.eventId,
        });
        return true;
      }
      // Cache event for deduplication (1 hour)
      await this.redis.safeSet(key, JSON.stringify(event), 3600);
      return false;
    } catch (error) {
      this.logger.error("Deduplication check failed", error as Error, {
        event,
      });
      return false;
    }
  }
}
