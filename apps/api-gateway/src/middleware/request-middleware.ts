import { Elysia } from "elysia";
import { createLogger } from "@libs/utils";
import { generateId } from "@libs/utils";
import { APP_CONFIG } from "../config/app-config";

const logger = createLogger("api-gateway");

export function setupMiddleware(app: Elysia) {
  return (
    app
      // Request logging
      .onBeforeHandle(({ request, headers }) => {
        const requestId = generateId("req");
        logger.info("Incoming request", {
          requestId,
          method: request.method,
          path: request.url,
          userAgent: headers["user-agent"],
          ip: headers["x-forwarded-for"],
        });
      })

      // Response tracking
      .onAfterHandle(({ request }) => {
        logger.debug("Request completed", {
          method: request.method,
          path: request.url,
        });
      })

      // Basic request handling (rate limiting would be handled by middleware in AdvancedElysiaServerBuilder)
      .onBeforeHandle(async ({ request }) => {
        try {
          const url = new URL(request.url);

          // Skip rate limiting for specified paths
          if (
            APP_CONFIG.rateLimiting.skipPaths.some((path) =>
              url.pathname.startsWith(path)
            )
          ) {
            return;
          }

          // Rate limiting is handled by the AdvancedElysiaServerBuilder middleware
          // This is just a placeholder for any additional request processing
          return;
        } catch (error) {
          logger.warn("Request middleware error", { error: String(error) });
          return;
        }
      })
  );
}
