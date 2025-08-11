import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  NotificationJob,
  NotificationResult,
  SMSConfig,
  PersonalizationData,
} from "./types";
import { TemplateService } from "./template.service";

export class SMSService {
  private config: SMSConfig;

  constructor(
    private logger: Logger,
    private metrics: MetricsCollector,
    private templateService: TemplateService
  ) {
    this.config = {
      provider: (process.env.SMS_PROVIDER as any) || "twilio",
      accountSid: process.env.SMS_ACCOUNT_SID || "",
      authToken: process.env.SMS_AUTH_TOKEN || "",
      fromNumber: process.env.SMS_FROM_NUMBER || "+1234567890",
    };
  }

  /**
   * Send SMS notification
   */
  async sendSMS(
    job: NotificationJob,
    personalizationData: PersonalizationData
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      this.logger.info("Sending SMS notification", {
        jobId: job.id,
        deliveryId: job.deliveryId,
        campaignId: job.campaignId,
        userId: job.userId,
        recipient: job.recipient.phone,
      });

      // Validate recipient
      if (!job.recipient.phone) {
        throw new Error("Phone number is required for SMS");
      }

      if (!this.isValidPhoneNumber(job.recipient.phone)) {
        throw new Error("Invalid phone number format");
      }

      // Get and render template
      const template = await this.templateService.getTemplate(
        job.campaignId,
        "sms"
      );
      if (!template) {
        throw new Error(
          `No SMS template found for campaign: ${job.campaignId}`
        );
      }

      const renderedContent = this.templateService.renderTemplate(
        template,
        personalizationData
      );

      // Validate SMS length (most carriers limit to 160 characters for single SMS)
      if (renderedContent.length > 160) {
        this.logger.warn("SMS content exceeds 160 characters", {
          jobId: job.id,
          length: renderedContent.length,
          content: renderedContent.substring(0, 50) + "...",
        });
      }

      // Send SMS based on provider
      let result: NotificationResult;

      switch (this.config.provider) {
        case "twilio":
          result = await this.sendViaTwilio(job, renderedContent);
          break;
        case "sns":
          result = await this.sendViaSNS(job, renderedContent);
          break;
        default:
          throw new Error(`Unsupported SMS provider: ${this.config.provider}`);
      }

      const duration = Date.now() - startTime;

      if (result.success) {
        this.logger.info("SMS sent successfully", {
          jobId: job.id,
          messageId: result.messageId,
          duration,
          contentLength: renderedContent.length,
        });

        this.metrics.recordCounter("sms.sent", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });

        this.metrics.recordTimer("sms.send_duration", duration, {
          provider: this.config.provider,
          status: "success",
        });
      } else {
        this.logger.error(
          "SMS sending failed",
          new Error(result.error || "Unknown error"),
          {
            jobId: job.id,
            duration,
          }
        );

        this.metrics.recordCounter("sms.failed", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error("SMS sending error", error as Error, {
        jobId: job.id,
        campaignId: job.campaignId,
        duration,
      });

      this.metrics.recordCounter("sms.error", 1, {
        provider: this.config.provider,
        campaignId: job.campaignId,
      });

      this.metrics.recordTimer("sms.send_duration", duration, {
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
   * Send SMS via Twilio
   */
  private async sendViaTwilio(
    job: NotificationJob,
    content: string
  ): Promise<NotificationResult> {
    try {
      // Mock Twilio implementation
      // In production, integrate with twilio SDK

      this.logger.debug("Sending SMS via Twilio", {
        to: job.recipient.phone,
        from: this.config.fromNumber,
        contentLength: content.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 200 + Math.random() * 300)
      );

      // Mock success response
      const messageId = `tw_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "twilio",
          to: job.recipient.phone,
          from: this.config.fromNumber,
          content:
            content.substring(0, 50) + (content.length > 50 ? "..." : ""),
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Twilio error: ${(error as Error).message}`,
        metadata: { provider: "twilio" },
      };
    }
  }

  /**
   * Send SMS via AWS SNS
   */
  private async sendViaSNS(
    job: NotificationJob,
    content: string
  ): Promise<NotificationResult> {
    try {
      // Mock SNS implementation
      // In production, integrate with AWS SDK v3

      this.logger.debug("Sending SMS via SNS", {
        to: job.recipient.phone,
        contentLength: content.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 150 + Math.random() * 250)
      );

      // Mock success response
      const messageId = `sns_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "sns",
          to: job.recipient.phone,
          content:
            content.substring(0, 50) + (content.length > 50 ? "..." : ""),
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `SNS error: ${(error as Error).message}`,
        metadata: { provider: "sns" },
      };
    }
  }

  /**
   * Validate phone number format
   */
  private isValidPhoneNumber(phone: string): boolean {
    // Basic E.164 format validation
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Format phone number to E.164 format
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, "");

    // Add + prefix if not present
    if (!phone.startsWith("+")) {
      // Assume US number if no country code
      if (digits.length === 10) {
        return `+1${digits}`;
      }
      return `+${digits}`;
    }

    return phone;
  }

  /**
   * Get SMS service health status
   */
  async getHealthStatus(): Promise<{
    status: string;
    provider: string;
    lastCheck: Date;
  }> {
    try {
      // In production, test actual provider connectivity
      // For now, return healthy status

      return {
        status: "healthy",
        provider: this.config.provider,
        lastCheck: new Date(),
      };
    } catch (error) {
      this.logger.error("SMS service health check failed", error as Error);

      return {
        status: "unhealthy",
        provider: this.config.provider,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get SMS service configuration (without sensitive data)
   */
  getConfig(): Partial<SMSConfig> {
    return {
      provider: this.config.provider,
      fromNumber: this.config.fromNumber,
    };
  }

  /**
   * Estimate SMS cost (mock implementation)
   */
  estimateCost(
    content: string,
    recipient: string
  ): { segments: number; estimatedCost: number } {
    // Calculate SMS segments (160 chars for GSM, 70 for Unicode)
    const isUnicode = /[^\x00-\x7F]/.test(content);
    const maxLength = isUnicode ? 70 : 160;
    const segments = Math.ceil(content.length / maxLength);

    // Mock pricing (varies by country/provider)
    const baseRate = 0.0075; // $0.0075 per segment
    const estimatedCost = segments * baseRate;

    return {
      segments,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000, // Round to 4 decimal places
    };
  }
}
