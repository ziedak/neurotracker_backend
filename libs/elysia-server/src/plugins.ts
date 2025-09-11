import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { ServerConfig } from "./config";

export function setupCorePlugins(app: Elysia, config: ServerConfig) {
  // Swagger must be first
  if (config.swagger?.enabled) {
    app.use(
      swagger({
        path: config.swagger.path || "/swagger",
        documentation: {
          info: {
            title: config.swagger.title || config.name,
            version: config.swagger.version || config.version,
            description: config.swagger.description ?? config.description ?? "",
          },
        },
      })
    );
  }

  return app;
}
