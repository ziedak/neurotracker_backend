import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  NotificationJob,
  NotificationResult,
  PushConfig,
  PersonalizationData,
} from "./types";
import { TemplateService } from "./template.service";

export class PushService {
  private config: PushConfig;

  constructor(
    private logger: Logger,
    private metrics: MetricsCollector,
    private templateService: TemplateService
  ) {
    this.config = {
      provider: (process.env.PUSH_PROVIDER as any) || "fcm",
      serverKey: process.env.PUSH_SERVER_KEY || "",
      bundleId: process.env.PUSH_BUNDLE_ID || "com.example.app",
      teamId: process.env.PUSH_TEAM_ID || "",
      keyId: process.env.PUSH_KEY_ID || "",
      privateKey: process.env.PUSH_PRIVATE_KEY || "",
    };
  }

  /**
   * Send push notification
   */
  async sendPush(
    job: NotificationJob,
    personalizationData: PersonalizationData
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      this.logger.info("Sending push notification", {
        jobId: job.id,
        deliveryId: job.deliveryId,
        campaignId: job.campaignId,
        userId: job.userId,
        hasDeviceToken: !!job.recipient.deviceToken,
      });

      // Validate recipient
      if (!job.recipient.deviceToken) {
        throw new Error("Device token is required for push notifications");
      }

      // Get and render template
      const template = await this.templateService.getTemplate(
        job.campaignId,
        "push"
      );
      if (!template) {
        throw new Error(
          `No push template found for campaign: ${job.campaignId}`
        );
      }

      const renderedContent = this.templateService.renderTemplate(
        template,
        personalizationData
      );
      const renderedTitle = template.subject
        ? this.templateService.renderTemplate(
            { ...template, content: template.subject },
            personalizationData
          )
        : personalizationData.store.name;

      // Create push payload
      const pushPayload = this.createPushPayload(
        job,
        renderedTitle,
        renderedContent,
        personalizationData
      );

      // Send push based on provider
      let result: NotificationResult;

      switch (this.config.provider) {
        case "fcm":
          result = await this.sendViaFCM(job, pushPayload);
          break;
        case "apns":
          result = await this.sendViaAPNS(job, pushPayload);
          break;
        default:
          throw new Error(`Unsupported push provider: ${this.config.provider}`);
      }

      const duration = Date.now() - startTime;

      if (result.success) {
        this.logger.info("Push notification sent successfully", {
          jobId: job.id,
          messageId: result.messageId,
          duration,
        });

        this.metrics.recordCounter("push.sent", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });

        this.metrics.recordTimer("push.send_duration", duration, {
          provider: this.config.provider,
          status: "success",
        });
      } else {
        this.logger.error(
          "Push notification sending failed",
          new Error(result.error || "Unknown error"),
          {
            jobId: job.id,
            duration,
          }
        );

        this.metrics.recordCounter("push.failed", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error("Push notification sending error", error as Error, {
        jobId: job.id,
        campaignId: job.campaignId,
        duration,
      });

      this.metrics.recordCounter("push.error", 1, {
        provider: this.config.provider,
        campaignId: job.campaignId,
      });

      this.metrics.recordTimer("push.send_duration", duration, {
        provider: this.config.provider,
        status: "error",
      });

      return {
        success: false,
        error: (error as Error).message,
        metadata: { duration },
      };
    }
  }

  /**
   * Create push notification payload
   */
  private createPushPayload(
    job: NotificationJob,
    title: string,
    body: string,
    personalizationData: PersonalizationData
  ): any {
    const basePayload: any = {
      title,
      body,
      icon: personalizationData.store.logo || "/icon-192x192.png",
      badge: 1,
      tag: `intervention_${job.campaignId}`,
      requireInteraction: false,
      silent: false,
      timestamp: Date.now(),
      data: {
        interventionId: job.deliveryId,
        campaignId: job.campaignId,
        userId: job.userId,
        storeId: job.storeId,
        type: "intervention",
        url: `${personalizationData.store.domain}/cart`,
        timestamp: new Date().toISOString(),
      },
    };

    // Add intervention-specific data
    if (personalizationData.intervention.discount) {
      basePayload.data.discount = personalizationData.intervention.discount;
    }

    if (personalizationData.intervention.urgency) {
      basePayload.data.urgency = personalizationData.intervention.urgency;
    }

    return basePayload;
  }

