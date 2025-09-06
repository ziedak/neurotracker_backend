import { Logger } from "@libs/monitoring";
import { AuthConfig, MiddlewareContext } from "../../types";
import { AuthResult } from "./types";

/**
 * JWT payload interface
 */
interface JwtPayload {
  userId?: string;
  permissions?: string[];
  roles?: string[];
  exp?: number;
  iat?: number;
  iss?: string;
  [key: string]: any;
}

/**
 * JWT authentication implementation
 */
export class JwtAuth {
  private readonly config: AuthConfig;
  private readonly logger: ILogger;

  constructor(config: AuthConfig, logger: ILogger) {
    this.config = config;
    this.logger = createLogger( "JwtAuth" });
  }

  /**
   * Authenticate using JWT token
   */
  async authenticate(
    authHeader: string,
    context: MiddlewareContext
  ): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Extract token from Bearer header
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) {
        return {
          authenticated: false,
          error:
            'Invalid Authorization header format - expected "Bearer <token>"',
        };
      }

      const token = tokenMatch[1];

      // Basic token validation
      if (token.length < 20) {
        return {
          authenticated: false,
          error: "Invalid token format",
        };
      }

      // Validate and decode token
      const payload = await this.validateToken(token);

      if (!payload) {
        return {
          authenticated: false,
          error: "Invalid or expired token",
        };
      }

      // Validate payload structure
      if (!this.isValidPayload(payload)) {
        return {
          authenticated: false,
          error: "Invalid token payload",
        };
      }

      const duration = performance.now() - startTime;
      this.logger.debug("JWT authentication successful", {
        userId: payload.userId,
        permissions: payload.permissions?.length || 0,
        roles: payload.roles?.length || 0,
        duration: Math.round(duration),
      });

      return {
        authenticated: true,
        user: {
          id: payload.userId,
          roles: payload.roles || [],
          permissions: payload.permissions || [],
          authMethod: "jwt",
          tokenIssued: payload.iat ? new Date(payload.iat * 1000) : undefined,
        },
      };
    } catch (error) {
      this.logger.error("JWT authentication error", error as Error);
      return {
        authenticated: false,
        error: "Token validation failed",
      };
    }
  }

  /**
   * Validate JWT token
   * In production, this would use proper JWT library with signature verification
   */
  private async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      // Basic JWT structure check
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }

      // Decode payload (in production, verify signature first)
      const payload = this.decodeTokenPayload(token);

      // Check expiration
      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error("Token expired");
      }

      // Check issuer if configured
      if (this.config.jwtSecret && payload.iss !== "neurotracker-backend") {
        throw new Error("Invalid token issuer");
      }

      return payload;
    } catch (error) {
      this.logger.warn("Token validation failed", {
        error: (error as Error).message,
        tokenPrefix: token.substring(0, 20) + "...",
      });
      return null;
    }
  }

  /**
   * Decode JWT payload
   * In production, use proper JWT library for decoding and verification
   */
  private decodeTokenPayload(token: string): JwtPayload {
    try {
      const parts = token.split(".");
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      );

      return payload;
    } catch (error) {
      throw new Error("Failed to decode token payload");
    }
  }

  /**
   * Validate JWT payload structure
   */
  private isValidPayload(payload: any): payload is JwtPayload {
    return (
      typeof payload === "object" &&
      payload !== null &&
      (typeof payload.userId === "string" ||
        typeof payload.userId === "undefined") &&
      (Array.isArray(payload.permissions) ||
        typeof payload.permissions === "undefined") &&
      (Array.isArray(payload.roles) || typeof payload.roles === "undefined")
    );
  }

  /**
   * Create a JWT token (for testing purposes)
   * In production, use proper JWT library with signing
   */
  public createToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
    const now = Math.floor(Date.now() / 1000);
    const expiry = this.config.tokenExpiry || 3600; // 1 hour default

    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + expiry,
      iss: "neurotracker-backend",
    };

    // Simple base64 encoding (in production, use proper JWT signing)
    const header = Buffer.from(
      JSON.stringify({ typ: "JWT", alg: "HS256" })
    ).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString(
      "base64url"
    );
    const signature = Buffer.from("mock-signature").toString("base64url");

    return `${header}.${payloadB64}.${signature}`;
  }

  /**
   * Refresh a token (extend expiration)
   */
  public async refreshToken(token: string): Promise<string | null> {
    try {
      const payload = await this.validateToken(token);
      if (!payload) {
        return null;
      }

      // Create new token with extended expiration
      const newPayload = {
        userId: payload.userId,
        permissions: payload.permissions,
        roles: payload.roles,
      };

      return this.createToken(newPayload);
    } catch (error) {
      this.logger.error("Token refresh failed", error as Error);
      return null;
    }
  }

  /**
   * Validate token without authentication context
   */
  public async isValidToken(token: string): Promise<boolean> {
    try {
      const payload = await this.validateToken(token);
      return payload !== null;
    } catch {
      return false;
    }
  }

  /**
   * Extract user ID from token without full validation
   */
  public getUserIdFromToken(token: string): string | null {
    try {
      const payload = this.decodeTokenPayload(token);
      return payload.userId || null;
    } catch {
      return null;
    }
  }

  /**
   * Get token expiration time
   */
  public getTokenExpiration(token: string): Date | null {
    try {
      const payload = this.decodeTokenPayload(token);
      return payload.exp ? new Date(payload.exp * 1000) : null;
    } catch {
      return null;
    }
  }
}
