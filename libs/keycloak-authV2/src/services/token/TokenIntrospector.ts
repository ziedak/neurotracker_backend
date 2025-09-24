/**
 * Token Introspector Service
 * Handles token introspection using Keycloak introspection endpoint
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../../types";
import { KeycloakClient } from "../../client/KeycloakClient";

export class TokenIntrospector {
  private readonly logger = createLogger("TokenIntrospector");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Validate token using Keycloak introspection endpoint
   */
  async introspectToken(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Use Keycloak client for token introspection
      const result = await this.keycloakClient.introspectToken(token);

      this.metrics?.recordCounter(
        "token_introspector.introspection_success",
        1
      );
      this.metrics?.recordTimer(
        "token_introspector.introspection_duration",
        performance.now() - startTime
      );

      this.logger.debug("Token introspection completed", {
        success: result.success,
        userId: result.user?.id,
      });

      return result;
    } catch (error) {
      this.logger.error("Token introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      this.metrics?.recordCounter("token_introspector.introspection_error", 1);

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token introspection failed",
      };
    }
  }
}
