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
  APIKey,
  IAuthenticationResult,
  IAuthenticationContext,
} from "../../types/core";

import { createTimestamp } from "../../types/core";

import type {
  IJWTService,
  ISessionService,
  IPermissionService,
  IAPIKeyService,
  ICacheService,
  IAuditService,
  IAuthenticationCredentials,
  IRegistrationData,
  IRegistrationResult,
  IPasswordChangeData,
} from "../../contracts/services";

import {
  AuthenticationError,
  InvalidCredentialsError,
  ValidationError,
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
  firstName?: string;
  lastName?: string;
  acceptedTerms: boolean;
  registrationMetadata: Record<string, unknown>;
}

/**
 * Session creation options
 */
interface ISessionCreationOptions {
  userId: EntityId;
  authMethod: "password" | "apikey" | "session" | "jwt";
  ipAddress?: string;
  userAgent?: string;
  temporary?: boolean;
  apiKeyId?: string;
  metadata?: Record<string, unknown>;
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
  private readonly cacheService: ICacheService;
  private readonly auditService: IAuditService;

  constructor(
    jwtService: IJWTService,
    sessionService: ISessionService,
    permissionService: IPermissionService,
    apiKeyService: IAPIKeyService,
    cacheService: ICacheService,
    auditService: IAuditService
  ) {
    this.jwtService = jwtService;
    this.sessionService = sessionService;
    this.permissionService = permissionService;
    this.apiKeyService = apiKeyService;
    this.cacheService = cacheService;
    this.auditService = auditService;
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
        ipAddress: credentials.metadata?.ipAddress as string,
        userAgent: credentials.metadata?.userAgent as string,
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
      const keyValidation = await this.apiKeyService.validateKey(
        credentials.apiKey!
      );

      if (!keyValidation.isValid || !keyValidation.userId) {
        throw new InvalidCredentialsError("Invalid API key");
      }

      // Log API key usage
      await this.auditService.logEvent({
        userId: keyValidation.userId,
        action: "api_key_usage",
        timestamp: createTimestamp(),
        metadata: {
          keyId: keyValidation.id,
          keyName: keyValidation.name,
        },
      });

      return await this.createAuthenticatedSession(
        keyValidation.userId,
        "apikey",
        {
          apiKeyId: keyValidation.id,
          apiKeyName: keyValidation.name,
          temporary: true,
          permissions: keyValidation.permissions || [],
          ipAddress: credentials.metadata?.ipAddress as string,
          userAgent: credentials.metadata?.userAgent as string,
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
      const tokenPayload = await this.jwtService.verifyToken(refreshToken);

      if (!tokenPayload.sessionId || !tokenPayload.userId) {
        throw new AuthenticationError("Invalid refresh token structure");
      }

      // Validate session still exists
      const session = await this.sessionService.getSession(
        tokenPayload.sessionId
      );
      if (!session || !session.isActive || session.expiresAt < Date.now()) {
        throw new AuthenticationError("Session expired or inactive");
      }

      // Get current permissions
      const permissions = await this.permissionService.getUserPermissions(
        tokenPayload.userId
      );

      // Generate new token pair
      const newTokens = await this.jwtService.generateTokenPair({
        userId: tokenPayload.userId,
        sessionId: tokenPayload.sessionId,
        permissions,
      });

      // Update session activity
      await this.sessionService.updateSession(tokenPayload.sessionId, {
        lastActivity: Date.now(),
        refreshCount: (session.refreshCount || 0) + 1,
      });

      return {
        success: true,
        userId: tokenPayload.userId,
        sessionId: tokenPayload.sessionId,
        permissions,
        tokens: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        },
        metadata: {
          refreshedAt: Date.now(),
          refreshCount: (session.refreshCount || 0) + 1,
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
          ipAddress: registrationData.metadata?.ipAddress,
          userAgent: registrationData.metadata?.userAgent,
        },
      });

      // Set up initial permissions
      if (registrationData.metadata?.initialPermissions) {
        await this.permissionService.assignPermissions(
          userId,
          registrationData.metadata.initialPermissions as string[]
        );
      }

      // Create authenticated session for new user
      const authResult = await this.createAuthenticatedSession(
        userId,
        "password",
        {
          isNewRegistration: true,
          registrationTime: Date.now(),
          ipAddress: registrationData.metadata?.ipAddress as string,
          userAgent: registrationData.metadata?.userAgent as string,
        }
      );

      // Log successful registration
      await this.auditService.logEvent({
        userId,
        action: "user_registration",
        timestamp: createTimestamp(),
        metadata: {
          email: registrationData.email,
          username: registrationData.username,
          hasInitialPermissions:
            !!registrationData.metadata?.initialPermissions,
        },
      });

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

      await this.auditService.logEvent({
        userId: registrationData.email as EntityId,
        action: "user_registration_failed",
        timestamp: createTimestamp(),
        metadata: {
          email: registrationData.email,
          username: registrationData.username,
          error: errorMessage,
        },
      });

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
        context.user.id,
        passwordData.currentPassword
      );

