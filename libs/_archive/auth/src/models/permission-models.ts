/**
 * Permission Models and Validation - Enterprise RBAC Data Structures
 *
 * Comprehensive data models for Role-Based Access Control (RBAC) system:
 * - Type-safe permission and role definitions
 * - Validation schemas with comprehensive error handling
 * - Permission hierarchy and inheritance structures
 * - Serialization optimization for caching performance
 * - Performance-optimized data structures
 *
 * Follows Clean Architecture principles with enterprise-grade type safety
 * and comprehensive validation.
 *
 * @version 2.2.0
 */

/**
 * Core permission interface with comprehensive metadata
 */
export interface Permission {
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

/**
 * Permission condition for fine-grained access control
 */
export interface PermissionCondition {
  readonly type: ConditionType;
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: string | number | boolean | string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Permission metadata for audit and management
 */
export interface PermissionMetadata {
  readonly description: string;
  readonly category: string;
  readonly priority: PermissionPriority;
  readonly tags: string[];
  readonly owner: string;
  readonly department: string;
  readonly compliance?: ComplianceInfo;
  readonly customAttributes?: Record<string, unknown>;
}

/**
 * Role interface with hierarchy support
 */
export interface Role {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly permissions: Permission[];
  readonly parentRoles: string[]; // Role IDs for hierarchy
  readonly childRoles: string[]; // Role IDs for hierarchy
  readonly metadata: RoleMetadata;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: string;
}

/**
 * Role metadata for comprehensive management
 */
export interface RoleMetadata {
  readonly category: RoleCategory;
  readonly level: RoleLevel;
  readonly department: string;
  readonly owner: string;
  readonly maxUsers?: number;
  readonly expiresAt?: Date;
  readonly compliance?: ComplianceInfo;
  readonly customAttributes?: Record<string, unknown>;
}

/**
 * Compliance information for audit requirements
 */
export interface ComplianceInfo {
  readonly framework: string; // SOX, GDPR, HIPAA, etc.
  readonly requirements: string[];
  readonly lastAudit?: Date;
  readonly nextAudit?: Date;
  readonly auditTrail: AuditEntry[];
}

/**
 * Audit entry for compliance tracking
 */
export interface AuditEntry {
  readonly timestamp: Date;
  readonly userId: string;
  readonly action: AuditAction;
  readonly details: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Permission validation result
 */
export interface PermissionValidationResult {
  readonly valid: boolean;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly normalizedPermission?: Permission;
}

/**
 * Role validation result
 */
export interface RoleValidationResult {
  readonly valid: boolean;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly normalizedRole?: Role;
  readonly hierarchyValid: boolean;
  readonly circularDependency: boolean;
}

/**
 * Validation error with detailed information
 */
export interface ValidationError {
  readonly field: string;
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly value?: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Validation warning for best practices
 */
export interface ValidationWarning {
  readonly field: string;
  readonly code: ValidationWarningCode;
  readonly message: string;
  readonly recommendation: string;
}

/**
 * Permission hierarchy analysis result
 */
export interface PermissionHierarchyResult {
  readonly valid: boolean;
  readonly depth: number;
  readonly circularReferences: string[];
  readonly orphanedRoles: string[];
  readonly maxDepthExceeded: boolean;
  readonly recommendations: string[];
}

// ===================================================================
// ENUMERATIONS
// ===================================================================

/**
 * Permission condition types
 */
export enum ConditionType {
  ATTRIBUTE = "attribute",
  TIME = "time",
  LOCATION = "location",
  CUSTOM = "custom",
}

/**
 * Condition operators for fine-grained control
 */
export enum ConditionOperator {
  EQUALS = "eq",
  NOT_EQUALS = "ne",
  GREATER_THAN = "gt",
  LESS_THAN = "lt",
  IN = "in",
  NOT_IN = "nin",
  CONTAINS = "contains",
  STARTS_WITH = "starts_with",
  ENDS_WITH = "ends_with",
  MATCHES = "matches",
}

/**
 * Permission priority levels
 */
export enum PermissionPriority {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

/**
 * Role categories for organization
 */
export enum RoleCategory {
  SYSTEM = "system",
  ADMINISTRATIVE = "administrative",
  OPERATIONAL = "operational",
  FUNCTIONAL = "functional",
  CUSTOM = "custom",
}

/**
 * Role hierarchy levels
 */
export enum RoleLevel {
  EXECUTIVE = 1,
  DIRECTOR = 2,
  MANAGER = 3,
  SUPERVISOR = 4,
  EMPLOYEE = 5,
  CONTRACTOR = 6,
  GUEST = 7,
}

/**
 * Audit action types
 */
export enum AuditAction {
  CREATED = "created",
  UPDATED = "updated",
  DELETED = "deleted",
  ASSIGNED = "assigned",
  REVOKED = "revoked",
  ACTIVATED = "activated",
  DEACTIVATED = "deactivated",
}

/**
 * Validation error codes
 */
export enum ValidationErrorCode {
  REQUIRED_FIELD = "required_field",
  INVALID_FORMAT = "invalid_format",
  INVALID_VALUE = "invalid_value",
  DUPLICATE_ID = "duplicate_id",
  CIRCULAR_REFERENCE = "circular_reference",
  INVALID_HIERARCHY = "invalid_hierarchy",
  PERMISSION_NOT_FOUND = "permission_not_found",
  ROLE_NOT_FOUND = "role_not_found",
}

/**
 * Validation warning codes
 */
export enum ValidationWarningCode {
  DEPRECATED_FIELD = "deprecated_field",
  PERFORMANCE_CONCERN = "performance_concern",
  SECURITY_RECOMMENDATION = "security_recommendation",
  BEST_PRACTICE = "best_practice",
}

// ===================================================================
// PERMISSION VALIDATOR CLASS
// ===================================================================

/**
 * Comprehensive permission and role validator with enterprise features
 */
export class PermissionValidator {
  private static readonly MAX_HIERARCHY_DEPTH = 10;
  private static readonly MAX_PERMISSIONS_PER_ROLE = 1000;
  private static readonly RESERVED_NAMES = new Set([
    "admin",
    "root",
    "system",
    "superuser",
    "anonymous",
  ]);

