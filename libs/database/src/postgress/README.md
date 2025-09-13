# PostgreSQL Client Library

A comprehensive, production-ready PostgreSQL client library built on Prisma with advanced features like connection pooling, caching, metrics collection, circuit breakers, and batch operations.

## Features

- 🚀 **Prisma Integration**: Full Prisma ORM support with Accelerate extension
- 🏊 **Connection Pooling**: Advanced connection management with monitoring
- 📊 **Metrics & Monitoring**: Built-in performance tracking and health checks
- 🛡️ **Resilience**: Circuit breakers, retry logic, and error handling
- 💾 **Intelligent Caching**: Query result caching with TTL and invalidation
- ⚡ **Batch Operations**: Efficient bulk operations with concurrency control
- 🔄 **Transactions**: Type-safe transaction support
- 📈 **Health Monitoring**: Comprehensive health checks and connection stats

## Installation

```bash
npm install @prisma/client @prisma/extension-accelerate
```

## Quick Start

### Basic Usage

```typescript
import { PostgreSQLClient } from "@libs/database/src/postgress/PostgreSQLClient";

// Create client instance
const db = PostgreSQLClient.create();

// Connect to database
await db.connect();

// Execute queries
const users = await db.executeRaw("SELECT * FROM users WHERE active = $1", [
  true,
]);
const userCount = await db.executeRaw("SELECT COUNT(*) as count FROM users");

// Health check
const health = await db.healthCheck();
console.log(`Database status: ${health.status}`);

// Disconnect when done
await db.disconnect();
```

### With Metrics and Caching

```typescript
import { PostgreSQLClient } from "@libs/database/src/postgress/PostgreSQLClient";
import { MetricsCollector } from "@libs/monitoring";
import { CacheService } from "@libs/database/src/cache/cache.service";

const metrics = new MetricsCollector();
const cache = new CacheService(metrics);

const db = PostgreSQLClient.create(metrics, cache);
await db.connect();

// Cached query execution
const users = await db.cachedQuery(
  "SELECT * FROM users WHERE status = ?",
  ["active"],
  300
);

// Cache statistics
const cacheStats = await db.getCacheStats();
console.log(
  `Cache hit rate: ${(cacheStats.metrics.hitRate * 100).toFixed(1)}%`
);
```

## Configuration

### Environment Variables

```bash
# Database Connection
DATABASE_URL=postgresql://user:password@localhost:5432/database

# Resilience Configuration
POSTGRESQL_MAX_RETRIES=3
POSTGRESQL_RETRY_DELAY=1000
POSTGRESQL_CIRCUIT_BREAKER_THRESHOLD=5
POSTGRESQL_CIRCUIT_BREAKER_TIMEOUT=30000
POSTGRESQL_CONNECTION_TIMEOUT=10000

# Metrics Configuration
POSTGRESQL_METRICS_ENABLED=true
POSTGRESQL_SLOW_QUERY_THRESHOLD=1000
POSTGRESQL_HEALTH_CHECK_INTERVAL=30000

# Query Caching
POSTGRESQL_QUERY_CACHE_ENABLED=true
POSTGRESQL_QUERY_CACHE_DEFAULT_TTL=300
POSTGRESQL_QUERY_CACHE_MAX_SIZE=1000
POSTGRESQL_QUERY_CACHE_KEY_PREFIX=postgresql:
POSTGRESQL_QUERY_CACHE_EXCLUDE_PATTERNS=INSERT,UPDATE,DELETE,CREATE,DROP,ALTER,TRUNCATE

# Logging
DATABASE_LOGGING=false
```

### Programmatic Configuration

```typescript
import { PostgreSQLClient } from "@libs/database/src/postgress/PostgreSQLClient";

const db = new PostgreSQLClient(metricsCollector, cacheService);
// Configuration is automatically loaded from environment variables
```

## Core API

### Connection Management

```typescript
const db = PostgreSQLClient.create();

// Connect (idempotent)
await db.connect();

// Check connection status
const isHealthy = db.isHealthy();

// Get detailed connection info
const info = await db.getConnectionInfo();
console.log(`Active connections: ${info.connectionPool.active}`);

// Disconnect
await db.disconnect();
```

### Raw Query Execution

```typescript
// Simple query
const users = await db.executeRaw("SELECT * FROM users LIMIT 10");

// Parameterized query
const user = await db.executeRaw("SELECT * FROM users WHERE id = $1", [userId]);

// Multiple parameters
const orders = await db.executeRaw(
  "SELECT * FROM orders WHERE user_id = $1 AND status = $2",
  [userId, "completed"]
);
```

### Cached Queries

