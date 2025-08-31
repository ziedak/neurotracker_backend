import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { InterventionTrigger } from "./types";

import { getEnv, getNumberEnv } from "@libs/config";

const DELAYED_CONFIG = {
  queue: getEnv("DELIVERY_QUEUE_DELAYED", "intervention:delayed:queue"),
  batchLimit: getNumberEnv("DELIVERY_DELAYED_BATCH_LIMIT", 100),
};

export class DelayedDeliveryService {
  private redis: any;
  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  async scheduleDelayedDelivery(trigger: InterventionTrigger): Promise<void> {
    const executeAt = Date.now() + (trigger.delayMs || 0);
    const delayedJob = {
      ...trigger,
      delayMs: 0,
      executeAt,
    };
    await this.redis.zadd(
      DELAYED_CONFIG.queue,
      executeAt,
      JSON.stringify(delayedJob)
    );
    this.logger.info(`Intervention scheduled for delayed delivery`, {
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      delayMs: trigger.delayMs,
      executeAt: new Date(executeAt),
    });
    this.metrics.recordCounter("intervention.scheduled", 1, {
      campaignId: trigger.campaignId,
      delayMs: (trigger.delayMs || 0).toString(),
    });
  }

  async processDelayedInterventions(
    processFn: (trigger: InterventionTrigger) => Promise<void>
  ): Promise<number> {
    const now = Date.now();
    const delayedJobs = await this.redis.zrangebyscore(
      DELAYED_CONFIG.queue,
      0,
      now,
      "LIMIT",
      0,
      DELAYED_CONFIG.batchLimit
    );
    if (delayedJobs.length === 0) return 0;
    let processed = 0;
    for (const jobData of delayedJobs) {
      try {
        const trigger: InterventionTrigger = JSON.parse(jobData);
        await processFn(trigger);
        await this.redis.zrem(DELAYED_CONFIG.queue, jobData);
        processed++;
      } catch (error) {
        this.logger.error(
          `Failed to process delayed intervention`,
          error as Error
        );
        await this.redis.zrem(DELAYED_CONFIG.queue, jobData);
      }
    }
    if (processed > 0) {
      this.logger.info(`Processed delayed interventions`, { count: processed });
      this.metrics.recordCounter("intervention.delayed.processed", processed);
    }
    return processed;
  }
}
