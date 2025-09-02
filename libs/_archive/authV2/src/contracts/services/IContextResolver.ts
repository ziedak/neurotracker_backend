import {
  IAuthenticationContext,
  SessionId,
  JWTToken,
  APIKey,
  EntityId,
} from "../../types/core";

import { IEnhancedUser } from "../../types/enhanced";

/**
 * Context resolution result interface
 */
export interface IContextResolutionResult {
  readonly success: boolean;
  readonly context?: IAuthenticationContext;
  readonly user?: IEnhancedUser;
  readonly permissions?: ReadonlyArray<string>;
  readonly errorMessage?: string;
  readonly needsRefresh?: boolean;
}

/**
 * Tenant validation result interface
 */
export interface ITenantValidationResult {
  readonly isValid: boolean;
  readonly tenantId?: string;
  readonly organizationId?: string;
  readonly storeId?: string;
  readonly permissions?: ReadonlyArray<string>;
  readonly errorMessage?: string;
}

/**
 * Context enrichment options
 */
export interface IContextEnrichmentOptions {
  readonly includePermissions?: boolean;
  readonly includeRoles?: boolean;
  readonly includeTenantInfo?: boolean;
  readonly includeMetadata?: boolean;
}

/**
 * Context resolver service interface
 * Handles context resolution, tenant validation, and permission enrichment
 * Following Single Responsibility Principle - focused on context resolution only
 */
export interface IContextResolver {
  /**
   * Resolve authentication context from session ID
   */
  resolveContextBySession(
    sessionId: SessionId,
    options?: IContextEnrichmentOptions
  ): Promise<IContextResolutionResult>;

  /**
   * Resolve authentication context from JWT token
   */
  resolveContextByJWT(
    token: JWTToken,
    options?: IContextEnrichmentOptions
  ): Promise<IContextResolutionResult>;

  /**
   * Resolve authentication context from API key
   */
  resolveContextByAPIKey(
    apiKey: APIKey,
    options?: IContextEnrichmentOptions
  ): Promise<IContextResolutionResult>;

  /**
   * Validate tenant context for multi-tenant operations
   */
  validateTenantContext(
    context: IAuthenticationContext,
    requiredTenantId?: string
  ): Promise<ITenantValidationResult>;

  /**
   * Enrich context with additional information
   */
  enrichContext(
    context: IAuthenticationContext,
    options: IContextEnrichmentOptions
  ): Promise<IAuthenticationContext>;

  /**
   * Get user permissions within context
   */
  getUserPermissions(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<ReadonlyArray<string>>;

  /**
   * Validate context permissions for operation
   */
  validateContextPermissions(
    context: IAuthenticationContext,
    requiredPermissions: ReadonlyArray<string>
  ): Promise<boolean>;

  /**
   * Check if context allows tenant access
   */
  canAccessTenant(
    context: IAuthenticationContext,
    tenantId: string
  ): Promise<boolean>;

  /**
   * Resolve user from context efficiently
   */
  resolveUserFromContext(
    context: IAuthenticationContext
  ): Promise<IEnhancedUser | null>;

  /**
   * Check if context is still valid and active
   */
  isContextValid(context: IAuthenticationContext): Promise<boolean>;

  /**
   * Create minimal context for operations
   */
  createMinimalContext(
    userId: EntityId,
    sessionId?: SessionId
  ): Promise<IAuthenticationContext>;
}
