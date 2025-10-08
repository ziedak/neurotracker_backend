/**
 * KeycloakAdminClient - Enterprise-grade Keycloak Admin API HTTP Client
 *
 * Purpose: Low-level HTTP operations with Keycloak Admin REST API
 *
 * Key Features:
 * - Comprehensive   async searchUsers(options: UserSearchOptions = {}): Promise<KeycloakUser[]> {
    this.ensureBaseUrl(); // Ensure baseUrl is initialized
    const startTime = performance.now();T validation before API calls
 * - Automatic admin token management via ClientCredentialsTokenProvider
 * - Retry logic and error handling
 * - Metrics and monitoring integration
 * - Type-safe API operations
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles HTTP communication with Keycloak Admin API
 * - Open/Closed: Extensible for new API endpoints
 * - Liskov Substitution: Can be replaced with different API implementations
 * - Interface Segregation: Focused on API operations only
 * - Dependency Inversion: Depends on abstractions (IClientCredentialsTokenProvider, JWTValidator, HttpClient)
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { createHttpClient, HttpStatus, type HttpClient } from "@libs/messaging";
import type { KeycloakClient } from "./KeycloakClient";
import { JWTValidator } from "../services/token/JWTValidator";
import type {
  IClientCredentialsTokenProvider,
  KeycloakUser,
  KeycloakRole,
  KeycloakCredential,
  UserSearchOptions,
  UpdateUserOptions,
} from "../services/user/interfaces";

/**
 * Interface for Keycloak Admin API operations
 */
export interface IKeycloakAdminClient {
  searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]>;
  getUserById(userId: string): Promise<KeycloakUser | null>;
  createUser(user: KeycloakUser): Promise<string>;
  updateUser(userId: string, updates: UpdateUserOptions): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  resetPassword(userId: string, credential: KeycloakCredential): Promise<void>;
  getUserRealmRoles(userId: string): Promise<KeycloakRole[]>;
  assignRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void>;
  removeRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void>;
  assignClientRoles(
    userId: string,
    clientId: string,
    roles: KeycloakRole[]
  ): Promise<void>;
  getRealmRoles(): Promise<KeycloakRole[]>;
  getClientRoles(clientId: string): Promise<KeycloakRole[]>;
  getClientInternalId(clientId: string): Promise<string>;
}

/**
 * Configuration for admin client
 */
export interface KeycloakAdminClientConfig {
  /** Enable JWT validation before API calls (default: true) */
  enableJwtValidation?: boolean;
  /** HTTP timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Max retry attempts for failed requests (default: 3) */
  retries?: number;
}

/**
 * KeycloakAdminClient - Production-grade Admin API HTTP client
 */
