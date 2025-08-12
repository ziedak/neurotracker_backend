import { Elysia, t } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { TemplateService } from "./template.service";
import { EmailService } from "./email.service";
import { SMSService } from "./sms.service";
import { PushService } from "./push.service";

export const createNotificationRoutes = (
  emailService: EmailService,
  smsService: SMSService,
  pushService: PushService,
  logger: Logger,
  metrics: MetricsCollector
) => {
  return (
    new Elysia({ prefix: "/api/notifications" })

      // Send email notification
      .post(
        "/email",
        async ({ body, set }: any) => {
          try {
            const { recipientEmail, subject, template, variables, storeId } =
              body;

            // Create NotificationJob with all required template fields
            const job = {
              id: `email_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              deliveryId: `del_${Date.now()}`,
              type: "email" as const,
              campaignId: body.campaignId || "manual",
              userId: body.userId || recipientEmail,
              storeId,
              priority: "medium" as const,
              scheduledFor: new Date(),
              attempts: 0,
              maxAttempts: 3,
              status: "pending" as const,
              template: {
                id: template,
                name: subject || "Manual Email",
                content: body.content || "",
                type: "email" as const,
                campaignId: body.campaignId || "manual",
                channel: "email" as const,
                variables: Object.keys(variables || {}),
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: { version: 1, source: "manual" },
              },
              variables: variables || {},
              recipient: {
                email: recipientEmail,
              },
              metadata: {
                source: "manual",
                timestamp: new Date().toISOString(),
              },
            };

            // Create PersonalizationData (strict structure)
            const personalizationData = {
              user: {
                email: recipientEmail,
                ...(body.user || {}),
              },
              cart: body.cart || { items: [], total: 0, currency: "USD" },
              store: body.store || {
                name: "Default Store",
                domain: "example.com",
              },
              intervention: body.intervention || { type: "manual" },
            };

            const result = await emailService.sendEmail(
              job,
              personalizationData
            );

            metrics.recordCounter("notifications.email.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId: job.deliveryId,
                messageId: result.messageId,
                channel: "email",
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to send email notification", error as Error);
            metrics.recordCounter("notifications.email.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to send email",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            recipientEmail: t.String(),
            subject: t.String(),
            template: t.String(),
            variables: t.Optional(t.Record(t.String(), t.Any())),
            storeId: t.String(),
          }),
        }
      )

      // Send SMS notification
      .post(
        "/sms",
        async ({ body, set }: any) => {
          try {
            const { recipientPhone, template, variables, storeId } = body;

            // Create SMS job
            const smsJob = {
              id: `sms_${Date.now()}`,
              type: "sms" as const,
              deliveryId: `del_${Date.now()}`,
              campaignId: "manual",
              userId: recipientPhone,
              storeId: storeId || "default",
              priority: "medium" as const,
              scheduledFor: new Date(),
              attempts: 0,
              maxAttempts: 3,
              status: "pending" as const,
              template: {
                id: template,
                name: "Manual SMS",
                content: body.message || "",
                type: "sms" as const,
                campaignId: "manual",
                channel: "sms" as const,
                variables: Object.keys(variables || {}),
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: { version: 1, source: "manual" },
              },
              variables: variables || {},
              recipient: { phone: recipientPhone },
              metadata: { source: "manual" },
            };

            // PersonalizationData for SMS
            const smsPersonalizationData = {
              user: { phone: recipientPhone },
              cart: body.cart || { items: [], total: 0, currency: "USD" },
              store: body.store || {
                name: "Default Store",
                domain: "example.com",
              },
              intervention: body.intervention || { type: "manual" },
            };

            const smsResult = await smsService.sendSMS(
              smsJob,
              smsPersonalizationData
            );

            metrics.recordCounter("notifications.sms.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId: smsJob.deliveryId,
                channel: "sms",
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to send SMS notification", error as Error);
            metrics.recordCounter("notifications.sms.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to send SMS",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            recipientPhone: t.String(),
            template: t.String(),
            variables: t.Optional(t.Record(t.String(), t.Any())),
            storeId: t.String(),
          }),
        }
      )

      // Send push notification
      .post(
        "/push",
        async ({ body, set }: any) => {
          try {
            const { recipientToken, title, template, variables, storeId } =
              body;

            // Create push job
            const pushJob = {
              id: `push_${Date.now()}`,
              type: "push" as const,
              deliveryId: `del_${Date.now()}`,
              campaignId: "manual",
              userId: recipientToken,
              storeId: storeId || "default",
              priority: "medium" as const,
              scheduledFor: new Date(),
              attempts: 0,
              maxAttempts: 3,
              status: "pending" as const,
              template: {
                id: template,
                name: title || "Manual Push",
                content: body.content || "",
                type: "push" as const,
                campaignId: "manual",
                channel: "push" as const,
                variables: Object.keys(variables || {}),
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: { version: 1, source: "manual" },
              },
              variables: variables || {},
              recipient: { deviceToken: recipientToken },
              metadata: { source: "manual" },
            };

            // PersonalizationData for push
            const pushPersonalizationData = {
              user: {},
              cart: body.cart || { items: [], total: 0, currency: "USD" },
              store: body.store || {
                name: "Default Store",
                domain: "example.com",
              },
              intervention: body.intervention || { type: "manual" },
            };

            const pushResult = await pushService.sendPush(
              pushJob,
              pushPersonalizationData
            );

            metrics.recordCounter("notifications.push.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId: pushJob.deliveryId,
                channel: "push",
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to send push notification", error as Error);
            metrics.recordCounter("notifications.push.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to send push notification",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            recipientToken: t.String(),
            title: t.String(),
            template: t.String(),
            variables: t.Optional(t.Record(t.String(), t.Any())),
            storeId: t.String(),
          }),
        }
      )

      // Notification health check (basic)
      .get("/health", async () => {
        return {
          status: "healthy",
          timestamp: new Date().toISOString(),
        };
      })
  );
};
