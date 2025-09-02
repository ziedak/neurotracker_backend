/**
 * Auth Library - Production-Ready Authentication System
 * Built with Keycloak integration and CASL-based RBAC
 *
 * Features:
 * - JWT authentication with Keycloak
 * - CASL ability-based permissions
 * - ElysiaJS middleware integration
 * - WebSocket authentication support
 * - Session management
 * - API key authentication
 * - Enterprise-grade security
 */

// ===================================================================
// CORE TYPES
// ===================================================================

export * from "./types";

import {
  AuthenticationService,
  createAuthenticationService,
  initializeAuthenticationService,
} from "./services/auth-service";
import { JWTService } from "./services/jwt-service";
import { KeycloakService } from "./services/keycloak-service";
import { PermissionService } from "./services/permission-service";
import { SessionService } from "./services/session-service";
import { ApiKeyService } from "./services/api-key-service";
import {
  AuthMiddleware,
  createAuthMiddleware,
} from "./middleware/http-middleware";

// ===================================================================
// ENHANCED SERVICES (PHASE 3B ENHANCEMENTS)
// ===================================================================

import { EnhancedMonitoringService } from "./services/enhanced-monitoring-service";
import { ConfigValidationService } from "./services/config-validation-service";
import { EnhancedPermissionCacheService } from "./services/enhanced-permission-cache-service";
import { AdvancedThreatDetectionService } from "./services/advanced-threat-detection-service";

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Quick setup function for basic authentication
 */
export async function setupBasicAuth(
  config: import("./types").AuthConfig,
  deps: import("./types").ServiceDependencies
) {
  const authService = createAuthenticationService(config, deps);
  await initializeAuthenticationService(authService);

  const middleware = createAuthMiddleware(authService, deps);

  return {
    authService,
    middleware,
    // Convenience methods
    requireAuth: () => middleware.create({ requireAuth: true }),
    requireRole: (roles: string[]) => middleware.requireRole(roles),
    requirePermission: (permissions: string[]) =>
      middleware.requirePermission(permissions),
    optionalAuth: () => middleware.optional(),
  };
}

/**
 * Health check for the entire auth system
 */
export async function healthCheck(authService: AuthenticationService) {
  return await authService.healthCheck();
}

// ===================================================================
// DEFAULT EXPORTS
// ===================================================================

export default {
  AuthenticationService,
  JWTService,
  KeycloakService,
  PermissionService,
  SessionService,
  ApiKeyService,
  AuthMiddleware,
  // Enhanced Services
  EnhancedMonitoringService,
  ConfigValidationService,
  EnhancedPermissionCacheService,
  AdvancedThreatDetectionService,
};
