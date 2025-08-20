import { Elysia } from "elysia";
import { Logger } from "@libs/monitoring";
import { generateId, AppError } from "@libs/utils";
import { handleError } from "../types";

const logger = Logger.getInstance("api-gateway");

export function setupErrorHandling(app: Elysia) {
  return app.onError(({ error, set, request }) => {
    const requestId = generateId("err");
    const err = handleError(error);

    if (error instanceof AppError) {
      logger.warn("Application error", {
        requestId,
        error: err.message,
        path: request.url,
      });
      set.status = error.statusCode;
      return { error: err.message, requestId };
    }

    logger.error("Unhandled error", err, { requestId, path: request.url });
    set.status = 500;
    return { error: "Internal server error", requestId };
  });
}
