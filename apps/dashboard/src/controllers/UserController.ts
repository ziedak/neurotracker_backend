import { Logger } from "@libs/monitoring";
import { UserService } from "../services/UserService";

export interface UserRequest {
  id?: string;
  name?: string;
  email?: string;
  filters?: Record<string, any>;
  pagination?: {
    page: number;
    limit: number;
  };
}

export interface CreateUserRequest {
  name: string;
  email: string;
  metadata?: Record<string, any>;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  metadata?: Record<string, any>;
}

export interface UserAnalyticsRequest {
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
}

/**
 * User Controller for Dashboard
 * Handles user management, analytics, and operations
 */
export class UserController {
  private readonly userService: UserService;
  private readonly logger: Logger;

  constructor(userService: UserService, logger: Logger) {
    this.userService = userService;
    this.logger = logger;
  }

  /**
   * Get all users with optional filters and pagination
   */
  async getUsers(request: UserRequest): Promise<any> {
    try {
      this.logger.info("Getting users", { request });

      const { filters = {}, pagination = { page: 1, limit: 50 } } = request;
      const offset = (pagination.page - 1) * pagination.limit;

      const users = await this.userService.getUsers(
        filters,
        pagination.limit,
        offset
      );

      // Get total count by getting user stats
      const stats = await this.userService.getUserStats();
      const totalCount = stats.total;

      return {
        success: true,
        data: {
          users,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: totalCount,
            pages: Math.ceil(totalCount / pagination.limit),
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get users", error as Error, { request });
      return {
        success: false,
        error: "Failed to retrieve users",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<any> {
    try {
      this.logger.info("Getting user by ID", { userId });

      const user = await this.userService.getUserById(userId);

      if (!user) {
        return {
          success: false,
          error: "User not found",
          message: `User with ID ${userId} does not exist`,
        };
      }

      return {
        success: true,
        data: { user },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user by ID", error as Error, { userId });
      return {
        success: false,
        error: "Failed to retrieve user",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Create a new user
   */
  async createUser(request: CreateUserRequest): Promise<any> {
    try {
      this.logger.info("Creating user", {
        request: { ...request, email: "***" },
      });

      // Validate required fields
      if (!request.name || !request.email) {
        return {
          success: false,
          error: "Missing required fields",
          message: "Name and email are required",
        };
      }

      // Check if user already exists
      const existingUser = await this.userService.getUserByEmail(request.email);
      if (existingUser) {
        return {
          success: false,
          error: "User already exists",
          message: "A user with this email already exists",
        };
      }

      const user = await this.userService.createUser(request);

      return {
        success: true,
        data: { user },
        message: "User created successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to create user", error as Error, { request });
      return {
        success: false,
        error: "Failed to create user",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Update a user
   */
  async updateUser(userId: string, request: UpdateUserRequest): Promise<any> {
    try {
      this.logger.info("Updating user", { userId, request });

      // Check if user exists
      const existingUser = await this.userService.getUserById(userId);
      if (!existingUser) {
        return {
          success: false,
          error: "User not found",
          message: `User with ID ${userId} does not exist`,
        };
      }

      // Check email uniqueness if email is being updated
      if (request.email && request.email !== existingUser.email) {
        const emailExists = await this.userService.getUserByEmail(
          request.email
        );
        if (emailExists) {
          return {
            success: false,
            error: "Email already in use",
            message: "Another user is already using this email",
          };
        }
      }

      const user = await this.userService.updateUser(userId, request);

      return {
        success: true,
        data: { user },
        message: "User updated successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to update user", error as Error, {
        userId,
        request,
      });
      return {
        success: false,
        error: "Failed to update user",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<any> {
    try {
      this.logger.info("Deleting user", { userId });

      // Check if user exists
      const existingUser = await this.userService.getUserById(userId);
      if (!existingUser) {
        return {
          success: false,
          error: "User not found",
          message: `User with ID ${userId} does not exist`,
        };
      }

      await this.userService.deleteUser(userId);

      return {
        success: true,
        message: "User deleted successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to delete user", error as Error, { userId });
      return {
        success: false,
        error: "Failed to delete user",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(request: UserAnalyticsRequest): Promise<any> {
    try {
      this.logger.info("Getting user analytics", { request });

      const { userId, dateFrom, dateTo, metrics = ["all"] } = request;

      let analytics: any;

      if (userId) {
        // Get user events and carts for user-specific analytics
        const [events, carts] = await Promise.all([
          this.userService.getUserEvents(userId),
          this.userService.getUserCarts(userId),
        ]);
        analytics = { events, carts };
      } else {
        // Get overall user statistics
        analytics = await this.userService.getUserStats();
      }

      // Filter metrics if specified
      if (metrics.length > 0 && !metrics.includes("all")) {
        const filteredAnalytics: any = {};
        metrics.forEach((metric) => {
          if (analytics[metric] !== undefined) {
            filteredAnalytics[metric] = analytics[metric];
          }
        });
        analytics = filteredAnalytics;
      }

      return {
        success: true,
        data: {
          analytics,
          userId,
          dateRange: { from: dateFrom, to: dateTo },
          metrics,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user analytics", error as Error, {
        request,
      });
      return {
        success: false,
        error: "Failed to retrieve user analytics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user session information
   */
  async getUserSessions(userId: string): Promise<any> {
    try {
      this.logger.info("Getting user sessions", { userId });

      const userWithSessions = await this.userService.getUserWithSessions(
        userId
      );
      const sessions = userWithSessions?.sessions || [];

      return {
        success: true,
        data: { sessions },
        userId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user sessions", error as Error, {
        userId,
      });
      return {
        success: false,
        error: "Failed to retrieve user sessions",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user activity
   */
  async getUserActivity(userId: string, limit: number = 50): Promise<any> {
    try {
      this.logger.info("Getting user activity", { userId, limit });

      // Use getUserEvents as activity feed
      const activity = await this.userService.getUserEvents(userId, limit);

      return {
        success: true,
        data: { activity },
        userId,
        limit,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user activity", error as Error, {
        userId,
        limit,
      });
      return {
        success: false,
        error: "Failed to retrieve user activity",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Search users
   */
  async searchUsers(query: string, limit: number = 20): Promise<any> {
    try {
      this.logger.info("Searching users", { query, limit });

      const users = await this.userService.searchUsers(query, limit);

      return {
        success: true,
        data: { users },
        query,
        limit,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to search users", error as Error, {
        query,
        limit,
      });
      return {
        success: false,
        error: "Failed to search users",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user statistics
   */
  async getUserStatistics(): Promise<any> {
    try {
      this.logger.info("Getting user statistics");

      const stats = await this.userService.getUserStats();

      return {
        success: true,
        data: { statistics: stats },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user statistics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve user statistics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Bulk user operations
   */
  async bulkUserOperation(
    operation: string,
    userIds: string[],
    data?: any
  ): Promise<any> {
    try {
      this.logger.info("Performing bulk user operation", {
        operation,
        userIds: userIds.length,
      });

      let results: any[] = [];

      switch (operation) {
        case "delete":
          for (const userId of userIds) {
            try {
              await this.userService.deleteUser(userId);
              results.push({ userId, success: true });
            } catch (error) {
              results.push({
                userId,
                success: false,
                error: (error as Error).message,
              });
            }
          }
          break;

        case "update":
          for (const userId of userIds) {
            try {
              const user = await this.userService.updateUser(userId, data);
              results.push({ userId, success: true, user });
            } catch (error) {
              results.push({
                userId,
                success: false,
                error: (error as Error).message,
              });
            }
          }
          break;

        default:
          return {
            success: false,
            error: "Unsupported bulk operation",
            message: `Operation '${operation}' is not supported`,
          };
      }

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      return {
        success: true,
        data: {
          results,
          summary: {
            total: results.length,
            successful: successCount,
            failed: failureCount,
          },
        },
        operation,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        "Failed to perform bulk user operation",
        error as Error,
        {
          operation,
          userCount: userIds.length,
        }
      );
      return {
        success: false,
        error: "Failed to perform bulk operation",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get user health check
   */
  async getUserServiceHealth(): Promise<any> {
    try {
      this.logger.info("Getting user service health");

      // Return basic service health info since UserService doesn't have health check
      const stats = await this.userService.getUserStats();
      const health = {
        status: "healthy",
        totalUsers: stats.total,
        activeUsers: stats.activeToday,
        lastCheck: new Date().toISOString(),
      };

      return {
        success: true,
        data: { health },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get user service health", error as Error);
      return {
        success: false,
        error: "Failed to retrieve user service health",
        message: (error as Error).message,
      };
    }
  }
}
