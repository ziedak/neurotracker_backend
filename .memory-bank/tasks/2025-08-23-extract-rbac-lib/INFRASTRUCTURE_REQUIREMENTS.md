# RBAC Library Infrastructure Requirements

## ⚠️ CRITICAL: Use Existing Database Infrastructure

**Date**: 2025-08-23  
**Status**: MANDATORY COMPLIANCE

## Database Foundation - VALIDATED ✅

### PostgreSQL Client - MUST USE

**Location**: `libs/database/src/postgress/pgClient.ts`

```typescript
import { PostgreSQLClient } from "@libs/database";

// CORRECT usage in RBAC service
const prisma = PostgreSQLClient.getInstance();
const users = await prisma.user.findMany();
await PostgreSQLClient.transaction(async (tx) => {
  // Transaction operations
});
```

### Redis Client - MUST USE

**Location**: `libs/database/src/redisClient.ts`

```typescript
import { RedisClient } from "@libs/database";

// CORRECT usage in RBAC service
const redis = RedisClient.getInstance();
await redis.setex("permission:user:123", 300, JSON.stringify(permissions));
const cached = await redis.get("permission:user:123");
```

### Generated Repositories - MUST USE

**Location**: `libs/database/src/repository/`

```typescript
import { Role, User, RolePermission } from "@libs/database/repository";

// CORRECT usage - these are BaseRepository classes
const roles = await Role.findAll({ isActive: true });
const user = await User.findUnique(userId);
const permissions = await RolePermission.findAll({ roleId });
```

### Validated Types - MUST USE

**Location**: `libs/models/src/index.ts`

```typescript
import { PrismaDecimal, Role, User, RolePermission } from "@libs/models";

// CORRECT usage - PrismaDecimal fixed for financial precision
interface PriceData {
  amount: PrismaDecimal; // string for precision, not number
}
```

## Database Schema - VALIDATED ✅

**Location**: `libs/database/prisma/schema.prisma`

### RBAC Models Available:

```prisma
model Role {
  id          String   @id @default(cuid())
  name        String   @unique @db.VarChar(128)
  displayName String   @db.VarChar(255)
  description String?
  category    String   @default("functional") @db.VarChar(64)
  level       Int      @default(5)
  isActive    Boolean  @default(true)
  // ... hierarchy and audit fields
  permissions RolePermission[]
  users       User[]
}

model RolePermission {
  id          String @id @default(cuid())
  roleId      String
  resource    String @db.VarChar(128)
  action      String @db.VarChar(128)
  name        String @db.VarChar(128)
  conditions  Json?
  priority    String @default("medium")
  // ... audit fields
}

model User {
  // Phase 3A: Single role architecture
  roleId         String?
  role           Role?
  roleAssignedAt DateTime?
  roleRevokedAt  DateTime?
  // ... other fields
}
```

## FORBIDDEN Actions ❌

### DO NOT Create New Clients

```typescript
// WRONG - DO NOT DO THIS
const prisma = new PrismaClient();
const redis = new Redis();
```

### DO NOT Create New Repositories

```typescript
// WRONG - DO NOT DO THIS
class UserRepository extends BaseRepository {}
class RoleRepository extends BaseRepository {}
```

### DO NOT Reimplement Types

```typescript
// WRONG - DO NOT DO THIS
interface Role {
  id: string;
  name: string;
  // ... duplicate type definitions
}
```

## CORRECT Integration Pattern ✅

```typescript
// RBAC Service Implementation Template
import { PostgreSQLClient, RedisClient } from "@libs/database";
import { Role, User, RolePermission } from "@libs/database/repository";
import { PrismaDecimal } from "@libs/models";

export class RBACService implements IRBACService {
  constructor(
    private readonly redis = RedisClient.getInstance(),
    private readonly prisma = PostgreSQLClient.getInstance(),
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector
  ) {}

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    // Use existing Role, User, RolePermission repositories
    const user = await User.findUnique(userId, {
      include: { role: { include: { permissions: true } } },
    });

    // Use existing Redis client for caching
    const cacheKey = `permission:${userId}:${permission}`;
    const cached = await this.redis.get(cacheKey);

    // Business logic here...
  }
}
```

## Validation Checklist ✅

- [x] Database foundation validated (VALIDATION_REPORT.md)
- [x] PostgreSQLClient singleton available
- [x] RedisClient singleton available
- [x] Generated repositories (Role, User, RolePermission) available
- [x] Type-safe models with corrected Decimal handling
- [x] Prisma schema matches TypeScript types
- [x] No infrastructure gaps identified

## Architecture Compliance

**This task MUST**:

1. ✅ Use existing PostgreSQLClient
2. ✅ Use existing RedisClient
3. ✅ Use existing generated repositories
4. ✅ Use validated type definitions
5. ✅ Build upon proven infrastructure
6. ✅ Follow conservative enhancement approach

**This task MUST NOT**:

1. ❌ Create new database clients
2. ❌ Create new repository implementations
3. ❌ Reimplement caching clients
4. ❌ Create duplicate type definitions
5. ❌ Ignore existing infrastructure patterns

---

**Ready for RBAC extraction using existing validated infrastructure.**
