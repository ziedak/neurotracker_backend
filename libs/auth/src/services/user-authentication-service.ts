/**
 * User Authentication Service
 * Handles authentication flows: login, register, logout
 * Part of Phase 2 service refactoring for single responsibility principle
 */

import {
  AuthResult,
  LoginCredentials,
  RegisterData,
  ServiceDependencies,
  AuthError,
} from "../types";
import { JWTService } from "./jwt-service";
import { KeycloakService } from "./keycloak-service";
import { SessionService } from "./session-service";
import { PasswordPolicyService } from "./password-policy-service";
import { ValidationSchemas, safeValidate } from "../validation/schemas";

/**
 * Interface for User Authentication Service
 */
export interface IUserAuthenticationService {
  /**
   * Authenticate user with credentials
   */
  login(credentials: LoginCredentials): Promise<AuthResult>;

  /**
   * Register new user account
   */
  register(data: RegisterData): Promise<AuthResult>;

  /**
   * Logout user and revoke tokens
   */
  logout(userId: string, token?: string): Promise<boolean>;

  /**
   * Validate login credentials
   */
  validateLoginCredentials(credentials: LoginCredentials): Promise<{
    valid: boolean;
    errors?: string[];
  }>;
}

/**
 * User Authentication Service Implementation
 *
 * Responsible for:
 * - User login with credentials validation
 * - New user registration
 * - User logout and token revocation
 * - Authentication flow coordination
 */
export class UserAuthenticationService implements IUserAuthenticationService {
  private jwtService: JWTService;
  private keycloakService: KeycloakService;
  private sessionService: SessionService;
  private passwordPolicyService?: PasswordPolicyService;

  constructor(
    private deps: ServiceDependencies,
    services: {
      jwtService: JWTService;
      keycloakService: KeycloakService;
      sessionService: SessionService;
      passwordPolicyService?: PasswordPolicyService;
    }
  ) {
    this.jwtService = services.jwtService;
    this.keycloakService = services.keycloakService;
    this.sessionService = services.sessionService;
    if (services.passwordPolicyService) {
      this.passwordPolicyService = services.passwordPolicyService;
    }
  }

  /**
   * Authenticate user with email/username and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // 1. Validate input credentials
      const validationResult = await this.validateLoginCredentials(credentials);
      if (!validationResult.valid) {
        return {
          success: false,
          error: "Invalid credentials format",
          code: "VALIDATION_ERROR",
        };
      }

      // 2. Authenticate with Keycloak
      const keycloakResult =
        await this.keycloakService.authenticateUserEnhanced(
          credentials.email,
          credentials.password
        );

      if (!keycloakResult.success || !keycloakResult.user) {
        return {
          success: false,
          error: "Authentication failed",
          code: "AUTHENTICATION_FAILED",
        };
      }

      // 3. Generate JWT tokens
      const tokens = await this.jwtService.generateTokens(keycloakResult.user);

      // 4. Create user session if device info is provided
      if (credentials.deviceInfo) {
        try {
          await this.sessionService.createSession(
            keycloakResult.user.id,
            credentials.deviceInfo
          );
        } catch (error) {
          // Session creation failure shouldn't block authentication
          this.deps.monitoring.logger.warn("Failed to create session:", error);
        }
      }

      return {
        success: true,
        user: keycloakResult.user,
        tokens,
      };
    } catch (error) {
      const authError = error as AuthError;
      return {
        success: false,
        error: authError.message || "Authentication failed",
        code: authError.code || "AUTHENTICATION_ERROR",
      };
    }
  }

  /**
   * Register new user account
   */
  async register(data: RegisterData): Promise<AuthResult> {
    try {
      // 1. Validate registration data
      const validation = safeValidate(ValidationSchemas.RegisterData, data);
      if (!validation.success) {
        return {
          success: false,
          error: "Invalid registration data",
          code: "VALIDATION_ERROR",
        };
      }

      // 2. Validate password policy if configured
      if (this.passwordPolicyService && data.password) {
        const passwordValidation =
          await this.passwordPolicyService.validatePassword(data.password, {
            email: data.email,
            ...(data.name && { name: data.name }),
          });

        if (!passwordValidation.isValid) {
          return {
            success: false,
            error: "Password does not meet security requirements",
            code: "PASSWORD_POLICY_VIOLATION",
          };
        }
      }

      // 3. Register user with Keycloak
      const keycloakResult = await this.keycloakService.registerUser({
        email: data.email,
        password: data.password,
        ...(data.name && { name: data.name }),
        roles: data.roles || ["user"],
        ...(data.metadata && { metadata: data.metadata }),
      });

      if (!keycloakResult.success || !keycloakResult.user) {
        return {
          success: false,
          error: "User registration failed",
          code: "REGISTRATION_FAILED",
        };
      }

      // 4. Generate JWT tokens for immediate login
      const tokens = await this.jwtService.generateTokens(keycloakResult.user);

      // 5. Create initial session if device info is provided (removed until DeviceInfo is available)
      // Note: Session creation will be handled in parent AuthenticationService

      return {
        success: true,
        user: keycloakResult.user,
        tokens,
      };
    } catch (error) {
      const authError = error as AuthError;
      return {
        success: false,
        error: authError.message || "Registration failed",
        code: authError.code || "REGISTRATION_ERROR",
      };
    }
  }

  /**
   * Logout user and revoke tokens
   */
  async logout(userId: string, token?: string): Promise<boolean> {
    try {
      // 1. Revoke JWT token if provided
      if (token) {
        await this.jwtService.revokeToken(token);
      }

      // 2. Delete all user sessions
      await this.sessionService.deleteUserSessions(userId);

      // 3. Logout from Keycloak (note: direct logout method not available, sessions handle this)
      // The session deletion above effectively handles logout

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Logout failed:", error);
      return false;
    }
  }

  /**
   * Validate login credentials format and password policy
   */
  async validateLoginCredentials(credentials: LoginCredentials): Promise<{
    valid: boolean;
    errors?: string[];
  }> {
    const errors: string[] = [];

    // 1. Validate basic format with Zod
    const validation = safeValidate(
      ValidationSchemas.LoginCredentials,
      credentials
    );
    if (!validation.success) {
      errors.push(...validation.errors.issues.map((issue) => issue.message));
    }

    // 2. Validate password policy if configured
    if (this.passwordPolicyService && credentials.password) {
      const passwordValidation =
        await this.passwordPolicyService.validatePassword(
          credentials.password,
          {
            email: credentials.email,
          }
        );

      if (!passwordValidation.isValid) {
        errors.push(...passwordValidation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      ...(errors.length > 0 && { errors }),
    };
  }
}
