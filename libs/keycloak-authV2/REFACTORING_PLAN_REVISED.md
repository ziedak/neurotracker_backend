# Revised Refactoring Plan - Post Rollback

**Date**: October 6, 2025  
**Status**: Phase 1 complete, Phases 2-3 rolled back  
**Next Steps**: Lean, focused approach using existing infrastructure

---

## Current State

### ✅ What's Working (Phase 1)

- Clear service naming:
  - `KeycloakUserClient` - Keycloak API wrapper
  - `KeycloakUserService` - Keycloak operations
  - `UserFacade` - Public API
- 21/21 tests passing
- Zero breaking changes

### ✅ What Exists in @libs/database

```typescript
// Already available - DO NOT RECREATE
import {
  User, // Complete user interface
  UserCreateInput, // Creation input type
  UserUpdateInput, // Update input type
  UserCreateInputSchema, // Zod validation for creation
  UserUpdateInputSchema, // Zod validation for updates
  UserStatus, // Status enum
} from "@libs/database";
```

**Key Point**: Database library is comprehensive. Use it!

---

## Revised Phases (Lean Approach)

### Phase 2: Keycloak Converter (2-4 hours)

**Goal**: Create ONLY Keycloak-specific conversions

**Create**:

```
src/services/user/converters/
├── KeycloakConverter.ts    (~200 lines)
├── index.ts                (~5 lines)
tests/services/user/converters/
└── KeycloakConverter.test.ts (~150 lines)
```

**Code Structure**:

```typescript
import { User, UserCreateInput, UserUpdateInput } from "@libs/database";
import { KeycloakUserRepresentation } from "@libs/keycloak-auth";

export namespace KeycloakConverter {
  /**
   * Convert Keycloak API response to DB User type
   */
  export function toUser(kcUser: KeycloakUserRepresentation): Partial<User> {
    return {
      id: kcUser.id,
      email: kcUser.email ?? "",
      username: kcUser.username ?? "",
      firstName: kcUser.firstName ?? null,
      lastName: kcUser.lastName ?? null,
      emailVerified: kcUser.emailVerified ?? false,
      // Map Keycloak-specific fields
      enabled: kcUser.enabled ?? true,
      // ... rest of mapping
    };
  }

  /**
   * Convert user creation data to Keycloak format
   */
  export function toKeycloakCreate(
    input: UserCreateInput
  ): KeycloakUserRepresentation {
    return {
      username: input.username,
      email: input.email,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      enabled: input.status === UserStatus.ACTIVE,
      emailVerified: input.emailVerified,
      // ... rest of mapping
    };
  }

  /**
   * Convert user update data to Keycloak format
   */
  export function toKeycloakUpdate(
    input: UserUpdateInput
  ): Partial<KeycloakUserRepresentation> {
    const update: Partial<KeycloakUserRepresentation> = {};

    if (input.username) update.username = input.username;
    if (input.email) update.email = input.email;
    if (input.firstName !== undefined)
      update.firstName = input.firstName ?? undefined;
    // ... rest of mapping

    return update;
  }

  /**
   * Helper: Compute enabled status from User
   */
  export function computeEnabled(user: User): boolean {
    return user.status === UserStatus.ACTIVE && !user.isDeleted;
  }

  /**
   * Helper: Check if user is active
   */
  export function isUserActive(user: User): boolean {
    return (
      user.status === UserStatus.ACTIVE &&
      !user.isDeleted &&
      (user.deletedAt === null || user.deletedAt === undefined)
    );
  }

  /**
   * Helper: Build full name
   */
  export function buildFullName(user: User): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.join(" ") || user.username;
  }
}
```

**Tests**: Standard mapping tests, edge cases, round-trip conversions

**Benefits**:

- ~200 lines total (vs 2,350 deleted)
- Zero duplication
- Reuses database types
- Only Keycloak-specific logic

---

### Phase 3: UserFacade Validation Integration (1-2 hours)

