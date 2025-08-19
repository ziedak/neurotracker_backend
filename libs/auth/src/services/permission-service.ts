/**
 * Permission Service Implementation - Enterprise RBAC Business Logic
 *
 * Comprehensive Role-Based Access Control (RBAC) service providing:
 * - Database integration for permission and role management
 * - Permission inheritance resolution with hierarchical roles
 * - Real-time permission evaluation with intelligent caching
 * - Batch permission checking for optimal performance
 * - Comprehensive audit trail for compliance requirements
 * - Advanced RBAC features with condition-based permissions
 *
 * Integrates with PermissionCache for ultra-fast permission lookups
 * and follows Clean Architecture principles with enterprise-grade
 * error handling, monitoring, and performance optimization.
 *
 * @version 2.2.0
 */

import { Logger, MetricsCollector } from "@libs/monitoring";
import { CircuitBreaker, LRUCache } from "@libs/utils";
import {
  PermissionCache,
  type PermissionCacheConfig,
} from "./permission-cache";

// Temporary inline types until module resolution is fixed
interface Permission {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly conditions?: PermissionCondition[];
  readonly metadata: PermissionMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: string;
}

interface PermissionCondition {
  readonly type: "attribute" | "time" | "location" | "custom";
  readonly field: string;
  readonly operator:
    | "eq"
    | "ne"
    | "gt"
    | "lt"
    | "in"
    | "nin"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "matches";
  readonly value: string | number | boolean | string[];
  readonly metadata?: Record<string, unknown>;
}

interface PermissionMetadata {
  readonly description: string;
  readonly category: string;
  readonly priority: "critical" | "high" | "medium" | "low";
  readonly tags: string[];
  readonly owner: string;
  readonly department: string;
  readonly compliance?: ComplianceInfo;
  readonly customAttributes?: Record<string, unknown>;
}

interface Role {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly permissions: Permission[];
  readonly parentRoles: string[];
  readonly childRoles: string[];
  readonly metadata: RoleMetadata;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: string;
}

interface RoleMetadata {
  readonly category:
    | "system"
    | "administrative"
    | "operational"
    | "functional"
    | "custom";
  readonly level: number;
  readonly department: string;
  readonly owner: string;
  readonly maxUsers?: number;
  readonly expiresAt?: Date;
  readonly compliance?: ComplianceInfo;
  readonly customAttributes?: Record<string, unknown>;
}

interface ComplianceInfo {
  readonly framework: string;
  readonly requirements: string[];
  readonly lastAudit?: Date;
  readonly nextAudit?: Date;
  readonly auditTrail: AuditEntry[];
}

interface AuditEntry {
  readonly timestamp: Date;
  readonly userId: string;
  readonly action:
    | "created"
    | "updated"
    | "deleted"
    | "assigned"
    | "revoked"
    | "activated"
    | "deactivated";
  readonly details: string;
  readonly metadata?: Record<string, unknown>;
}

