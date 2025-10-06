# User Services - Current vs Proposed Architecture

## Current Architecture (❌ Problematic)

```
┌──────────────────────────────────────────────────────────┐
│                 UserManagementService                     │
│  (Confusing: bridges local + remote, mixed concerns)    │
│                                                           │
│  - validateUserUniqueness() checks BOTH systems          │
│  - Manual sync after each operation                      │
│  - Rollback logic scattered                              │
│  - Reaches into internals with (as any)                  │
└───────────┬──────────────────────────┬───────────────────┘
            │                          │
            │                          │
     ┌──────▼──────────┐        ┌─────▼────────────┐
     │  UserService    │        │ LocalUserRepo    │
     │  (Keycloak)     │        │  (Database)      │
     │                 │        │                  │
     │ - Wraps         │        │ - Prisma calls   │
     │   UserRepo      │        │ - Direct DB      │
     └────────┬────────┘        └──────────────────┘
              │
     ┌────────▼─────────┐
     │  UserRepository  │  ← ❌ CONFUSING NAME!
     │  (Wraps KC API)  │     (Sounds like DB but calls remote API)
     │                  │
     │ - Caches         │
     │ - API calls      │
     └────────┬─────────┘
              │
     ┌────────▼──────────┐
     │ IKeycloakApiClient│  ← ❌ Missing implementation!
     │   (Interface)     │     (Where is the actual class?)
     └───────────────────┘
```

### Issues Highlighted:

1. **Naming Confusion**:

   - `UserRepository` sounds like it accesses local DB
   - Actually calls remote Keycloak API
   - Another `UserRepository` exists in `@libs/database`
   - Developers must use aliasing: `import { UserRepository as LocalUserRepository }`

2. **Mixed Concerns**:

   - UserManagementService handles BOTH local and remote
   - No clear boundary
   - Validation in both systems
   - Manual sync required

3. **Missing Implementation**:

   - `IKeycloakApiClient` interface exists
   - But no concrete implementation found
   - How does this work?

4. **Abstraction Violation**:
   ```typescript
   // ❌ Reaching into internals!
   const apiClient = (this.UserService as any).userRepository.apiClient;
   ```

---

## Proposed Architecture (✅ Clean)

```
┌──────────────────────────────────────────────────────────┐
│                      UserFacade                           │
│         (Single entry point - Public API)                │
│                                                           │
│  ✅ Clear responsibilities                                │
│  ✅ Enforces: Local DB = Source of Truth                 │
│  ✅ No manual sync (uses SyncService)                    │
└───────────┬──────────────────────────┬───────────────────┘
            │                          │
            │                          │
     ┌──────▼────────────┐      ┌─────▼────────────────┐
     │ LocalUserRepo     │      │  UserSyncService     │
     │   (MASTER)        │      │     (SLAVE)          │
     │                   │      │                      │
     │ ✅ PostgreSQL     │      │ ✅ Async sync        │
     │ ✅ Validation     │      │ ✅ Retry queue       │
     │ ✅ Source of      │      │ ✅ One-way only      │
     │    truth          │      │                      │
     └───────────────────┘      └──────┬───────────────┘
                                       │
                                       │
                                ┌──────▼───────────────┐
                                │ KeycloakUserClient   │
                                │   (Auth slave)       │
                                │                      │
                                │ ✅ Clear name        │
                                │ ✅ REST API calls    │
                                │ ✅ Credentials       │
                                └──────────────────────┘

Supporting Services (Horizontal):
┌─────────────────────────────────────────────────────────┐
│  UserValidationService    │  UserConverters             │
│  - Centralized validation │  - Type conversions         │
│  - Single source          │  - Explicit boundaries      │
└─────────────────────────────────────────────────────────┘
```

### Improvements:

1. **Clear Naming**:

   - `KeycloakUserClient` → Obviously remote API
   - `LocalUserRepository` → Obviously local DB
   - `UserSyncService` → Obviously handles sync
   - `UserFacade` → Obviously public API

2. **Single Responsibility**:

   - Each service has ONE clear job
   - No mixed concerns
   - Easy to test in isolation

3. **Enforced Source of Truth**:

   - LocalUserRepo = Master (always read from here)
   - KeycloakUserClient = Slave (sync to here)
   - One-way sync only (DB → Keycloak)
   - Architecture prevents violations

