/**
 * User Management Service
 * Handles user CRUD operations (Create, Read, Update, Delete)
 * Part of Phase 2 service refactoring for single responsibility principle
 */
import { ValidationSchemas, safeValidate } from "../validation/schemas";
/**
 * User Management Service Implementation
 *
 * Responsible for:
 * - User profile management (CRUD operations)
 * - User data validation
 * - User search and filtering
 * - User session management coordination
 */
export class UserManagementService {
    deps;
    keycloakService;
    sessionService;
    constructor(deps, services) {
        this.deps = deps;
        this.keycloakService = services.keycloakService;
        this.sessionService = services.sessionService;
    }
    /**
     * Get user by ID from Keycloak
     */
    async getUserById(userId) {
        try {
            const user = await this.keycloakService.getUserById(userId);
            if (!user) {
                return null;
            }
            // Enrich with additional user data if needed
            return await this.enrichUserData(user);
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("Failed to get user by ID", {
                userId,
                error: authError.message,
            });
            return null;
        }
    }
    /**
     * Update user information
     */
    async updateUser(userId, updates) {
        try {
            // 1. Validate update data
            const validationResult = await this.validateUserUpdate(updates);
            if (!validationResult.valid) {
                this.deps.monitoring.logger.warn("User update validation failed", {
                    userId,
                    errors: validationResult.errors,
                });
                return false;
            }
            // 2. Update user in Keycloak
            const updateSuccess = await this.keycloakService.updateUser(userId, updates);
            if (updateSuccess) {
                this.deps.monitoring.logger.info("User updated successfully", {
                    userId,
                    updatedFields: Object.keys(updates),
                });
            }
            return updateSuccess;
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("Failed to update user", {
                userId,
                error: authError.message,
            });
            return false;
        }
    }
    /**
     * Delete user account and all associated data
     */
    async deleteUser(userId) {
        try {
            // 1. Delete all user sessions first
            await this.sessionService.deleteUserSessions(userId);
            // 2. Delete user from Keycloak
            const deleteSuccess = await this.keycloakService.deleteUser(userId);
            if (deleteSuccess) {
                this.deps.monitoring.logger.info("User deleted successfully", {
                    userId,
                });
            }
            return deleteSuccess;
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("Failed to delete user", {
                userId,
                error: authError.message,
            });
            return false;
        }
    }
    /**
     * Search users by email, name, or other criteria
     */
    async searchUsers(query, limit = 10) {
        try {
            // This would require implementing search in KeycloakService
            // For now, return empty array as a placeholder
            this.deps.monitoring.logger.info("User search requested", {
                query,
                limit,
            });
            // TODO: Implement user search in KeycloakService
            return [];
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("User search failed", {
                query,
                error: authError.message,
            });
            return [];
        }
    }
    /**
     * Get user's active sessions
     */
    async getUserSessions(userId) {
        try {
            return await this.sessionService.getUserSessions(userId);
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("Failed to get user sessions", {
                userId,
                error: authError.message,
            });
            return [];
        }
    }
    /**
     * Validate user update data
     */
    async validateUserUpdate(updates) {
        const errors = [];
        try {
            // 1. Validate with Zod schema
            const validation = safeValidate(ValidationSchemas.UserUpdate, updates);
            if (!validation.success) {
                errors.push(...validation.errors.issues.map((issue) => issue.message));
            }
            // 2. Additional business logic validation
            if (updates.email) {
                if (!this.isValidEmail(updates.email)) {
                    errors.push("Invalid email format");
                }
            }
            if (updates.roles) {
                if (!Array.isArray(updates.roles) || updates.roles.length === 0) {
                    errors.push("User must have at least one role");
                }
            }
            return {
                valid: errors.length === 0,
                ...(errors.length > 0 && { errors }),
            };
        }
        catch (error) {
            return {
                valid: false,
                errors: ["Validation error occurred"],
            };
        }
    }
    /**
     * Enrich user data with additional information
     */
    async enrichUserData(user) {
        try {
            // Add any additional user data enrichment here
            // For example, last login time, session count, etc.
            return {
                ...user,
                metadata: {
                    ...user.metadata,
                    lastUpdated: new Date().toISOString(),
                },
            };
        }
        catch (error) {
            // Return original user if enrichment fails
            return user;
        }
    }
    /**
     * Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    /**
     * Get user statistics (admin function)
     */
    async getUserStats(userId) {
        try {
            const user = await this.getUserById(userId);
            if (!user)
                return null;
            const sessions = await this.getUserSessions(userId);
            const accountAge = Date.now() - user.createdAt.getTime();
            const lastLogin = user.metadata?.["lastLogin"];
            return {
                sessionCount: sessions.length,
                ...(lastLogin && { lastLogin }),
                accountAge: Math.floor(accountAge / (1000 * 60 * 60 * 24)), // Days
            };
        }
        catch (error) {
            const authError = error;
            this.deps.monitoring.logger.error("Failed to get user stats", {
                userId,
                error: authError.message,
            });
            return null;
        }
    }
}
//# sourceMappingURL=user-management-service.js.map