  /**
   * Validate permission with comprehensive checks
   */
  public static validatePermission(
    permission: unknown,
    options: ValidationOptions = {}
  ): PermissionValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Type check
      if (!permission || typeof permission !== "object") {
        errors.push({
          field: "root",
          code: ValidationErrorCode.INVALID_FORMAT,
          message: "Permission must be an object",
          value: permission,
        });
        return { valid: false, errors, warnings };
      }

      const perm = permission as Record<string, unknown>;

      // Validate required fields
      this.validateRequiredField(perm, "id", "string", errors);
      this.validateRequiredField(perm, "name", "string", errors);
      this.validateRequiredField(perm, "resource", "string", errors);
      this.validateRequiredField(perm, "action", "string", errors);
      this.validateRequiredField(perm, "metadata", "object", errors);

      // Validate ID format
      if (perm.id && typeof perm.id === "string") {
        if (!/^[a-zA-Z0-9_-]+$/.test(perm.id)) {
          errors.push({
            field: "id",
            code: ValidationErrorCode.INVALID_FORMAT,
            message:
              "Permission ID must contain only alphanumeric characters, underscores, and hyphens",
            value: perm.id,
          });
        }
      }

      // Validate resource format
      if (perm.resource && typeof perm.resource === "string") {
        if (!/^[a-zA-Z0-9_:./-]+$/.test(perm.resource)) {
          errors.push({
            field: "resource",
            code: ValidationErrorCode.INVALID_FORMAT,
            message: "Resource must follow valid path format",
            value: perm.resource,
          });
        }
      }

      // Validate action format
      if (perm.action && typeof perm.action === "string") {
        if (!/^[a-zA-Z0-9_:*]+$/.test(perm.action)) {
          errors.push({
            field: "action",
            code: ValidationErrorCode.INVALID_FORMAT,
            message:
              "Action must contain only alphanumeric characters, underscores, colons, and asterisks",
            value: perm.action,
          });
        }
      }

      // Validate conditions if present
      if (perm.conditions && Array.isArray(perm.conditions)) {
        for (let i = 0; i < perm.conditions.length; i++) {
          const conditionErrors = this.validateCondition(
            perm.conditions[i],
            `conditions[${i}]`
          );
          errors.push(...conditionErrors);
        }
      }

      // Validate metadata
      if (perm.metadata) {
        const metadataErrors = this.validatePermissionMetadata(
          perm.metadata as Record<string, unknown>
        );
        errors.push(...metadataErrors);
      }