interface User {
  readonly id: string;
  readonly email: string;
  readonly roles: string[];
  readonly isActive: boolean;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Permission service configuration
 */
export interface PermissionServiceConfig {
  readonly enableCache: boolean;
  readonly cacheConfig: Partial<PermissionCacheConfig>;
  readonly enableHierarchy: boolean;
  readonly maxHierarchyDepth: number;
  readonly enableConditions: boolean;
  readonly enableAuditLog: boolean;
  readonly batchSize: number;
  readonly circuitBreakerThreshold: number;
  readonly circuitBreakerTimeout: number;
  readonly permissionResolutionTimeout: number; // ms
  readonly enableMetrics: boolean;
  readonly enablePerformanceOptimization: boolean;
}

/**
 * Default permission service configuration
 */
export const DEFAULT_PERMISSION_SERVICE_CONFIG: PermissionServiceConfig = {
  enableCache: true,
  cacheConfig: {},
  enableHierarchy: true,
  maxHierarchyDepth: 10,
  enableConditions: true,
  enableAuditLog: true,
  batchSize: 100,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 30000, // 30 seconds
  permissionResolutionTimeout: 5000, // 5 seconds
  enableMetrics: true,
  enablePerformanceOptimization: true,
};

/**
 * Permission check result with detailed context
 */
export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly permission: string;
  readonly userId: string;
  readonly roles: string[];
  readonly matchedPermissions: Permission[];
  readonly evaluationPath: string[];
  readonly conditions: ConditionEvaluationResult[];
  readonly cached: boolean;
  readonly evaluationTime: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Condition evaluation result
 */
export interface ConditionEvaluationResult {
  readonly condition: PermissionCondition;
  readonly result: boolean;
  readonly evaluatedValue: unknown;
  readonly reason: string;
}

/**
 * Batch permission check result
 */
export interface BatchPermissionCheckResult {
  readonly userId: string;
  readonly results: Map<string, PermissionCheckResult>;
  readonly totalChecks: number;
  readonly allowedCount: number;
  readonly deniedCount: number;
  readonly cacheHitRate: number;
  readonly totalEvaluationTime: number;
}

/**
 * Permission assignment result
 */
export interface PermissionAssignmentResult {
  readonly success: boolean;
  readonly userId: string;
  readonly roleId?: string;
  readonly permissionId?: string;
  readonly action: "assign" | "revoke";
  readonly effectiveDate: Date;
  readonly auditId: string;
  readonly errors?: string[];
}

/**
 * Role assignment result
 */
export interface RoleAssignmentResult {
  readonly success: boolean;
  readonly userId: string;
  readonly roleId: string;
  readonly action: "assign" | "revoke";
  readonly effectivePermissions: Permission[];
  readonly inheritedPermissions: Permission[];
  readonly effectiveDate: Date;
  readonly auditId: string;
  readonly warnings?: string[];
  readonly errors?: string[];
}

/**
 * Permission analytics data
 */
export interface PermissionAnalytics {
  readonly totalPermissionChecks: number;
  readonly allowedChecks: number;
  readonly deniedChecks: number;
  readonly averageEvaluationTime: number;
  readonly cacheHitRate: number;
  readonly topPermissions: Array<{ permission: string; count: number }>;
  readonly topUsers: Array<{ userId: string; checks: number }>;
  readonly roleDistribution: Map<string, number>;
  readonly conditionEvaluations: number;
  readonly hierarchyTraversals: number;
  readonly errorRate: number;
}

/**
 * Database interface for permission operations
 */
interface PermissionDatabase {
  // User operations
  getUserById(userId: string): Promise<User | null>;
  getUserRoles(userId: string): Promise<string[]>;
  assignRoleToUser(userId: string, roleId: string): Promise<boolean>;
  revokeRoleFromUser(userId: string, roleId: string): Promise<boolean>;

  // Role operations
  getRoleById(roleId: string): Promise<Role | null>;
  getRolesByIds(roleIds: string[]): Promise<Role[]>;
  createRole(role: Omit<Role, "createdAt" | "updatedAt">): Promise<Role>;
  updateRole(roleId: string, updates: Partial<Role>): Promise<Role>;
  deleteRole(roleId: string): Promise<boolean>;

  // Permission operations
  getPermissionById(permissionId: string): Promise<Permission | null>;
  getPermissionsByIds(permissionIds: string[]): Promise<Permission[]>;
  createPermission(
    permission: Omit<Permission, "createdAt" | "updatedAt">
  ): Promise<Permission>;
  updatePermission(
    permissionId: string,
    updates: Partial<Permission>
  ): Promise<Permission>;
  deletePermission(permissionId: string): Promise<boolean>;

  // Audit operations
  createAuditEntry(entry: Omit<AuditEntry, "timestamp">): Promise<string>;
  getAuditTrail(entityId: string, limit?: number): Promise<AuditEntry[]>;
}

/**
 * Mock database implementation for development
 */
class MockPermissionDatabase implements PermissionDatabase {
  private users = new Map<string, User>();
  private roles = new Map<string, Role>();
  private permissions = new Map<string, Permission>();
  private userRoles = new Map<string, Set<string>>();
  private auditEntries = new Map<string, AuditEntry[]>();

  async getUserById(userId: string): Promise<User | null> {
    return this.users.get(userId) || null;
  }

