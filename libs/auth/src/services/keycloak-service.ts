/**
 * Keycloak Integration Service
 * Handles authentication and user management with Keycloak server
 * Uses the official Keycloak admin client for comprehensive integration
 */

import KcAdminClient from "@keycloak/keycloak-admin-client";
import { getEnv } from "@libs/config";
import {
  User,
  AuthResult,
  RegisterData,
  AuthConfig,
  ServiceDependencies,
  AuthError,
} from "../types";

// ===================================================================
// KEYCLOAK SERVICE CLASS
// ===================================================================

export class KeycloakService {
  private client: KcAdminClient;
  private initialized = false;

  constructor(private config: AuthConfig, private deps: ServiceDependencies) {
    this.client = new KcAdminClient({
      baseUrl: this.config.keycloak.serverUrl,
      realmName: this.config.keycloak.realm,
    });
  }

  /**
   * Initialize Keycloak client connection
   */
  async initialize(): Promise<void> {
    try {
      // Get Keycloak admin credentials from environment variables
      const adminUsername = getEnv("KEYCLOAK_ADMIN_USERNAME");
      const adminPassword = getEnv("KEYCLOAK_ADMIN_PASSWORD");

      if (!adminUsername || !adminPassword) {
        throw new AuthError(
          "Keycloak admin credentials not configured. Please set KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD environment variables.",
          "KEYCLOAK_CONFIG_MISSING"
        );
      }

      await this.client.auth({
        username: adminUsername,
        password: adminPassword,
        grantType: "password",
        clientId: this.config.keycloak.clientId,
        clientSecret: this.config.keycloak.clientSecret,
      });

      this.initialized = true;
      this.deps.monitoring.logger.info(
        "Keycloak client initialized successfully"
      );
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to initialize Keycloak client",
        { error }
      );
      throw new AuthError(
        "Keycloak initialization failed",
        "KEYCLOAK_INIT_FAILED"
      );
    }
  }

  /**
   * Enhanced user authentication with comprehensive validation
   * SECURITY FIX: Now properly validates passwords via Keycloak Direct Grant
   */
  async authenticateUserEnhanced(
    email: string,
    password: string,
    options?: {
      validateAccountStatus?: boolean;
      recordLoginAttempt?: boolean;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<AuthResult> {
    const startTime = Date.now();

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // SECURITY FIX: Perform actual password authentication via Keycloak Direct Grant
      const authResult = await this.performDirectGrantAuthentication(email, password);
      
      if (!authResult.success) {
        // Record failed login attempt if enabled
        if (options?.recordLoginAttempt && this.deps.monitoring) {
          await this.deps.monitoring.recordAuthEvent({
            type: "login_failed",
            userId: null,
            ipAddress: options.ipAddress,
            userAgent: options.userAgent,
            timestamp: new Date(),
            metadata: { reason: "invalid_credentials", email },
            severity: "medium",
          });
        }

        return {
          success: false,
          error: "Invalid credentials",
          code: "INVALID_CREDENTIALS",
        };
      }

      // Get user details after successful authentication
      const users = await this.client.users.find({
        email,
        enabled: true,
        emailVerified: true,
      });

      if (!users || users.length === 0) {
        // This should not happen after successful authentication, but handle gracefully
        this.deps.monitoring.logger.error("User not found after successful Keycloak authentication", {
          email,
          authResult: authResult.accessToken ? "[REDACTED]" : "no_token"
        });
        
        return {
          success: false,
          error: "Authentication error",
          code: "AUTH_ERROR",
        };
      }

      const keycloakUser = users[0];

      if (!keycloakUser) {
        return {
          success: false,
          error: "User not found",
          code: "USER_NOT_FOUND",
        };
      }

      // Additional account status validation
      if (options?.validateAccountStatus) {
        if (!keycloakUser.enabled) {
          return {
            success: false,
            error: "Account is disabled",
            code: "ACCOUNT_DISABLED",
          };
        }

        if (!keycloakUser.emailVerified) {
          return {
            success: false,
            error: "Email not verified",
            code: "EMAIL_NOT_VERIFIED",
          };
        }
      }

      // Get comprehensive user roles and permissions
      const roles = await this.getUserRoles(keycloakUser.id!);
      const permissions = await this.getUserPermissions(keycloakUser.id!);

      // Convert to enhanced User format
      const user: User = {
        id: keycloakUser.id!,
        email: keycloakUser.email!,
        name: this.buildUserDisplayName(keycloakUser),
        roles: roles.map((r) => r.name!),
        permissions: permissions,
        metadata: {
          keycloakId: keycloakUser.id,
          username: keycloakUser.username,
          emailVerified: keycloakUser.emailVerified,
          createdTimestamp: keycloakUser.createdTimestamp,
        },
        isActive: keycloakUser.enabled!,
        createdAt: new Date(keycloakUser.createdTimestamp!),
        updatedAt: new Date(),
      };

      // Record successful login if monitoring enabled
      if (options?.recordLoginAttempt && this.deps.monitoring) {
        const authTime = Date.now() - startTime;
        await this.deps.monitoring.recordAuthEvent({
          type: "login_success",
          userId: user.id,
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
          timestamp: new Date(),
          metadata: {
            email: user.email,
            rolesCount: user.roles.length,
            permissionsCount: user.permissions.length,
            authTime,
          },
          severity: "low",
        });
      }

      return {
        success: true,
        user,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Record authentication error
      if (this.deps.monitoring) {
        await this.deps.monitoring.recordAuthEvent({
          type: "login_error",
          userId: null,
          ipAddress: options?.ipAddress,
          userAgent: options?.userAgent,
          timestamp: new Date(),
          metadata: { error: errorMessage, email },
          severity: "medium",
        });
      }

      this.deps.monitoring.logger.error(
        "Enhanced Keycloak authentication failed",
        {
          email,
          error: errorMessage,
          duration: Date.now() - startTime,
        }
      );

      return {
        success: false,
        error: "Authentication failed",
        code: "AUTH_FAILED",
      };
    }
  }

  /**
   * Register new user in Keycloak
   */
  async registerUser(data: RegisterData): Promise<AuthResult> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Check if user already exists
      const existingUsers = await this.client.users.find({ email: data.email });
      if (existingUsers && existingUsers.length > 0) {
        return {
          success: false,
          error: "User already exists",
          code: "USER_EXISTS",
        };
      }

      // Create user in Keycloak
      const nameParts = data.name ? data.name.split(" ") : [];
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const keycloakUser = await this.client.users.create({
        username: data.email,
        email: data.email,
        firstName: firstName,
        lastName: lastName,
        enabled: true,
        emailVerified: false,
        credentials: [
          {
            type: "password",
            value: data.password,
            temporary: false,
          },
        ],
        groups: data.roles?.map((role) => role) || ["user"],
        attributes: {
          ...data.metadata,
        },
      });

      // Get the created user
      const user = await this.client.users.findOne({ id: keycloakUser.id });

      if (!user) {
        throw new AuthError(
          "Failed to retrieve created user",
          "USER_CREATION_FAILED"
        );
      }

      // Assign roles if specified
      if (data.roles && data.roles.length > 0) {
        await this.assignUserRoles(keycloakUser.id, data.roles);
      }

      // Convert to our User format
      const resultUser: User = {
        id: keycloakUser.id,
        email: data.email,
        name: data.name || data.email, // Fallback to email if name not provided
        roles: data.roles || ["user"],
        permissions: [],
        metadata: {
          keycloakId: keycloakUser.id,
          username: data.email,
          emailVerified: false,
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return {
        success: true,
        user: resultUser,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Keycloak user registration failed", {
        email: data.email,
        error,
      });
      return {
        success: false,
        error: "Registration failed",
        code: "REGISTRATION_FAILED",
      };
    }
  }

  /**
   * Get user by ID from Keycloak
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const keycloakUser = await this.client.users.findOne({ id: userId });
      if (!keycloakUser) {
        return null;
      }

      const roles = await this.getUserRoles(userId);

      return {
        id: keycloakUser.id!,
        email: keycloakUser.email!,
        name:
          keycloakUser.firstName && keycloakUser.lastName
            ? `${keycloakUser.firstName} ${keycloakUser.lastName}`
            : keycloakUser.username!,
        roles: roles.map((r) => r.name!),
        permissions: [],
        metadata: {
          keycloakId: keycloakUser.id,
          username: keycloakUser.username,
          emailVerified: keycloakUser.emailVerified,
        },
        isActive: keycloakUser.enabled!,
        createdAt: new Date(keycloakUser.createdTimestamp!),
        updatedAt: new Date(),
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get user from Keycloak", {
        userId,
        error,
      });
      return null;
    }
  }

  /**
   * Update user in Keycloak
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const updateData: any = {};

      if (updates.name) {
        const nameParts = updates.name.split(" ");
        updateData.firstName = nameParts[0];
        updateData.lastName = nameParts.slice(1).join(" ");
      }

      if (updates.email) {
        updateData.email = updates.email;
      }

      if (updates.isActive !== undefined) {
        updateData.enabled = updates.isActive;
      }

      await this.client.users.update({ id: userId }, updateData);

      // Update roles if specified
      if (updates.roles) {
        await this.assignUserRoles(userId, updates.roles);
      }

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to update user in Keycloak", {
        userId,
        error,
      });
      return false;
    }
  }

  /**
   * Delete user from Keycloak
   */
  async deleteUser(userId: string): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      await this.client.users.del({ id: userId });
      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to delete user from Keycloak", {
        userId,
        error,
      });
      return false;
    }
  }

  /**
   * Get user permissions from Keycloak (derived from roles)
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const roles = await this.getUserRoles(userId);
      const permissions: string[] = [];

      // Extract permissions from roles
      for (const role of roles) {
        if (role.composites && Array.isArray(role.composites)) {
          // If role has composite roles, get their permissions
          for (const composite of role.composites) {
            if (composite.name) {
              permissions.push(`role:${composite.name}`);
            }
          }
        }

        // Add basic role permission
        if (role.name) {
          permissions.push(`role:${role.name}`);
        }
      }

      return [...new Set(permissions)]; // Remove duplicates
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to get user permissions from Keycloak",
        { userId, error }
      );
      return [];
    }
  }

  /**
   * Get user roles from Keycloak
   */
  async getUserRoles(userId: string): Promise<any[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const roles = await this.client.users.listRealmRoleMappings({
        id: userId,
      });
      return roles || [];
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to get user roles from Keycloak",
        { userId, error }
      );
      return [];
    }
  }

  /**
   * Build user display name from Keycloak user data
   */
  private buildUserDisplayName(keycloakUser: any): string {
    if (keycloakUser.firstName && keycloakUser.lastName) {
      return `${keycloakUser.firstName} ${keycloakUser.lastName}`.trim();
    }

    if (keycloakUser.firstName) {
      return keycloakUser.firstName;
    }

    if (keycloakUser.lastName) {
      return keycloakUser.lastName;
    }

    return keycloakUser.username || keycloakUser.email || "Unknown User";
  }

  /**
   * Assign roles to user
   */
  async assignUserRoles(userId: string, roleNames: string[]): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Get role objects by name
      const roles = await this.client.roles.find();
      const rolesToAssign = roles
        .filter((role: any) => role.name && roleNames.includes(role.name))
        .map((role: any) => ({
          id: role.id!,
          name: role.name!,
        }));

      if (rolesToAssign.length > 0) {
        await this.client.users.addRealmRoleMappings({
          id: userId,
          roles: rolesToAssign,
        });
      }
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to assign user roles", {
        userId,
        roleNames,
        error,
      });
      throw new AuthError("Failed to assign roles", "ROLE_ASSIGNMENT_FAILED");
    }
  }

  /**
   * Verify Keycloak connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Try to get realm info
      await this.client.realms.findOne({ realm: this.config.keycloak.realm });
      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Keycloak health check failed", {
        error,
      });
      return false;
    }
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  /**
   * Perform Direct Grant authentication with Keycloak
   * This method validates user credentials against Keycloak server
   */
  private async performDirectGrantAuthentication(
    username: string, 
    password: string
  ): Promise<{ success: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
    try {
      // Create a separate client instance for user authentication (not admin)
      const userClient = new KcAdminClient({
        baseUrl: this.config.keycloak.serverUrl,
        realmName: this.config.keycloak.realm,
      });

      // Perform Direct Grant authentication
      await userClient.auth({
        username: username,
        password: password,
        grantType: "password",
        clientId: this.config.keycloak.clientId,
        clientSecret: this.config.keycloak.clientSecret,
      });

      // Check if authentication was successful by accessing the stored access token
      const accessToken = userClient.accessToken;
      const refreshToken = userClient.refreshToken;
      
      if (accessToken) {
        this.deps.monitoring.logger.info("Direct Grant authentication successful", {
          username,
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
        });

        return {
          success: true,
          accessToken: accessToken,
          refreshToken: refreshToken,
        };
      } else {
        this.deps.monitoring.logger.warn("Direct Grant authentication failed - no access token stored", {
          username,
        });

        return {
          success: false,
          error: "Authentication failed - no token received",
        };
      }
    } catch (error) {
      this.deps.monitoring.logger.warn("Direct Grant authentication failed", {
        username,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : "unknown",
      });

      // Don't expose detailed error information to prevent enumeration attacks
      return {
        success: false,
        error: "Invalid credentials",
      };
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create Keycloak service instance
 */
export function createKeycloakService(
  config: AuthConfig,
  deps: ServiceDependencies
): KeycloakService {
  return new KeycloakService(config, deps);
}

/**
 * Initialize Keycloak service
 */
export async function initializeKeycloakService(
  service: KeycloakService
): Promise<void> {
  await service.initialize();
}