**Goal**: Use existing Zod schemas for validation

**Update**: `UserFacade` methods to use database validation

**Example**:

```typescript
import {
  User,
  UserCreateInput,
  UserCreateInputSchema,
  UserUpdateInputSchema,
} from "@libs/database";
import { KeycloakConverter } from "./converters";

export class UserFacade {
  async createUser(input: unknown): Promise<User> {
    // 1. Validate using existing schema
    const validatedData = UserCreateInputSchema.parse(input);

    // 2. Create in LOCAL DB (master)
    const user = await this.localRepo.create(validatedData);

    // 3. Sync to Keycloak (async, non-blocking)
    const kcFormat = KeycloakConverter.toKeycloakCreate(validatedData);
    await this.keycloakService.createUser(kcFormat);

    return user;
  }

  async updateUser(id: string, input: unknown): Promise<User> {
    // 1. Validate using existing schema
    const validatedData = UserUpdateInputSchema.parse(input);

    // 2. Update in LOCAL DB (master)
    const user = await this.localRepo.update(id, validatedData);

    // 3. Sync to Keycloak (async, non-blocking)
    const kcFormat = KeycloakConverter.toKeycloakUpdate(validatedData);
    await this.keycloakService.updateUser(id, kcFormat);

    return user;
  }
}
```

**Benefits**:

- Use battle-tested Zod validation
- Zero custom validation code
- Type-safe with database schema
- Automatic validation errors

---

### Phase 4: Sync Service (2-3 days)

**Goal**: Async, reliable Keycloak synchronization

**Create**:

```
src/services/user/sync/
├── UserSyncService.ts      (~300 lines) - Main sync logic
├── SyncQueue.ts            (~200 lines) - Retry mechanism
├── types.ts                (~50 lines)  - Sync types
├── index.ts                (~10 lines)
tests/services/user/sync/
├── UserSyncService.test.ts (~200 lines)
└── SyncQueue.test.ts       (~150 lines)
```

**Architecture**:

```typescript
export class UserSyncService {
  async syncCreate(user: User): Promise<void> {
    try {
      const kcFormat = KeycloakConverter.toKeycloakCreate(user);
      await this.keycloakClient.createUser(kcFormat);
    } catch (error) {
      // Add to retry queue
      await this.syncQueue.enqueue({
        operation: "CREATE",
        userId: user.id,
        data: user,
        attempts: 0,
      });
    }
  }

  async syncUpdate(user: User): Promise<void> {
    try {
      const kcFormat = KeycloakConverter.toKeycloakUpdate(user);
      await this.keycloakClient.updateUser(user.id, kcFormat);
    } catch (error) {
      await this.syncQueue.enqueue({
        operation: "UPDATE",
        userId: user.id,
        data: user,
        attempts: 0,
      });
    }
  }

  async processRetryQueue(): Promise<void> {
    const items = await this.syncQueue.getRetryable();

    for (const item of items) {
      try {
        await this.retrySync(item);
        await this.syncQueue.markSuccess(item.id);
      } catch (error) {
        await this.syncQueue.incrementAttempts(item.id);
      }
    }
  }
}
```

**Benefits**:

- Non-blocking user operations
- Automatic retry on failure
- Clear master/slave pattern
- Monitoring and observability

---

### Phase 5: Facade Refactor (2-3 days)

**Goal**: Clean up UserFacade to use new services

**Update**: Remove manual sync, use SyncService

**Example**:

```typescript
export class UserFacade {
  constructor(
    private readonly localRepo: LocalUserRepository,
    private readonly syncService: UserSyncService
  ) // ... other dependencies
  {}

  async createUser(input: unknown): Promise<User> {
    // Validate with Zod
    const validatedData = UserCreateInputSchema.parse(input);

    // Create in LOCAL DB (master, synchronous)
    const user = await this.localRepo.create(validatedData);

    // Sync to Keycloak (async, non-blocking)
    this.syncService.syncCreate(user).catch((error) => {
      this.logger.error("Async sync failed", { error, userId: user.id });
    });

    return user; // Return immediately, don't wait for Keycloak
  }
}
```

