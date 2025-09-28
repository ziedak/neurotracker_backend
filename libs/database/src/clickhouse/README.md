# ClickHouse Database Client

A high-performance, enterprise-grade TypeScript client for ClickHouse OLAP database with advanced analytical capabilities, connection pooling, and comprehensive monitoring.

## Features

- 🚀 **High Performance**: Optimized for ClickHouse's columnar storage and vectorized execution
- 🔧 **Advanced Analytics**: Specialized operations for arrays, aggregations, time-series, and sampling
- 🏊 **Connection Pooling**: Intelligent connection management with health checks and load balancing
- 📊 **Metrics & Monitoring**: Built-in performance metrics and health monitoring
- 🔒 **Type Safety**: Full TypeScript support with comprehensive type definitions
- 🧪 **Well Tested**: Extensive test coverage with Jest
- 📈 **Production Ready**: Enterprise-grade error handling, logging, and resilience patterns

## Installation

```bash
# Install the database library
pnpm add @libs/database

# Or if using npm
npm install @libs/database
```

## Quick Start

```typescript
import { ClickHouseClient } from "@libs/database";

// Create a client instance
const client = ClickHouseClient.create();

// Basic query execution
const result = await client.execute("SELECT * FROM events LIMIT 10");
console.log(result);

// Always disconnect when done
await client.disconnect();
```

## Connection Pooling

For high-throughput applications, use the connection pool manager:

```typescript
import { ClickHouseConnectionPoolManager } from "@libs/database";

const poolManager = ClickHouseConnectionPoolManager.create({
  minConnections: 5,
  maxConnections: 50,
  healthCheckInterval: 30000,
});

await poolManager.initialize();

// Acquire and use connections
const connection = await poolManager.acquireConnection();
try {
  const result = await connection.execute("SELECT COUNT(*) FROM events");
  console.log(result);
} finally {
  connection.release(); // Return to pool
}

// Graceful shutdown
await poolManager.shutdown();
```

## Advanced Analytics Features

### Array Operations

ClickHouse provides powerful array manipulation functions:

```typescript
// Filter array elements
const filteredEvents = await client.arrayOperations.arrayFilter(
  "user_events",
  "tags",
  "x -> x LIKE '%error%'",
  {
    select: ["user_id", "timestamp"],
    where: { user_id: 12345 },
  }
);

// Transform array elements
const transformedData = await client.arrayOperations.arrayMap(
  "products",
  "prices",
  "x -> x * 1.1", // 10% price increase
  { where: { category: "electronics" } }
);

// Count array elements matching conditions
const errorCounts = await client.arrayOperations.arrayCount(
  "logs",
  "messages",
  {
    where: { level: "ERROR" },
    groupBy: ["service"],
  }
);

// Check if arrays contain specific values
const usersWithTag = await client.arrayOperations.arrayHas(
  "user_profiles",
  "interests",
  "gaming",
  {
    select: ["user_id", "name"],
  }
);
```

### Advanced Aggregations

Leverage ClickHouse's analytical aggregation functions:

```typescript
// Find arguments for maximum values
const topProducts = await client.aggregations.argMax(
  "sales",
  "product_name", // argument column
  "revenue", // value column
  {
    where: { date: "2024-01-01" },
    groupBy: ["category"],
  }
);

// Top-K analysis
const topCustomers = await client.aggregations.topK(
  "orders",
  "customer_id",
  10, // top 10
  { where: { status: "completed" } }
);

// Weighted top-K
const topWeighted = await client.aggregations.topKWeighted(
  "user_engagement",
  "user_id",
  "engagement_score",
  5
);

// Statistical aggregations
const stats = await client.aggregations.stats("metrics", "response_time", {
  where: { endpoint: "/api/v1/users" },
  groupBy: ["hour"],
});
// Returns: { count, sum, avg, min, max, variance, stddev }

// Quantile calculations
const percentiles = await client.aggregations.quantiles(
  "performance",
  "latency",
  [0.25, 0.5, 0.75, 0.95, 0.99], // percentiles
  { where: { service: "api" } }
);
// Returns: { p25, p50, p75, p95, p99 }
```

### Time Series Operations

Specialized functions for temporal data analysis:

