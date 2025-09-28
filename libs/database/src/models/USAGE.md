# Database Models Usage Examples

This document provides practical examples of how to use the modular database models in the Neurotracker backend.

## � **MANDATORY: Repository Pattern Usage**

**ALL database operations MUST use the repository layer.** Direct database access is strictly prohibited.

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

### ❌ **Incorrect Usage (Direct Database - PROHIBITED)**

```typescript
// NEVER do this in application code
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({ where: { id: "123" } });
```

## �📥 Importing Types

### Recommended: Import from Main Entry Point

```typescript
import {
  User,
  Store,
  Product,
  Order,
  Cart,
  UserStatus,
  OrderStatus,
} from "@libs/database/models";
```

### Selective Imports (Better Tree Shaking)

```typescript
// Import only what you need
import type { User, UserSession } from "@libs/database/models/user";
import type { Store, StoreSettings } from "@libs/database/models/store";
import type { Product, Cart, Order } from "@libs/database/models/commerce";
import { UserStatus, OrderStatus } from "@libs/database/models/types";
```

## 🏪 Store Operations

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  Store,
  StoreStatus,
  StoreSettings,
  StoreCreateInput,
  StoreUpdateInput,
} from "@libs/database/models";

const storeRepo = RepositoryFactory.getStoreRepository();

async function createStore(storeData: StoreCreateInput): Promise<Store> {
  return await storeRepo.create({
    name: storeData.name,
    domain: storeData.domain,
    status: StoreStatus.ACTIVE,
    settings: {
      currency: "USD",
      timezone: "UTC",
      language: "en",
      // ... other default settings
    },
  });
}

async function updateStoreSettings(
  storeId: string,
  settings: Partial<StoreSettings>
): Promise<StoreSettings> {
  // Get current store with settings
  const store = await storeRepo.findById(storeId, {
    include: { settings: true },
  });

  if (!store || !store.settings) {
    throw new Error("Store or settings not found");
  }

  // Update settings
  const updatedSettings = await storeRepo.updateSettings(storeId, {
    ...store.settings,
    ...settings,
  });

  return updatedSettings;
}

async function getActiveStores(): Promise<Store[]> {
  return await storeRepo.findMany({
    where: { status: StoreStatus.ACTIVE },
    include: { settings: true },
  });
}
```

## 👤 User Management

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  User,
  UserStatus,
  UserSession,
  UserCreateInput,
  UserUpdateInput,
} from "@libs/database/models";

const userRepo = RepositoryFactory.getUserRepository();
const sessionRepo = RepositoryFactory.getUserSessionRepository();

interface CreateUserRequest {
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  password: string;
}

async function createUser(request: CreateUserRequest): Promise<User> {
  // Hash password (implementation depends on your auth library)
  const hashedPassword = await hashPassword(request.password);

  const userData: UserCreateInput = {
    email: request.email,
    username: request.username,
    firstName: request.firstName,
    lastName: request.lastName,
    password: hashedPassword,
    status: UserStatus.ACTIVE,
    emailVerified: false,
    phoneVerified: false,
    loginCount: 0,
    isDeleted: false,
  };

  return await userRepo.create(userData);
}

async function authenticateUser(
  email: string,
  password: string
): Promise<UserSession | null> {
  // Find user by email
  const user = await userRepo.findByEmail(email, {
    include: { sessions: { where: { isActive: true } } },
  });

  if (!user || !(await verifyPassword(password, user.password))) {
    return null;
  }

  // Create new session
  const sessionData = {
    userId: user.id,
    sessionId: generateSessionId(),
    isActive: true,
    ipAddress: getClientIP(),
    userAgent: getUserAgent(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  };

  const session = await sessionRepo.create(sessionData);

  // Update user's last login
  await userRepo.updateLastLogin(user.id);

  return session;
}

async function getUserProfile(userId: string): Promise<User | null> {
  return await userRepo.findById(userId, {
    include: {
      roles: true,
      store: true,
      sessions: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}
```

## 🛒 Commerce Operations

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  Product,
  Cart,
  Order,
  OrderStatus,
  PaymentStatus,
  CartCreateInput,
  OrderCreateInput,
  OrderItemCreateInput,
} from "@libs/database/models";

