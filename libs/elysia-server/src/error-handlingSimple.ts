import { Elysia } from "elysia";

export function setupErrorHandling(app: Elysia) {
  return app.onError(({ error, set, request }: any) => {
    const requestId = `err_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

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