4. **No Abstraction Violations**:
   - Each service uses public interfaces only
   - No reaching into internals
   - Proper dependency injection

---

## Data Flow Comparison

### Current Flow (❌ Bidirectional, Confusing)

```
┌─────────────┐     validate    ┌──────────────┐
│  Keycloak   │◄───────────────►│   Local DB   │
│             │     validate    │              │
│             │                 │              │
│             │◄────sync────────┤              │
│             │                 │              │
│             ├────sync────────►│              │
└─────────────┘                 └──────────────┘

❌ Problems:
- Bidirectional sync (confusing)
- Validate in both (redundant)
- No clear master
- Sync can fail in either direction
```

### Proposed Flow (✅ Unidirectional, Clear)

```
┌─────────────┐                 ┌──────────────┐
│  Keycloak   │                 │   Local DB   │
│   (Slave)   │◄────async sync──┤   (Master)   │
│             │                 │              │
│ - Auth only │                 │ - All data   │
│ - Sessions  │                 │ - Validation │
│ - Tokens    │                 │ - Source of  │
│             │                 │   truth      │
└─────────────┘                 └──────────────┘

✅ Benefits:
- One-way sync (clear)
- Validate once (efficient)
- Clear master (Local DB)
- Sync failures don't block operations
- Retry mechanism handles failures
```

---

## Type System Comparison

### Current Types (❌ Three inconsistent types)

```typescript
// Type 1: KeycloakUser
interface KeycloakUser {
  id?: string | undefined;
  username: string;
  email?: string | undefined;
  enabled?: boolean | undefined;
  // ...
}

// Type 2: User (local DB)
interface User {
  id: string;
  username: string;
  email: string;  // ← Required here
  status: "ACTIVE" | "INACTIVE";  // ← Different from enabled
  storeId?: string;  // ← Not in KeycloakUser
  // ...
}

// Type 3: UserInfo
interface UserInfo {
  id: string;
  username: string | undefined;  // ← Inconsistent nullability
  email: string | undefined;
  roles: string[];  // ← Not in other types
  // ...
}

❌ Problems:
- Three different types
- Inconsistent nullability
- Different field names (enabled vs status)
- No clear conversion rules
```

### Proposed Types (✅ Single domain model)

```typescript
// Single Domain Model
interface UserDomainModel {
  id: string;
  username: string;
  email: string | null;  // Consistent nullability
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  enabled: boolean;  // Computed from status
  emailVerified: boolean;

  // Relations (only in local DB)
  storeId: string | null;
  organizationId: string | null;
  roleId: string | null;

  // Audit (only in local DB)
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

// Persistence Adapters (explicit boundaries)
namespace Persistence {
  type LocalUser = User;  // From Prisma

  interface KeycloakUser {
    id: string;
    username: string;
    email?: string;
    enabled: boolean;
    // ...
  }
}

// Explicit Converters
class UserConverters {
  static toLocal(domain: UserDomainModel): Persistence.LocalUser {...}
  static fromLocal(local: Persistence.LocalUser): UserDomainModel {...}
  static toKeycloak(domain: UserDomainModel): Persistence.KeycloakUser {...}
  static fromKeycloak(kc: Persistence.KeycloakUser): Partial<UserDomainModel> {...}
}

✅ Benefits:
- Single source of truth for structure
- Explicit conversion boundaries
- Consistent nullability rules
- Clear what belongs where
```

---

## Operation Flow Examples

### Example 1: Create User

#### Current Flow (❌ Complex, Error-Prone)

```typescript
async registerUser(data: RegisterUserInput): Promise<User> {
  // ❌ Validate in BOTH systems
  await this.validateUserUniqueness(data.username, data.email);
  //     ↓ checks local DB
  //     ↓ checks Keycloak

  // Create in local DB
  const localUser = await this.localUserRepository.create(data);

  try {
    // Create in Keycloak
    await this.createKeycloakUserWithId(localUser.id, data);
    //   ↑ Uses (as any) to reach into internals ❌

    return localUser;
  } catch (error) {
    // ❌ Manual rollback
    await this.localUserRepository.deleteById(localUser.id);
    throw error;
  }
}
```

**Issues**:

