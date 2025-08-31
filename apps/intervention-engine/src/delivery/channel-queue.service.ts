import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { InterventionTrigger, InterventionDelivery } from "./types";

import { getEnv } from "@libs/config";

const DELIVERY_CONFIG = {
  queues: {
    email: getEnv("DELIVERY_QUEUE_EMAIL", "intervention:email:queue"),
    sms: getEnv("DELIVERY_QUEUE_SMS", "intervention:sms:queue"),
    push: getEnv("DELIVERY_QUEUE_PUSH", "intervention:push:queue"),
  },
};

export class ChannelQueueService {
  private redis: any;
  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  async queueChannelDelivery(
    channel: "email" | "sms" | "push",
    trigger: InterventionTrigger,
    delivery: InterventionDelivery
  ): Promise<void> {
    const job = {
      type: channel,
      deliveryId: delivery.id,
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      trigger: trigger.trigger,
      priority: trigger.priority,
      scheduledFor: new Date(),
    };
    await this.redis.lpush(
      DELIVERY_CONFIG.queues[channel],
      JSON.stringify(job)
    );
    delivery.status = "pending";
    delivery.metadata.queuedAt = new Date().toISOString();
    this.logger.info(
      `${channel.charAt(0).toUpperCase() + channel.slice(1)} delivery queued`,
      {
        deliveryId: delivery.id,
        campaignId: trigger.campaignId,
        userId: trigger.userId,
      }
    );
  }
}