**Benefits**:

- Simpler facade code
- Clear responsibilities
- Non-blocking operations
- Better testability

---

### Phase 6: Cleanup & Documentation (1-2 days)

**Goal**: Final cleanup and comprehensive documentation

**Tasks**:

1. Remove deprecated code
2. Update all documentation
3. Add migration guide
4. Performance benchmarks
5. API documentation

---

## Comparison: Before vs After Rollback

### Lines of Code

| Phase     | Before (Deleted) | After (Revised)   | Savings           |
| --------- | ---------------- | ----------------- | ----------------- |
| Phase 2   | 1,227 lines      | 200 lines         | 84% reduction     |
| Phase 3   | 650 lines        | 0 lines (use Zod) | 100% savings      |
| **Total** | **1,877 lines**  | **200 lines**     | **89% reduction** |

### Test Lines

| Phase     | Before (Deleted) | After (Revised) | Savings       |
| --------- | ---------------- | --------------- | ------------- |
| Phase 2   | 540 lines        | 150 lines       | 72% reduction |
| Phase 3   | 540 lines        | 0 lines (reuse) | 100% savings  |
| **Total** | **1,080 lines**  | **150 lines**   | 86% reduction |

### Validation Logic

| Aspect                | Before (Custom)     | After (Zod from DB)                      |
| --------------------- | ------------------- | ---------------------------------------- |
| Email validation      | Custom regex        | `z.string().email()`                     |
| Password validation   | Custom min length   | `z.string().min(8)`                      |
| Username validation   | Custom length check | `z.string().min(3).max(50)`              |
| Phone validation      | Custom regex        | `z.string().regex(/^\+?[1-9]\d{1,14}$/)` |
| Status validation     | Custom enum check   | Zod enum validation                      |
| **Total custom code** | **650 lines**       | **0 lines** ✅                           |

---

## Success Metrics

### Code Quality

- ✅ Zero duplication with `@libs/database`
- ✅ Reuse existing Zod validation
- ✅ Only Keycloak-specific logic in keycloak-authV2
- ✅ 89% reduction in new code

### Architecture

- ✅ LOCAL DB = Master (source of truth)
- ✅ Keycloak = Slave (synchronized replica)
- ✅ Async sync with retry queue
- ✅ Non-blocking user operations

### Testing

- ✅ Phase 1: 21/21 tests passing
- ✅ Reuse existing Zod test coverage
- ✅ Only test Keycloak-specific conversions
- ✅ Integration tests for sync service

---

## Timeline

| Phase                | Estimate      | Focus                 |
| -------------------- | ------------- | --------------------- |
| Phase 2 (Converter)  | 2-4 hours     | Keycloak mapping only |
| Phase 3 (Validation) | 1-2 hours     | Use existing Zod      |
| Phase 4 (Sync)       | 2-3 days      | Async + retry queue   |
| Phase 5 (Facade)     | 2-3 days      | Clean refactor        |
| Phase 6 (Cleanup)    | 1-2 days      | Docs + deprecation    |
| **Total**            | **6-10 days** | Lean, focused         |

---

## Key Principles Going Forward

1. ✅ **Check existing infrastructure FIRST**
2. ✅ **Reuse before recreate**
3. ✅ **Validate with Zod schemas from database**
4. ✅ **Only create Keycloak-specific code**
5. ✅ **Master/Slave pattern: LOCAL DB → Keycloak**
6. ✅ **Async sync with retry mechanism**

---

## Ready to Continue

**Current Status**: Clean slate, Phase 1 complete, ready for lean Phase 2

**Next Action**: Create KeycloakConverter (~200 lines, 2-4 hours)

**Command**: "proceed with Phase 2 (KeycloakConverter)" when ready.
