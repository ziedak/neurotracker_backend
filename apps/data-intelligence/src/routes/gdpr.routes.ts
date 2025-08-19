import type { Elysia } from "@libs/elysia-server";
import { PostgreSQLClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

/**
 * GDPR Endpoints
 * Handles data subject requests: access, erasure, export
 */
export function setupGdprRoutes(app: Elysia) {
  const prisma = PostgreSQLClient.getInstance();
  const logger = Logger.getInstance("gdpr");

  app.group("/gdpr", (group) => {
    // Data Access Request
    group.get("/access/:userId", async ({ params }) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: params.userId },
        });
        if (!user) return { error: "User not found" };
        // Return user profile and related data (customize as needed)
        return { user };
      } catch (error) {
        logger.error("GDPR access failed", error as Error, {
          userId: params.userId,
        });
        return {
          error: "GDPR access error",
          message: (error as Error).message,
        };
      }
    });

    // Data Erasure Request
    group.delete("/erase/:userId", async ({ params }) => {
      try {
        // Erase user and related data (customize for all relevant tables)
        await prisma.user.delete({ where: { id: params.userId } });
        // TODO: Delete related records (orders, features, etc.)
        logger.info("GDPR erasure completed", { userId: params.userId });
        return { success: true };
      } catch (error) {
        logger.error("GDPR erasure failed", error as Error, {
          userId: params.userId,
        });
        return {
          error: "GDPR erasure error",
          message: (error as Error).message,
        };
      }
    });

    // Data Export Request
    group.get("/export/:userId", async ({ params }) => {
      try {
        // Export user data (customize for all relevant tables)
        const user = await prisma.user.findUnique({
          where: { id: params.userId },
        });
        // TODO: Export related records (orders, features, etc.)
        if (!user) return { error: "User not found" };
        return { user /*, orders, features, ...*/ };
      } catch (error) {
        logger.error("GDPR export failed", error as Error, {
          userId: params.userId,
        });
        return {
          error: "GDPR export error",
          message: (error as Error).message,
        };
      }
    });
    return app;
  });
}
