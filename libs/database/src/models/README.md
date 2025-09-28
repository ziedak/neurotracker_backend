# Database Models

This directory contains the TypeScript type definitions and interfaces for the Neurotracker database schema. The models have been organized into a modular structure for better maintainability and organization.

## 🚨 **MANDATORY: Repository Pattern Enforcement**

**ALL database operations MUST use the repository layer.** Direct Prisma client usage is strictly prohibited in application code.

### ✅ **Correct Usage (Repository Pattern)**

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type { User, UserCreateInput } from "@libs/database/models";

// Get repository from factory
const userRepo = RepositoryFactory.getUserRepository();

// Use repository methods
const user = await userRepo.findById("user-123");
const newUser = await userRepo.create(userData);
```

### ❌ **Incorrect Usage (Direct Prisma - PROHIBITED)**

```typescript
// NEVER do this in application code
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({ where: { id: "123" } });
```

### **Why Repository Pattern?**

- **Clean Architecture** - Separation of concerns and business logic
- **Testability** - Easy mocking and testing
- **Consistency** - Standardized error handling and logging
- **Performance** - Built-in caching and optimization
- **Maintainability** - Centralized data access logic
- **Type Safety** - Enhanced type checking with repository methods

## 📁 Structure

```
models/
├── index.ts          # Main entry point - re-exports all types
├── types.ts          # Common type definitions and enums
├── store.ts          # Store-related interfaces
├── user.ts           # User, session, and authentication interfaces
├── commerce.ts       # Product, cart, order, and payment interfaces
├── analytics.ts      # Feature and notification interfaces
├── system.ts         # System configuration and quality interfaces
└── api.ts           # API key interfaces
```

## 🔧 Usage

### Importing Types

```typescript
// Import from main entry point (recommended)
import { User, Store, Product, Order } from "@libs/database/models";

// Or import from specific modules
import { User } from "@libs/database/models/user";
import { Store } from "@libs/database/models/store";
```

### Repository Pattern Usage

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  User,
  UserCreateInput,
  UserUpdateInput,
} from "@libs/database/models";

// Get repository instance
const userRepo = RepositoryFactory.getUserRepository();

// Create operations
const newUser = await userRepo.create({
  email: "user@example.com",
  username: "johndoe",
  password: "hashed_password",
  status: UserStatus.ACTIVE,
});

// Read operations
const user = await userRepo.findById("user-123");
const users = await userRepo.findMany({
  where: { status: UserStatus.ACTIVE },
  include: { roles: true },
});

// Update operations
const updatedUser = await userRepo.update("user-123", {
  lastLoginAt: new Date(),
  loginCount: { increment: 1 },
});

// Delete operations
await userRepo.delete("user-123");
```

### Repository Factory

```typescript
import { createRepositoryFactory } from "@libs/database/repositories";

// Create factory with dependencies
const factory = createRepositoryFactory({
  database: databaseClient,
  cache: cacheClient,
  metrics: metricsCollector,
  logger: loggerInstance,
});

// Get specific repositories
const userRepo = factory.getUserRepository();
const orderRepo = factory.getOrderRepository();
const productRepo = factory.getProductRepository();
```

### Type Definitions

#### Common Types

- `DecimalType` - Prisma Decimal type
- `StoreStatus` - ACTIVE | SUSPENDED | DELETED
- `UserStatus` - ACTIVE | BANNED | INACTIVE | DELETED
- `ProductStatus` - ACTIVE | INACTIVE | ARCHIVED | DELETED
- `OrderStatus` - PENDING | COMPLETED | CANCELLED | FAILED
- `PaymentStatus` - PENDING | COMPLETED | FAILED | REFUNDED
- `CartStatus` - ACTIVE | ABANDONED | CONVERTED | EXPIRED
- `ApiKeyStatus` - ACTIVE | REVOKED | EXPIRED

#### Event Types

- `EventType` - Predefined event types for tracking
- `UserRoleType` - User role classifications

## 📋 Interfaces

### Store Domain (`store.ts`)

- `Store` - Main store entity
- `StoreSettings` - Store configuration
- `RecoveryEvent` - Cart recovery events
- `Report` - Generated reports
- `SessionActivity` - User session activities
- `Webhook` - Webhook configurations

### User Domain (`user.ts`)

