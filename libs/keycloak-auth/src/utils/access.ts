/**
 * Extract token from Authorization header
 */
export const extractBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

/**
 * Check if token is expired based on exp claim
 */
export const isTokenExpired = (
  exp?: number,
  bufferSeconds: number = 300
): boolean => {
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + bufferSeconds;
};

/**
 * Extract scopes from token claims
 */
export const extractScopes = (scope?: string): string[] => {
  if (!scope) return ["openid"];
  return scope.split(" ").filter((s) => s.length > 0);
};

/**
 * Check if user has required scopes
 */
export const hasRequiredScopes = (
  userScopes: string[],
  requiredScopes: string[]
): boolean => {
  if (!requiredScopes.length) return true;
  return requiredScopes.every((scope) => userScopes.includes(scope));
};

/**
 * Extract permissions from Keycloak token claims
 */
export const extractPermissions = (claims: any): string[] => {
  const permissions: string[] = [];

  // Extract realm roles
  if (claims.realm_access?.roles) {
    permissions.push(
      ...claims.realm_access.roles.map((role: string) => `realm:${role}`)
    );
  }

  // Extract client roles
  if (claims.resource_access) {
    Object.entries(claims.resource_access).forEach(
      ([clientId, clientAccess]: [string, any]) => {
        if (clientAccess.roles) {
          permissions.push(
            ...clientAccess.roles.map((role: string) => `${clientId}:${role}`)
          );
        }
      }
    );
  }

  return permissions;
};

/**
 * Check if user has required permissions
 */
export const hasRequiredPermissions = (
  userPermissions: string[],
  requiredPermissions: string[]
): boolean => {
  if (!requiredPermissions.length) return true;
  return requiredPermissions.every((permission) =>
    userPermissions.includes(permission)
  );
};
