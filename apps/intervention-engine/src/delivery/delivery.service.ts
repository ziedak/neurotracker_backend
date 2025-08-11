import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { WebSocketGateway } from "./websocket.gateway";
import {
  InterventionTrigger,
  InterventionDelivery,
  InterventionMessage,
} from "./types";

export class DeliveryService {
  private redis: any;

  constructor(
    private logger: Logger,
    private metrics: MetricsCollector,
    private wsGateway: WebSocketGateway
  ) {
    this.redis = RedisClient.getInstance();
  }

  /**
   * Process intervention trigger and deliver via appropriate channels
   */
  async processIntervention(
    trigger: InterventionTrigger
  ): Promise<InterventionDelivery[]> {
    const startTime = Date.now();
    this.logger.info(`Processing intervention`, {
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      type: trigger.trigger.type,
    });

    const deliveries: InterventionDelivery[] = [];

    try {
      // Apply delay if specified
      if (trigger.delayMs && trigger.delayMs > 0) {
        await this.scheduleDelayedDelivery(trigger);
        return deliveries;
      }

      // Check if intervention has expired
      if (trigger.expiresAt && new Date() > trigger.expiresAt) {
        this.logger.warn(`Intervention expired`, {
          campaignId: trigger.campaignId,
          userId: trigger.userId,
          expiresAt: trigger.expiresAt,
        });
        this.metrics.recordCounter("intervention.expired");
        return deliveries;
      }

      // Check intervention frequency limits
      const canDeliver = await this.checkFrequencyLimits(trigger);
      if (!canDeliver) {
        this.logger.info(`Intervention blocked by frequency limits`, {
          campaignId: trigger.campaignId,
          userId: trigger.userId,
        });
        this.metrics.recordCounter("intervention.blocked.frequency");
        return deliveries;
      }

      // Process each delivery channel
      for (const channel of trigger.channels) {
        const delivery = await this.deliverToChannel(trigger, channel);
        if (delivery) {
          deliveries.push(delivery);
        }
      }

      // Record intervention processed
      await this.recordInterventionHistory(trigger, deliveries);

      const duration = Date.now() - startTime;
      this.metrics.recordTimer("intervention.processing.duration", duration);
      this.metrics.recordCounter("intervention.processed", 1, {
        campaignId: trigger.campaignId,
        type: trigger.trigger.type,
        channels: trigger.channels.length.toString(),
      });

      return deliveries;
    } catch (error) {
      this.logger.error(`Failed to process intervention`, error as Error, {
        campaignId: trigger.campaignId,
        userId: trigger.userId,
      });

      this.metrics.recordCounter("intervention.processing.failed", 1, {
        campaignId: trigger.campaignId,
        type: trigger.trigger.type,
      });

      throw error;
    }
  }

  /**
   * Deliver intervention to specific channel
   */
  private async deliverToChannel(
    trigger: InterventionTrigger,
    channel: string
  ): Promise<InterventionDelivery | null> {
    const deliveryId = this.generateDeliveryId();
    const delivery: InterventionDelivery = {
      id: deliveryId,
      interventionId: this.generateInterventionId(trigger),
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      channel: channel as any,
      status: "pending",
      metadata: {},
    };

    try {
      switch (channel) {
        case "websocket":
          await this.deliverViaWebSocket(trigger, delivery);
          break;

        case "email":
          await this.queueEmailDelivery(trigger, delivery);
          break;

        case "sms":
          await this.queueSMSDelivery(trigger, delivery);
          break;

        case "push":
          await this.queuePushDelivery(trigger, delivery);
          break;

        default:
          this.logger.warn(`Unknown delivery channel`, { channel });
          return null;
      }

      this.logger.info(`Intervention delivered`, {
        deliveryId,
        channel,
        campaignId: trigger.campaignId,
        userId: trigger.userId,
      });

      this.metrics.recordCounter("intervention.delivered", 1, {
        channel,
        campaignId: trigger.campaignId,
      });

      return delivery;
    } catch (error) {
      delivery.status = "failed";
      delivery.metadata.failureReason = (error as Error).message;

      this.logger.error(`Failed to deliver intervention`, error as Error, {
        deliveryId,
        channel,
        campaignId: trigger.campaignId,
      });

      this.metrics.recordCounter("intervention.delivery.failed", 1, {
        channel,
        campaignId: trigger.campaignId,
      });

      return delivery;
    }
  }