- `User` - User account information
- `Role` - User roles and permissions
- `RolePermission` - Granular permissions
- `UserSession` - User authentication sessions
- `SessionLog` - Session activity logs
- `UserEvent` - User interaction events

### Commerce Domain (`commerce.ts`)

- `Product` - Product catalog items
- `Cart` - Shopping cart entities
- `Order` - Order transactions
- `OrderItem` - Individual order line items
- `Payment` - Payment transactions
- `CartItem` - Cart contents

### Analytics Domain (`analytics.ts`)

- `Feature` - Computed features for ML/AI
- `Notification` - User notifications

### System Domain (`system.ts`)

- `Config` - System configuration
- `QualityValidation` - Data quality checks
- `QualityAnomaly` - Data quality issues
- `ReconciliationRule` - Data reconciliation rules
- `ReconciliationExecution` - Rule execution results
- `RepairOperation` - Data repair operations

### API Domain (`api.ts`)

- `ApiKey` - API key management

## 🔄 Migration from Monolithic Structure

The models were previously defined in a single large `index.ts` file. This modular structure provides:

### Benefits

- **Better Organization** - Related interfaces grouped logically
- **Easier Maintenance** - Smaller, focused files
- **Selective Imports** - Import only what you need
- **Reduced Coupling** - Clear separation of concerns
- **Better IDE Support** - Faster navigation and autocomplete

### Backward Compatibility

The main `index.ts` file re-exports all types, maintaining backward compatibility:

```typescript
// This still works
import { User, Store } from "@libs/database/models";
```

## 🛠️ Development Guidelines

### Repository Usage Requirements

**ALL database operations MUST go through repositories:**

```typescript
// ✅ Correct - Use repository
const userRepo = RepositoryFactory.getUserRepository();
const user = await userRepo.findById(userId);

// ❌ Incorrect - Direct database access
const user = await prisma.user.findUnique({ where: { id: userId } });
```

### Adding New Interfaces

1. **Determine the appropriate domain module** for the interface
2. **Add the interface** to the relevant model file
3. **Create or extend repository** with business logic methods
4. **Update repository exports** in `repositories/index.ts`
5. **Add repository factory method** if new repository class
6. **Update dependency injection** configuration

### Repository Creation Guidelines

#### When to Create a New Repository

- **New domain entity** with complex business logic
- **Specialized data access patterns** (reporting, analytics)
- **Cross-entity operations** requiring transactions
- **Performance-critical operations** needing custom optimization

#### When to Extend Existing Repository

- **Additional methods** on existing entity
- **Query variations** of existing data
- **Business logic extensions** to current domain

### Repository Method Naming Conventions

```typescript
// Standard CRUD operations
findById(id: string): Promise<T | null>
findMany(options: QueryOptions): Promise<T[]>
create(data: CreateInput): Promise<T>
update(id: string, data: UpdateInput): Promise<T>
delete(id: string): Promise<void>

// Domain-specific operations
findByEmail(email: string): Promise<T | null>
findActive(): Promise<T[]>
findByStatus(status: StatusEnum): Promise<T[]>
countActive(): Promise<number>

// Business operations
createWithRelated(data: CreateInput, related: RelatedInput[]): Promise<T>
updateStatus(id: string, status: StatusEnum): Promise<T>
archive(id: string): Promise<void>
```

### Error Handling in Repositories

```typescript
import { RepositoryError } from "@libs/database/repositories";

export class UserRepository extends BaseRepository<User> {
  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.db.user.findUnique({ where: { email } });
    } catch (error) {
      throw new RepositoryError(
        `Failed to find user by email: ${email}`,
        "findByEmail",
        "User",
        error
      );
    }
  }
}
```

### Testing Repository Methods

```typescript
describe("UserRepository", () => {
  let userRepo: UserRepository;
  let mockDb: jest.Mocked<DatabaseClient>;

  beforeEach(() => {
    mockDb = createMockDatabaseClient();
    userRepo = new UserRepository(mockDb, mockCache, mockMetrics, mockLogger);
  });

  it("should find user by email", async () => {
    const mockUser = { id: "1", email: "test@example.com" };
    mockDb.user.findUnique.mockResolvedValue(mockUser);

    const result = await userRepo.findByEmail("test@example.com");

    expect(result).toEqual(mockUser);
    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
  });
});
```

## 📊 Schema Relationships

