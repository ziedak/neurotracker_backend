import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { DataReconciliationService } from "../services/dataReconciliation.service";
import type { AuthMiddleware } from "../middleware/auth.middleware";
import type { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import type { AuditMiddleware } from "../middleware/audit.middleware";
import type { ValidationMiddleware } from "../middleware/validation.middleware";

/**
 * Data Reconciliation endpoints
 * Handles rule creation, execution, status, and scheduling
 */
export const setupReconciliationRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getDataReconciliation = () =>
    container.getService(
      "dataReconciliationService"
    ) as DataReconciliationService;
  const authMiddleware = container.getService(
    "authMiddleware"
  ) as AuthMiddleware;
  const rateLimitMiddleware = container.getService(
    "rateLimitMiddleware"
  ) as RateLimitMiddleware;
  const auditMiddleware = container.getService(
    "auditMiddleware"
  ) as AuditMiddleware;
  const validationMiddleware = container.getService(
    "validationMiddleware"
  ) as ValidationMiddleware;

  app.group("/reconciliation", (group) => {
    group.post(
      "/rules",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.auditAction(
          "create_reconciliation_rule",
          "reconciliation"
        ),
        validationMiddleware.validate({
          body: [
            { field: "name", type: "string", required: true },
            { field: "sourceTable", type: "string", required: true },
            { field: "targetTable", type: "string", required: true },
            { field: "joinKey", type: "string", required: true },
            { field: "enabled", type: "boolean", required: true },
          ],
        }),
      ],
      async ({
        body,
      }: {
        body: {
          name: string;
          sourceTable: string;
          targetTable: string;
          joinKey: string;
          enabled: boolean;
        };
      }) => {
        try {
          const reconciliationService = getDataReconciliation();
          return await reconciliationService.createRule(body);
        } catch (error) {
          return {
            error: "Rule creation failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/execute/:ruleId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.auditAction("execute_reconciliation", "reconciliation"),
        validationMiddleware.validate({
          params: [{ field: "ruleId", type: "string", required: true }],
        }),
      ],
      async ({ params }: { params: { ruleId: string } }) => {
        try {
          const reconciliationService = getDataReconciliation();
          return await reconciliationService.executeReconciliation(
            params.ruleId
          );
        } catch (error) {
          return {
            error: "Reconciliation execution failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/status",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
      ],
      async () => {
        try {
          const reconciliationService = getDataReconciliation();
          return await reconciliationService.getStatus();
        } catch (error) {
          return {
            error: "Status retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/schedule",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.auditAction(
          "schedule_reconciliation",
          "reconciliation"
        ),
      ],
      async () => {
        try {
          const reconciliationService = getDataReconciliation();
          return await reconciliationService.scheduleReconciliation();
        } catch (error) {
          return {
            error: "Scheduling failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.put(
      "/rules/:ruleId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.auditAction(
          "update_reconciliation_rule",
          "reconciliation"
        ),
        validationMiddleware.validate({
          params: [{ field: "ruleId", type: "string", required: true }],
          body: [
            { field: "name", type: "string", required: false },
            { field: "config", type: "object", required: false },
            { field: "enabled", type: "boolean", required: false },
          ],
        }),
      ],
      async ({ params, body }) => {
        // TODO: Implement rule update logic
        return { message: "Reconciliation rule update not implemented." };
      }
    );

    group.delete(
      "/rules/:ruleId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.auditAction(
          "delete_reconciliation_rule",
          "reconciliation"
        ),
        validationMiddleware.validate({
          params: [{ field: "ruleId", type: "string", required: true }],
        }),
      ],
      async ({ params }) => {
        // TODO: Implement rule delete logic
        return { message: "Reconciliation rule delete not implemented." };
      }
    );

    group.get(
      "/history",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
        validationMiddleware.validate({
          query: [
            { field: "page", type: "number", required: false },
            { field: "pageSize", type: "number", required: false },
          ],
        }),
      ],
      async ({ query }) => {
        auditMiddleware.auditAction(
          "view_reconciliation_history",
          "reconciliation"
        );
        // TODO: Implement history listing logic
        return { message: "Reconciliation history not implemented." };
      }
    );

    group.get(
      "/discrepancies/:runId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
        auditMiddleware.auditAction(
          "view_reconciliation_discrepancies",
          "reconciliation"
        ),
        validationMiddleware.validate({
          params: [{ field: "runId", type: "string", required: true }],
        }),
      ],
      async ({ params }) => {
        // TODO: Implement discrepancy details retrieval
        return {
          message: "Reconciliation discrepancy details not implemented.",
        };
      }
    );

    return group;
  });

  return app;
};
