/**
 * @fileoverview Repository Factory for Enterprise AuthV2
 * @module repositories/RepositoryFactory
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import { PostgreSQLClient } from "@libs/database";
import { UserRepository } from "./UserRepository";
import { RoleRepository } from "./RoleRepository";

/**
 * Repository Factory for managing all data access repositories
 *
 * Features:
 * - Singleton pattern for repository instances
 * - Shared database connection management
 * - Transaction coordination across repositories
 * - Repository lifecycle management
 */
export class RepositoryFactory {
  private static instance: RepositoryFactory;
  private prismaClient: any;

  // Repository instances
  private _userRepository?: UserRepository;
  private _roleRepository?: RoleRepository;

  private constructor() {
    this.prismaClient = PostgreSQLClient.getInstance();
  }

  /**
   * Get singleton factory instance
   */
  static getInstance(): RepositoryFactory {
    if (!RepositoryFactory.instance) {
      RepositoryFactory.instance = new RepositoryFactory();
    }
    return RepositoryFactory.instance;
  }

  /**
   * Get User Repository instance
   */
  getUserRepository(): UserRepository {
    if (!this._userRepository) {
      this._userRepository = new UserRepository(this.prismaClient);
    }
    return this._userRepository;
  }

  /**
   * Get Role Repository instance
   */
  getRoleRepository(): RoleRepository {
    if (!this._roleRepository) {
      this._roleRepository = new RoleRepository(this.prismaClient);
    }
    return this._roleRepository;
  }

  /**
   * Execute multiple repository operations in a single transaction
   */
  async executeInTransaction<T>(
    operation: (repositories: {
      userRepo: UserRepository;
      roleRepo: RoleRepository;
    }) => Promise<T>
  ): Promise<T> {
    return await this.prismaClient.$transaction(async (prisma: any) => {
      // Create transactional repository instances
      const transactionalUserRepo = new UserRepository(prisma);
      const transactionalRoleRepo = new RoleRepository(prisma);

      return await operation({
        userRepo: transactionalUserRepo,
        roleRepo: transactionalRoleRepo,
      });
    });
  }

  /**
   * Get all repository instances for batch operations
   */
  getAllRepositories() {
    return {
      userRepository: this.getUserRepository(),
      roleRepository: this.getRoleRepository(),
    };
  }

  /**
   * Health check for all repositories
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    repositories: Record<string, "healthy" | "unhealthy">;
    details: Record<string, any>;
  }> {
    const results = {
      status: "healthy" as "healthy" | "unhealthy",
      repositories: {} as Record<string, "healthy" | "unhealthy">,
      details: {} as Record<string, any>,
    };

    try {
      // Test database connection
      await this.prismaClient.$queryRaw`SELECT 1`;
      results.repositories["database"] = "healthy";

      // Test user repository
      try {
        await this.getUserRepository().count();
        results.repositories["userRepository"] = "healthy";
      } catch (error) {
        results.repositories["userRepository"] = "unhealthy";
        results.details["userRepository"] =
          error instanceof Error ? error.message : "Unknown error";
        results.status = "unhealthy";
      }

      // Test role repository
      try {
        await this.getRoleRepository().count();
        results.repositories["roleRepository"] = "healthy";
      } catch (error) {
        results.repositories["roleRepository"] = "unhealthy";
        results.details["roleRepository"] =
          error instanceof Error ? error.message : "Unknown error";
        results.status = "unhealthy";
      }
    } catch (error) {
      results.status = "unhealthy";
      results.repositories["database"] = "unhealthy";
      results.details["database"] =
        error instanceof Error ? error.message : "Unknown error";
    }

    return results;
  }

  /**
   * Close all connections and cleanup
   */
  async cleanup(): Promise<void> {
    try {
      await this.prismaClient.$disconnect();
    } catch (error) {
      console.error("Error during repository cleanup:", error);
    }
  }

  /**
   * Reset factory instance (for testing)
   */
  static reset(): void {
    RepositoryFactory.instance = undefined as any;
  }
}

/**
 * Convenience function to get repository factory instance
 */
export const getRepositoryFactory = () => RepositoryFactory.getInstance();

/**
 * Convenience function to get all repositories
 */
export const getRepositories = () =>
  RepositoryFactory.getInstance().getAllRepositories();

/**
 * Convenience function for transactional operations
 */
export const withTransaction = <T>(
  operation: (repositories: {
    userRepo: UserRepository;
    roleRepo: RoleRepository;
  }) => Promise<T>
): Promise<T> => {
  return RepositoryFactory.getInstance().executeInTransaction(operation);
};
