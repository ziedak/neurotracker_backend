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
            { field: "sourceTable", type: "string", required: false },
            { field: "targetTable", type: "string", required: false },
            { field: "joinKey", type: "string", required: false },
            { field: "enabled", type: "boolean", required: false },
            { field: "sourceColumns", type: "array", required: false },
            { field: "targetColumns", type: "array", required: false },
            { field: "tolerance", type: "number", required: false },
          ],
        }),
      ],
      async ({
        params,
        body,
      }: {
        params: { ruleId: string };
        body: Partial<{
          name: string;
          sourceTable: string;
          targetTable: string;
          joinKey: string;
          enabled: boolean;
          sourceColumns: string[];
          targetColumns: string[];
          tolerance: number;
        }>;
      }) => {
        try {
          const reconciliationService = getDataReconciliation();
          const updated = await reconciliationService.updateRule(
            params.ruleId,
            body
          );
          if (!updated) {
            return {
              error: "Rule update failed",
              message: "Rule not found or update error.",
            };
          }
          return updated;
        } catch (error) {
          return {
            error: "Rule update failed",
            message: (error as Error).message,
          };
        }
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
      async ({ params }: { params: { ruleId: string } }) => {
        try {
          const reconciliationService = getDataReconciliation();
          const deleted = await reconciliationService.updateRule(
            params.ruleId,
            { enabled: false }
          );
          if (!deleted) {
            return {
              error: "Rule delete failed",
              message: "Rule not found or delete error.",
            };
          }
          return { message: "Rule disabled (soft delete)", rule: deleted };
        } catch (error) {
          return {
            error: "Rule delete failed",
            message: (error as Error).message,
          };
        }
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
      async ({ query }: { query: { page?: number; pageSize?: number } }) => {
        auditMiddleware.auditAction(
          "view_reconciliation_history",
          "reconciliation"
        );
        try {
          const reconciliationService = getDataReconciliation();
          const page = query.page ?? 1;
          const pageSize = query.pageSize ?? 20;
          return await reconciliationService.getHistory(page, pageSize);
        } catch (error) {
          return {
            error: "History retrieval failed",
            message: (error as Error).message,
          };
        }
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
      async ({ params }: { params: { runId: string } }) => {
        try {
          const reconciliationService = getDataReconciliation();
          const details = await reconciliationService.getDiscrepancyDetails(
            params.runId
          );
          if (!details) {
            return {
              error: "Discrepancy details not found",
              runId: params.runId,
            };
          }
          return { runId: params.runId, details };
        } catch (error) {
          return {
            error: "Discrepancy details retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    return group;
  });

  return app;
};