      // Generate warnings
      if (options.strictMode) {
        if (!perm.description || (perm.description as string).length < 10) {
          warnings.push({
            field: "description",
            code: ValidationWarningCode.BEST_PRACTICE,
            message: "Permission should have a descriptive description",
            recommendation:
              "Add a clear description explaining what this permission allows",
          });
        }
      }

      const valid = errors.length === 0;
      const normalizedPermission = valid
        ? this.normalizePermission(perm)
        : undefined;

      return {
        valid,
        errors,
        warnings,
        normalizedPermission,
      };
    } catch (error) {
      errors.push({
        field: "root",
        code: ValidationErrorCode.INVALID_FORMAT,
        message: `Validation error: ${(error as Error).message}`,
      });

      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate role with hierarchy checks
   */
  public static validateRole(
    role: unknown,
    options: ValidationOptions = {}
  ): RoleValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let hierarchyValid = true;
    let circularDependency = false;

    try {
      // Type check
      if (!role || typeof role !== "object") {
        errors.push({
          field: "root",
          code: ValidationErrorCode.INVALID_FORMAT,
          message: "Role must be an object",
          value: role,
        });
        return {
          valid: false,
          errors,
          warnings,
          hierarchyValid: false,
          circularDependency: false,
        };
      }

      const r = role as Record<string, unknown>;

      // Validate required fields
      this.validateRequiredField(r, "id", "string", errors);
      this.validateRequiredField(r, "name", "string", errors);
      this.validateRequiredField(r, "displayName", "string", errors);
      this.validateRequiredField(r, "permissions", "object", errors); // Array is an object
      this.validateRequiredField(r, "metadata", "object", errors);

      // Validate ID format
      if (r.id && typeof r.id === "string") {
        if (!/^[a-zA-Z0-9_-]+$/.test(r.id)) {
          errors.push({
            field: "id",
            code: ValidationErrorCode.INVALID_FORMAT,
            message:
              "Role ID must contain only alphanumeric characters, underscores, and hyphens",
            value: r.id,
          });
        }

        // Check reserved names
        if (this.RESERVED_NAMES.has(r.id.toLowerCase())) {
          errors.push({
            field: "id",
            code: ValidationErrorCode.INVALID_VALUE,
            message: "Role ID cannot be a reserved name",
            value: r.id,
          });
        }
      }

      // Validate permissions array
      if (r.permissions && Array.isArray(r.permissions)) {
        if (r.permissions.length > this.MAX_PERMISSIONS_PER_ROLE) {
          errors.push({
            field: "permissions",
            code: ValidationErrorCode.INVALID_VALUE,
            message: `Role cannot have more than ${this.MAX_PERMISSIONS_PER_ROLE} permissions`,
            value: r.permissions.length,
          });
        }

        for (let i = 0; i < r.permissions.length; i++) {
          const permResult = this.validatePermission(r.permissions[i], options);
          if (!permResult.valid) {
            errors.push(
              ...permResult.errors.map((error) => ({
                ...error,
                field: `permissions[${i}].${error.field}`,
              }))
            );
          }
        }
      }

      // Validate parent roles for circular dependencies
      if (r.parentRoles && Array.isArray(r.parentRoles)) {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        if (r.id && typeof r.id === "string") {
          circularDependency = this.hasCircularDependency(
            r.id,
            r.parentRoles as string[],
            visited,
            recursionStack,
            options.roleProvider
          );
        }

        if (circularDependency) {
          errors.push({
            field: "parentRoles",
            code: ValidationErrorCode.CIRCULAR_REFERENCE,
            message: "Circular dependency detected in role hierarchy",
          });
          hierarchyValid = false;
        }
      }

      // Validate metadata
      if (r.metadata) {
        const metadataErrors = this.validateRoleMetadata(
          r.metadata as Record<string, unknown>
        );
        errors.push(...metadataErrors);
      }

      // Generate warnings
      if (options.strictMode) {
        if (!r.description || (r.description as string).length < 10) {
          warnings.push({
            field: "description",
            code: ValidationWarningCode.BEST_PRACTICE,
            message: "Role should have a descriptive description",
            recommendation:
              "Add a clear description explaining the purpose of this role",
          });
        }
      }

      const valid = errors.length === 0;
      const normalizedRole = valid ? this.normalizeRole(r) : undefined;

      return {
        valid,
        errors,
        warnings,
        normalizedRole,
        hierarchyValid,
        circularDependency,
      };
    } catch (error) {
      errors.push({
        field: "root",
        code: ValidationErrorCode.INVALID_FORMAT,
        message: `Validation error: ${(error as Error).message}`,
      });

      return {
        valid: false,
        errors,
        warnings,
        hierarchyValid: false,
        circularDependency: false,
      };
    }
  }

