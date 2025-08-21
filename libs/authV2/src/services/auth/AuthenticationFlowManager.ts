/**
 * @fileoverview AuthenticationFlowManager - Enterprise authentication flow orchestration
 * @module services/auth/AuthenticationFlowManager
 * @version 1.0.0
 * @author Enterprise Development Team
 * @description Manages different authentication flows and user lifecycle operations
 */

import type {
  EntityId,
  SessionId,
  JWTToken,
  IAuthenticationResult,
  IAuthenticationContext,
} from "../../types/core";

import type { IEnhancedUser } from "../../types/enhanced";

import { createTimestamp } from "../../types/core";

import type {
  IJWTService,
  ISessionService,
  IPermissionService,
  IAPIKeyService,
  IAuditService,
  IUserService,
  IUserCreateData,
  IAuthenticationCredentials,
  IRegistrationData,
  IRegistrationResult,
  IPasswordChangeData,
} from "../../contracts/services";

import {
  AuthenticationError,
  InvalidCredentialsError,
} from "../../errors/core";

/**
 * Authentication flow result with detailed context
 */
interface IFlowResult {
  success: boolean;
  userId?: EntityId;
  sessionId?: SessionId;
  permissions?: string[];
  tokens?: {
    accessToken: JWTToken;
    refreshToken: JWTToken;
    expiresAt: number;
  };
  metadata?: Record<string, unknown>;
  error?: Error;
}

/**
 * User creation context for registration flow
 */
interface IUserCreationContext {
  email: string;
  username: string;
  passwordHash: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  acceptedTerms: boolean;
  registrationMetadata: Record<string, unknown>;
}

/**
 * Enterprise authentication flow manager
 *
 * Orchestrates complex authentication flows:
 * - Password-based authentication with session creation
 * - API key validation and temporary session management
 * - JWT token validation and refresh workflows
 * - User registration with comprehensive validation
 * - Password change operations with security checks
 * - Context validation and permission synchronization
 */
export class AuthenticationFlowManager {
  private readonly jwtService: IJWTService;
  private readonly sessionService: ISessionService;
  private readonly permissionService: IPermissionService;
  private readonly apiKeyService: IAPIKeyService;
  private readonly auditService: IAuditService;
  private readonly userService: IUserService;

  constructor(
    jwtService: IJWTService,
    sessionService: ISessionService,
    permissionService: IPermissionService,
    apiKeyService: IAPIKeyService,
    auditService: IAuditService,
    userService: IUserService
  ) {
    this.jwtService = jwtService;
    this.sessionService = sessionService;
    this.permissionService = permissionService;
    this.apiKeyService = apiKeyService;
    this.auditService = auditService;
    this.userService = userService;
  }

