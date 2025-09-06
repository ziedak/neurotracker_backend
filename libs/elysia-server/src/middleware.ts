import { Elysia } from "elysia";
import { ServerConfig } from "./config";

export function setupMiddleware(app: Elysia, config: ServerConfig) {
  // Request logging
  if (config.logging?.enabled) {
    app.onBeforeHandle(({ request, headers }: any) => {
      const requestId = `req_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;
      console.log("Incoming request", {
        requestId,
        method: request.method,
        path: request.url,
        userAgent: headers["user-agent"],
        ip: headers["x-forwarded-for"],
      });
      // Don't return anything to avoid overriding the route response
    });

    // Response tracking
    app.onAfterHandle(({ request }: any) => {
      console.log("Request completed", {
        method: request.method,
        path: request.url,
      });
    });
  }

  // Basic rate limiting placeholder
  if (config.rateLimiting?.enabled) {
    app.onBeforeHandle(async ({ request }: any) => {
      try {
        const url = new URL(request.url);

        // Skip rate limiting for specified paths
        if (
          config.rateLimiting?.skipPaths?.some((path) =>
            url.pathname.startsWith(path)
          )
        ) {
          return;
        }

        // TODO: Implement actual rate limiting when Redis is available
        // For now, just log the attempt
        console.log("Rate limiting check for:", request.url);
      } catch (error) {
        console.warn("Rate limiting check failed", { error: String(error) });
      }
    });
  }

  return app;
}