- Validates in both systems (slow, redundant)
- Blocks on Keycloak creation
- Manual rollback logic
- Abstraction violation with `(as any)`

#### Proposed Flow (✅ Simple, Reliable)

```typescript
async createUser(data: CreateUserInput): Promise<UserDomainModel> {
  // ✅ Validate ONCE in local DB (source of truth)
  await this.validation.validateCreate(data);

  // ✅ Create in LOCAL DB (master)
  const user = await this.localRepo.create(data);

  // ✅ Async sync to Keycloak (doesn't block)
  this.syncService.syncUserCreation(user).catch(error => {
    this.logger.error("Keycloak sync failed, queued for retry", { error });
    this.retryQueue.add({ userId: user.id, operation: 'create' });
  });

  return user;
}
```

**Benefits**:

- Single validation (fast)
- Doesn't block on Keycloak
- Automatic retry on failure
- Clean abstraction

---

### Example 2: Get User

#### Current Flow (❌ Confusing)

```typescript
// Sometimes returns from LOCAL DB
async getUserById(userId: string): Promise<User | null> {
  return await this.localUserRepository.findById(userId);
}

// Sometimes returns from KEYCLOAK
async getUserInfo(userId: string): Promise<UserInfo | null> {
  const keycloakUser = await this.UserService.getUserById(userId);
  // Convert KeycloakUser to UserInfo...
}
```

**Issues**:

- Two different methods for "get user"
- Returns different types
- Unclear which to use when
- No clear source of truth

#### Proposed Flow (✅ Always Local DB)

```typescript
async getUser(userId: string): Promise<UserDomainModel | null> {
  // ✅ ALWAYS read from LOCAL DB (source of truth)
  const localUser = await this.localRepo.findById(userId);

  if (!localUser) return null;

  // ✅ Convert to domain model
  return UserConverters.fromLocal(localUser);
}

async getUserWithAuth(userId: string): Promise<UserWithAuthInfo | null> {
  // Get user from local DB
  const user = await this.getUser(userId);
  if (!user) return null;

  // Optionally enrich with auth info from Keycloak
  const authInfo = await this.keycloakAuth.getAuthInfo(userId);

  return { ...user, authInfo };
}
```

**Benefits**:

- Single source of truth enforced
- Clear which method to use
- Consistent return types
- Optional auth enrichment

---

### Example 3: Update User

#### Current Flow (❌ Manual Sync)

```typescript
async updateUser(userId: string, data: UserUpdateInput): Promise<User> {
  // Update in LOCAL DB
  const user = await this.localUserRepository.updateById(userId, data);

  // ❌ Manually build Keycloak updates
  const keycloakUpdates: Partial<UpdateUserOptions> = {};
  if (typeof data.email === "string") keycloakUpdates.email = data.email;
  if (typeof data.firstName === "string") keycloakUpdates.firstName = data.firstName;
  // ... more manual mapping

  // ❌ Manually sync (might forget fields)
  if (Object.keys(keycloakUpdates).length > 0) {
    try {
      await this.UserService.updateUser(userId, keycloakUpdates);
    } catch (error) {
      this.logger.warn("Keycloak sync failed (non-critical)");
      // ❌ Systems now out of sync!
    }
  }

  return user;
}
```

**Issues**:

- Manual field mapping (error-prone)
- Can forget to sync fields
- Sync failure ignored ("non-critical")
- Systems can become inconsistent

#### Proposed Flow (✅ Automatic Sync)

```typescript
async updateUser(userId: string, data: UpdateUserInput): Promise<UserDomainModel> {
  // ✅ Update in LOCAL DB (master)
  const user = await this.localRepo.update(userId, data);

  // ✅ Automatic sync to Keycloak (doesn't block)
  this.syncService.syncUserUpdate(user).catch(error => {
    this.logger.error("Keycloak sync failed, queued for retry", { error });
    this.retryQueue.add({ userId, operation: 'update', data: user });
  });

  return UserConverters.fromLocal(user);
}

// In UserSyncService
async syncUserUpdate(user: UserDomainModel): Promise<void> {
  // ✅ Automatic conversion (no manual mapping)
  const keycloakData = UserConverters.toKeycloak(user);

  // ✅ All fields synced automatically
  await this.keycloakClient.updateUser(user.id, keycloakData);
}
```

