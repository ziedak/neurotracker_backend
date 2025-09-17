/**
 * Keycloak Authorization Services Client
 * Implements fine-grained authorization using Keycloak's Authorization Services
 * Supports UMA 2.0, RBAC, ABAC, and policy-based access control
 */

import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import { AuthenticationError, ClientType } from "../types";
import type { IKeycloakClientFactory } from "../types";

const logger = createLogger("KeycloakAuthzServices");

/**
 * Authorization decision
 */
export interface AuthorizationDecision {
  /** Whether access is granted */
  granted: boolean;
  /** List of scopes granted */
  scopes?: string[];
  /** Reason for decision (when denied) */
  reason?: string;
  /** Additional context */
  context?: Record<string, any>;
}

/**
 * Resource representation in Keycloak
 */
export interface ResourceRepresentation {
  id?: string;
  name: string;
  displayName?: string;
  type?: string;
  uris?: string[];
  scopes?: string[];
  attributes?: Record<string, string[]>;
  ownerManagedAccess?: boolean;
}

/**
 * Policy representation
 */
export interface PolicyRepresentation {
  id?: string;
  name: string;
  description?: string;
  type:
    | "role"
    | "user"
    | "client"
    | "time"
    | "aggregate"
    | "resource"
    | "scope"
    | "js";
  logic?: "POSITIVE" | "NEGATIVE";
  decisionStrategy?: "UNANIMOUS" | "AFFIRMATIVE" | "CONSENSUS";
  config?: Record<string, any>;
}

/**
 * Permission ticket for UMA flow
 */
export interface PermissionTicket {
  resource: string;
  scope?: string;
  claims?: Record<string, any>;
}

/**
 * Authorization request context
 */
export interface AuthorizationContext {
  /** User ID making the request */
  userId: string;
  /** Client ID */
  clientId?: string;
  /** IP address */
  ipAddress?: string;
  /** Time of request */
  timestamp?: number;
  /** Additional custom context */
  attributes?: Record<string, any>;
}

/**
 * Authorization Services configuration
 */
export interface AuthorizationServicesConfig {
  /** Enable caching of authorization decisions */
  enableCaching: boolean;
  /** Default cache TTL in seconds */
  cacheTtl: number;
  /** Enable policy evaluation logging */
  enableLogging: boolean;
  /** Enable performance metrics */
  enableMetrics: boolean;
  /** UMA ticket cache TTL in seconds */
  ticketCacheTtl: number;
}

/**
 * Default authorization configuration
 */
export const DEFAULT_AUTHZ_CONFIG: AuthorizationServicesConfig = {
  enableCaching: true,
  cacheTtl: 300, // 5 minutes
  enableLogging: true,
  enableMetrics: true,
  ticketCacheTtl: 60, // 1 minute
};

/**
 * Keycloak Authorization Services Client
 */
export class KeycloakAuthorizationServicesClient {
  private clientFactory: IKeycloakClientFactory;
  private cacheService: CacheService | undefined;
  private config: AuthorizationServicesConfig;
  private realmBaseUrl: string;
  private adminToken?:
    | {
        token: string;
        expiresAt: number;
      }
    | undefined;
  private adminTokenPromise?: Promise<string> | undefined;

