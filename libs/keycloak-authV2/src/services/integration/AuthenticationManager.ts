/**
 * Authentication Manager Component
 * Single Responsibility: Handle different authentication flows (password, OAuth code)
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  IAuthenticationManager,
  ClientContext,
  AuthenticationResult,
} from "./interfaces";
import type { UserInfo } from "../../types";
import type { KeycloakClient } from "../../client/KeycloakClient";
import type { KeycloakSessionManager } from "../session";
import type { IInputValidator } from "./interfaces";

/**
 * Authentication Manager Component
 * Handles different authentication flows with comprehensive error handling
 */
export class AuthenticationManager implements IAuthenticationManager {
  private readonly logger = createLogger("AuthenticationManager");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly sessionManager: KeycloakSessionManager,
    private readonly inputValidator: IInputValidator,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Authenticate user with username/password
   */
  async authenticateWithPassword(
    username: string,
    password: string,
    clientContext: ClientContext
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    try {
      // Input validation
      const usernameValidation = this.inputValidator.validateUsername(username);
      if (!usernameValidation.valid) {
        return {
          success: false,
          error: usernameValidation.error || "Invalid username",
        };
      }

      const passwordValidation = this.inputValidator.validatePassword(password);
      if (!passwordValidation.valid) {
        return {
          success: false,
          error: passwordValidation.error || "Invalid password",
        };
      }

      const contextValidation =
        this.inputValidator.validateClientContext(clientContext);
      if (!contextValidation.valid) {
        return {
          success: false,
          error: contextValidation.error || "Invalid client context",
        };
      }

      // Perform authentication with sanitized username
      const authResult = await this.keycloakClient.authenticateWithPassword(
        usernameValidation.sanitized!,
        password,
        clientContext.clientId
      );

      if (!authResult.success) {
        this.metrics?.recordCounter("keycloak.auth.password_failure", 1);
        return {
          success: false,
          error: authResult.error || "Authentication failed",
        };
      }

      if (!authResult.tokens) {
        return {
          success: false,
          error: "Authentication succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        authResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.createSessionForUser(
        userInfo,
        authResult.tokens,
        clientContext
      );

      if (!sessionResult.success || !sessionResult.session) {
        return {
          success: false,
          error: "Failed to create session",
        };
      }

      this.metrics?.recordCounter("keycloak.auth.password_success", 1);
      this.metrics?.recordTimer(
        "keycloak.auth.password_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated successfully", {
        userId: userInfo.id,
        username: userInfo.username,
      });

      return {
        success: true,
        user: userInfo,
        tokens: authResult.tokens,
        session: sessionResult.session,
      };
    } catch (error) {
      return this.handleAuthenticationError(error, "password");
    }
  }

  /**
   * Authenticate with authorization code (OAuth2 flow)
   */
  async authenticateWithCode(
    code: string,
    redirectUri: string,
    clientContext: ClientContext,
    codeVerifier?: string
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    try {
      // Input validation
      const codeValidation = this.inputValidator.validateAuthCode(code);
      if (!codeValidation.valid) {
        return {
          success: false,
          error: codeValidation.error || "Invalid authorization code",
        };
      }

      const uriValidation =
        this.inputValidator.validateRedirectUri(redirectUri);
      if (!uriValidation.valid) {
        return {
          success: false,
          error: uriValidation.error || "Invalid redirect URI",
        };
      }

      const contextValidation =
        this.inputValidator.validateClientContext(clientContext);
      if (!contextValidation.valid) {
        return {
          success: false,
          error: contextValidation.error || "Invalid client context",
        };
      }

      // Exchange code for tokens
      const tokenResult = await this.keycloakClient.exchangeCodeForTokens(
        code,
        redirectUri,
        codeVerifier
      );

      if (!tokenResult.success) {
        this.metrics?.recordCounter("keycloak.auth.code_failure", 1);
        return {
          success: false,
          error: tokenResult.error || "Code exchange failed",
        };
      }

      if (!tokenResult.tokens) {
        return {
          success: false,
          error: "Token exchange succeeded but no tokens received",
        };
      }

      // Get user information
      const userInfo = await this.keycloakClient.getUserInfo(
        tokenResult.tokens.access_token
      );

      if (!userInfo) {
        return {
          success: false,
          error: "Failed to retrieve user information",
        };
      }

      // Create session
      const sessionResult = await this.createSessionForUser(
        userInfo,
        tokenResult.tokens,
        clientContext
      );

      if (!sessionResult.success || !sessionResult.session) {
        return {
          success: false,
          error: "Failed to create session",
        };
      }

      this.metrics?.recordCounter("keycloak.auth.code_success", 1);
      this.metrics?.recordTimer(
        "keycloak.auth.code_duration",
        performance.now() - startTime
      );

      this.logger.info("User authenticated with code successfully", {
        userId: userInfo.id,
        username: userInfo.username,
      });

      return {
        success: true,
        user: userInfo,
        tokens: tokenResult.tokens,
        session: sessionResult.session,
      };
    } catch (error) {
      return this.handleAuthenticationError(error, "code");
    }
  }

  /**
   * Create session for authenticated user
   */
  private async createSessionForUser(
    userInfo: UserInfo,
    tokens: {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in: number;
      refresh_expires_in?: number;
    },
    clientContext: ClientContext
  ): Promise<{
    success: boolean;
    session?: {
      sessionId: string;
      sessionData: any;
    };
    error?: string;
  }> {
    try {
      const sessionResult = await this.sessionManager.createSession(
        userInfo.id,
        {
          accessToken: tokens.access_token,
          ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
          ...(tokens.id_token && { idToken: tokens.id_token }),
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          ...(tokens.refresh_expires_in && {
            refreshExpiresAt: new Date(
              Date.now() + tokens.refresh_expires_in * 1000
            ),
          }),
        },
        {
          ipAddress: clientContext.ipAddress,
          userAgent: clientContext.userAgent,
        }
      );

      return {
        success: true,
        session: {
          sessionId: sessionResult.sessionId!,
          sessionData: {
            id: sessionResult.sessionId!,
            userId: userInfo.id,
            userInfo: userInfo,
            ipAddress: clientContext.ipAddress,
            userAgent: clientContext.userAgent,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            expiresAt: sessionResult.expiresAt!,
            isActive: true,
            fingerprint: "",
          },
        },
      };
    } catch (error) {
      this.logger.error("Failed to create session", {
        error: error instanceof Error ? error.message : String(error),
        userId: userInfo.id,
      });
      return {
        success: false,
        error: "Session creation failed",
      };
    }
  }

  /**
   * Handle authentication errors with specific error categorization
   */
  private handleAuthenticationError(
    error: unknown,
    flowType: "password" | "code"
  ): AuthenticationResult {
    let errorMessage = "Authentication failed";
    let metricSuffix = "auth_error";

    if (error instanceof Error) {
      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorized")
      ) {
        errorMessage = "Invalid credentials";
        metricSuffix = "auth_invalid_credentials";
      } else if (
        error.message.includes("network") ||
        error.message.includes("ENOTFOUND")
      ) {
        errorMessage = "Authentication service unavailable";
        metricSuffix = "auth_service_unavailable";
      } else if (error.message.includes("timeout")) {
        errorMessage = "Authentication timeout";
        metricSuffix = "auth_timeout";
      } else if (
        error.message.includes("429") ||
        error.message.includes("Too Many Requests")
      ) {
        errorMessage = "Too many login attempts";
        metricSuffix = "auth_rate_limited";
      } else if (flowType === "code") {
        if (
          error.message.includes("invalid_grant") ||
          error.message.includes("invalid_code")
        ) {
          errorMessage = "Invalid or expired authorization code";
          metricSuffix = "code_auth_invalid_code";
        } else if (error.message.includes("invalid_redirect_uri")) {
          errorMessage = "Invalid redirect URI";
          metricSuffix = "code_auth_invalid_redirect";
        }
      }
    }

    this.logger.error(`${flowType} authentication failed`, {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });

    this.metrics?.recordCounter(`keycloak.auth.${metricSuffix}`, 1);

    return {
      success: false,
      error: errorMessage,
    };
  }
}
