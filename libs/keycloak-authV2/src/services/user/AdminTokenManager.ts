/**
 * AdminTokenManager - Single Responsibility: Admin token lifecycle
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles admin token acquisition and validation
 * - Open/Closed: Extensible for different token strategies
 * - Dependency Inversion: Depends on KeycloakClient abstraction
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  KeycloakClient,
  KeycloakTokenResponse,
} from "../../client/KeycloakClient";
import type { IAdminTokenManager } from "./interfaces";

export class AdminTokenManager implements IAdminTokenManager {
  private readonly logger: ILogger = createLogger("AdminTokenManager");
  private adminToken?: KeycloakTokenResponse | undefined;
  private tokenExpiry?: Date | undefined;

  constructor(
    private readonly adminClient: KeycloakClient,
    private readonly requiredScopes: string[] = [
      "manage-users",
      "manage-realm",
      "view-users",
      "view-realm",
    ],
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Get a valid admin token, refreshing if necessary
   */
  async getValidToken(): Promise<string> {
    const startTime = performance.now();

    try {
      if (this.isTokenValid()) {
        this.metrics?.recordCounter("admin_token.cache_hit", 1);
        return this.adminToken!.access_token;
      }

      await this.refreshToken();

      this.metrics?.recordCounter("admin_token.refresh", 1);
      this.metrics?.recordTimer(
        "admin_token.refresh_duration",
        performance.now() - startTime
      );

      return this.adminToken!.access_token;
    } catch (error) {
      this.metrics?.recordCounter("admin_token.refresh_error", 1);
      this.logger.error("Failed to get valid admin token", { error });
      throw new Error("Failed to authenticate with Keycloak Admin API");
    }
  }

  /**
   * Invalidate current token (forces refresh on next request)
   */
  invalidateToken(): void {
    this.adminToken = undefined;
    this.tokenExpiry = undefined;
    this.logger.debug("Admin token invalidated");
  }

  /**
   * Check if current token is valid
   */
  private isTokenValid(): boolean {
    if (!this.adminToken || !this.tokenExpiry) {
      return false;
    }

    const now = new Date();
    return now < this.tokenExpiry;
  }

  /**
   * Refresh admin token using client credentials
   */
  private async refreshToken(): Promise<void> {
    try {
      const now = new Date();

      this.adminToken = await this.adminClient.authenticateClientCredentials(
        this.requiredScopes
      );

      // Calculate expiry with 30-second safety buffer
      this.tokenExpiry = new Date(
        now.getTime() + (this.adminToken.expires_in - 30) * 1000
      );

      this.logger.debug("Admin token refreshed", {
        expiresIn: this.adminToken.expires_in,
        scopes: this.requiredScopes,
      });
    } catch (error) {
      this.logger.error("Failed to refresh admin token", {
        error,
        scopes: this.requiredScopes,
      });
      throw error;
    }
  }
}
