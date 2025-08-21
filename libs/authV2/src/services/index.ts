/**
 * @fileoverview AuthV2 Services - Clean service layer exports
 * @version 2.0.0
 * @author Enterprise Development Team
 * @description Provides clean, enterprise-grade service exports for authentication and authorization
 */

// Core Services - Phase 4 Complete (4/4)
export { JWTServiceV2 } from "./JWTService";
export { SessionServiceV2 } from "./SessionService";
export { PermissionServiceV2 } from "./PermissionService";
export { APIKeyServiceV2 } from "./APIKeyService";

// Infrastructure Services - Phase 4 Complete (3/3)
export { CacheServiceV2 } from "./CacheService";
export { RedisCacheService } from "./RedisCacheService";
export { AuditServiceV2 } from "./AuditService";

// Orchestration Services - Phase 4 Complete (1/1)
export { AuthenticationServiceV2 } from "./AuthenticationService";

// Legacy Services (for backward compatibility)
export { UserServiceV2 } from "./UserService";

// Legacy exports for backward compatibility
export { JWTServiceV2 as JWTService } from "./JWTService";
export { SessionServiceV2 as SessionService } from "./SessionService";
export { PermissionServiceV2 as PermissionService } from "./PermissionService";
export { APIKeyServiceV2 as APIKeyService } from "./APIKeyService";
export { CacheServiceV2 as CacheService } from "./CacheService";
export { AuditServiceV2 as AuditService } from "./AuditService";
export { AuthenticationServiceV2 as AuthenticationService } from "./AuthenticationService";
export { UserServiceV2 as UserService } from "./UserService";

// Re-export service contracts
export type * from "../contracts/services";

/**
 * Phase 4 Service Implementation Status:
 * ✅ Core Services (4/4): JWT, Session, Permission, APIKey
 * ✅ Infrastructure Services (2/2): Cache, Audit
 * ✅ Orchestration Services (1/1): Authentication
 *
 * Total: 7/7 services complete (100%)
 *
 * AuthV2 Phase 4 "Additional Services Implementation" - COMPLETE ✅
 * All enterprise authentication and authorization services successfully implemented.
 */
