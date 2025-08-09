import { Elysia, t } from "elysia";
import { createJWTPlugin, requireAuth, JWTService } from "@libs/auth";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { generateId } from "@libs/utils";
import {
  createAuthContext,
  handleError,
  LoginBody,
  RegisterBody,
  User,
  validateUser,
} from "../types";

const logger = new Logger("api-gateway");
const metrics = MetricsCollector.getInstance();
const jwtService = JWTService.getInstance();

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

export function setupAuthRoutes(app: Elysia): any {
  return app
    .use(createJWTPlugin())

    .post(
      "/auth/login",
      async ({ body, set, request }) => {
        const loginBody = body as LoginBody;
        const requestId = generateId("login");

        logger.info("Login attempt", {
          requestId,
          email: loginBody.email,
          ip: request.headers.get("x-forwarded-for"),
        });

        try {
          await metrics.recordCounter("auth.login_attempts");

          const user = await validateUser(
            loginBody.email,
            loginBody.password,
            loginBody.storeId
          );
          if (!user) {
            await metrics.recordCounter("auth.login_failures");
            logger.warn("Login failed - invalid credentials", {
              requestId,
              email: loginBody.email,
            });
            set.status = 401;
            return { error: "Invalid credentials" };
          }

          const tokens = await jwtService.generateTokens({
            sub: user.id,
            email: user.email,
            storeId: user.storeId,
            role: user.role,
            permissions: user.permissions,
          });

          await metrics.recordCounter("auth.login_success");
          logger.info("Login successful", {
            requestId,
            userId: user.id,
            role: user.role,
          });

          return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            user: {
              id: user.id,
              email: user.email,
              role: user.role,
              storeId: user.storeId,
            },
          };
        } catch (error) {
          await metrics.recordCounter("auth.login_errors");
          logger.error("Login error", handleError(error), { requestId });
          set.status = 500;
          return { error: "Authentication service temporarily unavailable" };
        }
      },
      { body: LoginSchema }
    )

    .post(
      "/auth/register",
      async ({ body, set }) => {
        const registerBody = body as RegisterBody;
        const requestId = generateId("register");

        logger.info("Registration attempt", {
          requestId,
          email: registerBody.email,
        });

        try {
          await metrics.recordCounter("auth.register_attempts");

          const existingUser = await validateUser(registerBody.email, "", "");
          if (existingUser) {
            await metrics.recordCounter("auth.register_failures");
            set.status = 409;
            return { error: "User already exists" };
          }

          const newUser: User = {
            id: generateId("user"),
            email: registerBody.email,
            storeId: generateId("store"),
            role: "store_owner",
            permissions: ["store:read", "store:write", "interventions:*"],
          };

          const tokens = await jwtService.generateTokens({
            sub: newUser.id,
            email: newUser.email,
            storeId: newUser.storeId,
            role: newUser.role,
            permissions: newUser.permissions,
          });

          await metrics.recordCounter("auth.register_success");
          logger.info("Registration successful", {
            requestId,
            userId: newUser.id,
          });

          return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            user: {
              id: newUser.id,
              email: newUser.email,
              role: newUser.role,
              storeId: newUser.storeId,
            },
          };
        } catch (error) {
          await metrics.recordCounter("auth.register_errors");
          logger.error("Registration error", handleError(error), { requestId });
          set.status = 500;
          return { error: "Registration service temporarily unavailable" };
        }
      },
      { body: RegisterSchema }
    )

    .get("/auth/me", async (context) => {
      try {
        const authContext = createAuthContext(context);
        const payload = await requireAuth(authContext);

        return {
          user: {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
            storeId: payload.storeId,
            permissions: payload.permissions,
          },
        };
      } catch (error) {
        context.set.status = 401;
        return { error: "Invalid or expired token" };
      }
    });
}
