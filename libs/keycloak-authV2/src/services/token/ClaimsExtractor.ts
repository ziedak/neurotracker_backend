/**
 * Claims Extractor - Pure JWT Claims Extraction
 *
 * Purpose: Extract data from JWT claims (Keycloak format)
 * Responsibility: ONLY extraction, no authorization logic
 *
 * For authorization checks (hasRole, hasPermission), see:
 * - src/services/authorization/RoleChecker.ts
 */

/**
 * Pure JWT claims extraction utility
 */
export class ClaimsExtractor {
  /**
   * Extract roles from JWT claims (Keycloak format)
   * Returns roles in format: "realm:role" or "client:role"
   */
  static extractRolesFromJWT(claims: Record<string, unknown>): string[] {
    const roles: string[] = [];

    // Extract realm roles
    if (claims["realm_access"] && typeof claims["realm_access"] === "object") {
      const realmAccess = claims["realm_access"] as Record<string, unknown>;
      if (Array.isArray(realmAccess["roles"])) {
        roles.push(
          ...(realmAccess["roles"] as string[]).map((role) => `realm:${role}`)
        );
      }
    }

    // Extract resource/client roles
    if (
      claims["resource_access"] &&
      typeof claims["resource_access"] === "object"
    ) {
      const resourceAccess = claims["resource_access"] as Record<
        string,
        unknown
      >;
      for (const [resource, access] of Object.entries(resourceAccess)) {
        if (access && typeof access === "object") {
          const resourceRoles = (access as Record<string, unknown>)["roles"];
          if (Array.isArray(resourceRoles)) {
            roles.push(
              ...(resourceRoles as string[]).map(
                (role) => `${resource}:${role}`
              )
            );
          }
        }
      }
    }

    return roles;
  }

  /**
   * Extract permissions from JWT claims
   * Combines UMA permissions and scope-based permissions
   */
  static extractPermissionsFromJWT(claims: Record<string, unknown>): string[] {
    const permissions: string[] = [];

    // Extract from authorization claim (UMA permissions)
    if (
      claims["authorization"] &&
      typeof claims["authorization"] === "object"
    ) {
      const auth = claims["authorization"] as Record<string, unknown>;
      if (Array.isArray(auth["permissions"])) {
        permissions.push(...(auth["permissions"] as string[]));
      }
    }

    // Extract from scope claim
    if (claims["scope"] && typeof claims["scope"] === "string") {
      permissions.push(...(claims["scope"] as string).split(" "));
    }

    return permissions;
  }

  /**
   * Extract user ID from JWT claims
   */
  static extractUserId(claims: Record<string, unknown>): string {
    return (claims["sub"] as string) || "";
  }

  /**
   * Extract username from JWT claims
   */
  static extractUsername(claims: Record<string, unknown>): string {
    return (claims["preferred_username"] as string) || "";
  }

  /**
   * Extract email from JWT claims
   */
  static extractEmail(claims: Record<string, unknown>): string {
    return (claims["email"] as string) || "";
  }

  /**
   * Extract full name from JWT claims
   */
  static extractName(claims: Record<string, unknown>): string {
    return (claims["name"] as string) || "";
  }

  /**
   * Extract token expiration timestamp
   */
  static extractExpiration(claims: Record<string, unknown>): Date | undefined {
    const exp = claims["exp"] as number | undefined;
    return exp ? new Date(exp * 1000) : undefined;
  }

  /**
   * Extract issued at timestamp
   */
  static extractIssuedAt(claims: Record<string, unknown>): Date | undefined {
    const iat = claims["iat"] as number | undefined;
    return iat ? new Date(iat * 1000) : undefined;
  }
}
