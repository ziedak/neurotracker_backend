import type { JWTPayload } from "./jwt";
import { JWTService } from "./jwt";

export interface AuthContext {
  headers: Record<string, string | undefined>;
  set: {
    status: number;
    headers: Record<string, string>;
  };
}

export class AuthGuard {
  private jwtService: JWTService;

  constructor() {
    this.jwtService = JWTService.getInstance();
  }

  async requireAuth(context: AuthContext): Promise<JWTPayload> {
    const authHeader = context.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      context.set.status = 401;
      throw new Error("Authorization header required");
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const payload = await this.jwtService.verifyToken(token);
      if (!payload) {
        context.set.status = 401;
        throw new Error("Invalid or expired token");
      }

      return payload;
    } catch (error) {
      context.set.status = 401;
      throw new Error("Authentication failed");
    }
  }

  async requireRole(
    context: AuthContext,
    requiredRole: string | string[]
  ): Promise<JWTPayload> {
    const payload = await this.requireAuth(context);
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    if (!roles.includes(payload.role) && payload.role !== "admin") {
      context.set.status = 403;
      throw new Error("Insufficient permissions");
    }

    return payload;
  }

  async requirePermission(
    context: AuthContext,
    requiredPermission: string | string[]
  ): Promise<JWTPayload> {
    const payload = await this.requireAuth(context);
    const permissions = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];

    const hasPermission = permissions.some(
      (perm) => payload.permissions.includes(perm) || payload.role === "admin"
    );

    if (!hasPermission) {
      context.set.status = 403;
      throw new Error("Insufficient permissions");
    }

    return payload;
  }

  async optionalAuth(context: AuthContext): Promise<JWTPayload | null> {
    try {
      return await this.requireAuth(context);
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const authGuard = new AuthGuard();

// Helper functions for backward compatibility
export async function requireAuth(context: AuthContext): Promise<JWTPayload> {
  return authGuard.requireAuth(context);
}

export async function requireRole(
  context: AuthContext,
  requiredRole: string | string[]
): Promise<JWTPayload> {
  return authGuard.requireRole(context, requiredRole);
}

export async function requirePermission(
  context: AuthContext,
  requiredPermission: string | string[]
): Promise<JWTPayload> {
  return authGuard.requirePermission(context, requiredPermission);
}

export async function optionalAuth(
  context: AuthContext
): Promise<JWTPayload | null> {
  return authGuard.optionalAuth(context);
}
