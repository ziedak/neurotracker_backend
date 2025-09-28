# ClickHouse Client Quick Start Guide

This guide provides the essential patterns for using the ClickHouse database client in the Neurotracker backend.

## Installation

```bash
pnpm add @libs/database
```

## Basic Usage

### Simple Client

```typescript
import { ClickHouseClient } from "@libs/database";

const client = ClickHouseClient.create();

// Execute queries
const result = await client.execute("SELECT * FROM events LIMIT 10");

// Insert data
await client.insert("events", [
  { user_id: 1, event: "login", timestamp: new Date() },
]);

// Clean up
await client.disconnect();
```

### Connection Pool (Recommended for Production)

```typescript
import { ClickHouseConnectionPoolManager } from "@libs/database";

const pool = ClickHouseConnectionPoolManager.create();
await pool.initialize();

const connection = await pool.acquireConnection();
try {
  const result = await connection.execute("SELECT COUNT(*) FROM users");
} finally {
  connection.release();
}

await pool.shutdown();
```

## Advanced Features

### Array Operations

```typescript
// Filter arrays
const errors = await client.arrayOperations.arrayFilter(
  "logs",
  "messages",
  "x -> x LIKE '%error%'"
);

// Transform arrays
const prices = await client.arrayOperations.arrayMap(
  "products",
  "prices",
  "x -> x * 1.1"
);

// Check array contents
const hasTag = await client.arrayOperations.arrayHas(
  "posts",
  "tags",
  "javascript"
);
```

### Analytics Aggregations

```typescript
// Top-K analysis
const topUsers = await client.aggregations.topK("events", "user_id", 10);

// Statistical summaries
const stats = await client.aggregations.stats("metrics", "response_time");

// Quantiles
const percentiles = await client.aggregations.quantiles(
  "data",
  "value",
  [0.25, 0.5, 0.75, 0.95]
);
```

### Time Series

```typescript
// Moving averages
const ma = await client.timeSeries.movingAverage(
  "metrics",
  "cpu",
  "timestamp",
  10
);

// Anomaly detection
const anomalies = await client.timeSeries.detectAnomalies(
  "metrics",
  "memory",
  "timestamp",
  { algorithm: "zscore" }
);

// Fill time gaps
const filled = await client.timeSeries.fillGaps("data", "timestamp", "1 hour");
```

### Sampling

```typescript
// Random sample
const sample = await client.sampling.sample("data", 0.1);

// Approximate distinct count
const count = await client.sampling.approximateCountDistinct(
  "visitors",
  "user_id",
  0.01
);

// Sample statistics
const stats = await client.sampling.sampleStats(
  "transactions",
  ["amount"],
  0.05
);
```

## Configuration

### Environment Variables

```bash
# Connection
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=analytics

# Pool settings
CLICKHOUSE_POOL_MIN_CONNECTIONS=5
CLICKHOUSE_POOL_MAX_CONNECTIONS=50
CLICKHOUSE_POOL_HEALTH_CHECK_INTERVAL=30000
```

### Programmatic Config

```typescript
const pool = new ClickHouseConnectionPoolManager({
  minConnections: 5,
  maxConnections: 50,
  healthCheckInterval: 30000,
  acquireTimeout: 60000,
});
```

## Error Handling

```typescript
try {
  const result = await client.execute("SELECT * FROM table");
} catch (error) {
  if (error.code === "UNKNOWN_TABLE") {
    console.log("Table not found");
  } else if (error.code === "NETWORK_ERROR") {
    console.log("Connection issue");
  }
  throw error;
}
```

## Best Practices

1. **Use connection pooling** for production applications
2. **Release connections** immediately after use
3. **Use parameterized queries** to prevent injection
4. **Leverage sampling** for large dataset analysis
5. **Monitor pool health** and query performance
6. **Handle errors gracefully** with retry logic

## Common Patterns

### Data Ingestion

```typescript
async function ingestBatch(data: any[]) {
  const connection = await pool.acquireConnection();
  try {
    await connection.batchInsert("events", data, {
      batchSize: 1000,
      retryAttempts: 3,
    });
  } finally {
    connection.release();
  }
}
```

### Analytics Query

```typescript
async function getAnalytics() {
  const connection = await pool.acquireConnection();
  try {
    const [userCount, topEvents, anomalies] = await Promise.all([
      connection.execute("SELECT COUNT(*) FROM users"),
      connection.aggregations.topK("events", "type", 5),
      connection.timeSeries.detectAnomalies("metrics", "load", "timestamp"),
    ]);
    return { userCount, topEvents, anomalies };
  } finally {
    connection.release();
  }
}
```

### Health Monitoring

```typescript
function monitorPool() {
  const stats = pool.getPoolStats();
  console.log(`Pool: ${stats.poolUtilization}% utilized`);
  console.log(`Active: ${stats.activeConnections} connections`);
}
```

For detailed examples, see `usage-examples.ts`. For complete API documentation, see `README.md`.
