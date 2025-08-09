import { Context } from "elysia";
import { requireAuth, JWTService } from "@libs/auth";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { generateId, AppError } from "@libs/utils";
import {
  createAuthContext,
  createJWTPayload,
  handleError,
  validateUser,
  LoginBody,
  RegisterBody,
  User,
} from "./types";

const logger = new Logger("auth-handlers");
const metrics = MetricsCollector.getInstance();
const jwtService = JWTService.getInstance();

export async function handleLogin(
  context: Context & { jwt?: any }
): Promise<any> {
  const { body, set, request } = context;
  const loginBody = body as LoginBody;
  const requestId = generateId("login");

  logger.info("Login attempt", {
    requestId,
    email: loginBody.email,
    ip: request.headers.get("x-forwarded-for"),
  });

  try {
    await metrics.recordCounter("auth.login_attempts");

    // Validate credentials
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

    // Create JWT tokens using our service
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
}

export async function handleRegister(
  context: Context & { jwt?: any }
): Promise<any> {
  const { body, set } = context;
  const registerBody = body as RegisterBody;
  const requestId = generateId("register");

  logger.info("Registration attempt", { requestId, email: registerBody.email });

  try {
    await metrics.recordCounter("auth.register_attempts");

    // Check if user already exists
    const existingUser = await validateUser(registerBody.email, "", "");
    if (existingUser) {
      await metrics.recordCounter("auth.register_failures");
      set.status = 409;
      return { error: "User already exists" };
    }

    // Create new user
    const newUser: User = {
      id: generateId("user"),
      email: registerBody.email,
      storeId: generateId("store"),
      role: "store_owner",
      permissions: ["store:read", "store:write", "interventions:*"],
    };

    // Create JWT tokens using our service
    const tokens = await jwtService.generateTokens({
      sub: newUser.id,
      email: newUser.email,
      storeId: newUser.storeId,
      role: newUser.role,
      permissions: newUser.permissions,
    });

    await metrics.recordCounter("auth.register_success");
    logger.info("Registration successful", { requestId, userId: newUser.id });

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
}

export async function handleAuthMe(context: Context): Promise<any> {
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

export async function requireAuthMiddleware(context: Context): Promise<any> {
  try {
    const authContext = createAuthContext(context);
    return await requireAuth(authContext);
  } catch (error) {
    context.set.status = 401;
    throw new AppError("Authentication required", 401);
  }
}
