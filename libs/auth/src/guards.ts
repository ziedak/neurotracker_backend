import { type JWTPayload, JWTService } from "./jwt";

/**
 * Context for authentication and authorization checks
 */
export interface AuthContext {
  headers: Record<string, string | undefined>;
  set: {
    status: number;
    headers: Record<string, string>;
  };
}

/**
 * AuthGuard: Secure authentication and authorization logic
 */
export class AuthGuard {
  private readonly jwtService: JWTService;

  constructor() {
    this.jwtService = JWTService.getInstance();
  }

  /**
   * Require a valid JWT for authentication
   * @throws Error if authentication fails
   */
  async requireAuth(context: AuthContext): Promise<JWTPayload> {
    const authHeader = context.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      context.set.status = 401;
      throw new Error("Authorization header required");
    }
    const token = authHeader.slice(7);
    const payload = await this.jwtService.verifyToken(token);
    if (!payload) {
      context.set.status = 401;
      throw new Error("Invalid or expired token");
    }
    return payload;
  }

  /**
   * Require a specific role (or admin) for access
   * @throws Error if role is insufficient
   */
  async requireRole(
    context: AuthContext,
    requiredRole: string | string[]
  ): Promise<JWTPayload> {
    const payload = await this.requireAuth(context);
    const allowedRoles = Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole];
    if (payload.role === "admin" || allowedRoles.includes(payload.role)) {
      return payload;
    }
    context.set.status = 403;
    throw new Error("Insufficient permissions");
  }

  /**
   * Require a specific permission (or admin) for access
   * @throws Error if permission is insufficient
   */
  async requirePermission(
    context: AuthContext,
    requiredPermission: string | string[]
  ): Promise<JWTPayload> {
    const payload = await this.requireAuth(context);
    const allowedPermissions = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];
    if (
      payload.role === "admin" ||
      allowedPermissions.some((perm) => payload.permissions.includes(perm))
    ) {
      return payload;
    }
    context.set.status = 403;
    throw new Error("Insufficient permissions");
  }

  /**
   * Optionally authenticate, returns null if not authenticated
   */
  async optionalAuth(context: AuthContext): Promise<JWTPayload | null> {
    try {
      return await this.requireAuth(context);
    } catch {
      return null;
    }
  }
}

/**
 * Singleton instance for global use
 */
export const authGuard = new AuthGuard();

/**
 * Helper functions for legacy compatibility
 */
export const requireAuth = (context: AuthContext) =>
  authGuard.requireAuth(context);
export const requireRole = (
  context: AuthContext,
  requiredRole: string | string[]
) => authGuard.requireRole(context, requiredRole);
export const requirePermission = (
  context: AuthContext,
  requiredPermission: string | string[]
) => authGuard.requirePermission(context, requiredPermission);
export const optionalAuth = (context: AuthContext) =>
  authGuard.optionalAuth(context);
