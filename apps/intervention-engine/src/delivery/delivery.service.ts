// Delivery configuration constants
const DELIVERY_CONFIG = {
  frequency: {
    user: { perHour: 5, perDay: 20 },
    campaign: { perHour: 1, perDay: 3 },
    historyRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  queues: {
    email: "intervention:email:queue",
    sms: "intervention:sms:queue",
    push: "intervention:push:queue",
    delayed: "intervention:delayed:queue",
  },
};
import { Logger, MetricsCollector } from "@libs/monitoring";
import { WebSocketGateway } from "./websocket.gateway";
import {
  InterventionTrigger,
  InterventionDelivery,
  InterventionMessage,
} from "./types";
import { ChannelQueueService } from "./channel-queue.service";
import { FrequencyLimitService } from "./frequency-limit.service";
import { DelayedDeliveryService } from "./delayed-delivery.service";

/**
 * DeliveryService is the main orchestrator for intervention delivery, handling triggers, channel routing, frequency limiting, delayed scheduling, and delivery history.
WebSocketGateway manages real-time connections, user/session mapping, and message delivery for websocket interventions.
Types are well-defined for triggers, deliveries, messages, and connection pools.
 */
export class DeliveryService {
  constructor(
    private logger: Logger,
    private metrics: MetricsCollector,
    private wsGateway: WebSocketGateway,
    private channelQueue: ChannelQueueService,
    private frequencyLimit: FrequencyLimitService,
    private delayedDelivery: DelayedDeliveryService
  ) {}

  getDelayedDelivery() {
    return this.delayedDelivery;
  }
  getFrequencyLimit() {
    return this.frequencyLimit;
  }
  getWsGateway() {
    return this.wsGateway;
  }

  /**
   * Lookup delivery status by deliveryId from Redis
   */
  async getDeliveryStatus(
    deliveryId: string
  ): Promise<InterventionDelivery | null> {
    // Try to find delivery in user/campaign frequency history
    // This is a simple scan; optimize as needed for production
    const redis = (this.frequencyLimit as any).redis;
    const keys = await redis.keys("intervention:frequency:*:*:*");
    for (const key of keys) {
      const records = await redis.zrange(key, 0, -1);
      for (const record of records) {
        try {
          const parsed = JSON.parse(record);
          if (parsed.deliveries) {
            for (const delivery of parsed.deliveries) {
              if (delivery.id === deliveryId) {
                return delivery;
              }
            }
          }
        } catch {}
      }
    }
    return null;
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
        await this.delayedDelivery.scheduleDelayedDelivery(trigger);
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
      const canDeliver = await this.frequencyLimit.checkFrequencyLimits(
        trigger
      );
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
      await this.frequencyLimit.recordInterventionHistory(trigger, deliveries);

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
        case "sms":
        case "push":
          await this.channelQueue.queueChannelDelivery(
            channel as any,
            trigger,
            delivery
          );
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
   * Schedule delayed intervention delivery
   */
  // Delayed delivery logic is now delegated to DelayedDeliveryService

  /**
   * Process delayed interventions
   */
  async processDelayedInterventions(): Promise<number> {
    // Delegate to DelayedDeliveryService, passing processIntervention as callback
    return this.delayedDelivery.processDelayedInterventions(
      async (trigger: InterventionTrigger) => {
        await this.processIntervention(trigger);
      }
    );
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
