import { jwt } from "@elysiajs/jwt";
import { getEnv, getNumberEnv } from "@libs/config";
import * as jose from "jose";

export interface JWTPayload {
  sub: string; // user ID
  email: string;
  storeId?: string;
  role: "admin" | "store_owner" | "api_user" | "customer";
  permissions: string[];
  iat: number;
  exp: number;
}

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

export function createJWTPlugin() {
  return jwt(jwtConfig);
}

export function createRefreshJWTPlugin() {
  return jwt(refreshTokenConfig);
}

export class JWTService {
  private static instance: JWTService;
  private jwtSecret: Uint8Array;
  private refreshSecret: Uint8Array;

  private constructor() {
    this.jwtSecret = new TextEncoder().encode(jwtConfig.secret as string);
    this.refreshSecret = new TextEncoder().encode(
      refreshTokenConfig.secret as string
    );
  }

  static getInstance(): JWTService {
    if (!JWTService.instance) {
      JWTService.instance = new JWTService();
    }
    return JWTService.instance;
  }

  async generateTokens(payload: Omit<JWTPayload, "iat" | "exp">): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const accessTokenExp =
      now + getNumberEnv("JWT_EXPIRES_IN_SECONDS", 24 * 60 * 60); // 24 hours
    const refreshTokenExp =
      now + getNumberEnv("JWT_REFRESH_EXPIRES_IN_SECONDS", 7 * 24 * 60 * 60); // 7 days

    const accessTokenPayload: Record<string, any> = {
      ...payload,
      iat: now,
      exp: accessTokenExp,
    };

    const refreshTokenPayload: Record<string, any> = {
      sub: payload.sub,
      type: "refresh",
      iat: now,
      exp: refreshTokenExp,
    };

    const accessToken = await new jose.SignJWT(accessTokenPayload)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(accessTokenExp)
      .setIssuedAt(now)
      .sign(this.jwtSecret);

    const refreshToken = await new jose.SignJWT(refreshTokenPayload)
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

  async verifyToken(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret);

      // Validate that the payload has the required fields
      if (
        !payload.sub ||
        !payload.email ||
        !payload.role ||
        !Array.isArray(payload.permissions)
      ) {
        return null;
      }

      return payload as unknown as JWTPayload;
    } catch (error) {
      return null;
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.refreshSecret);

      if (payload.type !== "refresh" || !payload.sub) {
        return null;
      }

      return payload as unknown as RefreshTokenPayload;
    } catch (error) {
      return null;
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  } | null> {
    const refreshPayload = await this.verifyRefreshToken(refreshToken);
    if (!refreshPayload) {
      return null;
    }

    // In a real implementation, you'd fetch user data from database
    // For now, we'll create a basic payload
    const userPayload = {
      sub: refreshPayload.sub,
      email: "", // Would be fetched from database
      role: "customer" as const,
      permissions: [],
    };

    const tokens = await this.generateTokens(userPayload);
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }
}