```typescript
// Automatic caching for SELECT queries
const users = await db.cachedQuery(
  "SELECT * FROM users WHERE active = ?",
  [true],
  300
);

// Cache with custom TTL
const products = await db.cachedQuery("SELECT * FROM products", [], 600);

// Execute with cache options
const data = await db.executeRawWithCache(
  "SELECT * FROM analytics WHERE date >= ?",
  [startDate],
  { ttl: 1800, useCache: true }
);

// Cache invalidation
await db.invalidateCache("user:*"); // Pattern-based invalidation
await db.invalidateCache(); // Clear all cached queries

// Cache statistics
const stats = await db.getCacheStats();
console.log(`Hits: ${stats.metrics.hits}, Misses: ${stats.metrics.misses}`);
```

### Transactions

```typescript
// Type-safe transactions
const result = await db.transaction(async (prisma) => {
  // Create user
  const user = await prisma.user.create({
    data: { email: "user@example.com", name: "John Doe" },
  });

  // Create profile
  const profile = await prisma.profile.create({
    data: { userId: user.id, bio: "Software developer" },
  });

  return { user, profile };
});
```

### Batch Operations

```typescript
// Execute multiple operations in batches
const operations = [
  () => db.executeRaw("INSERT INTO logs VALUES (?, ?)", ["event1", new Date()]),
  () => db.executeRaw("INSERT INTO logs VALUES (?, ?)", ["event2", new Date()]),
  () => db.executeRaw("INSERT INTO logs VALUES (?, ?)", ["event3", new Date()]),
];

const result = await db.batchExecute(operations, {
  batchSize: 10,
  concurrency: 3,
  timeoutMs: 30000,
});

console.log(
  `Processed: ${result.stats.processed}, Failed: ${result.stats.failed}`
);
```

### Write Operations with Cache Invalidation

```typescript
// Update user and invalidate related cache
await db.writeWithCacheInvalidation(
  "UPDATE users SET name = ? WHERE id = ?",
  ["Jane Doe", userId],
  ["user:*", "users:list"]
);
```

## Advanced Features

### Health Monitoring

```typescript
// Comprehensive health check
const health = await db.healthCheck();

if (health.status === "healthy") {
  console.log(`Database healthy, latency: ${health.latency}ms`);
  if (health.version) {
    console.log(`PostgreSQL version: ${health.version}`);
  }
} else if (health.status === "degraded") {
  console.log(`Database degraded: ${health.error}`);
} else {
  console.error(`Database unhealthy: ${health.error}`);
}
```

### Connection Pool Management

```typescript
import { PostgreSQLConnectionManager } from "@libs/database/src/postgress/ConnectionPoolManager";

const poolManager = PostgreSQLConnectionManager.create(db, {
  maxConnections: 20,
  minConnections: 2,
  connectionTimeout: 30000,
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
});

await poolManager.initialize();

// Get connection for raw SQL
const connection = await poolManager.getConnectionSqlRaw();
try {
  const users = await connection.execute("SELECT * FROM users");
  console.log(users);
} finally {
  connection.release();
}

// Get Prisma connection for ORM operations
const prisma = await poolManager.getConnectionPrisma();
try {
  const users = await prisma.user.findMany({
    where: { active: true },
    include: { profile: true },
  });
  console.log(`Found ${users.length} active users`);
} finally {
  // Note: Prisma connections are automatically managed
}

// Execute transaction
const result = await poolManager.executeTransaction(async (execute) => {
  await execute("INSERT INTO users (name) VALUES (?)", ["John"]);
  await execute("INSERT INTO profiles (user_id, bio) VALUES (?, ?)", [
    1,
    "Developer",
  ]);
  return "Transaction completed";
});

// Batch operations
const queries = [
  { query: "UPDATE users SET active = ? WHERE id = ?", params: [true, 1] },
  { query: "UPDATE users SET active = ? WHERE id = ?", params: [false, 2] },
];

const batchResults = await poolManager.executeBatch(queries);

// Pool statistics
const stats = poolManager.getStats();
console.log(`Pool utilization: ${(stats.poolUtilization * 100).toFixed(1)}%`);
```

### Low-Level Connection Pool

```typescript
import { PostgreSQLConnectionPool } from "@libs/database/src/postgress/PostgreSQLConnectionPool";

const pool = PostgreSQLConnectionPool.create({
  host: "localhost",
  port: 5432,
  database: "myapp",
  user: "postgres",
  password: "password",
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  enableCircuitBreaker: true,
  metricsCollector: metrics,
});

await pool.connect();

// Direct query execution
const result = await pool.query("SELECT * FROM users WHERE active = $1", [
  true,
]);
console.log(`Found ${result.rowCount} active users`);

// Transaction with connection
const userData = await pool.transaction(async (client) => {
  const userResult = await client.query(
    "INSERT INTO users (name) VALUES ($1) RETURNING id",
    ["Alice"]
  );
  const userId = userResult.rows[0].id;

  await client.query("INSERT INTO profiles (user_id, bio) VALUES ($1, $2)", [
    userId,
    "Engineer",
  ]);

  return { userId, name: "Alice" };
});

// Pool statistics
const poolStats = pool.getStats();
console.log(
  `Total: ${poolStats.totalCount}, Idle: ${poolStats.idleCount}, Waiting: ${poolStats.waitingCount}`
);

await pool.disconnect();
```