  async getUserRoles(userId: string): Promise<string[]> {
    return Array.from(this.userRoles.get(userId) || new Set());
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<boolean> {
    if (!this.userRoles.has(userId)) {
      this.userRoles.set(userId, new Set());
    }
    this.userRoles.get(userId)!.add(roleId);
    return true;
  }

  async revokeRoleFromUser(userId: string, roleId: string): Promise<boolean> {
    const userRoleSet = this.userRoles.get(userId);
    if (userRoleSet) {
      return userRoleSet.delete(roleId);
    }
    return false;
  }

  async getRoleById(roleId: string): Promise<Role | null> {
    return this.roles.get(roleId) || null;
  }

  async getRolesByIds(roleIds: string[]): Promise<Role[]> {
    const roles: Role[] = [];
    for (const roleId of roleIds) {
      const role = this.roles.get(roleId);
      if (role) {
        roles.push(role);
      }
    }
    return roles;
  }

  async createRole(role: Omit<Role, "createdAt" | "updatedAt">): Promise<Role> {
    const now = new Date();
    const fullRole: Role = {
      ...role,
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(role.id, fullRole);
    return fullRole;
  }

  async updateRole(roleId: string, updates: Partial<Role>): Promise<Role> {
    const existingRole = this.roles.get(roleId);
    if (!existingRole) {
      throw new Error(`Role not found: ${roleId}`);
    }
    const updatedRole: Role = {
      ...existingRole,
      ...updates,
      updatedAt: new Date(),
    };
    this.roles.set(roleId, updatedRole);
    return updatedRole;
  }

  async deleteRole(roleId: string): Promise<boolean> {
    return this.roles.delete(roleId);
  }

  async getPermissionById(permissionId: string): Promise<Permission | null> {
    return this.permissions.get(permissionId) || null;
  }

  async getPermissionsByIds(permissionIds: string[]): Promise<Permission[]> {
    const permissions: Permission[] = [];
    for (const permissionId of permissionIds) {
      const permission = this.permissions.get(permissionId);
      if (permission) {
        permissions.push(permission);
      }
    }
    return permissions;
  }

  async createPermission(
    permission: Omit<Permission, "createdAt" | "updatedAt">
  ): Promise<Permission> {
    const now = new Date();
    const fullPermission: Permission = {
      ...permission,
      createdAt: now,
      updatedAt: now,
    };
    this.permissions.set(permission.id, fullPermission);
    return fullPermission;
  }

  async updatePermission(
    permissionId: string,
    updates: Partial<Permission>
  ): Promise<Permission> {
    const existingPermission = this.permissions.get(permissionId);
    if (!existingPermission) {
      throw new Error(`Permission not found: ${permissionId}`);
    }
    const updatedPermission: Permission = {
      ...existingPermission,
      ...updates,
      updatedAt: new Date(),
    };
    this.permissions.set(permissionId, updatedPermission);
    return updatedPermission;
  }

  async deletePermission(permissionId: string): Promise<boolean> {
    return this.permissions.delete(permissionId);
  }

  async createAuditEntry(
    entry: Omit<AuditEntry, "timestamp">
  ): Promise<string> {
    const auditEntry: AuditEntry = {
      ...entry,
      timestamp: new Date(),
    };
    const entryId = `audit_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    if (!this.auditEntries.has(entry.userId)) {
      this.auditEntries.set(entry.userId, []);
    }
    this.auditEntries.get(entry.userId)!.push(auditEntry);

    return entryId;
  }

  async getAuditTrail(entityId: string, limit = 100): Promise<AuditEntry[]> {
    const entries = this.auditEntries.get(entityId) || [];
    return entries
      .slice(0, limit)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}

/**
 * Enterprise Permission Service with comprehensive RBAC implementation
 */
export class PermissionService {
  private readonly config: PermissionServiceConfig;
  private readonly database: PermissionDatabase;
  private readonly cache: PermissionCache;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly circuitBreaker: CircuitBreaker;

  // Local caches for performance optimization
  private readonly resolvedPermissionsCache: LRUCache<string, Permission[]>;
  private readonly hierarchyCache: LRUCache<string, Role[]>;
  private readonly conditionEvaluatorCache: LRUCache<string, boolean>;

  // Analytics tracking (mutable for internal updates)
  private analytics = {
    totalPermissionChecks: 0,
    allowedChecks: 0,
    deniedChecks: 0,
    averageEvaluationTime: 0,
    cacheHitRate: 0,
    topPermissions: [] as Array<{ permission: string; count: number }>,
    topUsers: [] as Array<{ userId: string; checks: number }>,
    roleDistribution: new Map<string, number>(),
    conditionEvaluations: 0,
    hierarchyTraversals: 0,
    errorRate: 0,
  };

  // Performance tracking
  private performanceData = {
    evaluationTimes: [] as number[],
    totalRequests: 0,
    totalErrors: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(
    config: Partial<PermissionServiceConfig> = {},
    logger: Logger,
    metrics: MetricsCollector,
    database?: PermissionDatabase
  ) {
    this.config = { ...DEFAULT_PERMISSION_SERVICE_CONFIG, ...config };
    this.logger = logger.child({ component: "PermissionService" });
    this.metrics = metrics;

    // Initialize database (use mock if not provided)
    this.database = database || new MockPermissionDatabase();

    // Initialize cache if enabled
    this.cache = new PermissionCache(this.config.cacheConfig, logger, metrics);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      threshold: this.config.circuitBreakerThreshold,
      timeout: this.config.circuitBreakerTimeout,
      resetTimeout: this.config.circuitBreakerTimeout * 2,
    });

    // Initialize local caches
    this.resolvedPermissionsCache = new LRUCache({
      max: 1000,
      ttl: 300000, // 5 minutes
    });

    this.hierarchyCache = new LRUCache({
      max: 500,
      ttl: 600000, // 10 minutes
    });

    this.conditionEvaluatorCache = new LRUCache({
      max: 2000,
      ttl: 60000, // 1 minute
    });

    // Start background tasks
    this.startBackgroundTasks();
  }

  /**
   * Get all permissions for a user with hierarchy resolution
   */
  public async getUserPermissions(userId: string): Promise<Permission[]> {
    const startTime = Date.now();

    try {
      this.validateUserId(userId);
      this.performanceData.totalRequests++;

      // Check cache first
      if (this.config.enableCache) {
        const cacheResult = await this.cache.getUserPermissions(userId);
        if (cacheResult.success && cacheResult.data) {
          this.performanceData.cacheHits++;
          await this.recordMetrics(
            "get_user_permissions",
            startTime,
            true,
            true
          );

          this.logger.debug("User permissions retrieved from cache", {
            userId,
            permissionCount: cacheResult.data.length,
            duration: Date.now() - startTime,
          });

          return cacheResult.data as Permission[];
        }
      }

      this.performanceData.cacheMisses++;

      // Get user roles
      const userRoles = await this.circuitBreaker.execute(() =>
        this.database.getUserRoles(userId)
      );

      if (userRoles.length === 0) {
        await this.recordMetrics(
          "get_user_permissions",
          startTime,
          true,
          false
        );
        return [];
      }

      // Resolve permissions from roles with hierarchy
      const permissions = await this.resolveUserPermissions(userId, userRoles);

      // Cache the result
      if (this.config.enableCache && permissions.length > 0) {
        await this.cache.cacheUserPermissions(userId, permissions);
      }

      await this.recordMetrics("get_user_permissions", startTime, true, false);

      this.logger.debug("User permissions resolved", {
        userId,
        roleCount: userRoles.length,
        permissionCount: permissions.length,
        duration: Date.now() - startTime,
      });

      return permissions;
    } catch (error) {
      this.performanceData.totalErrors++;
      await this.recordMetrics("get_user_permissions", startTime, false, false);

      this.logger.error("Failed to get user permissions", {
        userId,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      throw error;
    }
  }

  /**
   * Get all permissions for a role with hierarchy resolution
   */
  public async getRolePermissions(roleId: string): Promise<Permission[]> {
    const startTime = Date.now();

    try {
      this.validateRoleId(roleId);

      // Check cache first
      if (this.config.enableCache) {
        const cacheResult = await this.cache.getRolePermissions(roleId);
        if (cacheResult.success && cacheResult.data) {
          await this.recordMetrics(
            "get_role_permissions",
            startTime,
            true,
            true
          );
          return cacheResult.data as Permission[];
        }
      }

      // Get role with hierarchy
      const roleHierarchy = await this.resolveRoleHierarchy(roleId);

      // Collect all permissions from the hierarchy
      const allPermissions = new Map<string, Permission>();
      for (const role of roleHierarchy) {
        for (const permission of role.permissions) {
          allPermissions.set(permission.id, permission);
        }
      }

      const permissions = Array.from(allPermissions.values());

      // Cache the result
      if (this.config.enableCache && permissions.length > 0) {
        await this.cache.cacheRolePermissions(roleId, permissions);
      }

      await this.recordMetrics("get_role_permissions", startTime, true, false);

      this.logger.debug("Role permissions resolved", {
        roleId,
        hierarchyDepth: roleHierarchy.length,
        permissionCount: permissions.length,
        duration: Date.now() - startTime,
      });

      return permissions;
    } catch (error) {
      await this.recordMetrics("get_role_permissions", startTime, false, false);

      this.logger.error("Failed to get role permissions", {
        roleId,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      throw error;
    }
  }

  /**
   * Check if user has a specific permission with detailed evaluation
   */
  public async checkUserPermission(
    userId: string,
    permission: string,
    context?: Record<string, unknown>
  ): Promise<PermissionCheckResult> {
    const startTime = Date.now();

    try {
      this.validateUserId(userId);
      this.validatePermissionString(permission);

      this.analytics.totalPermissionChecks++;
      this.performanceData.totalRequests++;

      // Parse permission string (format: resource:action)
      const [resource, action] = permission.split(":");
      if (!resource || !action) {
        throw new Error("Invalid permission format. Expected: resource:action");
      }

      // Get user permissions
      const userPermissions = await this.getUserPermissions(userId);
      const userRoles = await this.database.getUserRoles(userId);

      // Find matching permissions
      const matchedPermissions = userPermissions.filter((perm) =>
        this.matchesPermission(perm, resource, action)
      );

      let allowed = false;
      const evaluationPath: string[] = [];
      const conditions: ConditionEvaluationResult[] = [];

      if (matchedPermissions.length > 0) {
        // Evaluate conditions if enabled
        if (this.config.enableConditions) {
          const conditionResult = await this.evaluatePermissionConditions(
            matchedPermissions,
            context || {}
          );
          allowed = conditionResult.allowed;
          conditions.push(...conditionResult.conditions);
          evaluationPath.push(...conditionResult.evaluationPath);
        } else {
          allowed = true;
          evaluationPath.push("direct_match");
        }
      }

      // Update analytics
      if (allowed) {
        this.analytics.allowedChecks++;
      } else {
        this.analytics.deniedChecks++;
      }

      const evaluationTime = Date.now() - startTime;
      this.performanceData.evaluationTimes.push(evaluationTime);

      await this.recordMetrics("check_user_permission", startTime, true, false);

      // Create audit entry if enabled
      if (this.config.enableAuditLog) {
        await this.database.createAuditEntry({
          userId,
          action: "updated", // Using 'updated' as the closest match for permission_check
          details: `Permission: ${permission}, Result: ${
            allowed ? "allowed" : "denied"
          }`,
          metadata: {
            permission,
            allowed,
            evaluationTime,
            matchedPermissions: matchedPermissions.length,
            conditionsEvaluated: conditions.length,
            context,
            auditType: "permission_check",
          },
        });
      }

      const result: PermissionCheckResult = {
        allowed,
        permission,
        userId,
        roles: userRoles,
        matchedPermissions,
        evaluationPath,
        conditions,
        cached: false, // We fetched from cache in getUserPermissions
        evaluationTime,
        metadata: context,
      };

      this.logger.debug("Permission check completed", {
        userId,
        permission,
        allowed,
        evaluationTime,
        matchedPermissions: matchedPermissions.length,
        conditionsEvaluated: conditions.length,
      });

      return result;
    } catch (error) {
      this.performanceData.totalErrors++;
      await this.recordMetrics(
        "check_user_permission",
        startTime,
        false,
        false
      );

      this.logger.error("Permission check failed", {
        userId,
        permission,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      throw error;
    }
  }

  /**
   * Batch check multiple permissions for a user
   */
  public async batchCheckUserPermissions(
    userId: string,
    permissions: string[],
    context?: Record<string, unknown>
  ): Promise<BatchPermissionCheckResult> {
    const startTime = Date.now();

    try {
      this.validateUserId(userId);

      if (permissions.length === 0) {
        throw new Error("Permissions array cannot be empty");
      }

      const results = new Map<string, PermissionCheckResult>();
      let allowedCount = 0;
      let deniedCount = 0;
      let cacheHits = 0;

      // Process permissions in batches for optimal performance
      const batches = this.createBatches(permissions, this.config.batchSize);

      for (const batch of batches) {
        const batchPromises = batch.map((permission) =>
          this.checkUserPermission(userId, permission, context)
        );

        const batchResults = await Promise.all(batchPromises);

        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i];
          results.set(batch[i], result);

          if (result.allowed) {
            allowedCount++;
          } else {
            deniedCount++;
          }

          if (result.cached) {
            cacheHits++;
          }
        }
      }

      const totalEvaluationTime = Date.now() - startTime;
      const cacheHitRate =
        permissions.length > 0 ? cacheHits / permissions.length : 0;

      await this.recordMetrics(
        "batch_check_user_permissions",
        startTime,
        true,
        false
      );

      this.logger.info("Batch permission check completed", {
        userId,
        totalChecks: permissions.length,
        allowedCount,
        deniedCount,
        cacheHitRate,
        totalEvaluationTime,
      });

      return {
        userId,
        results,
        totalChecks: permissions.length,
        allowedCount,
        deniedCount,
        cacheHitRate,
        totalEvaluationTime,
      };
    } catch (error) {
      await this.recordMetrics(
        "batch_check_user_permissions",
        startTime,
        false,
        false
      );

      this.logger.error("Batch permission check failed", {
        userId,
        permissionCount: permissions.length,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      throw error;
    }
  }

  /**
   * Assign a role to a user with comprehensive validation
   */
  public async assignRoleToUser(
    userId: string,
    roleId: string,
    assignedBy: string,
    context?: Record<string, unknown>
  ): Promise<RoleAssignmentResult> {
    const startTime = Date.now();

    try {
      this.validateUserId(userId);
      this.validateRoleId(roleId);

      // Validate role exists and is active
      const role = await this.database.getRoleById(roleId);
      if (!role) {
        throw new Error(`Role not found: ${roleId}`);
      }

      if (!role.isActive) {
        throw new Error(`Cannot assign inactive role: ${roleId}`);
      }

      // Check if user already has the role
      const existingRoles = await this.database.getUserRoles(userId);
      if (existingRoles.includes(roleId)) {
        throw new Error(`User already has role: ${roleId}`);
      }

      // Assign the role
      const assignmentSuccess = await this.database.assignRoleToUser(
        userId,
        roleId
      );
      if (!assignmentSuccess) {
        throw new Error("Failed to assign role to user");
      }

      // Resolve effective permissions after assignment
      const newRoles = [...existingRoles, roleId];
      const effectivePermissions = await this.resolveUserPermissions(
        userId,
        newRoles
      );
      const inheritedPermissions = await this.getRolePermissions(roleId);

      // Invalidate user cache
      if (this.config.enableCache) {
        await this.cache.invalidateUserCache(userId);
      }

      // Create audit entry
      const auditId = await this.database.createAuditEntry({
        userId: assignedBy,
        action: "assigned",
        details: `Assigned role ${roleId} to user ${userId}`,
        metadata: {
          targetUserId: userId,
          roleId,
          context,
          effectivePermissionCount: effectivePermissions.length,
        },
      });

      await this.recordMetrics("assign_role_to_user", startTime, true, false);

      this.logger.info("Role assigned to user successfully", {
        userId,
        roleId,
        assignedBy,
        effectivePermissionCount: effectivePermissions.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        userId,
        roleId,
        action: "assign",
        effectivePermissions,
        inheritedPermissions,
        effectiveDate: new Date(),
        auditId,
      };
    } catch (error) {
      await this.recordMetrics("assign_role_to_user", startTime, false, false);

      this.logger.error("Failed to assign role to user", {
        userId,
        roleId,
        assignedBy,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      return {
        success: false,
        userId,
        roleId,
        action: "assign",
        effectivePermissions: [],
        inheritedPermissions: [],
        effectiveDate: new Date(),
        auditId: "",
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Revoke a role from a user
   */
  public async revokeRoleFromUser(
    userId: string,
    roleId: string,
    revokedBy: string,
    context?: Record<string, unknown>
  ): Promise<RoleAssignmentResult> {
    const startTime = Date.now();

    try {
      this.validateUserId(userId);
      this.validateRoleId(roleId);

      // Check if user has the role
      const existingRoles = await this.database.getUserRoles(userId);
      if (!existingRoles.includes(roleId)) {
        throw new Error(`User does not have role: ${roleId}`);
      }

      // Revoke the role
      const revocationSuccess = await this.database.revokeRoleFromUser(
        userId,
        roleId
      );
      if (!revocationSuccess) {
        throw new Error("Failed to revoke role from user");
      }

      // Resolve effective permissions after revocation
      const remainingRoles = existingRoles.filter((r) => r !== roleId);
      const effectivePermissions = await this.resolveUserPermissions(
        userId,
        remainingRoles
      );
      const revokedPermissions = await this.getRolePermissions(roleId);

      // Invalidate user cache
      if (this.config.enableCache) {
        await this.cache.invalidateUserCache(userId);
      }

      // Create audit entry
      const auditId = await this.database.createAuditEntry({
        userId: revokedBy,
        action: "revoked",
        details: `Revoked role ${roleId} from user ${userId}`,
        metadata: {
          targetUserId: userId,
          roleId,
          context,
          remainingPermissionCount: effectivePermissions.length,
        },
      });

      await this.recordMetrics("revoke_role_from_user", startTime, true, false);

      this.logger.info("Role revoked from user successfully", {
        userId,
        roleId,
        revokedBy,
        remainingPermissionCount: effectivePermissions.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        userId,
        roleId,
        action: "revoke",
        effectivePermissions,
        inheritedPermissions: revokedPermissions,
        effectiveDate: new Date(),
        auditId,
      };
    } catch (error) {
      await this.recordMetrics(
        "revoke_role_from_user",
        startTime,
        false,
        false
      );

      this.logger.error("Failed to revoke role from user", {
        userId,
        roleId,
        revokedBy,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      } as any);

      return {
        success: false,
        userId,
        roleId,
        action: "revoke",
        effectivePermissions: [],
        inheritedPermissions: [],
        effectiveDate: new Date(),
        auditId: "",
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Get permission analytics and statistics
   */
  public async getPermissionAnalytics(): Promise<PermissionAnalytics> {
    // Calculate average evaluation time
    const averageEvaluationTime =
      this.performanceData.evaluationTimes.length > 0
        ? this.performanceData.evaluationTimes.reduce(
            (sum, time) => sum + time,
            0
          ) / this.performanceData.evaluationTimes.length
        : 0;

    // Calculate cache hit rate
    const totalCacheAttempts =
      this.performanceData.cacheHits + this.performanceData.cacheMisses;
    const cacheHitRate =
      totalCacheAttempts > 0
        ? this.performanceData.cacheHits / totalCacheAttempts
        : 0;

    // Calculate error rate
    const errorRate =
      this.performanceData.totalRequests > 0
        ? this.performanceData.totalErrors / this.performanceData.totalRequests
        : 0;

    return {
      ...this.analytics,
      averageEvaluationTime: Math.round(averageEvaluationTime * 100) / 100,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
    };
  }

  // ===================================================================
  // PRIVATE HELPER METHODS
  // ===================================================================

  /**
   * Resolve all permissions for a user from their roles with hierarchy
   */
  private async resolveUserPermissions(
    userId: string,
    roleIds: string[]
  ): Promise<Permission[]> {
    const cacheKey = `user_${userId}_roles_${roleIds.sort().join("_")}`;

    // Check local cache first
    const cached = this.resolvedPermissionsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const allPermissions = new Map<string, Permission>();

    // Resolve permissions from each role with hierarchy
    for (const roleId of roleIds) {
      try {
        const rolePermissions = await this.getRolePermissions(roleId);
        for (const permission of rolePermissions) {
          allPermissions.set(permission.id, permission);
        }
      } catch (error) {
        this.logger.warn(`Failed to resolve permissions for role ${roleId}`, {
          userId,
          roleId,
          error: (error as Error).message,
        } as any);
      }
    }

    const permissions = Array.from(allPermissions.values());

    // Cache the result
    this.resolvedPermissionsCache.set(cacheKey, permissions);

    return permissions;
  }

  /**
   * Resolve role hierarchy with parent roles
   */
  private async resolveRoleHierarchy(roleId: string): Promise<Role[]> {
    const cacheKey = `hierarchy_${roleId}`;

    // Check local cache first
    const cached = this.hierarchyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const hierarchy: Role[] = [];
    const visited = new Set<string>();
    const stack = [roleId];

    while (
      stack.length > 0 &&
      hierarchy.length < this.config.maxHierarchyDepth
    ) {
      const currentRoleId = stack.pop()!;

      if (visited.has(currentRoleId)) {
        continue; // Avoid circular dependencies
      }

      visited.add(currentRoleId);

      const role = await this.database.getRoleById(currentRoleId);
      if (!role) {
        this.logger.warn(
          `Role not found in hierarchy resolution: ${currentRoleId}`
        );
        continue;
      }

      hierarchy.push(role);

      // Add parent roles to the stack
      if (this.config.enableHierarchy && role.parentRoles.length > 0) {
        stack.push(...role.parentRoles);
        this.analytics.hierarchyTraversals++;
      }
    }

    // Cache the result
    this.hierarchyCache.set(cacheKey, hierarchy);

    return hierarchy;
  }

  /**
   * Check if a permission matches the requested resource and action
   */
  private matchesPermission(
    permission: Permission,
    resource: string,
    action: string
  ): boolean {
    // Exact match
    if (permission.resource === resource && permission.action === action) {
      return true;
    }

    // Wildcard matching
    if (permission.action === "*" && permission.resource === resource) {
      return true;
    }

    if (permission.resource === "*" && permission.action === action) {
      return true;
    }

    if (permission.resource === "*" && permission.action === "*") {
      return true;
    }

    // Pattern matching for resource hierarchy
    if (permission.resource.endsWith("*")) {
      const baseResource = permission.resource.slice(0, -1);
      if (resource.startsWith(baseResource) && permission.action === action) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate permission conditions based on context
   */
  private async evaluatePermissionConditions(
    permissions: Permission[],
    context: Record<string, unknown>
  ): Promise<{
    allowed: boolean;
    conditions: ConditionEvaluationResult[];
    evaluationPath: string[];
  }> {
    const conditions: ConditionEvaluationResult[] = [];
    const evaluationPath: string[] = [];
    let allowed = false;

    for (const permission of permissions) {
      if (!permission.conditions || permission.conditions.length === 0) {
        // No conditions means permission is allowed
        allowed = true;
        evaluationPath.push(`permission_${permission.id}_no_conditions`);
        continue;
      }

      // Evaluate all conditions for this permission (AND logic)
      let permissionAllowed = true;
      for (const condition of permission.conditions) {
        const result = await this.evaluateCondition(condition, context);
        conditions.push(result);

        if (!result.result) {
          permissionAllowed = false;
        }

        this.analytics.conditionEvaluations++;
      }

      if (permissionAllowed) {
        allowed = true;
        evaluationPath.push(`permission_${permission.id}_conditions_passed`);
        break; // One permission with passing conditions is enough
      } else {
        evaluationPath.push(`permission_${permission.id}_conditions_failed`);
      }
    }

    return { allowed, conditions, evaluationPath };
  }

  /**
   * Evaluate a single permission condition
   */
  private async evaluateCondition(
    condition: PermissionCondition,
    context: Record<string, unknown>
  ): Promise<ConditionEvaluationResult> {
    const cacheKey = `condition_${JSON.stringify(condition)}_${JSON.stringify(
      context
    )}`;

    // Check cache for condition evaluation
    const cached = this.conditionEvaluatorCache.get(cacheKey);
    if (cached !== undefined) {
      return {
        condition,
        result: cached,
        evaluatedValue: context[condition.field],
        reason: cached ? "condition_met_cached" : "condition_not_met_cached",
      };
    }

    const contextValue = context[condition.field];
    let result = false;
    let reason = "condition_not_met";

    try {
      switch (condition.operator) {
        case "eq":
          result = contextValue === condition.value;
          reason = result ? "equals_match" : "equals_no_match";
          break;
        case "ne":
          result = contextValue !== condition.value;
          reason = result ? "not_equals_match" : "not_equals_no_match";
          break;
        case "gt":
          result =
            typeof contextValue === "number" &&
            typeof condition.value === "number" &&
            contextValue > condition.value;
          reason = result ? "greater_than_match" : "greater_than_no_match";
          break;
        case "lt":
          result =
            typeof contextValue === "number" &&
            typeof condition.value === "number" &&
            contextValue < condition.value;
          reason = result ? "less_than_match" : "less_than_no_match";
          break;
        case "in":
          result =
            Array.isArray(condition.value) &&
            condition.value.includes(contextValue as string);
          reason = result ? "in_array_match" : "in_array_no_match";
          break;
        case "nin":
          result =
            Array.isArray(condition.value) &&
            !condition.value.includes(contextValue as string);
          reason = result ? "not_in_array_match" : "not_in_array_no_match";
          break;
        case "contains":
          result =
            typeof contextValue === "string" &&
            typeof condition.value === "string" &&
            contextValue.includes(condition.value);
          reason = result ? "contains_match" : "contains_no_match";
          break;
        case "starts_with":
          result =
            typeof contextValue === "string" &&
            typeof condition.value === "string" &&
            contextValue.startsWith(condition.value);
          reason = result ? "starts_with_match" : "starts_with_no_match";
          break;
        case "ends_with":
          result =
            typeof contextValue === "string" &&
            typeof condition.value === "string" &&
            contextValue.endsWith(condition.value);
          reason = result ? "ends_with_match" : "ends_with_no_match";
          break;
        case "matches":
          if (
            typeof contextValue === "string" &&
            typeof condition.value === "string"
          ) {
            const regex = new RegExp(condition.value);
            result = regex.test(contextValue);
            reason = result ? "regex_match" : "regex_no_match";
          }
          break;
        default:
          reason = "unknown_operator";
      }
    } catch (error) {
      result = false;
      reason = `evaluation_error: ${(error as Error).message}`;
    }

    // Cache the result
    this.conditionEvaluatorCache.set(cacheKey, result);

    return {
      condition,
      result,
      evaluatedValue: contextValue,
      reason,
    };
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Validate user ID format
   */
  private validateUserId(userId: string): void {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("Invalid user ID: must be a non-empty string");
    }
  }

  /**
   * Validate role ID format
   */
  private validateRoleId(roleId: string): void {
    if (!roleId || typeof roleId !== "string" || roleId.trim().length === 0) {
      throw new Error("Invalid role ID: must be a non-empty string");
    }
  }

  /**
   * Validate permission string format
   */
  private validatePermissionString(permission: string): void {
    if (
      !permission ||
      typeof permission !== "string" ||
      !permission.includes(":")
    ) {
      throw new Error('Invalid permission format: must be "resource:action"');
    }
  }

  /**
   * Record performance metrics
   */
  private async recordMetrics(
    operation: string,
    startTime: number,
    success: boolean,
    cached: boolean
  ): Promise<void> {
    const duration = Date.now() - startTime;

    try {
      if (this.config.enableMetrics) {
        await this.metrics.recordHistogram(
          "permission_service_operation_duration",
          duration,
          {
            operation,
            success: success.toString(),
            cached: cached.toString(),
          }
        );

        await this.metrics.recordCounter(
          "permission_service_operations_total",
          1,
          {
            operation,
            success: success.toString(),
            cached: cached.toString(),
          }
        );
      }
    } catch (error) {
      // Don't fail the operation if metrics recording fails
      this.logger.warn("Failed to record permission service metrics", {
        operation,
        error: (error as Error).message,
      } as any);
    }
  }

  /**
   * Start background maintenance tasks
   */
  private startBackgroundTasks(): void {
    // Performance metrics cleanup
    setInterval(() => {
      try {
        // Keep only recent performance data
        if (this.performanceData.evaluationTimes.length > 10000) {
          this.performanceData.evaluationTimes =
            this.performanceData.evaluationTimes.slice(-1000);
        }

        // Update analytics
        this.updateAnalytics();
      } catch (error) {
        this.logger.error("Background analytics update failed", {
          error: (error as Error).message,
        } as any);
      }
    }, 60000); // Every minute

    // Cache maintenance
    setInterval(() => {
      try {
        this.resolvedPermissionsCache.purgeStale();
        this.hierarchyCache.purgeStale();
        this.conditionEvaluatorCache.purgeStale();
      } catch (error) {
        this.logger.error("Cache maintenance failed", {
          error: (error as Error).message,
        } as any);
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Update analytics data
   */
  private updateAnalytics(): void {
    // This would typically update top permissions, top users, etc.
    // For now, just update basic statistics which are maintained elsewhere
  }
}
