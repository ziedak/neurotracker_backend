# Phase 3A: Enterprise RBAC System Unification

## Technical Architecture Specification

**Version:** 1.0  
**Date:** August 20, 2025  
**Status:** Draft  
**Priority:** Critical

---

## 🎯 **EXECUTIVE SUMMARY**

Consolidate the distributed Role-Based Access Control (RBAC) implementation across `libs/auth` into a unified, enterprise-grade system with single source of truth for types, proper infrastructure usage, and consistent permission management.

### **Key Objectives:**

1. **Eliminate type duplication** - Single source of truth for Permission/Role models
2. **Standardize role architecture** - Single role per user with hierarchy support
3. **Fix infrastructure anti-patterns** - Leverage existing Redis client from `libs/database`
4. **Enhance permission system** - Use enterprise-grade `Permission[]` objects throughout

---

## 📋 **CURRENT STATE ANALYSIS**

### **Critical Issues Identified:**

#### **1. Type System Fragmentation**

```typescript
// PROBLEM: Multiple Permission/Role interface definitions
├── libs/auth/src/models/permission-models.ts     ← Canonical (enterprise-grade)
├── libs/auth/src/services/permission-service.ts ← Duplicate inline types
├── libs/auth/src/services/permission-cache.ts   ← Duplicate inline types
└── libs/auth/src/context-factory.ts            ← Type mismatches
```

#### **2. Infrastructure Anti-Patterns**

```typescript
// BAD: Custom Redis interfaces in permission-cache.ts
interface RedisInterface { ... }
interface RedisPipeline { ... }
class RedisClientStub { ... }

// GOOD: Should use existing enterprise infrastructure
import { RedisClient } from "@libs/database";
```

#### **3. Permission Format Inconsistency**

```typescript
// MIXED: Different permission formats across system
UnifiedAuthContext.permissions: string[]           ← Simple strings
PermissionService.getUserPermissions(): Permission[] ← Rich objects
```

#### **4. Role Architecture Inconsistency**

```typescript
// INCONSISTENT: Mixed role patterns
UserIdentity.role: string     ← Single role (context-factory)
UserIdentity.roles: string[]  ← Multiple roles (other places)
```

---

## 🏗️ **TARGET ARCHITECTURE**

### **1. Unified Type System**

#### **Single Source of Truth:**

```typescript
// libs/auth/src/models/index.ts - CANONICAL EXPORTS
export {
  Permission,
  Role,
  PermissionCondition,
  PermissionMetadata,
  RoleMetadata,
  // ... all enterprise types
} from "./permission-models";
```

#### **Enterprise Permission Object:**

```typescript
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
```

### **2. Single Role Architecture with Hierarchy**

#### **User Role Model:**

```typescript
interface UserIdentity {
  readonly id: string;
  readonly email: string;
  readonly role: string; // ← SINGLE role ID
  readonly storeId?: string;
  readonly status: UserStatus;
}
```

#### **Role Hierarchy System:**

```typescript
interface Role {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly permissions: Permission[]; // ← Direct permissions
  readonly parentRoles: string[]; // ← Inheritance hierarchy
  readonly childRoles: string[]; // ← Delegation hierarchy
  readonly metadata: RoleMetadata;
  readonly isActive: boolean;
  // ... audit fields
}
```

#### **Permission Resolution Strategy:**

```
User.role → Role.permissions + inherited permissions from Role.parentRoles
```

### **3. Enterprise Infrastructure Usage**

#### **Redis Client Integration:**

```typescript
// libs/auth/src/services/permission-cache.ts
import { RedisClient } from "@libs/database";

export class PermissionCache {
  private readonly redis: Redis;

  constructor() {
    this.redis = RedisClient.getInstance();
  }
}
```

### **4. Unified Permission Management**

#### **Context System:**

```typescript
interface UnifiedAuthContext {
  readonly permissions: Permission[];  // ← Rich objects, not strings

  canAccess(resource: string, action: string): boolean {
    return this.permissions.some(p =>
      p.resource === resource &&
      p.action === action &&
      this.evaluateConditions(p.conditions)
    );
  }
}
```

---

## 📊 **IMPLEMENTATION ROADMAP**

### **Phase 3A.1: Type System Consolidation**

**Duration:** 2-3 hours  
**Priority:** Critical

#### **Tasks:**

1. **Create unified exports** in `libs/auth/src/models/index.ts`
2. **Remove duplicate type definitions** from service files
3. **Update all imports** to use canonical types
4. **Validate type consistency** across codebase

#### **Success Criteria:**

- ✅ Single source of truth for all RBAC types
- ✅ No duplicate interface definitions
- ✅ All imports reference canonical models
- ✅ TypeScript compilation clean

### **Phase 3A.2: Redis Infrastructure Fix**

