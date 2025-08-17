import { jwt } from "@elysiajs/jwt";
import { getEnv, getNumberEnv } from "@libs/config";
import * as jose from "jose";

/**
 * JWTPayload: Structure for JWT access token payload
 */
export interface JWTPayload {
  sub: string; // user ID
  email: string;
  storeId?: string;
  role: "admin" | "store_owner" | "api_user" | "customer";
  permissions: string[];
  iat: number;
  exp: number;
}

/**
 * RefreshTokenPayload: Structure for JWT refresh token payload
 */
export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
  iat: number;
  exp: number;
}

export const jwtConfig = {
  name: "jwt" as const,
  secret: getEnv(
    "JWT_SECRET",
    "development-secret-change-in-production-PLEASE"
  ),
  exp: getEnv("JWT_EXPIRES_IN", "24h"),
};

export const refreshTokenConfig = {
  name: "jwt" as const, // Elysia JWT plugin requires "jwt" as name
  secret: getEnv(
    "JWT_REFRESH_SECRET",
    "development-refresh-secret-change-in-production-PLEASE"
  ),
  exp: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),
};

/**
 * Create JWT plugin for Elysia
 */
export function createJWTPlugin() {
  return jwt(jwtConfig);
}

/**
 * Create Refresh JWT plugin for Elysia
 */
export function createRefreshJWTPlugin() {
  return jwt(refreshTokenConfig);
}

/**
 * JWTService: Secure JWT token generation and verification
 * - Singleton pattern for centralized JWT logic
 * - Strict TypeScript enforced
 * - All config values parameterized
 * - No magic values
 * - Modular, testable, and maintainable
 */
export class JWTService {
  private static instance: JWTService;
  private readonly jwtSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;

  private constructor() {
    this.jwtSecret = new TextEncoder().encode(jwtConfig.secret as string);
    this.refreshSecret = new TextEncoder().encode(
      refreshTokenConfig.secret as string
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): JWTService {
    if (!JWTService.instance) {
      JWTService.instance = new JWTService();
    }
    return JWTService.instance;
  }

  /**
   * Generate access and refresh tokens for a user
   * @param payload - User payload (without iat/exp)
   * @returns { accessToken, refreshToken, expiresIn }
   */
  public async generateTokens(
    payload: Omit<JWTPayload, "iat" | "exp">
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const now: number = Math.floor(Date.now() / 1000);
    const accessTokenExp: number =
      now + getNumberEnv("JWT_EXPIRES_IN_SECONDS", 24 * 60 * 60);
    const refreshTokenExp: number =
      now + getNumberEnv("JWT_REFRESH_EXPIRES_IN_SECONDS", 7 * 24 * 60 * 60);

    const accessTokenPayload: JWTPayload = {
      ...payload,
      iat: now,
      exp: accessTokenExp,
    };
    const refreshTokenPayload: RefreshTokenPayload = {
      sub: payload.sub,
      type: "refresh",
      iat: now,
      exp: refreshTokenExp,
    };

    const accessToken: string = await new jose.SignJWT(
      accessTokenPayload as unknown as Record<string, unknown>
    )
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(accessTokenExp)
      .setIssuedAt(now)
      .sign(this.jwtSecret);

    const refreshToken: string = await new jose.SignJWT(
      refreshTokenPayload as unknown as Record<string, unknown>
    )
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(refreshTokenExp)
      .setIssuedAt(now)
      .sign(this.refreshSecret);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenExp,
    };
  }

  /**
   * Verify access token and return payload if valid
   * @param token - JWT access token
   * @returns JWTPayload or null
   */
  public async verifyToken(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret);
      if (
        typeof payload.sub === "string" &&
        typeof payload.email === "string" &&
        typeof payload.role === "string" &&
        Array.isArray(payload.permissions) &&
        typeof payload.iat === "number" &&
        typeof payload.exp === "number"
      ) {
        // Optionally validate role and permissions further
        return {
          sub: payload.sub,
          email: payload.email,
          storeId:
            typeof payload.storeId === "string" ? payload.storeId : undefined,
          role: payload.role as JWTPayload["role"],
          permissions: payload.permissions as string[],
          iat: payload.iat,
          exp: payload.exp,
        };
      }
      return null;
    } catch (error) {
      // Log error for observability if needed
      return null;
    }
  }

  /**
   * Verify refresh token and return payload if valid
   * @param token - JWT refresh token
   * @returns RefreshTokenPayload or null
   */
  public async verifyRefreshToken(
    token: string
  ): Promise<RefreshTokenPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.refreshSecret);
      if (
        typeof payload.sub === "string" &&
        payload.type === "refresh" &&
        typeof payload.iat === "number" &&
        typeof payload.exp === "number"
      ) {
        return {
          sub: payload.sub,
          type: "refresh",
          iat: payload.iat,
          exp: payload.exp,
        };
      }
      return null;
    } catch (error) {
      // Log error for observability if needed
      return null;
    }
  }

  /**
   * Generate a new access token from a valid refresh token
   * @param refreshToken - JWT refresh token
   * @returns { accessToken, expiresIn } or null
   */
  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  } | null> {
    const refreshPayload = await this.verifyRefreshToken(refreshToken);
    if (!refreshPayload) {
      return null;
    }
    // TODO: Fetch user data from database for real implementation
    // This is a stub for demonstration; must be replaced with DB lookup
    const userPayload: Omit<JWTPayload, "iat" | "exp"> = {
      sub: refreshPayload.sub,
      email: "", // Should be fetched from DB
      role: "customer",
      permissions: [],
    };
    const tokens = await this.generateTokens(userPayload);
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }
}
