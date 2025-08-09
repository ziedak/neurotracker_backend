import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { APP_CONFIG } from "../config/app-config";

export function setupCorePlugins(app: Elysia) {
  return (
    app
      // Swagger must be first
      .use(
        swagger({
          path: APP_CONFIG.swagger.path,
          documentation: {
            info: APP_CONFIG.swagger.info,
          },
        })
      )
      // CORS
      .use(cors(APP_CONFIG.cors))
  );
}