  /**
   * Deliver intervention via WebSocket
   */
  private async deliverViaWebSocket(
    trigger: InterventionTrigger,
    delivery: InterventionDelivery
  ): Promise<void> {
    const message: Partial<InterventionMessage> = {
      type: "trigger_intervention",
      payload: {
        interventionId: delivery.interventionId,
        campaignId: trigger.campaignId,
        userId: trigger.userId,
        storeId: trigger.storeId,
        cartId: trigger.cartId,
        trigger: trigger.trigger,
        deliveryId: delivery.id,
      },
    };

    // Try to deliver to user's active connections
    const sent = this.wsGateway.sendToUser(
      trigger.storeId,
      trigger.userId,
      message
    );

    if (sent > 0) {
      delivery.status = "delivered";
      delivery.deliveredAt = new Date();
      delivery.metadata.connectionId = `store:${trigger.storeId}:user:${trigger.userId}`;

      this.logger.info(`WebSocket intervention delivered`, {
        deliveryId: delivery.id,
        userId: trigger.userId,
        storeId: trigger.storeId,
        connectionsSent: sent,
      });
    } else {
      // User not connected, queue for later delivery or use fallback channel
      delivery.status = "failed";
      delivery.metadata.failureReason = "User not connected via WebSocket";

      this.logger.warn(`WebSocket delivery failed - user not connected`, {
        deliveryId: delivery.id,
        userId: trigger.userId,
        storeId: trigger.storeId,
      });
    }
  }

  /**
   * Queue email delivery for processing by notification service
   */
  private async queueEmailDelivery(
    trigger: InterventionTrigger,
    delivery: InterventionDelivery
  ): Promise<void> {
    const emailJob = {
      type: "email",
      deliveryId: delivery.id,
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      trigger: trigger.trigger,
      priority: trigger.priority,
      scheduledFor: new Date(),
    };

    await this.redis.lpush(
      "intervention:email:queue",
      JSON.stringify(emailJob)
    );

    delivery.status = "pending";
    delivery.metadata.queuedAt = new Date().toISOString();

    this.logger.info(`Email delivery queued`, {
      deliveryId: delivery.id,
      campaignId: trigger.campaignId,
      userId: trigger.userId,
    });
  }

  /**
   * Queue SMS delivery
   */
  private async queueSMSDelivery(
    trigger: InterventionTrigger,
    delivery: InterventionDelivery
  ): Promise<void> {
    const smsJob = {
      type: "sms",
      deliveryId: delivery.id,
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      trigger: trigger.trigger,
      priority: trigger.priority,
      scheduledFor: new Date(),
    };

    await this.redis.lpush("intervention:sms:queue", JSON.stringify(smsJob));

    delivery.status = "pending";
    delivery.metadata.queuedAt = new Date().toISOString();
  }

  /**
   * Queue push notification delivery
   */
  private async queuePushDelivery(
    trigger: InterventionTrigger,
    delivery: InterventionDelivery
  ): Promise<void> {
    const pushJob = {
      type: "push",
      deliveryId: delivery.id,
      campaignId: trigger.campaignId,
      userId: trigger.userId,
      storeId: trigger.storeId,
      trigger: trigger.trigger,
      priority: trigger.priority,
      scheduledFor: new Date(),
    };

    await this.redis.lpush("intervention:push:queue", JSON.stringify(pushJob));

    delivery.status = "pending";
    delivery.metadata.queuedAt = new Date().toISOString();
  }