  /**
   * Send push notification via Firebase Cloud Messaging (FCM)
   */
  private async sendViaFCM(
    job: NotificationJob,
    payload: any
  ): Promise<NotificationResult> {
    try {
      // Mock FCM implementation
      // In production, integrate with firebase-admin SDK

      this.logger.debug("Sending push notification via FCM", {
        deviceToken: job.recipient.deviceToken?.substring(0, 20) + "...",
        title: payload.title,
        bodyLength: payload.body.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200)
      );

      // Mock success response
      const messageId = `fcm_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "fcm",
          deviceToken: job.recipient.deviceToken?.substring(0, 20) + "...",
          title: payload.title,
          body:
            payload.body.substring(0, 50) +
            (payload.body.length > 50 ? "..." : ""),
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `FCM error: ${(error as Error).message}`,
        metadata: { provider: "fcm" },
      };
    }
  }

  /**
   * Send push notification via Apple Push Notification Service (APNS)
   */
  private async sendViaAPNS(
    job: NotificationJob,
    payload: any
  ): Promise<NotificationResult> {
    try {
      // Mock APNS implementation
      // In production, integrate with node-apn or @parse/node-apn

      this.logger.debug("Sending push notification via APNS", {
        deviceToken: job.recipient.deviceToken?.substring(0, 20) + "...",
        title: payload.title,
        bodyLength: payload.body.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 150 + Math.random() * 250)
      );

      // Mock success response
      const messageId = `apns_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "apns",
          deviceToken: job.recipient.deviceToken?.substring(0, 20) + "...",
          title: payload.title,
          body:
            payload.body.substring(0, 50) +
            (payload.body.length > 50 ? "..." : ""),
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `APNS error: ${(error as Error).message}`,
        metadata: { provider: "apns" },
      };
    }
  }

  /**
   * Validate device token format
   */
  private isValidDeviceToken(token: string, provider: string): boolean {
    switch (provider) {
      case "fcm":
        // FCM tokens are typically 152 characters
        return token.length >= 140 && token.length <= 200;
      case "apns":
        // APNS device tokens are 64 hex characters
        return /^[a-fA-F0-9]{64}$/.test(token);
      default:
        return token.length > 0;
    }
  }

  /**
   * Register device token for user
   */
  async registerDeviceToken(
    userId: string,
    storeId: string,
    deviceToken: string,
    platform: "ios" | "android" | "web"
  ): Promise<boolean> {
    try {
      // Validate token format
      if (!this.isValidDeviceToken(deviceToken, this.config.provider)) {
        throw new Error("Invalid device token format");
      }

      // In production, store in Redis/Database
      // For now, just log the registration

      this.logger.info("Device token registered", {
        userId,
        storeId,
        platform,
        tokenLength: deviceToken.length,
        provider: this.config.provider,
      });

      this.metrics.recordCounter("push.token_registered", 1, {
        platform,
        provider: this.config.provider,
        storeId,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to register device token", error as Error, {
        userId,
        storeId,
        platform,
      });

      this.metrics.recordCounter("push.token_registration_failed", 1, {
        platform,
        provider: this.config.provider,
      });

      return false;
    }
  }

  /**
   * Unregister device token
   */
  async unregisterDeviceToken(
    userId: string,
    deviceToken: string
  ): Promise<boolean> {
    try {
      // In production, remove from Redis/Database

      this.logger.info("Device token unregistered", {
        userId,
        tokenLength: deviceToken.length,
      });

      this.metrics.recordCounter("push.token_unregistered", 1, {
        provider: this.config.provider,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to unregister device token", error as Error, {
        userId,
      });

      return false;
    }
  }

  /**
   * Get push service health status
   */
  async getHealthStatus(): Promise<{
    status: string;
    provider: string;
    lastCheck: Date;
  }> {
    try {
      // In production, test actual provider connectivity

      return {
        status: "healthy",
        provider: this.config.provider,
        lastCheck: new Date(),
      };
    } catch (error) {
      this.logger.error("Push service health check failed", error as Error);

      return {
        status: "unhealthy",
        provider: this.config.provider,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get push service configuration (without sensitive data)
   */
  getConfig(): Partial<PushConfig> {
    return {
      provider: this.config.provider,
      bundleId: this.config.bundleId,
    };
  }
}