  /**
   * Validate permission hierarchy for consistency
   */
  public static validatePermissionHierarchy(
    roles: Role[],
    options: ValidationOptions = {}
  ): PermissionHierarchyResult {
    const circularReferences: string[] = [];
    const orphanedRoles: string[] = [];
    let maxDepthExceeded = false;
    const recommendations: string[] = [];

    try {
      const roleMap = new Map<string, Role>();
      for (const role of roles) {
        roleMap.set(role.id, role);
      }

      // Check for circular references and depth
      for (const role of roles) {
        const visited = new Set<string>();
        const path: string[] = [];

        if (
          this.checkHierarchyDepth(role.id, roleMap, visited, path, 0) >
          this.MAX_HIERARCHY_DEPTH
        ) {
          maxDepthExceeded = true;
          recommendations.push(
            `Consider flattening role hierarchy for role: ${role.id}`
          );
        }

        if (
          this.hasCircularReferenceInHierarchy(
            role.id,
            roleMap,
            new Set(),
            new Set()
          )
        ) {
          circularReferences.push(role.id);
        }
      }

      // Find orphaned roles
      const referencedRoles = new Set<string>();
      for (const role of roles) {
        for (const parentId of role.parentRoles) {
          referencedRoles.add(parentId);
        }
        for (const childId of role.childRoles) {
          referencedRoles.add(childId);
        }
      }

      for (const role of roles) {
        if (!referencedRoles.has(role.id) && role.parentRoles.length === 0) {
          orphanedRoles.push(role.id);
        }
      }

      const valid = circularReferences.length === 0 && !maxDepthExceeded;
      const depth = Math.max(
        ...roles.map((role) =>
          this.checkHierarchyDepth(role.id, roleMap, new Set(), [], 0)
        )
      );

      return {
        valid,
        depth,
        circularReferences,
        orphanedRoles,
        maxDepthExceeded,
        recommendations,
      };
    } catch (error) {
      recommendations.push(
        `Hierarchy validation failed: ${(error as Error).message}`
      );
      return {
        valid: false,
        depth: 0,
        circularReferences,
        orphanedRoles,
        maxDepthExceeded: false,
        recommendations,
      };
    }
  }

  // ===================================================================
  // PRIVATE HELPER METHODS
  // ===================================================================

  private static validateRequiredField(
    obj: Record<string, unknown>,
    field: string,
    expectedType: string,
    errors: ValidationError[]
  ): void {
    if (!obj[field]) {
      errors.push({
        field,
        code: ValidationErrorCode.REQUIRED_FIELD,
        message: `Field '${field}' is required`,
      });
    } else if (expectedType === "object" && typeof obj[field] !== "object") {
      errors.push({
        field,
        code: ValidationErrorCode.INVALID_FORMAT,
        message: `Field '${field}' must be an object`,
        value: obj[field],
      });
    } else if (
      expectedType !== "object" &&
      typeof obj[field] !== expectedType
    ) {
      errors.push({
        field,
        code: ValidationErrorCode.INVALID_FORMAT,
        message: `Field '${field}' must be a ${expectedType}`,
        value: obj[field],
      });
    }
  }

  private static validateCondition(
    condition: unknown,
    fieldPath: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!condition || typeof condition !== "object") {
      errors.push({
        field: fieldPath,
        code: ValidationErrorCode.INVALID_FORMAT,
        message: "Condition must be an object",
        value: condition,
      });
      return errors;
    }

    const cond = condition as Record<string, unknown>;

    this.validateRequiredField(cond, "type", "string", errors);
    this.validateRequiredField(cond, "field", "string", errors);
    this.validateRequiredField(cond, "operator", "string", errors);
    this.validateRequiredField(cond, "value", "string", errors); // Can be various types

    return errors.map((error) => ({
      ...error,
      field: `${fieldPath}.${error.field}`,
    }));
  }