## Error Handling

```typescript
import { PostgreSQLError } from "@libs/database/src/postgress/PostgreSQLClient";

try {
  await db.executeRaw("SELECT * FROM nonexistent_table");
} catch (error) {
  if (error instanceof PostgreSQLError) {
    console.error(`Database error: ${error.message}`);
    console.error(`Original cause: ${error.cause}`);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Monitoring and Metrics

The library automatically collects comprehensive metrics:

### Available Metrics

- **Connection Metrics**: `postgresql.ping.*`, `postgresql.connect.*`
- **Query Metrics**: `postgresql.raw_query.*`, `postgresql.query.*`
- **Cache Metrics**: `postgresql.cache.hit`, `postgresql.cache.miss`
- **Transaction Metrics**: `postgresql.transaction.*`
- **Batch Metrics**: `postgresql.batch.*`
- **Health Metrics**: `postgresql.healthcheck.*`

### Custom Metrics Collection

```typescript
import { IMetricsCollector } from "@libs/monitoring";

class CustomMetricsCollector implements IMetricsCollector {
  recordCounter(name: string, value?: number): void {
    console.log(`Counter: ${name} = ${value || 1}`);
  }

  recordTimer(name: string, duration: number): void {
    console.log(`Timer: ${name} took ${duration}ms`);
  }

  recordGauge(name: string, value: number): void {
    console.log(`Gauge: ${name} = ${value}`);
  }
}

const db = PostgreSQLClient.create(new CustomMetricsCollector());
```

## Performance Optimization

### Connection Pool Tuning

```typescript
// Optimal settings for different workloads
const configs = {
  // Read-heavy workload
  readHeavy: {
    maxConnections: 30,
    minConnections: 5,
    idleTimeout: 60000,
  },

  // Write-heavy workload
  writeHeavy: {
    maxConnections: 15,
    minConnections: 2,
    idleTimeout: 30000,
  },

  // Mixed workload
  balanced: {
    maxConnections: 20,
    minConnections: 3,
    idleTimeout: 45000,
  },
};
```

### Caching Strategies

```typescript
// Cache frequently accessed reference data
const countries = await db.cachedQuery("SELECT * FROM countries", [], 3600); // 1 hour TTL

// Cache user sessions with short TTL
const session = await db.cachedQuery(
  "SELECT * FROM user_sessions WHERE token = ?",
  [token],
  300 // 5 minutes
);

// Cache computed analytics with medium TTL
const stats = await db.cachedQuery(
  "SELECT COUNT(*) as total, AVG(amount) as average FROM orders WHERE created_at >= ?",
  [lastWeek],
  1800 // 30 minutes
);
```

### Batch Operation Optimization

```typescript
// Optimize batch size based on data size
const batchConfig = {
  batchSize: 50, // Process 50 operations at a time
  concurrency: 5, // Run 5 batches concurrently
  timeoutMs: 60000, // 1 minute timeout per batch
};

const result = await db.batchExecute(largeOperations, batchConfig);
```

## Best Practices

### 1. Connection Management

```typescript
// Always use connection pooling for production
const db = PostgreSQLClient.create(metrics, cache);
await db.connect();

// Use try/finally for cleanup
try {
  // Database operations
} finally {
  await db.disconnect();
}
```

### 2. Error Handling

```typescript
// Always catch and handle database errors
try {
  const result = await db.executeRaw(query, params);
  return result;
} catch (error) {
  logger.error("Database operation failed", { error, query });
  throw new AppError("Database operation failed", 500);
}
```

### 3. Query Optimization

```typescript
// Use parameterized queries to prevent SQL injection
const user = await db.executeRaw(
  "SELECT * FROM users WHERE email = $1 AND active = $2",
  [email, true]
);

// Cache expensive queries
const expensiveData = await db.cachedQuery(
  "SELECT * FROM analytics WHERE date >= $1 ORDER BY views DESC LIMIT 100",
  [startDate],
  1800 // 30 minutes
);
```

### 4. Transaction Management

```typescript
// Keep transactions short and focused
const result = await db.transaction(async (prisma) => {
  // Validate data first
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("User already exists");

  // Perform operations
  const user = await prisma.user.create({ data: { email, name } });
  await prisma.auditLog.create({
    data: { action: "user_created", userId: user.id },
  });

  return user;
});
```

### 5. Monitoring

```typescript
// Monitor health regularly
setInterval(async () => {
  const health = await db.healthCheck();
  if (health.status !== "healthy") {
    alertSystem.notify(`Database ${health.status}: ${health.error}`);
  }
}, 30000);

