/**
 * KeycloakApiClient - Single Responsibility: Low-level HTTP operations with Keycloak Admin API
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles HTTP communication with Keycloak API
 * - Open/Closed: Extensible for new API endpoints
 * - Liskov Substitution: Can be replaced with different API implementations
 * - Interface Segregation: Focused on API operations only
 * - Dependency Inversion: Depends on abstractions (IAdminTokenManager, HttpClient)
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { createHttpClient, HttpStatus, type HttpClient } from "@libs/messaging";
import type { KeycloakClient } from "../../client/KeycloakClient";
import type {
  IKeycloakApiClient,
  IAdminTokenManager,
  KeycloakUser,
  KeycloakRole,
  KeycloakCredential,
  UserSearchOptions,
  UpdateUserOptions,
} from "./interfaces";

export class KeycloakApiClient implements IKeycloakApiClient {
  private readonly logger: ILogger = createLogger("KeycloakApiClient");
  private readonly httpClient: HttpClient;
  private readonly baseUrl: string;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly tokenManager: IAdminTokenManager,
    private readonly metrics?: IMetricsCollector
  ) {
    this.httpClient = createHttpClient({
      timeout: 30000,
      retries: 3,
    });

    this.baseUrl = this.buildAdminApiUrl();
  }

  /**
   * Search for users
   */
  async searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]> {
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();
      const params = this.buildSearchParams(options);

      const response = await this.httpClient.get<KeycloakUser[]>(
        `${this.baseUrl}/users?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      this.validateResponse(response, "User search failed");

      const users: KeycloakUser[] = response.data;

      this.recordMetrics("search_users", performance.now() - startTime);
      this.logger.debug("Users searched", { count: users.length, options });

      return users;
    } catch (error) {
      this.recordError("search_users", error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUser | null> {
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();

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
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();

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
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();

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
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();

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
      const token = await this.tokenManager.getValidToken();

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
    const startTime = performance.now();

    try {
      const token = await this.tokenManager.getValidToken();

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
      const token = await this.tokenManager.getValidToken();

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
      const token = await this.tokenManager.getValidToken();

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
      const token = await this.tokenManager.getValidToken();
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
      const token = await this.tokenManager.getValidToken();

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
      const token = await this.tokenManager.getValidToken();
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
      const token = await this.tokenManager.getValidToken();

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

  private buildAdminApiUrl(): string {
    const discoveryDoc = this.keycloakClient.getDiscoveryDocument();
    if (!discoveryDoc) {
      throw new Error("Keycloak discovery document not available");
    }

    const baseUrl = discoveryDoc.issuer.replace(/\/realms\/.*$/, "");
    const realm = discoveryDoc.issuer.split("/realms/")[1];

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
    this.metrics?.recordCounter(`keycloak_api.${operation}`, 1);
    if (duration !== undefined) {
      this.metrics?.recordTimer(`keycloak_api.${operation}_duration`, duration);
    }
  }

  private recordError(operation: string, error: unknown): void {
    this.metrics?.recordCounter(`keycloak_api.${operation}_error`, 1);
    this.logger.error(`${operation} failed`, { error });
  }
}