      // Update password
      await this.updateUserPassword(context.user.id, passwordData.newPassword);

      // Invalidate all other sessions for security
      await this.invalidateOtherSessions(context.user.id, context.session?.id);

      // Log password change
      await this.auditService.logEvent({
        userId: context.user.id,
        action: "password_changed",
        timestamp: createTimestamp(),
        metadata: {
          sessionId: context.session?.id,
          otherSessionsInvalidated: true,
        },
      });

      return true;
    } catch (error) {
      await this.auditService.logEvent({
        userId: context.user.id,
        action: "password_change_failed",
        timestamp: createTimestamp(),
        metadata: {
          sessionId: context.session?.id,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

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
        const session = await this.sessionService.getSession(
          context.session.id
        );
        if (!session || !session.isActive || session.expiresAt < Date.now()) {
          throw new AuthenticationError("Session expired or invalid");
        }
      }

      // Get current permissions
      const currentPermissions =
        await this.permissionService.getUserPermissions(context.user.id);

      // Check if permissions have changed
      const permissionsChanged = this.hasPermissionsChanged(
        context.permissions,
        currentPermissions
      );

      // Update session with new permissions if needed
      if (permissionsChanged && context.session) {
        await this.sessionService.updateSession(context.session.id, {
          permissions: currentPermissions,
          lastActivity: Date.now(),
        });
      }

      // Generate fresh tokens
      const tokens = context.session
        ? await this.jwtService.generateTokenPair({
            userId: context.user.id,
            sessionId: context.session.id,
            permissions: currentPermissions,
          })
        : undefined;

      return {
        success: true,
        userId: context.user.id,
        sessionId: context.session?.id,
        permissions: currentPermissions,
        tokens: tokens
          ? {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            }
          : undefined,
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
    const session = await this.sessionService.createSession({
      userId,
      metadata: {
        authMethod,
        loginTime: Date.now(),
        ...options,
      },
    });

    // Generate JWT tokens
    const tokens = await this.jwtService.generateTokenPair({
      userId,
      sessionId: session.id,
      permissions,
    });

    return {
      success: true,
      userId,
      sessionId: session.id,
      permissions,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
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
    // This would integrate with actual user service for password verification
    throw new Error(
      "User service integration required for password verification"
    );
  }

  private async checkExistingUser(
    email: string,
    username: string
  ): Promise<{ field: string; value: string } | null> {
    // This would integrate with actual user service to check for existing users
    return null; // Placeholder - no existing users found
  }

  private async createUserAccount(
    context: IUserCreationContext
  ): Promise<EntityId> {
    // This would integrate with actual user service to create user account
    throw new Error("User service integration required for user creation");
  }

  private async hashPassword(password: string): Promise<string> {
    // This would use proper password hashing (bcrypt, argon2, etc.)
    throw new Error("Password hashing service integration required");
  }

  private async verifyCurrentPassword(
    userId: EntityId,
    password: string
  ): Promise<void> {
    // This would verify the current password against stored hash
    throw new Error(
      "User service integration required for password verification"
    );
  }

  private async updateUserPassword(
    userId: EntityId,
    newPassword: string
  ): Promise<void> {
    // This would update the user's password in the user service
    throw new Error("User service integration required for password update");
  }

  private async getUserById(userId: EntityId): Promise<any> {
    // This would fetch user details from user service
    return null; // Placeholder
  }

  private async invalidateOtherSessions(
    userId: EntityId,
    keepSessionId?: SessionId
  ): Promise<void> {
    const userSessions = await this.sessionService.getUserSessions(userId);

    for (const session of userSessions) {
      if (session.id !== keepSessionId) {
        await this.sessionService.deleteSession(session.id);
      }
    }
  }
}