  /**
   * Schedule delayed intervention delivery
   */
  private async scheduleDelayedDelivery(
    trigger: InterventionTrigger
  ): Promise<void> {
    const executeAt = Date.now() + trigger.delayMs!;
    const delayedJob = {
      ...trigger,
      delayMs: 0, // Remove delay for actual execution
      executeAt,
    };

    await this.redis.zadd(
      "intervention:delayed:queue",
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
      delayMs: trigger.delayMs!.toString(),
    });
  }

  /**
   * Check intervention frequency limits for user
   */
  private async checkFrequencyLimits(
    trigger: InterventionTrigger
  ): Promise<boolean> {
    const userKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}`;
    const campaignKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}:${trigger.campaignId}`;

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Check global user limits (max 5 interventions per hour, 20 per day)
    const userHourCount = await this.redis.zcount(userKey, hourAgo, now);
    const userDayCount = await this.redis.zcount(userKey, dayAgo, now);

    if (userHourCount >= 5 || userDayCount >= 20) {
      return false;
    }

    // Check campaign-specific limits (max 1 per hour, 3 per day)
    const campaignHourCount = await this.redis.zcount(
      campaignKey,
      hourAgo,
      now
    );
    const campaignDayCount = await this.redis.zcount(campaignKey, dayAgo, now);

    if (campaignHourCount >= 1 || campaignDayCount >= 3) {
      return false;
    }

    return true;
  }

  /**
   * Record intervention in history for frequency limiting
   */
  private async recordInterventionHistory(
    trigger: InterventionTrigger,
    deliveries: InterventionDelivery[]
  ): Promise<void> {
    const now = Date.now();
    const userKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}`;
    const campaignKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}:${trigger.campaignId}`;

    const record = {
      campaignId: trigger.campaignId,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
      })),
      timestamp: now,
    };

    // Record in both user and campaign frequency trackers
    await Promise.all([
      this.redis.zadd(userKey, now, JSON.stringify(record)),
      this.redis.zadd(campaignKey, now, JSON.stringify(record)),
      // Clean up old records (older than 7 days)
      this.redis.zremrangebyscore(userKey, 0, now - 7 * 24 * 60 * 60 * 1000),
      this.redis.zremrangebyscore(
        campaignKey,
        0,
        now - 7 * 24 * 60 * 60 * 1000
      ),
    ]);
  }

  /**
   * Process delayed interventions
   */
  async processDelayedInterventions(): Promise<number> {
    const now = Date.now();
    const delayedJobs = await this.redis.zrangebyscore(
      "intervention:delayed:queue",
      0,
      now,
      "LIMIT",
      0,
      100
    );

    if (delayedJobs.length === 0) {
      return 0;
    }

    let processed = 0;
    for (const jobData of delayedJobs) {
      try {
        const trigger: InterventionTrigger = JSON.parse(jobData);
        await this.processIntervention(trigger);

        // Remove from delayed queue
        await this.redis.zrem("intervention:delayed:queue", jobData);
        processed++;
      } catch (error) {
        this.logger.error(
          `Failed to process delayed intervention`,
          error as Error
        );
        // Remove failed job to prevent infinite retries
        await this.redis.zrem("intervention:delayed:queue", jobData);
      }
    }

    if (processed > 0) {
      this.logger.info(`Processed delayed interventions`, { count: processed });
      this.metrics.recordCounter("intervention.delayed.processed", processed);
    }

    return processed;
  }

  /**
   * Generate unique delivery ID
   */
  private generateDeliveryId(): string {
    return `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate intervention ID from trigger
   */
  private generateInterventionId(trigger: InterventionTrigger): string {
    return `int_${trigger.campaignId}_${trigger.userId}_${Date.now()}`;
  }

  /**
   * Get delivery statistics
   */
  async getDeliveryStats(storeId?: string, timeframe = 3600000): Promise<any> {
    // Implementation would aggregate metrics from Redis
    // For now, return basic structure
    return {
      storeId,
      timeframe,
      totalDeliveries: 0,
      channelBreakdown: {
        websocket: 0,
        email: 0,
        sms: 0,
        push: 0,
      },
      statusBreakdown: {
        delivered: 0,
        failed: 0,
        pending: 0,
      },
    };
  }
}