  constructor(
    clientFactory: IKeycloakClientFactory,
    realmBaseUrl: string,
    cacheService?: CacheService,
    config: Partial<AuthorizationServicesConfig> = {}
  ) {
    // Validate required dependencies
    if (!clientFactory) {
      throw new Error(
        "KeycloakAuthorizationServicesClient requires a valid clientFactory"
      );
    }
    if (!realmBaseUrl || typeof realmBaseUrl !== "string") {
      throw new Error(
        "KeycloakAuthorizationServicesClient requires a valid realmBaseUrl"
      );
    }

    this.clientFactory = clientFactory;
    this.cacheService = cacheService;
    this.realmBaseUrl = realmBaseUrl;

    // Validate and merge configuration
    const mergedConfig = { ...DEFAULT_AUTHZ_CONFIG, ...config };
    this.validateConfig(mergedConfig);
    this.config = mergedConfig;

    logger.info("Authorization Services client initialized", {
      realmBaseUrl: this.realmBaseUrl,
      cacheEnabled: !!this.cacheService,
      config: this.config,
    });
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(config: AuthorizationServicesConfig): void {
    if (config.cacheTtl < 0) {
      throw new Error("cacheTtl must be a non-negative number");
    }
    if (config.ticketCacheTtl < 0) {
      throw new Error("ticketCacheTtl must be a non-negative number");
    }
    if (config.cacheTtl > 86400) {
      logger.warn("cacheTtl is very high, consider using a lower value", {
        cacheTtl: config.cacheTtl,
      });
    }
  }

  /**
   * Check authorization for a resource and scopes
   */
  public async checkAuthorization(
    accessToken: string,
    resource: string,
    scopes: string[] = [],
    context?: AuthorizationContext
  ): Promise<AuthorizationDecision> {
    const cacheKey = this.config.enableCaching
      ? this.buildCacheKey("authz", resource, scopes, accessToken)
      : undefined;

    // Try cache first
    if (cacheKey && this.cacheService) {
      const cached = await this.cacheService.get(cacheKey);
      if (cached.data) {
        logger.debug("Authorization decision from cache", { resource, scopes });
        return cached.data as AuthorizationDecision;
      }
    }

    try {
      const decision = await this.performAuthorizationCheck(
        accessToken,
        resource,
        scopes,
        context
      );

      // Cache the decision
      if (cacheKey && this.cacheService) {
        await this.cacheService.set(cacheKey, decision, this.config.cacheTtl);
      }

      if (this.config.enableLogging) {
        logger.info("Authorization decision made", {
          resource,
          scopes,
          granted: decision.granted,
          reason: decision.reason,
          context: context?.userId,
        });
      }

      return decision;
    } catch (error) {
      logger.error("Authorization check failed", {
        resource,
        scopes,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        granted: false,
        reason: "authorization_check_error",
        context: { error: String(error) },
      };
    }
  }

  /**
   * Request permission ticket for UMA flow
   */
  public async requestPermissionTicket(
    permissions: PermissionTicket[],
    _context?: AuthorizationContext
  ): Promise<string> {
    const clientToken = await this.getServiceClientToken();
    const endpoint = `${this.realmBaseUrl}/authz/protection/permission`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(permissions),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new AuthenticationError(
          `Permission ticket request failed: ${
            errorData.error_description || "Unknown error"
          }`,
          "PERMISSION_TICKET_FAILED",
          response.status,
          errorData
        );
      }

      const result = await response.json();
      const ticket = result.ticket || result;

      logger.debug("Permission ticket obtained", {
        permissions: permissions.length,
        ticket: ticket.substring(0, 10) + "...",
      });

      return ticket;
    } catch (error) {
      logger.error("Permission ticket request failed", {
        permissions: permissions.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Register a resource with Keycloak Authorization Services
   */
  public async registerResource(
    resource: ResourceRepresentation
  ): Promise<ResourceRepresentation> {
    const adminToken = await this.getAdminToken();
    const endpoint = `${this.realmBaseUrl}/authz/admin/resources`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(resource),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new AuthenticationError(
          `Resource registration failed: ${
            errorData.error_description || "Unknown error"
          }`,
          "RESOURCE_REGISTRATION_FAILED",
          response.status,
          errorData
        );
      }

      const registeredResource = await response.json();

      logger.info("Resource registered", {
        resourceId: registeredResource.id,
        name: resource.name,
        type: resource.type,
      });

      return registeredResource;
    } catch (error) {
      logger.error("Resource registration failed", {
        resourceName: resource.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create or update a policy
   */
  public async createPolicy(
    policy: PolicyRepresentation
  ): Promise<PolicyRepresentation> {
    const adminToken = await this.getAdminToken();
    const endpoint = `${this.realmBaseUrl}/authz/admin/policies/${policy.type}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(policy),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new AuthenticationError(
          `Policy creation failed: ${
            errorData.error_description || "Unknown error"
          }`,
          "POLICY_CREATION_FAILED",
          response.status,
          errorData
        );
      }

      const createdPolicy = await response.json();

      logger.info("Policy created", {
        policyId: createdPolicy.id,
        name: policy.name,
        type: policy.type,
      });

      return createdPolicy;
    } catch (error) {
      logger.error("Policy creation failed", {
        policyName: policy.name,
        policyType: policy.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all resources for the client
   */
  public async getResources(): Promise<ResourceRepresentation[]> {
    const adminToken = await this.getAdminToken();
    const endpoint = `${this.realmBaseUrl}/authz/admin/resources`;

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new AuthenticationError(
          "Failed to fetch resources",
          "RESOURCE_FETCH_FAILED",
          response.status
        );
      }

      const resources = await response.json();

      logger.debug("Resources fetched", { count: resources.length });

      return resources;
    } catch (error) {
      logger.error("Resource fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear authorization cache
   */
  public async clearAuthorizationCache(pattern?: string): Promise<number> {
    if (!this.cacheService) return 0;

    const searchPattern = pattern || "authz:*";
    const invalidated = await this.cacheService.invalidatePattern(
      searchPattern
    );

    logger.info("Authorization cache cleared", {
      pattern: searchPattern,
      count: invalidated,
    });

    return invalidated;
  }

  /**
   * Perform the actual authorization check via token exchange
   */
  private async performAuthorizationCheck(
    accessToken: string,
    resource: string,
    scopes: string[],
    _context?: AuthorizationContext
  ): Promise<AuthorizationDecision> {
    const endpoint = `${this.realmBaseUrl}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
      audience: this.getClientId("service"), // The client that manages the resource
      permission: `${resource}${scopes.length ? "#" + scopes.join(",") : ""}`,
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (response.ok) {
        const tokenResponse = await response.json();
        return {
          granted: true,
          scopes,
          context: {
            tokenType: tokenResponse.token_type,
            upgradeToken: !!tokenResponse.upgraded,
          },
        };
      }

      // Handle authorization denial
      const errorData = await response.json().catch(() => ({}));

      return {
        granted: false,
        reason: errorData.error || "access_denied",
        context: {
          status: response.status,
          description: errorData.error_description,
        },
      };
    } catch (error) {
      throw new AuthenticationError(
        `Authorization check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "AUTHORIZATION_CHECK_FAILED",
        500,
        { originalError: error }
      );
    }
  }

  /**
   * Get service client token for administrative operations
   */
  private async getServiceClientToken(): Promise<string> {
    const tokenResponse = await this.clientFactory.getClientCredentialsToken(
      "service"
    );
    return tokenResponse.access_token;
  }

  /**
   * Get admin token for authorization services management (with race condition protection)
   */
  private async getAdminToken(): Promise<string> {
    // Check if we have a valid cached admin token
    if (this.adminToken && this.adminToken.expiresAt > Date.now()) {
      return this.adminToken.token;
    }

    // If there's already a token request in progress, wait for it
    if (this.adminTokenPromise) {
      return await this.adminTokenPromise;
    }

    // Create new token request
    this.adminTokenPromise = this.fetchNewAdminToken();

    try {
      const token = await this.adminTokenPromise;
      return token;
    } finally {
      // Clear the promise so future requests can create a new one
      this.adminTokenPromise = undefined;
    }
  }

  /**
   * Fetch new admin token
   */
  private async fetchNewAdminToken(): Promise<string> {
    const tokenResponse = await this.clientFactory.getClientCredentialsToken(
      "service"
    );

    this.adminToken = {
      token: tokenResponse.access_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000 - 60000, // 1-minute buffer
    };

    logger.debug("New admin token obtained", {
      expiresIn: tokenResponse.expires_in,
    });

    return this.adminToken.token;
  }

  /**
   * Get client ID for a given client type
   */
  private getClientId(type: ClientType): string {
    const client = this.clientFactory.getClient(type);
    return client.clientId;
  }

  /**
   * Build cache key for authorization decisions
   */
  private buildCacheKey(
    prefix: string,
    resource: string,
    scopes: string[],
    token: string
  ): string {
    // Create secure hash of token using crypto
    const crypto = require("crypto");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .substring(0, 16);

    // Sanitize resource name and scopes for cache key
    const sanitizedResource = resource.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sanitizedScopes = scopes
      .map((scope) => scope.replace(/[^a-zA-Z0-9_-]/g, "_"))
      .sort()
      .join(",");

    return `${prefix}:${sanitizedResource}:${sanitizedScopes}:${tokenHash}`;
  }
}

/**
 * Create Authorization Services client
 */
export function createKeycloakAuthorizationServicesClient(
  clientFactory: IKeycloakClientFactory,
  realmBaseUrl: string,
  cacheService?: CacheService,
  config?: Partial<AuthorizationServicesConfig>
): KeycloakAuthorizationServicesClient {
  return new KeycloakAuthorizationServicesClient(
    clientFactory,
    realmBaseUrl,
    cacheService,
    config
  );
}

/**
 * Authorization helper functions
 */
export const AuthorizationHelpers = {
  /**
   * Create a role-based policy
   */
  createRolePolicy(
    name: string,
    roles: string[],
    logic: "POSITIVE" | "NEGATIVE" = "POSITIVE"
  ): PolicyRepresentation {
    return {
      name,
      type: "role",
      logic,
      config: {
        roles: JSON.stringify(
          roles.map((role) => ({ id: role, required: false }))
        ),
      },
    };
  },

  /**
   * Create a user-based policy
   */
  createUserPolicy(
    name: string,
    users: string[],
    logic: "POSITIVE" | "NEGATIVE" = "POSITIVE"
  ): PolicyRepresentation {
    return {
      name,
      type: "user",
      logic,
      config: {
        users: JSON.stringify(users),
      },
    };
  },

  /**
   * Create a time-based policy
   */
  createTimePolicy(
    name: string,
    startDate?: Date,
    endDate?: Date,
    startTime?: string,
    endTime?: string
  ): PolicyRepresentation {
    const config: Record<string, any> = {};

    if (startDate) config["nbf"] = startDate.toISOString();
    if (endDate) config["naf"] = endDate.toISOString();
    if (startTime) config["dayMonth"] = startTime;
    if (endTime) config["dayMonthEnd"] = endTime;

    return {
      name,
      type: "time",
      config,
    };
  },

  /**
   * Create a JavaScript-based policy
   */
  createJavaScriptPolicy(name: string, code: string): PolicyRepresentation {
    return {
      name,
      type: "js",
      config: {
        code,
      },
    };
  },
};
