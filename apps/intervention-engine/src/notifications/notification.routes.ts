import { Elysia, t } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { TemplateService } from "./template.service";
import { EmailService } from "./email.service";
import { SMSService } from "./sms.service";
import { PushService } from "./push.service";

export const createNotificationRoutes = (
  templateService: TemplateService,
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

            const deliveryId = await emailService.sendEmail({
              to: recipientEmail,
              subject,
              templateId: template,
              variables,
              storeId,
            });

            metrics.recordCounter("notifications.email.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId,
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

            const deliveryId = await smsService.sendNotification({
              recipientPhone,
              template,
              variables,
              storeId,
            });

            metrics.recordCounter("notifications.sms.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId,
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

            const deliveryId = await pushService.sendNotification({
              recipientToken,
              title,
              template,
              variables,
              storeId,
            });

            metrics.recordCounter("notifications.push.sent", 1, {
              storeId,
              template,
            });

            return {
              success: true,
              data: {
                deliveryId,
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

      // Get template
      .get("/template/:templateId", async ({ params, query, set }: any) => {
        try {
          const { templateId } = params;
          const { storeId } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const template = await templateService.getTemplate(
            templateId,
            storeId
          );

          return {
            success: true,
            data: template,
          };
        } catch (error) {
          logger.error("Failed to get template", error as Error);

          set.status = 404;
          return {
            success: false,
            error: "Template not found",
            message: (error as Error).message,
          };
        }
      })

      // List templates
      .get("/templates", async ({ query }: any) => {
        try {
          const { storeId, category } = query;

          if (!storeId) {
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const templates = await templateService.listTemplates(
            storeId,
            category
          );

          return {
            success: true,
            data: {
              templates,
              count: templates.length,
            },
          };
        } catch (error) {
          logger.error("Failed to list templates", error as Error);

          return {
            success: false,
            error: "Failed to list templates",
            message: (error as Error).message,
          };
        }
      })

      // Create/update template
      .put(
        "/template/:templateId",
        async ({ params, body, set }: any) => {
          try {
            const { templateId } = params;
            const templateData = body;

            await templateService.updateTemplate(templateId, templateData);

            return {
              success: true,
              data: {
                templateId,
                updated: true,
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to update template", error as Error);

            set.status = 500;
            return {
              success: false,
              error: "Failed to update template",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            storeId: t.String(),
            name: t.String(),
            category: t.String(),
            channel: t.String(),
            subject: t.Optional(t.String()),
            content: t.String(),
            variables: t.Optional(t.Array(t.String())),
            metadata: t.Optional(t.Record(t.String(), t.Any())),
          }),
        }
      )

      // Notification health check
      .get("/health", async () => {
        const health = {
          status: "healthy",
          services: {
            template: await templateService.healthCheck(),
            email: await emailService.healthCheck(),
            sms: await smsService.healthCheck(),
            push: await pushService.healthCheck(),
          },
          timestamp: new Date().toISOString(),
        };

        const allHealthy = Object.values(health.services).every(
          (s) => s.status === "healthy"
        );

        return {
          ...health,
          status: allHealthy ? "healthy" : "degraded",
        };
      })
  );
};