```typescript
// Tumbling windows
const hourlyStats = await client.timeSeries.tumblingWindow(
  "events",
  "timestamp",
  "1 hour", // window size
  {
    select: ["COUNT(*) as event_count", "AVG(value) as avg_value"],
    groupBy: ["window_start"],
  }
);

// Moving averages
const movingAvg = await client.timeSeries.movingAverage(
  "metrics",
  "cpu_usage",
  "timestamp",
  10, // 10-point moving average
  {
    partitionBy: ["server_id"],
    where: { datacenter: "us-east" },
  }
);

// Anomaly detection
const anomalies = await client.timeSeries.detectAnomalies(
  "system_metrics",
  "memory_usage",
  "timestamp",
  {
    algorithm: "zscore", // 'zscore' | 'iqr' | 'mad'
    threshold: 3.0,
    where: { host: "web-01" },
  }
);

// Fill gaps in time series
const filledSeries = await client.timeSeries.fillGaps(
  "sensor_data",
  "timestamp",
  "1 minute", // interval
  0, // fill value for missing data
  {
    select: ["sensor_id", "temperature"],
    startTime: "2024-01-01 00:00:00",
    endTime: "2024-01-01 23:59:59",
  }
);
```

### Sampling Operations

Efficient data sampling for large datasets:

```typescript
// Random sampling
const sample = await client.sampling.sample(
  "user_events",
  1000, // sample size or 0.1 for 10%
  {
    select: ["user_id", "event_type", "timestamp"],
    where: { date: "2024-01-01" },
  }
);

// Consistent sampling (reproducible results)
const consistentSample = await client.sampling.sampleConsistent(
  "logs",
  10000, // sample size
  "user_id", // hash column for consistency
  { where: { level: "INFO" } }
);

// Approximate distinct counting
const distinctCount = await client.sampling.approximateCountDistinct(
  "visitors",
  "user_id",
  0.01, // 1% sample for estimation
  { where: { source: "organic" } }
);
// Returns: { approximate_count, exact_count }

// Statistical analysis on samples
const sampleStats = await client.sampling.sampleStats(
  "transactions",
  ["amount", "processing_time"],
  0.05, // 5% sample
  { where: { status: "success" } }
);
// Returns comprehensive stats for each column
```

## Configuration

### Client Configuration

```typescript
const client = new ClickHouseClient({
  url: "http://localhost:8123",
  username: "default",
  password: "password",
  database: "analytics",
  requestTimeout: 30000,
  maxOpenConnections: 10,
  compression: {
    response: true,
    request: false,
  },
});
```

### Pool Configuration

```typescript
const poolConfig = {
  minConnections: 5, // Minimum pool size
  maxConnections: 50, // Maximum pool size
  connectionTimeout: 30000, // Connection creation timeout (ms)
  idleTimeout: 300000, // Idle connection timeout (ms)
  healthCheckInterval: 30000, // Health check frequency (ms)
  acquireTimeout: 60000, // Connection acquire timeout (ms)
  enableCircuitBreaker: true, // Enable circuit breaker
  circuitBreakerThreshold: 10, // Failure threshold for circuit breaker
  retryAttempts: 3, // Query retry attempts
  retryDelay: 1000, // Delay between retries (ms)
};

const poolManager = new ClickHouseConnectionPoolManager(
  poolConfig,
  metricsCollector, // Optional metrics collector
  cacheService // Optional cache service
);
```

## Environment Variables

| Variable                                    | Default                 | Description                     |
| ------------------------------------------- | ----------------------- | ------------------------------- |
| `CLICKHOUSE_URL`                            | `http://localhost:8123` | ClickHouse server URL           |
| `CLICKHOUSE_USERNAME`                       | `default`               | Authentication username         |
| `CLICKHOUSE_PASSWORD`                       | `""`                    | Authentication password         |
| `CLICKHOUSE_DATABASE`                       | `analytics`             | Default database name           |
| `CLICKHOUSE_REQUEST_TIMEOUT`                | `30000`                 | Request timeout in milliseconds |
| `CLICKHOUSE_COMPRESSION`                    | `true`                  | Enable response compression     |
| `CLICKHOUSE_REQUEST_COMPRESSION`            | `false`                 | Enable request compression      |
| `CLICKHOUSE_POOL_MIN_CONNECTIONS`           | `5`                     | Minimum pool connections        |
| `CLICKHOUSE_POOL_MAX_CONNECTIONS`           | `50`                    | Maximum pool connections        |
| `CLICKHOUSE_POOL_CONNECTION_TIMEOUT`        | `30000`                 | Connection timeout (ms)         |
| `CLICKHOUSE_POOL_IDLE_TIMEOUT`              | `300000`                | Idle timeout (ms)               |
| `CLICKHOUSE_POOL_HEALTH_CHECK_INTERVAL`     | `30000`                 | Health check interval (ms)      |
| `CLICKHOUSE_POOL_ACQUIRE_TIMEOUT`           | `60000`                 | Acquire timeout (ms)            |
| `CLICKHOUSE_POOL_CIRCUIT_BREAKER`           | `true`                  | Enable circuit breaker          |
| `CLICKHOUSE_POOL_CIRCUIT_BREAKER_THRESHOLD` | `10`                    | Circuit breaker threshold       |
| `CLICKHOUSE_POOL_RETRY_ATTEMPTS`            | `3`                     | Retry attempts                  |
| `CLICKHOUSE_POOL_RETRY_DELAY`               | `1000`                  | Retry delay (ms)                |

