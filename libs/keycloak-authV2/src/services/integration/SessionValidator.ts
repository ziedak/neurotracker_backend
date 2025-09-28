/**
 * Session Validator Component
 * Single Responsibility: Session validation and logout management
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ISessionValidator, LogoutResult } from "./interfaces";
import type { KeycloakSessionManager, KeycloakSessionData } from "../session";
import type { KeycloakClient } from "../../client/KeycloakClient";
import type { IInputValidator } from "./interfaces";

/**
 * Session Validator Component
 * Handles session validation and logout operations
 */
export class SessionValidator implements ISessionValidator {
  private readonly logger = createLogger("SessionValidator");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly sessionManager: KeycloakSessionManager,
    private readonly inputValidator: IInputValidator,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Validate and refresh session
   */
  async validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<{
    valid: boolean;
    session?: KeycloakSessionData;
    refreshed?: boolean;
    error?: string;
  }> {
    try {
      // Input validation
      if (!this.inputValidator.validateSessionId(sessionId)) {
        return {
          valid: false,
          error: "Invalid session ID format",
        };
      }

      if (!context || !context.ipAddress || !context.userAgent) {
        return {
          valid: false,
          error: "Invalid context: IP address and user agent are required",
        };
      }

      const validation = await this.sessionManager.validateSession(
        sessionId,
        context
      );

      if (!validation.isValid) {
        this.metrics?.recordCounter("keycloak.session.validation_failed", 1);
        return {
          valid: false,
          ...(validation.reason && { error: validation.reason }),
        };
      }

      this.metrics?.recordCounter("keycloak.session.validation_success", 1);

      const result: {
        valid: boolean;
        session?: KeycloakSessionData;
        refreshed?: boolean;
        error?: string;
      } = {
        valid: true,
      };

      if (validation.sessionData) {
        result.session = validation.sessionData;
      }

      if (validation.shouldRefreshToken !== undefined) {
        result.refreshed = validation.shouldRefreshToken;
      }

      return result;
    } catch (error) {
      return this.handleSessionError(error, "validation");
    }
  }

  /**
   * Logout user and destroy session
   */
  async logout(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    },
    options?: {
      logoutFromKeycloak?: boolean;
      destroyAllSessions?: boolean;
    }
  ): Promise<LogoutResult> {
    const startTime = performance.now();
    let sessionDestroyed = false;
    let keycloakLogout = false;
    let keycloakLogoutError: string | undefined;

    try {
      // Input validation
      if (!this.inputValidator.validateSessionId(sessionId)) {
        return {
          success: false,
          loggedOut: false,
          sessionDestroyed: false,
          keycloakLogout: false,
          error: "Invalid session ID format",
        };
      }

      // Get session data for logout - validate session properly
      const validation = await this.sessionManager.validateSession(sessionId, {
        ipAddress: context.ipAddress || "unknown",
        userAgent: context.userAgent || "unknown",
      });

      if (validation.isValid && validation.sessionData) {
        const session = validation.sessionData;

        // Logout from Keycloak if requested and tokens available
        if (options?.logoutFromKeycloak && session.refreshToken) {
          try {
            await this.keycloakClient.logout(session.refreshToken);
            keycloakLogout = true;
            this.logger.info("User logged out from Keycloak", {
              userId: session.userId,
            });
            this.metrics?.recordCounter(
              "keycloak.session.keycloak_logout_success",
              1
            );
          } catch (logoutError) {
            keycloakLogoutError =
              logoutError instanceof Error
                ? logoutError.message
                : String(logoutError);
            this.logger.error("Failed to logout from Keycloak", {
              error: logoutError,
              userId: session.userId,
            });
            this.metrics?.recordCounter(
              "keycloak.session.keycloak_logout_failure",
              1
            );
          }
        }

        // Destroy current session
        await this.sessionManager.destroySession(sessionId, "logout");
        sessionDestroyed = true;
      } else {
        // Session not found or invalid - still consider it a successful logout
        sessionDestroyed = true;
      }

      this.metrics?.recordCounter("keycloak.session.logout_success", 1);
      this.metrics?.recordTimer(
        "keycloak.session.logout_duration",
        performance.now() - startTime
      );

      const result: LogoutResult = {
        success: true,
        loggedOut: true,
        sessionDestroyed,
        keycloakLogout,
      };

      if (keycloakLogoutError) {
        result.keycloakLogoutError = keycloakLogoutError;
      }

      return result;
    } catch (error) {
      this.logger.error("Logout failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.metrics?.recordCounter("keycloak.session.logout_error", 1);
      return {
        success: false,
        loggedOut: false,
        sessionDestroyed,
        keycloakLogout,
        error: "Logout failed",
      };
    }
  }

  /**
   * Handle session-related errors with specific categorization
   */
  private handleSessionError(
    error: unknown,
    operation: "validation" | "logout"
  ): {
    valid: boolean;
    error: string;
  } {
    let errorMessage = `Session ${operation} failed`;
    let metricSuffix = `${operation}_error`;

    if (error instanceof Error) {
      if (
        error.message.includes("expired") ||
        error.message.includes("invalid")
      ) {
        errorMessage = "Session expired or invalid";
        metricSuffix = `${operation}_expired`;
      } else if (
        error.message.includes("network") ||
        error.message.includes("ENOTFOUND")
      ) {
        errorMessage = "Session service unavailable";
        metricSuffix = `${operation}_service_unavailable`;
      } else if (error.message.includes("timeout")) {
        errorMessage = `Session ${operation} timeout`;
        metricSuffix = `${operation}_timeout`;
      } else if (
        error.message.includes("permission") ||
        error.message.includes("unauthorized")
      ) {
        errorMessage = "Insufficient permissions";
        metricSuffix = `${operation}_permission_denied`;
      }
    }

    this.logger.error(`Session ${operation} failed`, {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });

    this.metrics?.recordCounter(`keycloak.session.${metricSuffix}`, 1);

    return {
      valid: false,
      error: errorMessage,
    };
  }
}