```
Store (1) ──── (M) User
   │              │
   ├── (1) ──── (M) StoreSettings
   ├── (1) ──── (M) RecoveryEvent
   ├── (1) ──── (M) Report
   ├── (1) ──── (M) SessionActivity
   ├── (1) ──── (M) Webhook
   └── (1) ──── (M) ApiKey

User (1) ──── (M) UserSession
   │              │
   ├── (1) ──── (M) UserEvent
   ├── (1) ──── (M) Cart
   ├── (1) ──── (M) Order
   └── (1) ──── (M) Notification

Cart (1) ──── (M) CartItem
   │              │
   └── (1) ──── (M) Feature

Order (1) ──── (M) OrderItem
   │
   └── (1) ──── (M) Payment

Product (1) ──── (M) CartItem
   │
   └── (1) ──── (M) OrderItem
```

## 🔍 Repository Integration

All interfaces are designed to work seamlessly with the repository pattern:

### Repository Architecture

```typescript
// Repository base class provides common functionality
export class BaseRepository<T> {
  protected readonly db: DatabaseClient;
  protected readonly cache: ICache;
  protected readonly metrics: IMetricsCollector;
  protected readonly logger: ILogger;

  // Common CRUD operations
  async findById(id: string): Promise<T | null>;
  async findMany(options: QueryOptions): Promise<T[]>;
  async create(data: CreateInput): Promise<T>;
  async update(id: string, data: UpdateInput): Promise<T>;
  async delete(id: string): Promise<void>;
}
```

### Domain-Specific Repositories

Each domain has a dedicated repository with specialized methods:

```typescript
// User repository with authentication methods
class UserRepository extends BaseRepository<User> {
  async findByEmail(email: string): Promise<User | null>;
  async updateLastLogin(userId: string): Promise<User>;
  async getActiveSessions(userId: string): Promise<UserSession[]>;
}

// Commerce repository with business logic
class OrderRepository extends BaseRepository<Order> {
  async createWithItems(
    orderData: OrderCreateInput,
    items: OrderItemCreateInput[]
  ): Promise<Order>;
  async calculateTotal(orderId: string): Promise<DecimalType>;
  async updateStatus(orderId: string, status: OrderStatus): Promise<Order>;
}
```

### Internal Prisma Usage (Repository Layer Only)

**⚠️ WARNING: Prisma client usage is restricted to repository implementations only.**

```typescript
// This is ONLY allowed in repository classes
export class UserRepository extends BaseRepository<User> {
  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { email },
      include: { roles: true },
    });
  }
}
```

### Benefits of Repository Pattern

- **Business Logic Encapsulation** - Domain rules in repository methods
- **Caching Layer** - Automatic caching with TTL management
- **Metrics & Monitoring** - Built-in performance tracking
- **Error Handling** - Consistent error types and logging
- **Transaction Management** - Automatic transaction handling
- **Audit Trail** - Automatic logging of data changes

## 🧪 Testing

Models are tested through repository integration tests. Repository testing ensures type safety and correct integration.

### Repository Testing Guidelines

```typescript
import { createMockDatabaseClient } from "@libs/database/tests/mocks";
import { UserRepository } from "@libs/database/repositories";

describe("UserRepository", () => {
  let repository: UserRepository;
  let mockDb: jest.Mocked<DatabaseClient>;

  beforeEach(() => {
    mockDb = createMockDatabaseClient();
    repository = new UserRepository(mockDb, mockCache, mockMetrics, mockLogger);
  });

  describe("findByEmail", () => {
    it("should return user when found", async () => {
      const mockUser = createMockUser({ email: "test@example.com" });
      mockDb.user.findUnique.mockResolvedValue(mockUser);

      const result = await repository.findByEmail("test@example.com");

      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      const result = await repository.findByEmail("notfound@example.com");

      expect(result).toBeNull();
    });
  });
});
```

### Testing Checklist for New Repositories

- [ ] **Type Safety**: All methods use correct model types
- [ ] **Error Handling**: RepositoryError thrown for database errors
- [ ] **Input Validation**: Invalid inputs handled gracefully
- [ ] **Caching**: Cache integration tested where applicable
- [ ] **Metrics**: Performance metrics recorded correctly
- [ ] **Transactions**: Multi-step operations use transactions
- [ ] **Cross-References**: Related entity loading works correctly

### Mock Data Factories

