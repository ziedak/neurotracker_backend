import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

export class DeduplicationService {
  private redis: any;
  private logger: Logger;

  constructor() {
    this.redis = RedisClient.getInstance();
    this.logger = Logger.getInstance("DeduplicationService");
  }

  async isDuplicate(event: any): Promise<boolean> {
    try {
      const key = `event:${event.eventId}`;
      const exists = await this.redis.get(key);
      if (exists) {
        this.logger.info("Duplicate event detected", {
          eventId: event.eventId,
        });
        return true;
      }
      // Cache event for deduplication (1 hour)
      await this.redis.set(key, JSON.stringify(event), "EX", 3600);
      return false;
    } catch (error) {
      this.logger.error("Deduplication check failed", error as Error, {
        event,
      });
      return false;
    }
  }
}