**Duration:** 1-2 hours  
**Priority:** High

#### **Tasks:**

1. **Replace custom Redis interfaces** with `@libs/database/RedisClient`
2. **Remove RedisClientStub** and associated mock classes
3. **Update PermissionCache** to use enterprise Redis client
4. **Validate Redis connectivity** and operations

#### **Success Criteria:**

- ✅ No custom Redis interface duplication
- ✅ Leverages existing database infrastructure
- ✅ Cache operations work with real Redis client
- ✅ Improved reliability and performance

### **Phase 3A.3: Permission System Enhancement**

**Duration:** 3-4 hours  
**Priority:** Medium

#### **Tasks:**

1. **Update UnifiedAuthContext** to use `Permission[]` objects
2. **Enhance permission checking** with condition evaluation
3. **Update context builders** for enterprise permission handling
4. **Add permission serialization utilities** for caching

#### **Success Criteria:**

- ✅ Rich permission objects throughout system
- ✅ Condition-based access control support
- ✅ Improved security and flexibility
- ✅ Better audit capabilities

### **Phase 3A.4: Role Architecture Standardization**

**Duration:** 2-3 hours
**Priority:** Medium

#### **Tasks:**

1. **Standardize to single role per user** across all interfaces
2. **Implement role hierarchy resolution** in PermissionService
3. **Update authentication flows** for single role model
4. **Add role inheritance utilities**

#### **Success Criteria:**

- ✅ Consistent single role architecture
- ✅ Role hierarchy fully functional
- ✅ Permission inheritance working
- ✅ Authentication flows updated

---

## 🔧 **TECHNICAL SPECIFICATIONS**

### **File Structure Changes:**

```
libs/auth/src/
├── models/
│   ├── index.ts                    ← NEW: Unified exports
│   ├── permission-models.ts        ← CANONICAL: Enterprise types
│   ├── session-models.ts          ← EXISTING
│   └── user-models.ts             ← UPDATE: Single role
├── services/
│   ├── permission-service.ts      ← REFACTOR: Remove inline types
│   ├── permission-cache.ts        ← REFACTOR: Use RedisClient
│   └── user-service.ts            ← UPDATE: Single role support
├── context-factory.ts             ← FIX: Permission[] usage
├── context-builder.ts             ← UPDATE: Permission[] handling
├── unified-context.ts             ← ENHANCE: Rich permissions
└── index.ts                       ← UPDATE: Export unified models
```

### **Breaking Changes:**

#### **1. Permission Format:**

```typescript
// BEFORE (mixed)
permissions: string[]              // "resource:action"
permissions: Permission[]          // Rich objects

// AFTER (unified)
permissions: Permission[]          // Enterprise objects only
```

#### **2. Role Model:**

```typescript
// BEFORE (inconsistent)
UserIdentity.role: string          // Single
UserIdentity.roles: string[]       // Multiple

// AFTER (standardized)
UserIdentity.role: string          // Single role ID
```

### **Migration Strategy:**

#### **1. Backward Compatibility:**

- Maintain existing API signatures during transition
- Add deprecation warnings for old patterns
- Provide migration utilities where needed

#### **2. Testing Strategy:**

- Unit tests for all permission resolution logic
- Integration tests for role hierarchy
- Performance tests for Redis cache operations
- End-to-end authentication flow validation

---

## 📈 **EXPECTED OUTCOMES**

### **Technical Benefits:**

- ✅ **50% reduction** in code duplication
- ✅ **Improved type safety** with canonical models
- ✅ **Better performance** with proper Redis client
- ✅ **Enhanced security** with condition-based permissions

### **Architectural Benefits:**

- ✅ **Single source of truth** for RBAC types
- ✅ **Consistent role model** across all services
- ✅ **Proper infrastructure usage** following DRY principles
- ✅ **Enterprise-grade permissions** with rich metadata

### **Maintenance Benefits:**

- ✅ **Easier debugging** with unified type system
- ✅ **Simpler testing** with consistent interfaces
- ✅ **Better documentation** with canonical models
- ✅ **Reduced technical debt** through consolidation

---

## 🚀 **IMPLEMENTATION DECISION**

**Recommended Approach:** Sequential implementation following the roadmap:

1. **Phase 3A.1** → Type system consolidation (foundation)
2. **Phase 3A.2** → Redis infrastructure fix (critical anti-pattern)
3. **Phase 3A.3** → Permission system enhancement (functionality)
4. **Phase 3A.4** → Role architecture standardization (completeness)

**Next Step:** Begin implementation of **Phase 3A.1: Type System Consolidation**

---

_This specification provides the architectural foundation for creating a unified, enterprise-grade RBAC system that eliminates technical debt while maintaining backward compatibility and enhancing functionality._