// Log performance metrics
const cacheStats = await db.getCacheStats();
metrics.recordGauge("cache.hit_rate", cacheStats.metrics.hitRate);
```

## API Reference

### PostgreSQLClient

#### Constructor

```typescript
constructor(metricsCollector?: IMetricsCollector, cacheService?: ICache)
```

#### Static Methods

```typescript
PostgreSQLClient.create(metricsCollector?: IMetricsCollector, cacheService?: ICache): PostgreSQLClient
```

#### Instance Methods

##### Connection Management

```typescript
connect(): Promise<void>
disconnect(): Promise<void>
isHealthy(): boolean
getConnectionInfo(): Promise<ConnectionInfo>
```

##### Query Execution

```typescript
executeRaw<T = unknown>(query: string, ...params: unknown[]): Promise<T>
executeRawWithCache<T = unknown>(
  query: string,
  params: unknown[] = [],
  options?: PostgreSQLQueryCacheOptions
): Promise<T>
cachedQuery<T = unknown>(
  query: string,
  params: unknown[] = [],
  cacheTTL: number = 300
): Promise<T>
```

##### Transactions

```typescript
transaction<T>(
  callback: (prisma: PrismaClient) => Promise<T>
): Promise<T>
```

##### Batch Operations

```typescript
batchExecute<T>(
  operations: (() => Promise<T>)[],
  config?: Partial<PostgreSQLBatchConfig>
): Promise<BatchResult<T>>
```

##### Cache Management

```typescript
invalidateCache(pattern?: string): Promise<void>
getCacheStats(): Promise<CacheStats>
writeWithCacheInvalidation(
  query: string,
  params: unknown[] = [],
  invalidationPatterns: string[] = []
): Promise<unknown>
```

##### Health & Monitoring

```typescript
ping(): Promise<boolean>
healthCheck(): Promise<HealthResult>
```

### PostgreSQLConnectionPool

#### Constructor

```typescript
constructor(config: PostgreSQLPoolConfig)
```

#### Methods

```typescript
connect(): Promise<void>
disconnect(): Promise<void>
getClient(): Promise<PoolClient>
query<T>(text: string, params?: any[]): Promise<QueryResult<T>>
transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>
getStats(): PoolStats
healthCheck(): Promise<boolean>
```

### PostgreSQLConnectionManager

#### Constructor

```typescript
constructor(postgresClient: PostgreSQLClient, config?: Partial<ConnectionPoolConfig>)
```

#### Methods

```typescript
initialize(): Promise<void>
getConnectionSqlRaw(): Promise<SqlConnection>
getConnectionPrisma(): Promise<PrismaConnection>
executeQuery<T>(query: string, params?: any[]): Promise<T[]>
executeTransaction<T>(operations: TransactionCallback): Promise<T>
executeBatch<T>(queries: BatchQuery[]): Promise<BatchResult<T>>
getStats(): ConnectionPoolStats
reconnect(): Promise<void>
shutdown(): Promise<void>
```

## Troubleshooting

### Common Issues

1. **Connection Timeouts**

   ```typescript
   // Increase connection timeout
   process.env.POSTGRESQL_CONNECTION_TIMEOUT = "60000";
   ```

2. **High Memory Usage**

   ```typescript
   // Reduce cache size and TTL
   process.env.POSTGRESQL_QUERY_CACHE_MAX_SIZE = "500";
   process.env.POSTGRESQL_QUERY_CACHE_DEFAULT_TTL = "180";
   ```

3. **Slow Queries**

   ```typescript
   // Enable slow query logging
   process.env.POSTGRESQL_METRICS_ENABLED = "true";
   process.env.POSTGRESQL_SLOW_QUERY_THRESHOLD = "500";
   ```

4. **Connection Pool Exhaustion**
   ```typescript
   // Increase pool size
   process.env.MAX_CONNECTIONS = "50";
   process.env.MIN_CONNECTIONS = "5";
   ```

### Debug Logging

```typescript
// Enable detailed logging
process.env.DATABASE_LOGGING = "true";

// Custom logger
import { createLogger } from "@libs/utils";

const logger = createLogger("PostgreSQLDebug");
```

## Contributing

When contributing to this library:

1. Follow TypeScript best practices
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure all tests pass before submitting PR
5. Follow the established error handling patterns

## License

This library is part of the internal database utilities package.</content>
<parameter name="filePath">/home/zied/workspace/backend/libs/database/src/postgress/README.md
