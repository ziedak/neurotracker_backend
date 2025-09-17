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
export * from "./types";
export { AuthenticationService, createAuthenticationService, initializeAuthenticationService, } from "./services/auth-service";
export { JWTService } from "./services/jwt-service";
export { KeycloakService } from "./services/keycloak-service";
export { PermissionService } from "./services/permission-service";
export { SessionService } from "./services/session-service";
export { ApiKeyService } from "./services/api-key-service";
export { UserAuthenticationService, type IUserAuthenticationService, } from "./services/user-authentication-service";
export { TokenManagementService, type ITokenManagementService, } from "./services/token-management-service";
export { UserManagementService, type IUserManagementService, } from "./services/user-management-service";
export { EnhancedMonitoringService } from "./services/enhanced-monitoring-service";
export { ConfigValidationService } from "./services/config-validation-service";
export { EnhancedPermissionCacheService } from "./services/enhanced-permission-cache-service";
export { AdvancedThreatDetectionService } from "./services/advanced-threat-detection-service";
/**
 * Quick setup function for basic authentication
 */
/**
 * Health check for the entire auth system
 */
//# sourceMappingURL=index.d.ts.map