const cartRepo = RepositoryFactory.getCartRepository();
const orderRepo = RepositoryFactory.getOrderRepository();
const productRepo = RepositoryFactory.getProductRepository();
const orderItemRepo = RepositoryFactory.getOrderItemRepository();

async function addToCart(
  userId: string,
  productId: string,
  quantity: number
): Promise<Cart> {
  // Find or create active cart for user
  let cart = await cartRepo.findFirst({
    where: { userId, status: "ACTIVE" },
  });

  if (!cart) {
    const cartData: CartCreateInput = {
      userId,
      status: "ACTIVE",
      total: 0,
      currency: "USD",
    };
    cart = await cartRepo.create(cartData);
  }

  // Get product details
  const product = await productRepo.findById(productId);
  if (!product) {
    throw new Error("Product not found");
  }

  // Add item to cart (this would typically be handled by a cart service)
  // For simplicity, showing direct repository usage
  const cartItem = await cartRepo.addItem(cart.id, {
    productId,
    quantity,
    price: product.price,
  });

  // Recalculate cart total
  const updatedCart = await cartRepo.recalculateTotal(cart.id);

  return updatedCart;
}

async function createOrder(
  cartId: string,
  paymentMethod: string
): Promise<Order> {
  // Get cart with items
  const cart = await cartRepo.findById(cartId, {
    include: { items: true, user: true },
  });

  if (!cart) {
    throw new Error("Cart not found");
  }

  // Create order with items in a transaction
  const order = await orderRepo.createWithItems(
    {
      cartId,
      userId: cart.userId,
      status: OrderStatus.PENDING,
      total: cart.total,
      currency: cart.currency,
      paymentMethod,
    },
    cart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    }))
  );

  // Mark cart as converted
  await cartRepo.updateStatus(cartId, "CONVERTED");

  return order;
}

async function processPayment(
  orderId: string,
  paymentData: any
): Promise<Order> {
  const order = await orderRepo.findById(orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  // Process payment (implementation depends on payment provider)
  const paymentResult = await processPaymentWithProvider(paymentData);

  if (paymentResult.success) {
    // Update order status
    const updatedOrder = await orderRepo.updateStatus(
      orderId,
      OrderStatus.COMPLETED
    );

    // Create payment record
    await orderRepo.createPayment(orderId, {
      amount: order.total,
      currency: order.currency,
      method: order.paymentMethod,
      status: PaymentStatus.COMPLETED,
      transactionId: paymentResult.transactionId,
    });

    return updatedOrder;
  } else {
    // Payment failed
    await orderRepo.updateStatus(orderId, OrderStatus.FAILED);
    throw new Error("Payment processing failed");
  }
}
```

## 📊 Analytics & Features

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  Feature,
  Notification,
  FeatureCreateInput,
  NotificationCreateInput,
} from "@libs/database/models";

const featureRepo = RepositoryFactory.getFeatureRepository();
const notificationRepo = RepositoryFactory.getNotificationRepository();

async function computeCartFeatures(cartId: string): Promise<Feature[]> {
  // Get cart with items and user data
  const cart = await cartRepo.findById(cartId, {
    include: { items: true, user: true },
  });

  if (!cart) {
    throw new Error("Cart not found");
  }

  const features: FeatureCreateInput[] = [
    {
      cartId,
      name: "item_count",
      value: cart.items.length,
      version: "1.0",
      description: "Total number of items in cart",
    },
    {
      cartId,
      name: "total_value",
      value: Number(cart.total),
      version: "1.0",
      description: "Total cart value",
    },
    {
      cartId,
      name: "avg_item_price",
      value:
        cart.items.length > 0
          ? cart.items.reduce((sum, item) => sum + Number(item.price), 0) /
            cart.items.length
          : 0,
      version: "1.0",
      description: "Average price per item",
    },
    {
      cartId,
      name: "user_engagement_score",
      value: calculateEngagementScore(cart.user),
      version: "1.0",
      description: "User engagement score based on activity",
    },
  ];

  // Create features in batch
  return await featureRepo.createMany(features);
}

async function sendNotification(
  userId: string,
  type: string,
  message: string
): Promise<Notification> {
  const notificationData: NotificationCreateInput = {
    userId,
    type,
    message,
    read: false,
    priority: "normal",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  };

  return await notificationRepo.create(notificationData);
}

async function getUserNotifications(
  userId: string,
  unreadOnly: boolean = false
): Promise<Notification[]> {
  const where: any = { userId };
  if (unreadOnly) {
    where.read = false;
  }

  return await notificationRepo.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

async function markNotificationAsRead(
  notificationId: string
): Promise<Notification> {
  return await notificationRepo.markAsRead(notificationId);
}
```

## 🔑 API Key Management

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  ApiKey,
  ApiKeyStatus,
  ApiKeyCreateInput,
} from "@libs/database/models";