  private static validatePermissionMetadata(
    metadata: Record<string, unknown>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    this.validateRequiredField(metadata, "description", "string", errors);
    this.validateRequiredField(metadata, "category", "string", errors);
    this.validateRequiredField(metadata, "priority", "string", errors);
    this.validateRequiredField(metadata, "owner", "string", errors);
    this.validateRequiredField(metadata, "department", "string", errors);

    return errors.map((error) => ({
      ...error,
      field: `metadata.${error.field}`,
    }));
  }

  private static validateRoleMetadata(
    metadata: Record<string, unknown>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    this.validateRequiredField(metadata, "category", "string", errors);
    this.validateRequiredField(metadata, "level", "string", errors);
    this.validateRequiredField(metadata, "department", "string", errors);
    this.validateRequiredField(metadata, "owner", "string", errors);

    return errors.map((error) => ({
      ...error,
      field: `metadata.${error.field}`,
    }));
  }

  private static hasCircularDependency(
    roleId: string,
    parentRoles: string[],
    visited: Set<string>,
    recursionStack: Set<string>,
    roleProvider?: (roleId: string) => Role | null
  ): boolean {
    if (!roleProvider) {
      return false; // Cannot check without role provider
    }

    visited.add(roleId);
    recursionStack.add(roleId);

    for (const parentId of parentRoles) {
      if (!visited.has(parentId)) {
        const parentRole = roleProvider(parentId);
        if (
          parentRole &&
          this.hasCircularDependency(
            parentId,
            parentRole.parentRoles,
            visited,
            recursionStack,
            roleProvider
          )
        ) {
          return true;
        }
      } else if (recursionStack.has(parentId)) {
        return true; // Circular dependency found
      }
    }

    recursionStack.delete(roleId);
    return false;
  }

  private static hasCircularReferenceInHierarchy(
    roleId: string,
    roleMap: Map<string, Role>,
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    if (recursionStack.has(roleId)) {
      return true;
    }

    if (visited.has(roleId)) {
      return false;
    }

    visited.add(roleId);
    recursionStack.add(roleId);

    const role = roleMap.get(roleId);
    if (role) {
      for (const parentId of role.parentRoles) {
        if (
          this.hasCircularReferenceInHierarchy(
            parentId,
            roleMap,
            visited,
            recursionStack
          )
        ) {
          return true;
        }
      }
    }

    recursionStack.delete(roleId);
    return false;
  }

  private static checkHierarchyDepth(
    roleId: string,
    roleMap: Map<string, Role>,
    visited: Set<string>,
    path: string[],
    currentDepth: number
  ): number {
    if (visited.has(roleId) || currentDepth > this.MAX_HIERARCHY_DEPTH) {
      return currentDepth;
    }

    visited.add(roleId);
    path.push(roleId);

    const role = roleMap.get(roleId);
    if (!role || role.parentRoles.length === 0) {
      return currentDepth;
    }

    let maxDepth = currentDepth;
    for (const parentId of role.parentRoles) {
      const depth = this.checkHierarchyDepth(
        parentId,
        roleMap,
        visited,
        path,
        currentDepth + 1
      );
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  private static normalizePermission(
    permission: Record<string, unknown>
  ): Permission {
    const now = new Date();

    return {
      id: permission.id as string,
      name: permission.name as string,
      resource: permission.resource as string,
      action: permission.action as string,
      conditions: (permission.conditions as PermissionCondition[]) || [],
      metadata: permission.metadata as PermissionMetadata,
      createdAt: (permission.createdAt as Date) || now,
      updatedAt: (permission.updatedAt as Date) || now,
      version: (permission.version as string) || "1.0.0",
    };
  }

  private static normalizeRole(role: Record<string, unknown>): Role {
    const now = new Date();

    return {
      id: role.id as string,
      name: role.name as string,
      displayName: role.displayName as string,
      description: (role.description as string) || "",
      permissions: role.permissions as Permission[],
      parentRoles: (role.parentRoles as string[]) || [],
      childRoles: (role.childRoles as string[]) || [],
      metadata: role.metadata as RoleMetadata,
      isActive: (role.isActive as boolean) ?? true,
      createdAt: (role.createdAt as Date) || now,
      updatedAt: (role.updatedAt as Date) || now,
      version: (role.version as string) || "1.0.0",
    };
  }
}

// ===================================================================
// VALIDATION OPTIONS INTERFACE
// ===================================================================

export interface ValidationOptions {
  readonly strictMode?: boolean;
  readonly roleProvider?: (roleId: string) => Role | null;
  readonly customValidators?: Record<string, (value: unknown) => boolean>;
}
