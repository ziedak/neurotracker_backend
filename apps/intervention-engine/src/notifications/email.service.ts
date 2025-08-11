import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  NotificationJob,
  NotificationResult,
  EmailConfig,
  PersonalizationData,
} from "./types";
import { TemplateService } from "./template.service";

export class EmailService {
  private config: EmailConfig;

  constructor(
    private logger: Logger,
    private metrics: MetricsCollector,
    private templateService: TemplateService
  ) {
    this.config = {
      provider: (process.env.EMAIL_PROVIDER as any) || "sendgrid",
      apiKey: process.env.EMAIL_API_KEY || "",
      fromEmail: process.env.EMAIL_FROM || "noreply@example.com",
      fromName: process.env.EMAIL_FROM_NAME || "Intervention Engine",
      replyTo: process.env.EMAIL_REPLY_TO,
    };
  }

  /**
   * Send email notification
   */
  async sendEmail(
    job: NotificationJob,
    personalizationData: PersonalizationData
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      this.logger.info("Sending email notification", {
        jobId: job.id,
        deliveryId: job.deliveryId,
        campaignId: job.campaignId,
        userId: job.userId,
        recipient: job.recipient.email,
      });

      // Validate recipient
      if (!job.recipient.email) {
        throw new Error("Email recipient is required");
      }

      if (!this.isValidEmail(job.recipient.email)) {
        throw new Error("Invalid email address");
      }

      // Get and render template
      const template = await this.templateService.getTemplate(
        job.campaignId,
        "email"
      );
      if (!template) {
        throw new Error(
          `No email template found for campaign: ${job.campaignId}`
        );
      }

      const renderedContent = this.templateService.renderTemplate(
        template,
        personalizationData
      );
      const renderedSubject = template.subject
        ? this.templateService.renderTemplate(
            { ...template, content: template.subject },
            personalizationData
          )
        : `Notification from ${personalizationData.store.name}`;

      // Send email based on provider
      let result: NotificationResult;

      switch (this.config.provider) {
        case "sendgrid":
          result = await this.sendViaSendGrid(
            job,
            renderedSubject,
            renderedContent
          );
          break;
        case "ses":
          result = await this.sendViaSES(job, renderedSubject, renderedContent);
          break;
        case "smtp":
          result = await this.sendViaSMTP(
            job,
            renderedSubject,
            renderedContent
          );
          break;
        default:
          throw new Error(
            `Unsupported email provider: ${this.config.provider}`
          );
      }

      const duration = Date.now() - startTime;

      if (result.success) {
        this.logger.info("Email sent successfully", {
          jobId: job.id,
          messageId: result.messageId,
          duration,
        });

        this.metrics.recordCounter("email.sent", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });

        this.metrics.recordTimer("email.send_duration", duration, {
          provider: this.config.provider,
          status: "success",
        });
      } else {
        this.logger.error(
          "Email sending failed",
          new Error(result.error || "Unknown error"),
          {
            jobId: job.id,
            duration,
          }
        );

        this.metrics.recordCounter("email.failed", 1, {
          provider: this.config.provider,
          campaignId: job.campaignId,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error("Email sending error", error as Error, {
        jobId: job.id,
        campaignId: job.campaignId,
        duration,
      });

      this.metrics.recordCounter("email.error", 1, {
        provider: this.config.provider,
        campaignId: job.campaignId,
      });

      this.metrics.recordTimer("email.send_duration", duration, {
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
   * Send email via SendGrid
   */
  private async sendViaSendGrid(
    job: NotificationJob,
    subject: string,
    content: string
  ): Promise<NotificationResult> {
    try {
      // Mock SendGrid implementation
      // In production, integrate with @sendgrid/mail

      this.logger.debug("Sending email via SendGrid", {
        to: job.recipient.email,
        subject: subject.substring(0, 50) + "...",
        contentLength: content.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200)
      );

      // Mock success response
      const messageId = `sg_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "sendgrid",
          to: job.recipient.email,
          subject,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `SendGrid error: ${(error as Error).message}`,
        metadata: { provider: "sendgrid" },
      };
    }
  }

  /**
   * Send email via AWS SES
   */
  private async sendViaSES(
    job: NotificationJob,
    subject: string,
    content: string
  ): Promise<NotificationResult> {
    try {
      // Mock SES implementation
      // In production, integrate with AWS SDK v3

      this.logger.debug("Sending email via SES", {
        to: job.recipient.email,
        subject: subject.substring(0, 50) + "...",
        contentLength: content.length,
      });

      // Simulate API call delay
      await new Promise((resolve) =>
        setTimeout(resolve, 150 + Math.random() * 300)
      );

      // Mock success response
      const messageId = `ses_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "ses",
          to: job.recipient.email,
          subject,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `SES error: ${(error as Error).message}`,
        metadata: { provider: "ses" },
      };
    }
  }

  /**
   * Send email via SMTP
   */
  private async sendViaSMTP(
    job: NotificationJob,
    subject: string,
    content: string
  ): Promise<NotificationResult> {
    try {
      // Mock SMTP implementation
      // In production, integrate with nodemailer

      this.logger.debug("Sending email via SMTP", {
        to: job.recipient.email,
        subject: subject.substring(0, 50) + "...",
        contentLength: content.length,
      });

      // Simulate SMTP delay
      await new Promise((resolve) =>
        setTimeout(resolve, 200 + Math.random() * 400)
      );

      // Mock success response
      const messageId = `smtp_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      return {
        success: true,
        messageId,
        metadata: {
          provider: "smtp",
          to: job.recipient.email,
          subject,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `SMTP error: ${(error as Error).message}`,
        metadata: { provider: "smtp" },
      };
    }
  }

  /**
   * Validate email address format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get email service health status
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
      this.logger.error("Email service health check failed", error as Error);

      return {
        status: "unhealthy",
        provider: this.config.provider,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get email service configuration (without sensitive data)
   */
  getConfig(): Partial<EmailConfig> {
    return {
      provider: this.config.provider,
      fromEmail: this.config.fromEmail,
      fromName: this.config.fromName,
      replyTo: this.config.replyTo,
    };
  }
}
