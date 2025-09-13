# PostgreSQL Client Usage Examples

This directory contains practical examples for using the PostgreSQL client library in various scenarios.

## Table of Contents

- [Basic Setup](#basic-setup)
- [CRUD Operations](#crud-operations)
- [Advanced Queries](#advanced-queries)
- [Caching Examples](#caching-examples)
- [Transaction Examples](#transaction-examples)
- [Batch Operations](#batch-operations)
- [Connection Pooling](#connection-pooling)
- [Error Handling](#error-handling)
- [Monitoring & Metrics](#monitoring--metrics)
- [Performance Optimization](#performance-optimization)

## Basic Setup

### Simple Client Setup

```typescript
import { PostgreSQLClient } from "./PostgreSQLClient";

async function main() {
  // Create client instance
  const db = PostgreSQLClient.create();

  try {
    // Connect to database
    await db.connect();
    console.log("Connected to PostgreSQL");

    // Execute a simple query
    const result = await db.executeRaw("SELECT version() as version");
    console.log("PostgreSQL version:", result[0].version);
  } catch (error) {
    console.error("Database operation failed:", error);
  } finally {
    // Always disconnect
    await db.disconnect();
    console.log("Disconnected from PostgreSQL");
  }
}

main();
```

### Client with Metrics and Caching

```typescript
import { PostgreSQLClient } from "./PostgreSQLClient";
import { MetricsCollector } from "@libs/monitoring";
import { CacheService } from "../cache/cache.service";

async function setupDatabaseClient() {
  // Initialize dependencies
  const metrics = new MetricsCollector();
  const cache = new CacheService(metrics);

  // Create client with full features
  const db = PostgreSQLClient.create(metrics, cache);

  // Connect
  await db.connect();

  // Verify connection
  const health = await db.healthCheck();
  console.log(`Database health: ${health.status}`);

  return db;
}
```

## CRUD Operations

### Create Operations

```typescript
async function createUser(
  db: PostgreSQLClient,
  userData: {
    email: string;
    name: string;
    role: string;
  }
) {
  const query = `
    INSERT INTO users (email, name, role, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING id, email, name, role, created_at
  `;

  const result = await db.executeRaw(query, [
    userData.email,
    userData.name,
    userData.role,
  ]);

  return result[0]; // Return the created user
}

// Usage
const newUser = await createUser(db, {
  email: "john@example.com",
  name: "John Doe",
  role: "user",
});
console.log("Created user:", newUser);
```

### Read Operations

```typescript
async function getUserById(db: PostgreSQLClient, userId: number) {
  const query = `
    SELECT id, email, name, role, created_at, updated_at
    FROM users
    WHERE id = $1 AND deleted_at IS NULL
  `;

  const result = await db.executeRaw(query, [userId]);
  return result[0] || null;
}

async function getUsersByRole(db: PostgreSQLClient, role: string, limit = 50) {
  const query = `
    SELECT id, email, name, created_at
    FROM users
    WHERE role = $1 AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT $2
  `;

  return await db.executeRaw(query, [role, limit]);
}

async function searchUsers(db: PostgreSQLClient, searchTerm: string) {
  const query = `
    SELECT id, email, name, role
    FROM users
    WHERE (email ILIKE $1 OR name ILIKE $1)
    AND deleted_at IS NULL
    ORDER BY name
    LIMIT 20
  `;

  return await db.executeRaw(query, [`%${searchTerm}%`]);
}

// Usage
const user = await getUserById(db, 123);
const admins = await getUsersByRole(db, "admin", 10);
const searchResults = await searchUsers(db, "john");
```

### Update Operations

```typescript
async function updateUser(
  db: PostgreSQLClient,
  userId: number,
  updates: Partial<{
    email: string;
    name: string;
    role: string;
  }>
) {
  const setParts = [];
  const values = [];
  let paramIndex = 1;

  // Build dynamic SET clause
  if (updates.email !== undefined) {
    setParts.push(`email = $${paramIndex++}`);
    values.push(updates.email);
  }
  if (updates.name !== undefined) {
    setParts.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.role !== undefined) {
    setParts.push(`role = $${paramIndex++}`);
    values.push(updates.role);
  }

  if (setParts.length === 0) {
    throw new Error("No fields to update");
  }

  setParts.push(`updated_at = NOW()`);
  values.push(userId);

  const query = `
    UPDATE users
    SET ${setParts.join(", ")}
    WHERE id = $${paramIndex}
    AND deleted_at IS NULL
    RETURNING id, email, name, role, updated_at
  `;

  const result = await db.executeRaw(query, values);
  return result[0] || null;
}

// Usage
const updatedUser = await updateUser(db, 123, {
  name: "John Smith",
  role: "moderator",
});
```

### Delete Operations (Soft Delete)

```typescript
async function softDeleteUser(db: PostgreSQLClient, userId: number) {
  const query = `
    UPDATE users
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, deleted_at
  `;

  const result = await db.executeRaw(query, [userId]);
  return result.length > 0;
}

async function hardDeleteUser(db: PostgreSQLClient, userId: number) {
  const query = "DELETE FROM users WHERE id = $1";
  await db.executeRaw(query, [userId]);
  return true;
}

// Usage
const deleted = await softDeleteUser(db, 123);
if (deleted) {
  console.log("User soft deleted");
}
```

## Advanced Queries

### Complex Joins and Aggregations

```typescript
async function getUserWithPosts(db: PostgreSQLClient, userId: number) {
  const query = `
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.created_at as user_created_at,
      json_agg(
        json_build_object(
          'id', p.id,
          'title', p.title,
          'content', p.content,
          'created_at', p.created_at,
          'published', p.published
        ) ORDER BY p.created_at DESC
      ) as posts
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id AND p.deleted_at IS NULL
    WHERE u.id = $1 AND u.deleted_at IS NULL
    GROUP BY u.id, u.email, u.name, u.role, u.created_at
  `;

  const result = await db.executeRaw(query, [userId]);
  return result[0] || null;
}

async function getPostsAnalytics(db: PostgreSQLClient, days = 30) {
  const query = `
    SELECT
      DATE(created_at) as date,
      COUNT(*) as total_posts,
      COUNT(*) FILTER (WHERE published = true) as published_posts,
      COUNT(DISTINCT user_id) as active_users
    FROM posts
    WHERE created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `;

  return await db.executeRaw(query);
}

// Usage
const userWithPosts = await getUserWithPosts(db, 123);
const analytics = await getPostsAnalytics(db, 7);
```

### Pagination

```typescript
async function getPostsPaginated(
  db: PostgreSQLClient,
  options: {
    page: number;
    limit: number;
    userId?: number;
    published?: boolean;
  }
) {
  const { page, limit, userId, published } = options;
  const offset = (page - 1) * limit;

  let whereConditions = ["p.deleted_at IS NULL"];
  let params = [limit, offset];
  let paramIndex = 3;

  if (userId !== undefined) {
    whereConditions.push(`p.user_id = $${paramIndex++}`);
    params.push(userId);
  }

  if (published !== undefined) {
    whereConditions.push(`p.published = $${paramIndex++}`);
    params.push(published);
  }

  const whereClause = whereConditions.join(" AND ");

  // Get posts
  const postsQuery = `
    SELECT
      p.id, p.title, p.content, p.published, p.created_at, p.updated_at,
      u.id as author_id, u.name as author_name, u.email as author_email
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT $1 OFFSET $2
  `;

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM posts p
    WHERE ${whereClause.replace("p.", "").replace("u.", "")}
  `;

  const [posts, countResult] = await Promise.all([
    db.executeRaw(postsQuery, params),
    db.executeRaw(countQuery, params.slice(2)), // Remove limit and offset
  ]);

  const total = parseInt(countResult[0].total);
  const totalPages = Math.ceil(total / limit);

  return {
    posts,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// Usage
const result = await getPostsPaginated(db, {
  page: 2,
  limit: 20,
  published: true,
});

console.log(
  `Page ${result.pagination.page} of ${result.pagination.totalPages}`
);
console.log(`Showing ${result.posts.length} posts`);
```

## Caching Examples

### Basic Query Caching

```typescript
async function getReferenceData(db: PostgreSQLClient) {
  // Cache country list for 1 hour
  const countries = await db.cachedQuery(
    "SELECT id, name, code FROM countries ORDER BY name",
    [],
    3600
  );

  // Cache categories for 30 minutes
  const categories = await db.cachedQuery(
    "SELECT id, name, description FROM categories WHERE active = true",
    [],
    1800
  );

  return { countries, categories };
}
```

### User-Specific Caching

```typescript
async function getUserProfile(db: PostgreSQLClient, userId: number) {
  // Cache user profile for 15 minutes
  const profile = await db.cachedQuery(
    `SELECT id, email, name, avatar_url, bio, preferences
     FROM user_profiles
     WHERE user_id = ?`,
    [userId],
    900
  );

  return profile[0] || null;
}

async function getUserPosts(db: PostgreSQLClient, userId: number, page = 1) {
  const limit = 20;
  const offset = (page - 1) * limit;

  // Cache paginated results for 5 minutes
  const cacheKey = `user_posts_${userId}_page_${page}`;

  const posts = await db.executeRawWithCache(
    `SELECT id, title, excerpt, published, created_at
     FROM posts
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
    {
      cacheKey,
      ttl: 300,
      useCache: true,
    }
  );

  return posts;
}
```

### Cache Invalidation

```typescript
async function updateUserProfile(
  db: PostgreSQLClient,
  userId: number,
  updates: any
) {
  // Update profile
  await db.writeWithCacheInvalidation(
    `UPDATE user_profiles SET ? WHERE user_id = ?`,
    [updates, userId],
    [
      `user_profile_${userId}`, // Specific user profile
      `user_posts_${userId}_page_*`, // All paginated posts for user
      "user_profiles_list", // User profiles list if exists
    ]
  );
}

async function publishPost(db: PostgreSQLClient, postId: number) {
  // Publish post and invalidate related caches
  await db.writeWithCacheInvalidation(
    "UPDATE posts SET published = true, published_at = NOW() WHERE id = ?",
    [postId],
    [
      `post_${postId}`, // Specific post
      "recent_posts", // Recent posts list
      "published_posts_*", // Any published posts cache
      "posts_feed_*", // User feeds
    ]
  );
}
```

### Cache Statistics and Monitoring

```typescript
async function monitorCachePerformance(db: PostgreSQLClient) {
  const stats = await db.getCacheStats();

  console.log("Cache Performance:");
  console.log(`- Enabled: ${stats.enabled}`);
  console.log(`- Hits: ${stats.metrics.hits}`);
  console.log(`- Misses: ${stats.metrics.misses}`);
  console.log(`- Hit Rate: ${(stats.metrics.hitRate * 100).toFixed(1)}%`);
  console.log(`- Errors: ${stats.metrics.errors}`);

  // Alert if hit rate is too low
  if (stats.metrics.hitRate < 0.7) {
    console.warn("Cache hit rate is below 70%");
  }

  return stats;
}
```

## Transaction Examples

### Simple Transaction

```typescript
async function createUserWithProfile(
  db: PostgreSQLClient,
  userData: {
    email: string;
    name: string;
    bio: string;
  }
) {
  return await db.transaction(async (prisma) => {
    // Create user
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        name: userData.name,
      },
    });

    // Create profile
    const profile = await prisma.profile.create({
      data: {
        userId: user.id,
        bio: userData.bio,
      },
    });

    return { user, profile };
  });
}
```

### Complex Business Transaction

```typescript
async function processOrder(
  db: PostgreSQLClient,
  orderData: {
    userId: number;
    items: Array<{ productId: number; quantity: number; price: number }>;
    shippingAddress: any;
  }
) {
  return await db.transaction(async (prisma) => {
    // Calculate total
    const total = orderData.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Check user balance
    const user = await prisma.user.findUnique({
      where: { id: orderData.userId },
      select: { balance: true },
    });

    if (!user || user.balance < total) {
      throw new Error("Insufficient balance");
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        userId: orderData.userId,
        total,
        status: "pending",
        shippingAddress: orderData.shippingAddress,
      },
    });

    // Create order items
    for (const item of orderData.items) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        },
      });

      // Update product stock
      await prisma.product.update({
        where: { id: item.productId },
        data: {
          stock: { decrement: item.quantity },
        },
      });
    }

    // Deduct user balance
    await prisma.user.update({
      where: { id: orderData.userId },
      data: {
        balance: { decrement: total },
      },
    });

    // Create transaction record
    await prisma.transaction.create({
      data: {
        userId: orderData.userId,
        amount: -total,
        type: "order",
        description: `Order #${order.id}`,
      },
    });

    return order;
  });
}
```

### Nested Transactions and Error Handling

```typescript
async function complexBusinessOperation(db: PostgreSQLClient) {
  try {
    return await db.transaction(async (prisma) => {
      // Step 1: Validate prerequisites
      const prerequisites = await validatePrerequisites(prisma);
      if (!prerequisites.valid) {
        throw new Error(`Prerequisites not met: ${prerequisites.reason}`);
      }

      // Step 2: Reserve resources
      const reservation = await reserveResources(prisma, prerequisites);

      try {
        // Step 3: Process main operation
        const result = await processMainOperation(prisma, reservation);

        // Step 4: Update related records
        await updateRelatedRecords(prisma, result);

        // Step 5: Send notifications
        await queueNotifications(result);

        return result;
      } catch (error) {
        // Cleanup on failure
        await cleanupReservation(prisma, reservation);
        throw error;
      }
    });
  } catch (error) {
    console.error("Business operation failed:", error);
    throw error;
  }
}

async function validatePrerequisites(prisma: any) {
  // Implementation...
}

async function reserveResources(prisma: any, prerequisites: any) {
  // Implementation...
}

async function processMainOperation(prisma: any, reservation: any) {
  // Implementation...
}

async function updateRelatedRecords(prisma: any, result: any) {
  // Implementation...
}

async function queueNotifications(result: any) {
  // Implementation...
}

async function cleanupReservation(prisma: any, reservation: any) {
  // Implementation...
}
```

## Batch Operations

### Bulk Insert

```typescript
async function bulkInsertUsers(
  db: PostgreSQLClient,
  users: Array<{
    email: string;
    name: string;
    role: string;
  }>
) {
  const operations = users.map((user) => async () => {
    return await db.executeRaw(
      `INSERT INTO users (email, name, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [user.email, user.name, user.role]
    );
  });

  const result = await db.batchExecute(operations, {
    batchSize: 10,
    concurrency: 3,
    timeoutMs: 30000,
  });

  console.log(`Inserted ${result.results.length} users`);
  console.log(`Failed: ${result.errors.length}`);

  return result;
}
```

### Bulk Update with Progress Tracking

```typescript
async function bulkUpdateUserStatus(
  db: PostgreSQLClient,
  userUpdates: Array<{
    userId: number;
    status: string;
  }>
) {
  let processed = 0;
  let successful = 0;
  let failed = 0;

  const operations = userUpdates.map(({ userId, status }) => async () => {
    const result = await db.executeRaw(
      "UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, userId]
    );

    processed++;
    if (result) {
      successful++;
    } else {
      failed++;
    }

    // Log progress every 100 operations
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${userUpdates.length} updates`);
    }

    return result;
  });

  const result = await db.batchExecute(operations, {
    batchSize: 50,
    concurrency: 5,
    timeoutMs: 60000,
  });

  console.log(`Batch complete: ${successful} successful, ${failed} failed`);
  return result;
}
```

### Parallel Data Processing

```typescript
async function processLargeDataset(db: PostgreSQLClient, dataset: any[]) {
  // Split dataset into chunks
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < dataset.length; i += chunkSize) {
    chunks.push(dataset.slice(i, i + chunkSize));
  }

  const operations = chunks.map((chunk, index) => async () => {
    console.log(`Processing chunk ${index + 1}/${chunks.length}`);

    // Process chunk data
    const processedData = await processChunk(chunk);

    // Bulk insert processed data
    for (const item of processedData) {
      await db.executeRaw(
        "INSERT INTO processed_data (data, processed_at) VALUES ($1, NOW())",
        [JSON.stringify(item)]
      );
    }

    return processedData.length;
  });

  const result = await db.batchExecute(operations, {
    batchSize: 5, // Process 5 chunks at a time
    concurrency: 2, // 2 concurrent chunk processors
    timeoutMs: 300000, // 5 minutes per chunk
  });

  const totalProcessed = result.results.reduce((sum, count) => sum + count, 0);
  console.log(`Total processed: ${totalProcessed} items`);

  return result;
}

async function processChunk(chunk: any[]): Promise<any[]> {
  // Simulate heavy processing
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return chunk.map((item) => ({
    ...item,
    processed: true,
    processedAt: new Date(),
  }));
}
```

## Connection Pooling

### Basic Pool Usage

```typescript
import { PostgreSQLConnectionPool } from "./PostgreSQLConnectionPool";

async function setupConnectionPool() {
  const pool = PostgreSQLConnectionPool.create({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "myapp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
  });

  await pool.connect();
  return pool;
}

async function useConnectionPool(pool: PostgreSQLConnectionPool) {
  // Direct query
  const users = await pool.query("SELECT * FROM users LIMIT 10");
  console.log(`Found ${users.rowCount} users`);

  // Transaction
  const result = await pool.transaction(async (client) => {
    await client.query("BEGIN");

    const user = await client.query(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      ["John Doe", "john@example.com"]
    );

    await client.query(
      "INSERT INTO user_profiles (user_id, bio) VALUES ($1, $2)",
      [user.rows[0].id, "Software developer"]
    );

    await client.query("COMMIT");
    return user.rows[0];
  });

  console.log("Created user:", result);
}
```

### Advanced Pool Management

```typescript
import { PostgreSQLConnectionManager } from "./ConnectionPoolManager";

async function setupAdvancedPool(db: PostgreSQLClient) {
  const poolManager = PostgreSQLConnectionManager.create(db, {
    maxConnections: 30,
    minConnections: 5,
    connectionTimeout: 30000,
    idleTimeout: 600000,
    healthCheckInterval: 30000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 0.8,
  });

  await poolManager.initialize();

  // Monitor pool health
  setInterval(() => {
    const stats = poolManager.getStats();
    console.log(
      `Pool: ${stats.activeConnections}/${stats.totalConnections} active`
    );

    if (stats.poolUtilization > 0.9) {
      console.warn("Pool utilization critical!");
    }
  }, 60000);

  return poolManager;
}

async function executeWithPoolManager(manager: PostgreSQLConnectionManager) {
  // Get raw SQL connection
  const connection = await manager.getConnectionSqlRaw();
  try {
    const users = await connection.execute(
      "SELECT * FROM users WHERE active = ?",
      [true]
    );
    console.log(`Active users: ${users.length}`);
  } finally {
    connection.release();
  }

  // Execute transaction
  const orderResult = await manager.executeTransaction(async (execute) => {
    const order = await execute(
      "INSERT INTO orders (user_id, total) VALUES (?, ?) RETURNING id",
      [123, 99.99]
    );

    await execute(
      "INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)",
      [order[0].id, 456, 2]
    );

    return order[0];
  });

  // Batch operations
  const updates = [
    {
      query: "UPDATE products SET stock = stock - 1 WHERE id = ?",
      params: [1],
    },
    {
      query: "UPDATE products SET stock = stock - 2 WHERE id = ?",
      params: [2],
    },
  ];

  const batchResults = await manager.executeBatch(updates);
  console.log(
    `Batch results: ${batchResults.filter((r) => !(r instanceof Error)).length} successful`
  );
}
```

## Error Handling

### Comprehensive Error Handling

```typescript
import { PostgreSQLError } from "./PostgreSQLClient";

class DatabaseService {
  constructor(private db: PostgreSQLClient) {}

  async safeQuery(query: string, params: any[] = []) {
    try {
      const result = await this.db.executeRaw(query, ...params);
      return { success: true, data: result };
    } catch (error) {
      return this.handleDatabaseError(error, { query, params });
    }
  }

  async safeTransaction<T>(
    operation: (db: PostgreSQLClient) => Promise<T>,
    context: string
  ) {
    try {
      const result = await this.db.transaction(async (prisma) => {
        return await operation(this.db);
      });
      return { success: true, data: result };
    } catch (error) {
      return this.handleDatabaseError(error, {
        context,
        operation: operation.name,
      });
    }
  }

  private handleDatabaseError(error: unknown, context: any) {
    console.error("Database error:", error, context);

    if (error instanceof PostgreSQLError) {
      // Handle known database errors
      switch (error.cause?.code) {
        case "23505": // unique_violation
          return {
            success: false,
            error: "Duplicate entry",
            code: "DUPLICATE_ERROR",
          };

        case "23503": // foreign_key_violation
          return {
            success: false,
            error: "Referenced record not found",
            code: "FOREIGN_KEY_ERROR",
          };

        case "23502": // not_null_violation
          return {
            success: false,
            error: "Required field is missing",
            code: "REQUIRED_FIELD_ERROR",
          };

        default:
          return {
            success: false,
            error: "Database operation failed",
            code: "DATABASE_ERROR",
            details: error.message,
          };
      }
    }

    // Handle unknown errors
    return {
      success: false,
      error: "Unknown database error",
      code: "UNKNOWN_ERROR",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

// Usage
const dbService = new DatabaseService(db);

const result = await dbService.safeQuery(
  "INSERT INTO users (email, name) VALUES ($1, $2)",
  ["john@example.com", "John Doe"]
);

if (!result.success) {
  console.error(`Operation failed: ${result.error}`);
  // Handle specific error types
  if (result.code === "DUPLICATE_ERROR") {
    // Handle duplicate email
  }
}
```

### Retry and Circuit Breaker Patterns

```typescript
async function resilientOperation(
  db: PostgreSQLClient,
  operation: () => Promise<any>
) {
  const maxRetries = 3;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check database health before operation
      const health = await db.healthCheck();
      if (health.status === "unhealthy") {
        throw new Error(`Database unhealthy: ${health.error}`);
      }

      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Operation failed after ${maxRetries} attempts: ${lastError.message}`
  );
}

// Usage
const result = await resilientOperation(db, async () => {
  return await db.executeRaw("SELECT * FROM critical_data");
});
```

## Monitoring & Metrics

### Custom Metrics Collector

```typescript
import { IMetricsCollector } from "@libs/monitoring";

class DatabaseMetricsCollector implements IMetricsCollector {
  private metrics: Map<string, number> = new Map();

  recordCounter(name: string, value: number = 1): void {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + value);
  }

  recordTimer(name: string, duration: number): void {
    // Store timing data for analysis
    console.log(`[TIMER] ${name}: ${duration.toFixed(2)}ms`);

    // Could send to monitoring system
    // monitoringSystem.recordTiming(name, duration);
  }

  recordGauge(name: string, value: number): void {
    this.metrics.set(name, value);
    console.log(`[GAUGE] ${name}: ${value}`);
  }

  getMetrics() {
    return Object.fromEntries(this.metrics);
  }

  reset() {
    this.metrics.clear();
  }
}

// Usage
const metrics = new DatabaseMetricsCollector();
const db = PostgreSQLClient.create(metrics);

// Monitor database operations
setInterval(() => {
  const currentMetrics = metrics.getMetrics();
  console.log("Database Metrics:", currentMetrics);

  // Alert on high error rates
  const totalOps =
    (currentMetrics["postgresql.raw_query.success"] || 0) +
    (currentMetrics["postgresql.raw_query.failure"] || 0);

  if (totalOps > 100) {
    const errorRate =
      (currentMetrics["postgresql.raw_query.failure"] || 0) / totalOps;
    if (errorRate > 0.1) {
      console.error(
        `High database error rate: ${(errorRate * 100).toFixed(1)}%`
      );
    }
  }

  metrics.reset();
}, 60000); // Every minute
```

### Health Monitoring

```typescript
class DatabaseHealthMonitor {
  constructor(private db: PostgreSQLClient) {}

  async startMonitoring(intervalMs: number = 30000) {
    setInterval(async () => {
      await this.checkHealth();
    }, intervalMs);
  }

  async checkHealth() {
    try {
      const health = await this.db.healthCheck();
      const connectionInfo = await this.db.getConnectionInfo();

      const healthData = {
        status: health.status,
        latency: health.latency,
        version: health.version,
        connections: {
          active: connectionInfo.connectionPool.active,
          idle: connectionInfo.connectionPool.idle,
          total: connectionInfo.connectionPool.total,
        },
        uptime: connectionInfo.uptime,
        timestamp: new Date().toISOString(),
      };

      console.log("Database Health:", JSON.stringify(healthData, null, 2));

      // Alert on unhealthy status
      if (health.status !== "healthy") {
        this.alertHealthIssue(health);
      }

      // Alert on high connection usage
      const utilization =
        connectionInfo.connectionPool.active /
        connectionInfo.connectionPool.total;

      if (utilization > 0.8) {
        console.warn(
          `High connection utilization: ${(utilization * 100).toFixed(1)}%`
        );
      }

      return healthData;
    } catch (error) {
      console.error("Health check failed:", error);
      this.alertHealthIssue({ status: "error", error: error.message });
    }
  }

  private alertHealthIssue(health: any) {
    // Send alert to monitoring system
    console.error("DATABASE HEALTH ALERT:", health);

    // Could integrate with:
    // - Slack notifications
    // - PagerDuty
    // - Email alerts
    // - Dashboard updates
  }
}

// Usage
const healthMonitor = new DatabaseHealthMonitor(db);
await healthMonitor.startMonitoring(30000); // Check every 30 seconds
```

## Performance Optimization

### Query Optimization

```typescript
async function optimizedQueries(db: PostgreSQLClient) {
  // 1. Use indexes effectively
  const users = await db.executeRaw(
    `
    SELECT u.id, u.name, u.email, p.bio
    FROM users u
    LEFT JOIN user_profiles p ON u.id = p.user_id
    WHERE u.created_at >= $1
    AND u.active = true
    ORDER BY u.created_at DESC
    LIMIT 100
  `,
    [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)]
  ); // Last 30 days

  // 2. Batch similar queries
  const userIds = [1, 2, 3, 4, 5];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(",");
  const userDetails = await db.executeRaw(
    `SELECT * FROM users WHERE id IN (${placeholders})`,
    userIds
  );

  // 3. Use pagination efficiently
  const pageSize = 50;
  const lastId = 1000; // From previous page

  const paginatedUsers = await db.executeRaw(
    `
    SELECT * FROM users
    WHERE id > $1
    ORDER BY id
    LIMIT $2
  `,
    [lastId, pageSize]
  );

  return { users, userDetails, paginatedUsers };
}
```

### Connection Pool Optimization

```typescript
function getOptimalPoolConfig(workload: "read" | "write" | "mixed") {
  const configs = {
    read: {
      maxConnections: 30,
      minConnections: 5,
      idleTimeout: 60000,
      acquireTimeout: 30000,
    },
    write: {
      maxConnections: 15,
      minConnections: 2,
      idleTimeout: 30000,
      acquireTimeout: 20000,
    },
    mixed: {
      maxConnections: 20,
      minConnections: 3,
      idleTimeout: 45000,
      acquireTimeout: 25000,
    },
  };

  return configs[workload];
}

// Usage
const poolConfig = getOptimalPoolConfig("read");
const pool = PostgreSQLConnectionPool.create({
  ...poolConfig,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
```

### Caching Strategy Optimization

```typescript
class SmartCacheManager {
  constructor(private db: PostgreSQLClient) {}

  // Cache static/reference data for longer periods
  async getReferenceData() {
    return await this.db.cachedQuery(
      "SELECT * FROM reference_data WHERE active = true",
      [],
      3600 // 1 hour
    );
  }

  // Cache user-specific data for shorter periods
  async getUserData(userId: number) {
    const cacheKey = `user_data_${userId}`;
    return await this.db.executeRawWithCache(
      "SELECT * FROM user_data WHERE user_id = ?",
      [userId],
      {
        cacheKey,
        ttl: 900, // 15 minutes
        useCache: true,
      }
    );
  }

  // Cache computed/aggregated data with automatic invalidation
  async getAnalyticsData(dateRange: { start: Date; end: Date }) {
    const cacheKey = `analytics_${dateRange.start.toISOString()}_${dateRange.end.toISOString()}`;

    return await this.db.executeRawWithCache(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as events,
        COUNT(DISTINCT user_id) as users
       FROM events
       WHERE created_at BETWEEN ? AND ?
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [dateRange.start, dateRange.end],
      {
        cacheKey,
        ttl: 1800, // 30 minutes
        useCache: true,
      }
    );
  }

  // Invalidate cache when data changes
  async invalidateUserCache(userId: number) {
    await this.db.invalidateCache(`user_data_${userId}`);
    await this.db.invalidateCache(`user_*`); // Pattern invalidation
  }
}

// Usage
const cacheManager = new SmartCacheManager(db);

// Get cached data
const referenceData = await cacheManager.getReferenceData();
const userData = await cacheManager.getUserData(123);
const analytics = await cacheManager.getAnalyticsData({
  start: new Date("2024-01-01"),
  end: new Date("2024-01-31"),
});

// Invalidate when user data changes
await cacheManager.invalidateUserCache(123);
```

### Batch Operation Optimization

```typescript
async function optimizedBatchOperations(db: PostgreSQLClient) {
  // 1. Group similar operations
  const usersToInsert = [
    { email: "user1@example.com", name: "User 1" },
    { email: "user2@example.com", name: "User 2" },
    // ... many more
  ];

  // Single batch insert (if supported by your PostgreSQL version)
  const values = usersToInsert
    .map((u) => `('${u.email}', '${u.name}')`)
    .join(",");
  await db.executeRaw(`
    INSERT INTO users (email, name, created_at)
    VALUES ${values}
  `);

  // 2. Use appropriate batch sizes
  const operations = usersToInsert.map((user) => async () => {
    return await db.executeRaw(
      "INSERT INTO users (email, name, created_at) VALUES ($1, $2, NOW())",
      [user.email, user.name]
    );
  });

  const result = await db.batchExecute(operations, {
    batchSize: Math.min(100, operations.length), // Smaller batches for inserts
    concurrency: 3, // Lower concurrency for write operations
    timeoutMs: 60000,
  });

  // 3. Optimize read batches
  const userIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const readOperations = userIds.map((id) => async () => {
    return await db.executeRaw("SELECT * FROM users WHERE id = $1", [id]);
  });

  const readResult = await db.batchExecute(readOperations, {
    batchSize: 10, // Larger batches for reads
    concurrency: 5, // Higher concurrency for read operations
    timeoutMs: 30000,
  });

  return { insertResult: result, readResult: readResult };
}
```

This comprehensive examples file provides practical, copy-paste ready code for all major PostgreSQL client features and use cases.
