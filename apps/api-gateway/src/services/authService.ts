import { Context } from "elysia";
import { requireAuth, EnhancedJWTService } from "@libs/auth";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { generateId, AppError } from "@libs/utils";
import {
  createAuthContext,
  handleError,
  validateUser,
  LoginBody,
  RegisterBody,
  User,
} from "../types";

/**
 * AuthService: Encapsulates authentication logic for API Gateway
 */
export class AuthService {
  constructor(
    private readonly logger: Logger,
    private readonly metrics: MetricsCollector,
    private readonly jwtService: EnhancedJWTService
  ) {}

  /**
   * Handle user login
   */
  async login(context: Context & { jwt?: any }): Promise<any> {
    const { body, set, request } = context;
    const loginBody = body as LoginBody;
    const requestId = generateId("login");

    this.logger.info("Login attempt", {
      requestId,
      email: loginBody.email,
      ip: request.headers.get("x-forwarded-for"),
    });

    try {
      await this.metrics.recordCounter("auth.login_attempts");
      const user = await validateUser(
        loginBody.email,
        loginBody.password,
        loginBody.storeId
      );
      if (!user) {
        await this.metrics.recordCounter("auth.login_failures");
        this.logger.warn("Login failed - invalid credentials", {
          requestId,
          email: loginBody.email,
        });
        set.status = 401;
        return { error: "Invalid credentials" };
      }
      const tokens = await this.jwtService.generateTokens({
        sub: user.id,
        email: user.email,
        storeId: user.storeId,
        role: user.role,
        permissions: user.permissions,
      });
      await this.metrics.recordCounter("auth.login_success");
      this.logger.info("Login successful", {
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
      await this.metrics.recordCounter("auth.login_errors");
      this.logger.error("Login error", handleError(error), { requestId });
      set.status = 500;
      return { error: "Authentication service temporarily unavailable" };
    }
  }

  /**
   * Handle user registration
   */
  async register(context: Context & { jwt?: any }): Promise<any> {
    const { body, set } = context;
    const registerBody = body as RegisterBody;
    const requestId = generateId("register");

    this.logger.info("Registration attempt", {
      requestId,
      email: registerBody.email,
    });

    try {
      await this.metrics.recordCounter("auth.register_attempts");
      const existingUser = await validateUser(registerBody.email, "", "");
      if (existingUser) {
        await this.metrics.recordCounter("auth.register_failures");
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
      const tokens = await this.jwtService.generateTokens({
        sub: newUser.id,
        email: newUser.email,
        storeId: newUser.storeId,
        role: newUser.role,
        permissions: newUser.permissions,
      });
      await this.metrics.recordCounter("auth.register_success");
      this.logger.info("Registration successful", {
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
      await this.metrics.recordCounter("auth.register_errors");
      this.logger.error("Registration error", handleError(error), {
        requestId,
      });
      set.status = 500;
      return { error: "Registration service temporarily unavailable" };
    }
  }

  /**
   * Get authenticated user info
   */
  async getMe(context: Context): Promise<any> {
    const { set } = context;
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
      set.status = 401;
      return { error: "Invalid or expired token" };
    }
  }

  /**
   * Middleware to require authentication
   */
  async requireAuthMiddleware(context: Context): Promise<any> {
    try {
      const authContext = createAuthContext(context);
      return await requireAuth(authContext);
    } catch (error) {
      context.set.status = 401;
      throw new AppError("Authentication required", 401);
    }
  }
}