export class KeycloakAdminClient implements IKeycloakAdminClient {
  private readonly logger: ILogger = createLogger("KeycloakAdminClient");
  private readonly httpClient: HttpClient;
  private baseUrl: string; // Changed from readonly to allow lazy initialization
  private readonly config: Required<KeycloakAdminClientConfig>;
  private jwtValidator?: JWTValidator;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly tokenProvider: IClientCredentialsTokenProvider,
    config: KeycloakAdminClientConfig = {},
    private readonly metrics?: IMetricsCollector
  ) {
    // Merge with defaults
    this.config = {
      enableJwtValidation: config.enableJwtValidation ?? true,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
    };

    this.httpClient = createHttpClient({
      timeout: this.config.timeout,
      retries: this.config.retries,
    });

    // Defer baseUrl building - will be set on first use or after discovery doc is available
    this.baseUrl = "";

    // Initialize JWT validator if enabled (after discovery document is available)
    if (this.config.enableJwtValidation) {
      const discoveryDoc = keycloakClient.getDiscoveryDocument();
      if (discoveryDoc?.jwks_uri && discoveryDoc?.issuer) {
        // Build baseUrl now that discovery doc is available
        this.baseUrl = this.buildAdminApiUrl();

        this.jwtValidator = new JWTValidator(
          discoveryDoc.jwks_uri,
          discoveryDoc.issuer,
          undefined, // No specific audience for admin tokens
          metrics
        );
      } else {
        this.logger.warn(
          "JWT validation enabled but discovery document incomplete - will retry on first use"
        );
      }
    } else {
      // Try to build baseUrl even without validation
      try {
        this.baseUrl = this.buildAdminApiUrl();
      } catch (error) {
        this.logger.warn(
          "Discovery document not yet available - baseUrl will be built on first API call",
          { error }
        );
      }
    }

    this.logger.debug("KeycloakAdminClient initialized", {
      baseUrl: this.baseUrl,
      jwtValidationEnabled:
        this.config.enableJwtValidation && !!this.jwtValidator,
    });
  }

  /**
   * Get validated admin token
   * - Retrieves token from provider (with automatic refresh)
   * - Validates JWT signature and claims if enabled
   * - Returns validated token ready for use
   */
  private async getValidatedToken(): Promise<string> {
    this.logger.debug("Getting validated token from provider");

    const token = await this.tokenProvider.getValidToken();

    this.logger.debug("Token received from provider", {
      hasToken: !!token,
      tokenLength: token?.length,
      tokenType: typeof token,
      tokenPrefix: token ? token.substring(0, 50) + "..." : "NO_TOKEN",
    });

    if (!token) {
      this.logger.error("Token provider returned undefined or empty token");
      throw new Error("Token provider returned undefined or empty token");
    }

    // Validate token if JWT validation is enabled
    if (this.config.enableJwtValidation && this.jwtValidator) {
      const startTime = performance.now();

      try {
        const result = await this.jwtValidator.validateJWT(token);

        if (!result.success) {
          this.metrics?.recordCounter(
            "admin_client.token_validation_failed",
            1
          );
          this.logger.error("Admin token validation failed", {
            error: result.error,
          });
          throw new Error(`Admin token validation failed: ${result.error}`);
        }

        this.metrics?.recordCounter("admin_client.token_validation_success", 1);
        this.metrics?.recordTimer(
          "admin_client.token_validation_duration",
          performance.now() - startTime
        );

        this.logger.debug("Admin token validated successfully", {
          userId: result.user?.id,
        });
      } catch (error) {
        this.metrics?.recordCounter("admin_client.token_validation_error", 1);
        throw error;
      }
    }

    return token;
  }

  /**
   * Search for users
   */
  async searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]> {
    this.ensureBaseUrl();
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();
      const params = this.buildSearchParams(options);
      const url = `${this.baseUrl}/users?${params.toString()}`;

      this.logger.info("🔍 Executing Admin API search_users request", {
        url,
        baseUrl: this.baseUrl,
        params: params.toString(),
        options,
        hasToken: !!token,
        tokenLength: token?.length,
        tokenPrefix: token ? token.substring(0, 50) + "..." : "NO_TOKEN",
        authHeader: token ? `Bearer ${token.substring(0, 20)}...` : "NO_AUTH",
      });

      const response = await this.httpClient.get<KeycloakUser[]>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      this.logger.info("✅ Admin API search_users response received", {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        dataLength: Array.isArray(response.data) ? response.data.length : 0,
      });

      this.validateResponse(response, "User search failed");

      const users: KeycloakUser[] = response.data;

      this.recordMetrics("search_users", performance.now() - startTime);
      this.logger.debug("Users searched", { count: users.length, options });

      return users;
    } catch (error) {
      this.logger.error("search_users failed with detailed error", {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: error?.constructor?.name,
        errorData:
          typeof error === "object" && error !== null && "data" in error
            ? error.data
            : undefined,
        errorStatus:
          typeof error === "object" && error !== null && "status" in error
            ? error.status
            : undefined,
        options,
      });
      this.recordError("search_users", error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUser | null> {
    this.ensureBaseUrl();
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.get<KeycloakUser>(
        `${this.baseUrl}/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      if (response.status === 404) {
        return null;
      }

      this.validateResponse(response, "Get user failed");

      const user: KeycloakUser = response.data;

      this.recordMetrics("get_user", performance.now() - startTime);

      return user;
    } catch (error) {
      this.recordError("get_user", error);
      throw error;
    }
  }

  /**
   * Create user
   */
  async createUser(user: KeycloakUser): Promise<string> {
    this.ensureBaseUrl(); // Ensure baseUrl is initialized
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      this.logger.info("Creating user in Keycloak", {
        username: user.username,
        email: user.email,
        enabled: user.enabled,
        hasCredentials: !!user.credentials,
        credentialsCount: user.credentials?.length,
        credentialTypes: user.credentials?.map((c) => c.type),
      });

      const response = await this.httpClient.post<KeycloakUser>(
        `${this.baseUrl}/users`,
        JSON.stringify(user),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "User creation failed");

      // Extract user ID from Location header
      const locationHeader =
        response.headers?.["location"] || response.headers?.["Location"];
      if (!locationHeader) {
        throw new Error("User created but ID not returned");
      }

      const userId = locationHeader.split("/").pop()!;

      this.recordMetrics("create_user", performance.now() - startTime);
      this.logger.info("User created", { userId, username: user.username });

      return userId;
    } catch (error) {
      this.recordError("create_user", error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId: string, updates: UpdateUserOptions): Promise<void> {
    this.ensureBaseUrl();
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.put<KeycloakUser>(
        `${this.baseUrl}/users/${userId}`,
        JSON.stringify(updates),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      this.validateResponse(response, "User update failed");

      this.recordMetrics("update_user", performance.now() - startTime);
      this.logger.info("User updated", { userId });
    } catch (error) {
      this.recordError("update_user", error);
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    this.ensureBaseUrl();
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.delete(
        `${this.baseUrl}/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 404) {
        this.logger.warn("User not found for deletion", { userId });
        return;
      }

      this.validateResponse(response, "User deletion failed");

      this.recordMetrics("delete_user", performance.now() - startTime);
      this.logger.info("User deleted", { userId });
    } catch (error) {
      this.recordError("delete_user", error);
      throw error;
    }
  }

  /**
   * Reset user password
   */
  async resetPassword(
    userId: string,
    credential: KeycloakCredential
  ): Promise<void> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.put(
        `${this.baseUrl}/users/${userId}/reset-password`,
        JSON.stringify(credential),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      this.validateResponse(response, "Password reset failed");

      this.recordMetrics("reset_password", performance.now() - startTime);
      this.logger.info("Password reset", {
        userId,
        temporary: credential.temporary,
      });
    } catch (error) {
      this.recordError("reset_password", error);
      throw error;
    }
  }

  /**
   * Get user's realm roles
   */
  async getUserRealmRoles(userId: string): Promise<KeycloakRole[]> {
    this.ensureBaseUrl();
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.get<KeycloakRole[]>(
        `${this.baseUrl}/users/${userId}/role-mappings/realm`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "Get user realm roles failed");

      const roles: KeycloakRole[] = response.data;

      this.recordMetrics("get_user_realm_roles", performance.now() - startTime);

      return roles;
    } catch (error) {
      this.recordError("get_user_realm_roles", error);
      throw error;
    }
  }

  /**
   * Assign realm roles to user
   */
  async assignRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.post(
        `${this.baseUrl}/users/${userId}/role-mappings/realm`,
        JSON.stringify(roles),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      this.validateResponse(response, "Assign realm roles failed");

      this.recordMetrics("assign_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles assigned", {
        userId,
        roles: roles.map((r) => r.name),
      });
    } catch (error) {
      this.recordError("assign_realm_roles", error);
      throw error;
    }
  }

  /**
   * Remove realm roles from user
   */
  async removeRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.delete(
        `${this.baseUrl}/users/${userId}/role-mappings/realm`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: roles,
        }
      );

      this.validateResponse(response, "Remove realm roles failed");

      this.recordMetrics("remove_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles removed", {
        userId,
        roles: roles.map((r) => r.name),
      });
    } catch (error) {
      this.recordError("remove_realm_roles", error);
      throw error;
    }
  }

  /**
   * Assign client roles to user
   */
  async assignClientRoles(
    userId: string,
    clientId: string,
    roles: KeycloakRole[]
  ): Promise<void> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();
      const internalClientId = await this.getClientInternalId(clientId);

      const response = await this.httpClient.post(
        `${this.baseUrl}/users/${userId}/role-mappings/clients/${internalClientId}`,
        JSON.stringify(roles),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      this.validateResponse(response, "Assign client roles failed");

      this.recordMetrics("assign_client_roles", performance.now() - startTime);
      this.logger.info("Client roles assigned", {
        userId,
        clientId,
        roles: roles.map((r) => r.name),
      });
    } catch (error) {
      this.recordError("assign_client_roles", error);
      throw error;
    }
  }

  /**
   * Get all realm roles
   */
  async getRealmRoles(): Promise<KeycloakRole[]> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.get<KeycloakRole[]>(
        `${this.baseUrl}/roles`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "Get realm roles failed");

      const roles: KeycloakRole[] = response.data || [];

      this.recordMetrics("get_realm_roles", performance.now() - startTime);

      return roles;
    } catch (error) {
      this.recordError("get_realm_roles", error);
      throw error;
    }
  }

  /**
   * Get client roles
   */
  async getClientRoles(clientId: string): Promise<KeycloakRole[]> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();
      const internalClientId = await this.getClientInternalId(clientId);

      const response = await this.httpClient.get<KeycloakRole[]>(
        `${this.baseUrl}/clients/${internalClientId}/roles`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "Get client roles failed");

      const roles: KeycloakRole[] = response.data;

      this.recordMetrics("get_client_roles", performance.now() - startTime);

      return roles;
    } catch (error) {
      this.recordError("get_client_roles", error);
      throw error;
    }
  }

  /**
   * Get client internal ID from client ID
   */
  async getClientInternalId(clientId: string): Promise<string> {
    const startTime = performance.now();

    try {
      const token = await this.getValidatedToken();

      const response = await this.httpClient.get<any[]>(
        `${this.baseUrl}/clients?clientId=${clientId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "Get client failed");

      const clients = response.data;
      if (!Array.isArray(clients) || clients.length === 0) {
        throw new Error(`Client not found: ${clientId}`);
      }

      const internalClientId = clients[0].id;

      this.recordMetrics(
        "get_client_internal_id",
        performance.now() - startTime
      );

      return internalClientId;
    } catch (error) {
      this.recordError("get_client_internal_id", error);
      throw error;
    }
  }

  // Private utility methods

  private ensureBaseUrl(): void {
    if (!this.baseUrl) {
      this.baseUrl = this.buildAdminApiUrl();
    }
  }

  private buildAdminApiUrl(): string {
    const discoveryDoc = this.keycloakClient.getDiscoveryDocument();
    if (!discoveryDoc) {
      throw new Error("Keycloak discovery document not available");
    }

    const baseUrl = discoveryDoc.issuer.replace(/\/realms\/.*$/, "");
    const realm = discoveryDoc.issuer.split("/realms/")[1];

    if (!realm) {
      throw new Error("Could not extract realm from discovery document");
    }

    return `${baseUrl}/admin/realms/${realm}`;
  }

  private buildSearchParams(options: UserSearchOptions): URLSearchParams {
    const params = new URLSearchParams();

    if (options.username) params.append("username", options.username);
    if (options.email) params.append("email", options.email);
    if (options.firstName) params.append("firstName", options.firstName);
    if (options.lastName) params.append("lastName", options.lastName);
    if (options.search) params.append("search", options.search);
    if (options.exact !== undefined)
      params.append("exact", options.exact.toString());
    if (options.max !== undefined) params.append("max", options.max.toString());
    if (options.first !== undefined)
      params.append("first", options.first.toString());

    return params;
  }

  private validateResponse(response: any, errorPrefix: string): void {
    if (!HttpStatus.isSuccess(response.status)) {
      throw new Error(
        `${errorPrefix}: ${response.status} ${response.statusText}`
      );
    }
  }

  private recordMetrics(operation: string, duration?: number): void {
    this.metrics?.recordCounter(`admin_client.${operation}`, 1);
    if (duration !== undefined) {
      this.metrics?.recordTimer(`admin_client.${operation}_duration`, duration);
    }
  }

  private recordError(operation: string, error: unknown): void {
    this.metrics?.recordCounter(`admin_client.${operation}_error`, 1);
    this.logger.error(`${operation} failed`, { error });
  }
}

/**
 * Factory function to create KeycloakAdminClient with defaults
 */
export function createKeycloakAdminClient(
  keycloakClient: KeycloakClient,
  tokenProvider: IClientCredentialsTokenProvider,
  config?: KeycloakAdminClientConfig,
  metrics?: IMetricsCollector
): KeycloakAdminClient {
  return new KeycloakAdminClient(
    keycloakClient,
    tokenProvider,
    {
      enableJwtValidation: config?.enableJwtValidation ?? true,
      timeout: config?.timeout ?? 30000,
      retries: config?.retries ?? 3,
    },
    metrics
  );
}