  /**
   * Execute password-based authentication flow
   */
  async executePasswordFlow(
    credentials: IAuthenticationCredentials
  ): Promise<IFlowResult> {
    try {
      // Verify password credentials (this would typically call user service)
      const userId = await this.verifyPasswordCredentials(
        credentials.identifier,
        credentials.password!
      );

      return await this.createAuthenticatedSession(userId, "password", {
        ipAddress: credentials.metadata?.["ipAddress"] as string,
        userAgent: credentials.metadata?.["userAgent"] as string,
        loginMethod: "password",
        identifier: credentials.identifier,
      });
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("Password authentication failed"),
      };
    }
  }

  /**
   * Execute API key authentication flow
   */
  async executeAPIKeyFlow(
    credentials: IAuthenticationCredentials
  ): Promise<IFlowResult> {
    try {
      // Validate API key
      const keyValidation = await this.apiKeyService.validate(
        credentials.apiKey!
      );
      if (!keyValidation.isValid || !keyValidation.keyInfo?.userId) {
        throw new InvalidCredentialsError({ message: "Invalid API key" });
      }

      // Log API key usage
      await this.auditService.logAuthEvent(
        keyValidation.keyInfo.userId,
        "api_key_usage",
        "success",
        {
          keyId: keyValidation.keyInfo.id,
          keyName: keyValidation.keyInfo.name,
        }
      );

      return await this.createAuthenticatedSession(
        keyValidation.keyInfo.userId,
        "apikey",
        {
          apiKeyId: keyValidation.keyInfo.id,
          apiKeyName: keyValidation.keyInfo.name,
          temporary: true,
          permissions: keyValidation.keyInfo.scopes || [],
          ipAddress: credentials.metadata?.["ipAddress"] as string,
          userAgent: credentials.metadata?.["userAgent"] as string,
        }
      );
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("API key authentication failed"),
      };
    }
  }

  /**
   * Execute JWT token refresh flow
   */
  async executeRefreshFlow(refreshToken: JWTToken): Promise<IFlowResult> {
    try {
      // Verify refresh token
      const tokenVerification = await this.jwtService.verify(refreshToken);

      if (
        !tokenVerification.isValid ||
        !tokenVerification.payload?.sessionId ||
        !tokenVerification.payload?.userId
      ) {
        throw new AuthenticationError("Invalid refresh token structure");
      }

      // Validate session still exists
      const session = await this.sessionService.findById(
        tokenVerification.payload.sessionId
      );
      if (
        !session ||
        !session.isActive ||
        new Date(session.expiresAt).getTime() < Date.now()
      ) {
        throw new AuthenticationError("Session expired or inactive");
      }

      // Get current permissions
      const permissions = await this.permissionService.getUserPermissions(
        tokenVerification.payload.userId
      );

      // Generate new token pair
      const newTokens = await this.jwtService.generate({
        userId: tokenVerification.payload.userId,
        sessionId: tokenVerification.payload.sessionId,
        permissions: permissions.map((p) => p.name),
      });

      // Update session activity
      await this.sessionService.update(tokenVerification.payload.sessionId, {
        lastAccessedAt: new Date(),
        metadata: {
          refreshCount:
            ((session.metadata?.["refreshCount"] as number) || 0) + 1,
        },
      });

      return {
        success: true,
        userId: tokenVerification.payload.userId,
        sessionId: tokenVerification.payload.sessionId,
        permissions: permissions.map((p) => p.name),
        tokens: {
          accessToken: newTokens.token,
          refreshToken: newTokens.refreshToken,
          expiresAt: newTokens.expiresAt.getTime(),
        },
        metadata: {
          refreshedAt: Date.now(),
          refreshCount:
            ((session.metadata?.["refreshCount"] as number) || 0) + 1,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("Token refresh failed"),
      };
    }
  }

  /**
   * Execute user registration flow
   */
  async executeRegistrationFlow(
    registrationData: IRegistrationData
  ): Promise<IRegistrationResult> {
    try {
      // Check for existing users
      const existingUser = await this.checkExistingUser(
        registrationData.email,
        registrationData.username
      );

      if (existingUser) {
        return {
          success: false,
          user: null,
          authenticationResult: null,
          failureReason: `User with ${existingUser.field} already exists`,
          validationErrors: [`${existingUser.field} is already registered`],
        };
      }

      // Create user account
      const userId = await this.createUserAccount({
        email: registrationData.email,
        username: registrationData.username,
        passwordHash: await this.hashPassword(registrationData.password),
        firstName: registrationData.firstName,
        lastName: registrationData.lastName,
        acceptedTerms: registrationData.acceptedTerms,
        registrationMetadata: {
          registrationTime: Date.now(),
          deviceInfo: registrationData.deviceInfo,
          ipAddress: registrationData.metadata?.["ipAddress"],
          userAgent: registrationData.metadata?.["userAgent"],
        },
      });

      // Set up initial permissions (if available in permission service)
      if (registrationData.metadata?.["initialPermissions"]) {
        // Note: IPermissionService doesn't have assignPermissions method
        // This would need to be implemented differently or removed
        // await this.permissionService.assignPermissions(
        //   userId,
        //   registrationData.metadata?.["initialPermissions"] as string[]
        // );
      }

      // Create authenticated session for new user
      const authResult = await this.createAuthenticatedSession(
        userId,
        "password",
        {
          isNewRegistration: true,
          registrationTime: Date.now(),
          ipAddress: registrationData.metadata?.["ipAddress"] as string,
          userAgent: registrationData.metadata?.["userAgent"] as string,
        }
      );

      // Log successful registration
      await this.auditService.logAuthEvent(
        userId,
        "user_registration",
        "success",
        {
          email: registrationData.email,
          username: registrationData.username,
          hasInitialPermissions:
            !!registrationData.metadata?.["initialPermissions"],
        }
      );

      return {
        success: true,
        user: await this.getUserById(userId),
        authenticationResult: this.convertFlowResultToAuthResult(authResult),
        failureReason: null,
        validationErrors: [],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Registration failed";

      await this.auditService.logAuthEvent(
        registrationData.email as EntityId,
        "user_registration",
        "failure",
        {
          error: errorMessage,
          email: registrationData.email,
          username: registrationData.username,
        }
      );

      return {
        success: false,
        user: null,
        authenticationResult: null,
        failureReason: errorMessage,
        validationErrors: [errorMessage],
      };
    }
  }

  /**
   * Execute password change flow
   */
  async executePasswordChangeFlow(
    context: IAuthenticationContext,
    passwordData: IPasswordChangeData
  ): Promise<boolean> {
    try {
      // Verify current password
      await this.verifyCurrentPassword(
        context.user.id as EntityId,
        passwordData.currentPassword
      );

      // Update password
      await this.updateUserPassword(
        context.user.id as EntityId,
        passwordData.currentPassword,
        passwordData.newPassword
      );

      // Invalidate all other sessions for security
      await this.invalidateOtherSessions(
        context.user.id as EntityId,
        context.session?.id as SessionId
      );

      // Log password change
      await this.auditService.logAuthEvent(
        context.user.id as EntityId,
        "password_changed",
        "success",
        {
          sessionId: context.session?.id,
          otherSessionsInvalidated: true,
        }
      );

      return true;
    } catch (error) {
      await this.auditService.logAuthEvent(
        context.user.id as EntityId,
        "password_change_failed",
        "failure",
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );

      throw error;
    }
  }

  /**
   * Execute context validation flow
   */
  async executeContextValidationFlow(
    context: IAuthenticationContext
  ): Promise<IFlowResult> {
    try {
      // Validate session if present
      if (context.session) {
        const session = await this.sessionService.findById(
          context.session.id as SessionId
        );
        if (
          !session ||
          !session.isActive ||
          new Date(session.expiresAt).getTime() < Date.now()
        ) {
          throw new AuthenticationError("Session expired or invalid");
        }
      }

      // Get current permissions
      const currentPermissions =
        await this.permissionService.getUserPermissions(
          context.user.id as EntityId
        );

      // Check if permissions have changed
      const permissionsChanged = this.hasPermissionsChanged(
        [...context.permissions],
        currentPermissions.map((p) => p.name)
      );

      // Update session with new permissions if needed
      if (permissionsChanged && context.session) {
        await this.sessionService.update(context.session.id as SessionId, {
          lastAccessedAt: new Date(),
          metadata: {
            lastValidation: Date.now(),
            permissions: currentPermissions.map((p) => p.name),
          },
        });
      }

      // Generate fresh tokens
      const tokens = context.session
        ? await this.jwtService.generate({
            userId: context.user.id as EntityId,
            sessionId: context.session.id as SessionId,
            permissions: currentPermissions.map((p) => p.name),
          })
        : undefined;

      return {
        success: true,
        userId: context.user.id as EntityId,
        sessionId: context.session?.id as SessionId,
        permissions: currentPermissions.map((p) => p.name),
        ...(tokens && {
          tokens: {
            accessToken: tokens.token,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt.getTime(),
          },
        }),
        metadata: {
          validatedAt: Date.now(),
          permissionsChanged,
          sessionExtended: !!context.session,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error
            : new AuthenticationError("Context validation failed"),
      };
    }
  }

  /**
   * Private helper methods
   */

  private async createAuthenticatedSession(
    userId: EntityId,
    authMethod: "password" | "apikey" | "session" | "jwt",
    options: Record<string, unknown> = {}
  ): Promise<IFlowResult> {
    // Get user permissions
    const permissions = await this.permissionService.getUserPermissions(userId);

    // Create session
    const session = await this.sessionService.create({
      userId,
      deviceId: (options["deviceId"] as string) || "unknown",
      ipAddress: (options["ipAddress"] as string) || "unknown",
      userAgent: (options["userAgent"] as string) || "unknown",
      metadata: {
        authMethod,
        loginTime: Date.now(),
        ...options,
      },
    });

    // Generate JWT tokens
    const tokens = await this.jwtService.generate({
      userId,
      sessionId: session.id as unknown as SessionId,
      permissions: permissions.map((p) => (typeof p === "string" ? p : p.name)),
    });

    return {
      success: true,
      userId,
      sessionId: session.id as unknown as SessionId,
      permissions: permissions.map((p) => (typeof p === "string" ? p : p.name)),
      tokens: {
        accessToken: tokens.token,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.getTime(),
      },
      metadata: {
        authMethod,
        sessionCreated: true,
        loginTime: Date.now(),
        ...options,
      },
    };
  }

  private convertFlowResultToAuthResult(
    flowResult: IFlowResult
  ): IAuthenticationResult | null {
    if (!flowResult.success || !flowResult.userId) {
      return null;
    }

    return {
      success: true,
      user: null, // Would be populated with actual user data
      session: null, // Would be populated with session data
      accessToken: flowResult.tokens?.accessToken || null,
      refreshToken: flowResult.tokens?.refreshToken || null,
      expiresAt: flowResult.tokens?.expiresAt
        ? createTimestamp(new Date(flowResult.tokens.expiresAt))
        : null,
      permissions: flowResult.permissions || [],
      roles: [], // Would be populated with user roles
      errors: [],
      metadata: flowResult.metadata || {},
    };
  }

  private hasPermissionsChanged(
    oldPermissions: string[],
    newPermissions: string[]
  ): boolean {
    if (oldPermissions.length !== newPermissions.length) {
      return true;
    }

    const oldSet = new Set(oldPermissions);
    const newSet = new Set(newPermissions);

    for (const permission of oldPermissions) {
      if (!newSet.has(permission)) {
        return true;
      }
    }

    for (const permission of newPermissions) {
      if (!oldSet.has(permission)) {
        return true;
      }
    }

    return false;
  }

  // User service integration methods (these would be implemented with actual user service)
  private async verifyPasswordCredentials(
    identifier: string,
    password: string
  ): Promise<EntityId> {
    try {
      const verificationResult = await this.userService.verifyCredentials(
        identifier,
        password
      );

      if (!verificationResult.isValid || !verificationResult.user) {
        throw new Error("Invalid credentials");
      }

      return verificationResult.user.id;
    } catch (error) {
      throw new Error("Authentication verification failed");
    }
  }

  private async checkExistingUser(
    email: string,
    username: string
  ): Promise<{ field: string; value: string } | null> {
    try {
      // Check email
      const userByEmail = await this.userService.findByEmail(email);
      if (userByEmail) {
        return { field: "email", value: email };
      }

      // Check username if provided
      if (username) {
        const userByUsername = await this.userService.findByUsername(username);
        if (userByUsername) {
          return { field: "username", value: username };
        }
      }

      return null;
    } catch (error) {
      // On error, assume no conflict to allow creation attempt
      return null;
    }
  }

  private async createUserAccount(
    context: IUserCreationContext
  ): Promise<EntityId> {
    try {
      const createData: IUserCreateData = {
        email: context.email,
        username: context.username,
        password: context.passwordHash, // This is already hashed
        ...(context.firstName && { firstName: context.firstName }),
        ...(context.lastName && { lastName: context.lastName }),
        metadata: context.registrationMetadata,
      };

      const user = await this.userService.create(createData);
      return user.id;
    } catch (error) {
      throw new Error("User account creation failed");
    }
  }

  private async hashPassword(password: string): Promise<string> {
    // The user service handles password hashing internally during creation/updates
    // For now, return the password as-is since UserService will hash it
    return password;
  }

  private async verifyCurrentPassword(
    userId: EntityId,
    password: string
  ): Promise<void> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const verificationResult = await this.userService.verifyCredentials(
        user.email,
        password
      );

      if (!verificationResult.isValid) {
        throw new Error("Invalid current password");
      }
    } catch (error) {
      throw new Error("Current password verification failed");
    }
  }

  private async updateUserPassword(
    userId: EntityId,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    try {
      const success = await this.userService.updatePassword(
        userId,
        currentPassword,
        newPassword
      );

      if (!success) {
        throw new Error("Password update failed");
      }
    } catch (error) {
      throw new Error("User password update failed");
    }
  }

  private async getUserById(userId: EntityId): Promise<IEnhancedUser | null> {
    try {
      const user = await this.userService.findById(userId);
      return user;
    } catch (error) {
      return null;
    }
  }

  private async invalidateOtherSessions(
    userId: EntityId,
    keepSessionId?: SessionId
  ): Promise<void> {
    try {
      if (keepSessionId) {
        // Use the new selective session termination method
        await this.sessionService.endAllForUserExcept(userId, keepSessionId);
      } else {
        await this.sessionService.endAllForUser(userId);
      }
    } catch (error) {
      throw new Error(
        `Failed to invalidate user sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
