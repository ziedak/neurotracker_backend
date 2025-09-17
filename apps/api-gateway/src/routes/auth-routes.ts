import { Elysia, t } from "elysia";
import { ILogger } from "@libs/utils";
import {
  AuthenticationService,
  LoginCredentials,
  RegisterData,
} from "@libs/auth";

const LoginSchema = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 6 }),
  deviceInfo: t.Optional(
    t.Object({
      userAgent: t.Optional(t.String()),
      ipAddress: t.Optional(t.String()),
    })
  ),
});

const RegisterSchema = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
  name: t.Optional(t.String()),
  roles: t.Optional(t.Array(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
});

/**
 * Sets up authentication routes for the API Gateway
 * @param app - Elysia server instance
 * @param logger - Logger instance
 * @param authService - Authentication service instance
 * @returns Elysia server instance with auth routes
 */
export function setupAuthRoutes(
  app: Elysia,
  logger: ILogger,
  authService: AuthenticationService
): Elysia {
  if (!authService) {
    logger.warn(
      "AuthenticationService not provided, auth routes will be disabled"
    );
    return app;
  }

  return app
    .post(
      "/auth/login",
      async ({ body, set, headers, request }) => {
        try {
          const credentials: LoginCredentials = {
            email: (body as any).email,
            password: (body as any).password,
            deviceInfo: {
              userAgent: headers["user-agent"],
              ipAddress:
                headers["x-forwarded-for"] ||
                headers["x-real-ip"] ||
                request.url,
              ...(body as any).deviceInfo,
            },
          };

          const result = await authService.login(credentials);

          if (!result.success) {
            set.status = 401;
            return { error: result.error || "Login failed" };
          }

          logger.info("User login successful", {
            userId: result.user?.id,
            email: result.user?.email,
          });

          return {
            success: true,
            user: result.user,
            tokens: result.tokens,
          };
        } catch (error) {
          logger.error("Login error", error as Error);
          set.status = 500;
          return { error: "Internal server error" };
        }
      },
      {
        body: LoginSchema,
      }
    )

    .post(
      "/auth/register",
      async ({ body, set }) => {
        try {
          const registerData: RegisterData = {
            email: (body as any).email,
            password: (body as any).password,
            name: (body as any).name,
            roles: (body as any).roles,
            metadata: (body as any).metadata,
          };

          const result = await authService.register(registerData);

          if (!result.success) {
            set.status = 400;
            return { error: result.error || "Registration failed" };
          }

          logger.info("User registration successful", {
            userId: result.user?.id,
            email: result.user?.email,
          });

          return {
            success: true,
            user: result.user,
            tokens: result.tokens,
          };
        } catch (error) {
          logger.error("Registration error", error as Error);
          set.status = 500;
          return { error: "Internal server error" };
        }
      },
      {
        body: RegisterSchema,
      }
    )

    .get("/auth/me", async ({ headers, set }) => {
      try {
        const authHeader = headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          set.status = 401;
          return { error: "Authorization header required" };
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
          set.status = 401;
          return { error: "Invalid authorization header" };
        }

        // Use JWT service to verify and decode token
        const jwtService = authService.getJWTService();
        try {
          const decoded = await jwtService.verifyToken(token);

          // Assuming verifyToken returns a User object when successful
          return {
            success: true,
            user: decoded,
          };
        } catch (tokenError) {
          set.status = 401;
          return { error: "Invalid token" };
        }
      } catch (error) {
        logger.error("Get user profile error", error as Error);
        set.status = 500;
        return { error: "Internal server error" };
      }
    })

    .post("/auth/logout", async ({ headers, set }) => {
      try {
        const authHeader = headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          set.status = 401;
          return { error: "Authorization header required" };
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
          set.status = 401;
          return { error: "Invalid authorization header" };
        }

        // For now, just log the logout - token invalidation would need session management
        logger.info("User logout successful", {
          token: token.substring(0, 10) + "...",
        });

        return {
          success: true,
          message: "Logged out successfully",
        };
      } catch (error) {
        logger.error("Logout error", error as Error);
        set.status = 500;
        return { error: "Internal server error" };
      }
    });
}
