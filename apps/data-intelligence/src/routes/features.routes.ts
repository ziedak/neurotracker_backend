import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { FeatureStoreService } from "../services/featureStore.service";
import type {
  FeatureStoreComputeBody,
  FeatureStoreBatchComputeBody,
} from "../types/index";
import type { AuthMiddleware } from "../middleware/auth.middleware";
import type { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import type { AuditMiddleware } from "../middleware/audit.middleware";
import type { ValidationMiddleware } from "../middleware/validation.middleware";

/**
 * Feature Store endpoints
 * Handles feature computation, batch operations, and definitions
 */
export const setupFeaturesRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getFeatureStore = () =>
    container.getService("featureStoreService") as FeatureStoreService;
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

  app.group("/features", (group) => {
    group.get(
      "/:cartId",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          params: [{ field: "cartId", type: "string", required: true }],
        }),
      ],
      async ({
        params,
        query,
      }: {
        params: { cartId: string };
        query: Record<string, any>;
      }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.getFeatures(params.cartId, query);
        } catch (error) {
          return {
            error: "Feature retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/compute",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          body: [
            { field: "cartId", type: "string", required: true },
            { field: "features", type: "array", required: false },
            { field: "description", type: "string", required: false },
          ],
        }),
      ],
      async ({ body }: { body: FeatureStoreComputeBody }) => {
        try {
          // Basic runtime validation
          if (!body.cartId || typeof body.features !== "object") {
            return {
              error: "Invalid request body",
              message: "cartId and features are required.",
            };
          }
          const featureStore = getFeatureStore();
          return await featureStore.computeFeatures(body);
        } catch (error) {
          return {
            error: "Feature computation failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/definitions",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.getFeatureDefinitions(query?.version);
        } catch (error) {
          return {
            error: "Feature definitions retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/batch-compute",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          body: [
            { field: "cartIds", type: "array", required: true },
            { field: "features", type: "array", required: false },
            { field: "description", type: "string", required: false },
          ],
        }),
      ],
      async ({ body }: { body: FeatureStoreBatchComputeBody }) => {
        try {
          // Basic runtime validation
          if (!Array.isArray(body.cartIds) || body.cartIds.length === 0) {
            return {
              error: "Invalid request body",
              message: "cartIds must be a non-empty array.",
            };
          }
          const featureStore = getFeatureStore();
          return await featureStore.batchComputeFeatures([body]);
        } catch (error) {
          return {
            error: "Batch feature computation failed",
            message: (error as Error).message,
          };
        }
      }
    );

    // Update feature
    group.put(
      "/:cartId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          params: [{ field: "cartId", type: "string", required: true }],
          body: [
            { field: "features", type: "array", required: true },
            { field: "description", type: "string", required: false },
          ],
        }),
      ],
      async ({
        params,
        body,
      }: {
        params: { cartId: string };
        body: { features: any[] };
      }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.updateFeatures(
            params.cartId,
            body.features
          );
        } catch (error) {
          return {
            error: "Feature update failed",
            message: (error as Error).message,
          };
        }
      }
    );

    // Delete feature
    group.delete(
      "/:cartId",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.userLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          params: [{ field: "cartId", type: "string", required: true }],
        }),
      ],
      async ({ params }: { params: { cartId: string } }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.deleteFeatures(params.cartId);
        } catch (error) {
          return {
            error: "Feature delete failed",
            message: (error as Error).message,
          };
        }
      }
    );

    // Feature version management
    group.post(
      "/version",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.userLimit(),
        auditMiddleware.featureStoreAudit(),
        validationMiddleware.validate({
          body: [
            { field: "version", type: "string", required: true },
            { field: "features", type: "array", required: true },
          ],
        }),
      ],
      async ({ body }: { body: { version: string; features: any[] } }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.createFeatureVersion(
            body.version,
            body.features
          );
        } catch (error) {
          return {
            error: "Feature version creation failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/versions",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
      ],
      async () => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.getFeatureVersions();
        } catch (error) {
          return {
            error: "Feature versions retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    return app;
  });
};