const apiKeyRepo = RepositoryFactory.getApiKeyRepository();

async function createApiKey(
  userId: string,
  name: string,
  scopes: string[]
): Promise<ApiKey> {
  // Generate secure key components
  const keyIdentifier = generateSecureToken(16); // Public identifier
  const keySecret = generateSecureToken(32); // Secret part
  const keyHash = await hashApiKey(keySecret); // Hashed for storage

  const apiKeyData: ApiKeyCreateInput = {
    name,
    keyHash,
    keyIdentifier,
    keyPreview: `${keyIdentifier}...`,
    userId,
    scopes,
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    rateLimit: 1000, // requests per hour
  };

  const apiKey = await apiKeyRepo.create(apiKeyData);

  // Return the key with the secret (only time it's available)
  return {
    ...apiKey,
    keySecret: `${keyIdentifier}.${keySecret}`, // Full key for client
  };
}

async function validateApiKey(keyHash: string): Promise<ApiKey | null> {
  return await apiKeyRepo.findByHash(keyHash, {
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

async function revokeApiKey(apiKeyId: string, userId: string): Promise<ApiKey> {
  // Verify ownership
  const apiKey = await apiKeyRepo.findById(apiKeyId);
  if (!apiKey || apiKey.userId !== userId) {
    throw new Error("API key not found or access denied");
  }

  return await apiKeyRepo.updateStatus(apiKeyId, ApiKeyStatus.REVOKED);
}

async function getUserApiKeys(userId: string): Promise<ApiKey[]> {
  return await apiKeyRepo.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

async function updateApiKeyUsage(apiKeyId: string): Promise<void> {
  await apiKeyRepo.incrementUsage(apiKeyId);
}
```

## 🔧 System Operations

```typescript
import { RepositoryFactory } from "@libs/database/repositories";
import type {
  QualityValidation,
  ReconciliationRule,
  QualityValidationCreateInput,
} from "@libs/database/models";

const qualityRepo = RepositoryFactory.getQualityValidationRepository();
const reconciliationRepo = RepositoryFactory.getReconciliationRuleRepository();

async function runQualityCheck(
  tableName: string,
  checkType: string
): Promise<QualityValidation> {
  // Perform quality check (implementation depends on check type)
  const result = await performQualityCheck(tableName, checkType);

  const validationData: QualityValidationCreateInput = {
    tableName,
    checkType,
    checkName: `${tableName}_${checkType}`,
    status: result.passed ? "PASSED" : "FAILED",
    severity: result.severity || "medium",
    details: result.details,
    affectedRows: result.affectedRows,
    executionTime: result.executionTime,
    executedAt: new Date(),
  };

  return await qualityRepo.create(validationData);
}

async function createReconciliationRule(
  sourceTable: string,
  targetTable: string,
  joinKey: string
): Promise<ReconciliationRule> {
  const ruleData = {
    name: `${sourceTable}_vs_${targetTable}`,
    sourceTable,
    targetTable,
    joinKey,
    enabled: true,
    schedule: "daily",
    tolerance: 0.01, // 1% tolerance for numeric comparisons
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
  };

  return await reconciliationRepo.create(ruleData);
}

async function getFailedQualityChecks(
  since: Date
): Promise<QualityValidation[]> {
  return await qualityRepo.findMany({
    where: {
      status: "FAILED",
      executedAt: { gte: since },
    },
    orderBy: { executedAt: "desc" },
  });
}

async function getActiveReconciliationRules(): Promise<ReconciliationRule[]> {
  return await reconciliationRepo.findMany({
    where: { enabled: true },
    orderBy: { nextRunAt: "asc" },
  });
}
```

## 🎯 Type Guards and Utilities

```typescript
import { UserStatus, OrderStatus } from "@libs/database/models";

// Type guards
export function isActiveUser(user: { status: UserStatus }): boolean {
  return user.status === UserStatus.ACTIVE;
}

export function isCompletedOrder(order: { status: OrderStatus }): boolean {
  return order.status === OrderStatus.COMPLETED;
}

// Utility types
export type UserCreateInput = Omit<
  User,
  "id" | "createdAt" | "updatedAt" | "loginCount"
>;
export type OrderUpdateInput = Partial<Pick<Order, "status" | "completedAt">>;

// Validation helpers
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateOrderStatusTransition(
  current: OrderStatus,
  next: OrderStatus
): boolean {
  const validTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.FAILED]: [OrderStatus.PENDING],
  };

  return validTransitions[current]?.includes(next) ?? false;
}
```

## 🔄 Integration with Database Clients

### Repository Factory Usage

```typescript
import { createRepositoryFactory } from "@libs/database/repositories";

// Create factory with dependencies (typically done in DI container)
const factory = createRepositoryFactory({
  database: databaseClient,
  cache: redisCache,
  metrics: prometheusMetrics,
  logger: structuredLogger,
});

// Get repositories from factory
const userRepo = factory.getUserRepository();
const orderRepo = factory.getOrderRepository();
const analyticsRepo = factory.getAnalyticsRepository();
```

### Service Layer Integration

```typescript
// UserService using repository pattern
export class UserService {
  constructor(
    private userRepo: UserRepository,
    private sessionRepo: UserSessionRepository,
    private metrics: MetricsCollector
  ) {}

  async authenticateUser(
    email: string,
    password: string
  ): Promise<UserSession> {
    const timer = this.metrics.startTimer("user_authentication");

    try {
      const user = await this.userRepo.findByEmail(email);
      if (!user || !(await verifyPassword(password, user.password))) {
        throw new AuthenticationError("Invalid credentials");
      }

      const session = await this.sessionRepo.create({
        userId: user.id,
        sessionId: generateSessionId(),
        isActive: true,
      });

      await this.userRepo.updateLastLogin(user.id);

      this.metrics.increment("user_login_success");
      return session;
    } catch (error) {
      this.metrics.increment("user_login_failure");
      throw error;
    } finally {
      timer.end();
    }
  }
}
```

### Analytics Integration

```typescript
import { ClickHouseClient } from "@libs/database";

export class AnalyticsService {
  constructor(
    private clickhouse: ClickHouseClient,
    private featureRepo: FeatureRepository
  ) {}

  async trackUserEvent(event: UserEvent): Promise<void> {
    // Store in ClickHouse for analytics
    await this.clickhouse.insert("user_events", [
      {
        user_id: event.userId,
        session_id: event.sessionId,
        event_type: event.eventType,
        metadata: JSON.stringify(event.metadata),
        page_url: event.pageUrl,
        user_agent: event.userAgent,
        ip_address: event.ipAddress,
        is_error: event.isError,
        error_msg: event.errorMsg,
        timestamp: event.timestamp,
      },
    ]);

    // Store features in PostgreSQL via repository
    if (event.metadata?.cartId) {
      await this.featureRepo.create({
        cartId: event.metadata.cartId,
        name: "user_interaction",
        value: event.eventType,
        version: "1.0",
      });
    }
  }
}
```

### Transaction Management

```typescript
export class OrderService {
  constructor(
    private orderRepo: OrderRepository,
    private inventoryRepo: InventoryRepository
  ) {}

  async placeOrder(orderData: OrderCreateInput): Promise<Order> {
    // Use repository's transactional method
    return await this.orderRepo.createWithInventoryCheck(
      orderData,
      async (order) => {
        // Reserve inventory
        await this.inventoryRepo.reserveItems(order.items);

        // Process payment
        await this.paymentService.charge(order);

        // Send confirmation
        await this.notificationService.sendOrderConfirmation(order);
      }
    );
  }
}
```

This modular structure makes it easy to:

- Import only the types you need
- Maintain clear separation of concerns
- Scale the codebase as it grows
- Ensure type safety across the application
- **MANDATORILY use repository patterns for all database operations**</content>
  <parameter name="filePath">/home/zied/workspace/backend/libs/database/src/models/USAGE.md
