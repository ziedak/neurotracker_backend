import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { SecurityService } from "../services/security.service";
import type { ValidationMiddleware } from "../middleware/validation.middleware";

/**
 * Auth endpoints
 * Handles authentication and login
 */
export const setupAuthRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getSecurity = () =>
    container.getService("securityService") as SecurityService;
  const validationMiddleware = container.getService(
    "validationMiddleware"
  ) as ValidationMiddleware;

  app.group("/auth", (group) => {
    group.post(
      "/login",
      [
        validationMiddleware.validate({
          body: [
            { field: "email", type: "string", required: true },
            { field: "password", type: "string", required: true, minLength: 6 },
          ],
        }),
      ],
      async ({ body }: { body: { email: string; password: string } }) => {
        try {
          const securityService = getSecurity();
          return await securityService.authenticate({
            token: undefined,
            apiKey: undefined,
            endpoint: "/auth/login",
            method: "POST",
            ...body,
          });
        } catch (error) {
          return {
            error: "Authentication failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/register",
      [
        validationMiddleware.validate({
          body: [
            { field: "email", type: "string", required: true },
            { field: "password", type: "string", required: true, minLength: 6 },
            { field: "name", type: "string", required: true },
          ],
        }),
      ],
      async ({
        body,
      }: {
        body: { email: string; password: string; name: string };
      }) => {
        try {
          const securityService = getSecurity();
          return await securityService.registerUser(body);
        } catch (error) {
          return {
            error: "Registration failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/password-reset",
      [
        validationMiddleware.validate({
          body: [{ field: "email", type: "string", required: true }],
        }),
      ],
      async ({ body }: { body: { email: string } }) => {
        try {
          const securityService = getSecurity();
          return await securityService.initiatePasswordReset(body.email);
        } catch (error) {
          return {
            error: "Password reset failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/token-refresh",
      [
        validationMiddleware.validate({
          body: [{ field: "refreshToken", type: "string", required: true }],
        }),
      ],
      async ({ body }: { body: { refreshToken: string } }) => {
        try {
          const securityService = getSecurity();
          return await securityService.refreshToken(body.refreshToken);
        } catch (error) {
          return {
            error: "Token refresh failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/logout",
      [
        validationMiddleware.validate({
          body: [{ field: "token", type: "string", required: true }],
        }),
      ],
      async ({ body }: { body: { token: string } }) => {
        try {
          const securityService = getSecurity();
          return await securityService.logout(body.token);
        } catch (error) {
          return {
            error: "Logout failed",
            message: (error as Error).message,
          };
        }
      }
    );

    return group;
  });
};
