import { Elysia, t } from "@libs/elysia-server";
import { createJWTPlugin, JWTService } from "@libs/auth";
import { Logger, MetricsCollector } from "@libs/monitoring";

const LoginSchema = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 6 }),
  storeId: t.Optional(t.String()),
});

const RegisterSchema = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
  storeName: t.String({ minLength: 2 }),
  storeUrl: t.String({ format: "uri" }),
  firstName: t.String(),
  lastName: t.String(),
});

/**
 * Sets up authentication routes for the API Gateway
 * @param app - Elysia server instance
 * @param logger - Logger instance
 * @returns Elysia server instance with auth routes
 */
export function setupAuthRoutes(app: Elysia, logger: Logger): any {
  const { AuthService } = require("../services/authService");
  const authService = new AuthService(
    logger,
    MetricsCollector.getInstance(),
    JWTService.getInstance()
  );
  return app
    .use(createJWTPlugin())
    .post("/auth/login", async (context: any) => authService.login(context), {
      body: LoginSchema,
    })
    .post(
      "/auth/register",
      async (context: any) => authService.register(context),
      { body: RegisterSchema }
    )
    .get("/auth/me", async (context: any) => authService.getMe(context));
}
