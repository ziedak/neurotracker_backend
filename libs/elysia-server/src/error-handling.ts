import { Elysia } from "elysia";
import { ServerConfig } from "./config";

export function setupErrorHandling(app: Elysia, config: ServerConfig) {
  return app.onError(({ error, set, request }: any) => {
    const requestId = `err_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Basic error handling
    console.error("Application error", {
      requestId,
      error: error.message || String(error),
      path: request.url,
    });

    set.status = error.statusCode || 500;
    return {
      error: error.message || "Internal server error",
      requestId,
    };
  });
}