**Benefits**:

- Automatic field mapping
- Can't forget fields
- Retry on failure
- Consistent state

---

## Testing Comparison

### Current Testing (❌ Complex)

```typescript
describe("UserManagementService", () => {
  it("should create user", async () => {
    // ❌ Must mock multiple systems
    const mockKeycloakClient = createMockKeycloakClient();
    const mockUserService = createMockUserService();
    const mockLocalRepo = createMockLocalRepo();

    // ❌ Must set up complex mock chains
    mockUserService.getUserByUsername.mockResolvedValue(null);
    mockLocalRepo.findByUsername.mockResolvedValue(null);
    mockLocalRepo.create.mockResolvedValue(mockUser);

    // ❌ Must mock internal property access
    (mockUserService as any).userRepository = {
      apiClient: { createUser: jest.fn() },
    };

    // Test...
  });
});
```

### Proposed Testing (✅ Simple)

```typescript
describe("UserFacade", () => {
  it("should create user", async () => {
    // ✅ Mock only what service directly uses
    const mockLocalRepo = createMockLocalRepo();
    const mockSyncService = createMockSyncService();
    const mockValidation = createMockValidation();

    // ✅ Simple mocks
    mockValidation.validateCreate.mockResolvedValue({
      isValid: true,
      errors: [],
    });
    mockLocalRepo.create.mockResolvedValue(mockUser);

    // ✅ Test
    const result = await facade.createUser(input);

    expect(result).toEqual(mockUser);
    expect(mockSyncService.syncUserCreation).toHaveBeenCalledWith(mockUser);
  });
});
```

---

## Summary of Benefits

| Aspect              | Current (❌)                  | Proposed (✅)                             |
| ------------------- | ----------------------------- | ----------------------------------------- |
| **Naming**          | Confusing (2x UserRepository) | Clear (KeycloakUserClient, LocalUserRepo) |
| **Separation**      | Mixed local + remote          | Clear boundaries                          |
| **Source of Truth** | Unclear, checks both          | Enforced: Local DB = Master               |
| **Validation**      | Redundant (2 systems)         | Centralized (1 place)                     |
| **Sync**            | Manual, blocking              | Automatic, async with retry               |
| **Types**           | 3 inconsistent types          | 1 domain model + converters               |
| **Abstractions**    | Violations with `(as any)`    | Clean interfaces                          |
| **Testing**         | Complex mocking               | Simple, isolated                          |
| **Reliability**     | Systems can diverge           | Retry ensures consistency                 |
| **Performance**     | Blocks on Keycloak            | Async, non-blocking                       |

---

## Migration Path Visual

```
Phase 1: Rename (Quick Win - 1-2 days)
┌────────────────────┐
│ UserRepository     │───rename───►┌───────────────────────┐
│ (Keycloak API)     │             │ KeycloakUserClient    │
└────────────────────┘             └───────────────────────┘

┌────────────────────┐
│ userService        │───rename───►┌───────────────────────┐
│ (Keycloak ops)     │             │ KeycloakUserService   │
└────────────────────┘             └───────────────────────┘

┌────────────────────┐
│ UserMgmtService    │───rename───►┌───────────────────────┐
│ (Bridge both)      │             │ UserFacade            │
└────────────────────┘             └───────────────────────┘

Phase 2: Add Domain Model (2-3 days)
┌────────────────────────────────┐
│    UserDomainModel             │  ← Single type
│    UserConverters              │  ← Explicit conversions
└────────────────────────────────┘

Phase 3: Centralize Validation (1-2 days)
┌────────────────────────────────┐
│  UserValidationService         │  ← All validation here
└────────────────────────────────┘

Phase 4: Add Sync Service (3-4 days)
┌────────────────────────────────┐
│    UserSyncService             │  ← Async sync
│    RetryQueue                  │  ← Handle failures
└────────────────────────────────┘

Phase 5: Refactor Facade (2-3 days)
┌────────────────────────────────┐
│     UserFacade                 │  ← Use new services
│  - LocalUserRepo (master)      │
│  - UserSyncService (slave)     │
│  - ValidationService           │
└────────────────────────────────┘
```

**Total**: 10-16 days for complete migration

---

_Generated: October 6, 2025_  
_This document visualizes the current problems and proposed solutions_