## API Reference

### ClickHouseClient

#### Methods

- `execute<T>(query: string, values?: Record<string, unknown>): Promise<T>`
- `insert(table: string, data: Record<string, unknown>[], format?: string): Promise<void>`
- `batchInsert(table: string, data: Record<string, unknown>[], options?: IBatchInsertOptions, format?: string): Promise<IBatchInsertResult>`
- `ping(): Promise<boolean>`
- `healthCheck(): Promise<IHealthCheckResult>`
- `isHealthy(): boolean`
- `disconnect(): Promise<void>`

#### Properties

- `arrayOperations: IClickHouseArrayOperations`
- `aggregations: IClickHouseAggregations`
- `timeSeries: IClickHouseTimeSeries`
- `sampling: IClickHouseSampling`

### ClickHouseConnectionPoolManager

#### Methods

- `initialize(): Promise<void>`
- `acquireConnection(): Promise<PooledClickHouseConnection>`
- `releaseConnection(connection: PooledClickHouseConnection): Promise<void>`
- `getPoolStats(): ClickHousePoolStats`
- `shutdown(): Promise<void>`

#### Static Methods

- `create(config?: Partial<ClickHousePoolConfig>, metricsCollector?: IMetricsCollector, cacheService?: ICache): ClickHouseConnectionPoolManager`

## Error Handling

The client provides comprehensive error handling with specific error types:

```typescript
try {
  const result = await client.execute("SELECT * FROM invalid_table");
} catch (error) {
  if (error.code === "UNKNOWN_TABLE") {
    console.log("Table does not exist");
  } else if (error.code === "NETWORK_ERROR") {
    console.log("Connection failed");
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Monitoring & Metrics

Built-in metrics collection for performance monitoring:

```typescript
// Pool metrics
const stats = poolManager.getPoolStats();
console.log(`Pool utilization: ${stats.poolUtilization}%`);
console.log(`Active connections: ${stats.activeConnections}`);
console.log(`Average wait time: ${stats.averageWaitTime}ms`);

// Query metrics (automatically collected)
client.execute("SELECT COUNT(*) FROM events");
// Metrics: query_duration, query_rows_read, query_bytes_read
```

## Best Practices

### Connection Management

- Always use connection pooling for production applications
- Release connections back to the pool immediately after use
- Implement proper error handling and connection recovery

### Query Optimization

- Use parameterized queries to prevent injection attacks
- Leverage ClickHouse's sampling capabilities for large datasets
- Use appropriate data types and table engines for your use case

### Performance

- Batch inserts for high-throughput data ingestion
- Use array operations for complex data transformations
- Implement proper indexing strategies in your ClickHouse tables

### Monitoring

- Monitor pool utilization and connection health
- Set up alerts for high error rates or slow queries
- Use the built-in metrics for performance dashboards

## Testing

```typescript
import { ClickHouseClient } from "@libs/database";

// Mock client for testing
const mockClient = {
  execute: jest.fn(),
  arrayOperations: {
    arrayFilter: jest.fn(),
    // ... other methods
  },
  // ... other properties
};

// Use in tests
describe("Analytics Service", () => {
  it("should filter events by tags", async () => {
    mockClient.arrayOperations.arrayFilter.mockResolvedValue([
      { id: 1, tags: ["error", "urgent"] },
    ]);

    const result = await analyticsService.getErrorEvents();
    expect(result).toHaveLength(1);
  });
});
```

## Contributing

1. Follow the existing code style and patterns
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure TypeScript compilation passes
5. Run the full test suite before submitting

## License

This project is part of the Neurotracker backend and follows the same licensing terms.
