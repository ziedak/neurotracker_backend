/**
 * @fileoverview Repository Layer Exports
 * @module repositories
 * @version 1.0.0
 * @author Enterprise Development Team
 */

// Base Repository Pattern
export * from "./base/BaseRepository";

// Repository Implementations
export * from "./UserRepository";
export * from "./RoleRepository";

// Repository Factory
export * from "./RepositoryFactory";

// Convenience exports for common usage patterns
export {
  getRepositoryFactory,
  getRepositories,
  withTransaction,
} from "./RepositoryFactory";

/**
 * Repository Layer Information
 */
export const RepositoryInfo = {
  version: "1.0.0",
  description:
    "Enterprise repository pattern implementation with clean architecture",
  features: [
    "Base repository with CRUD operations",
    "Tenant-aware data access",
    "Transaction support",
    "Audit logging",
    "Performance monitoring",
    "Type-safe database operations",
    "Role hierarchy management",
    "Multi-tenant isolation",
    "Access control validation",
  ],
  repositories: [
    "UserRepository - User management with enterprise features",
    "RoleRepository - Role hierarchy and permission management",
  ],
  architecture: {
    pattern: "Repository Pattern",
    principles: [
      "Clean Architecture",
      "Single Responsibility",
      "Dependency Inversion",
    ],
    features: [
      "Transaction Management",
      "Audit Logging",
      "Performance Monitoring",
    ],
  },
} as const;