```typescript
import {
  createMockUser,
  createMockStore,
} from "@libs/database/tests/factories";

const mockUser = createMockUser({
  email: "test@example.com",
  status: UserStatus.ACTIVE,
});

const mockStore = createMockStore({
  name: "Test Store",
  status: StoreStatus.ACTIVE,
});
```

### Integration Testing

```typescript
describe("User-Store Integration", () => {
  it("should create user with store relationship", async () => {
    const store = await storeRepo.create(mockStore);
    const user = await userRepo.create({
      ...mockUser,
      storeId: store.id,
    });

    expect(user.storeId).toBe(store.id);
  });
});
```

## 🏗️ Repository Pattern Best Practices

### Repository Layer Architecture

```
Application Layer
        ↓
Repository Layer (Business Logic)
        ↓
Database Layer (Prisma/SQL)
```

### Repository Responsibilities

1. **Data Access Logic** - CRUD operations and queries
2. **Business Rules** - Domain-specific validation and logic
3. **Caching** - Automatic cache management
4. **Metrics** - Performance monitoring and logging
5. **Error Handling** - Consistent error types and messages
6. **Transaction Management** - Multi-step operations

### Repository Anti-Patterns

#### ❌ **Direct Prisma Usage in Services**

```typescript
// DON'T DO THIS
export class UserService {
  constructor(private prisma: PrismaClient) {}

  async getUser(id: string) {
    return this.prisma.user.findUnique({ where: { id } }); // ❌ Direct access
  }
}
```

#### ✅ **Repository Usage in Services**

```typescript
// DO THIS INSTEAD
export class UserService {
  constructor(private userRepo: UserRepository) {}

  async getUser(id: string) {
    return this.userRepo.findById(id); // ✅ Repository pattern
  }
}
```

### Repository Method Design

#### Query Methods

```typescript
// Good: Specific, named methods
findByEmail(email: string): Promise<User | null>
findActiveUsers(): Promise<User[]>
findUsersCreatedAfter(date: Date): Promise<User[]>

// Bad: Generic methods with complex options
findUsers(options: ComplexQueryOptions): Promise<User[]>
```

#### Business Logic Methods

```typescript
// Good: Business operations encapsulate logic
createUserWithProfile(userData: UserCreateInput, profileData: ProfileInput): Promise<User>
activateUser(userId: string): Promise<User>
deactivateUser(userId: string, reason: string): Promise<User>

// Bad: Simple CRUD exposed as business logic
updateUserStatus(userId: string, status: UserStatus): Promise<User>
```

### Dependency Injection

```typescript
// Repository factory for clean dependency injection
export class RepositoryFactory {
  private static instance: RepositoryFactory;

  static getUserRepository(): UserRepository {
    return new UserRepository(this.db, this.cache, this.metrics, this.logger);
  }
}

// Usage in services
@Injectable()
export class UserService {
  constructor(@Inject(UserRepository) private userRepo: UserRepository) {}

  async getUser(id: string) {
    return this.userRepo.findById(id);
  }
}
```

### Performance Considerations

#### Caching Strategy

```typescript
export class UserRepository extends BaseRepository<User> {
  async findById(id: string): Promise<User | null> {
    // Automatic caching with TTL
    return this.cache.getOrSet(
      `user:${id}`,
      () => this.db.user.findUnique({ where: { id } }),
      { ttl: 300 } // 5 minutes
    );
  }
}
```

#### Query Optimization

```typescript
export class OrderRepository extends BaseRepository<Order> {
  async findOrdersWithItems(userId: string): Promise<Order[]> {
    // Single query with includes instead of N+1
    return this.db.order.findMany({
      where: { userId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
  }
}
```

### Error Handling Patterns

```typescript
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly entity: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

// Usage in repositories
throw new RepositoryError(
  `User with email ${email} not found`,
  "findByEmail",
  "User"
);
```

### Transaction Management

````typescript
export class OrderRepository extends BaseRepository<Order> {
  async createOrderWithItems(orderData: OrderCreateInput, items: OrderItemCreateInput[]): Promise<Order> {
    return this.db.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({ data: orderData });

      // Create order items
      for (const item of items) {
        await tx.orderItem.create({
          data: { ...item, orderId: order.id }
        });
      }

      return order;
    });
  }
}
```</content>
   <parameter name="filePath">/home/zied/workspace/backend/libs/database/src/models/README.md
````
