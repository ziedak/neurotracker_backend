import { Elysia } from "elysia";
import { Logger, RateLimiter } from "@libs/monitoring";
import { generateId } from "@libs/utils";
import { APP_CONFIG } from "../config/app-config";

const logger = Logger.getInstance("api-gateway");
const rateLimiter = new RateLimiter();

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
        return { requestId };
      })

      // Response tracking
      .onAfterHandle(({ request }) => {
        logger.debug("Request completed", {
          method: request.method,
          path: request.url,
        });
      })

      // Rate limiting
      .onBeforeHandle(async ({ request, set }) => {
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

          const clientIp =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          try {
            const result = await rateLimiter.checkRateLimit(
              clientIp,
              APP_CONFIG.rateLimiting.requests,
              APP_CONFIG.rateLimiting.windowMs
            );

            if (!result.allowed) {
              set.status = 429;
              return {
                error: "Too Many Requests",
                message: "Rate limit exceeded. Please try again later.",
                retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
              };
            }
          } catch (redisError) {
            logger.debug("Rate limiting skipped due to Redis unavailability", {
              error:
                redisError instanceof Error
                  ? redisError.message
                  : String(redisError),
            });
          }
        } catch (error) {
          logger.warn("Rate limiting check failed", { error: String(error) });
        }
      })
  );
}
