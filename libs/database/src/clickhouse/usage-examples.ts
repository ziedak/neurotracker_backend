/**
 * ClickHouse Client Usage Examples
 *
 * This file demonstrates practical usage patterns for the ClickHouse database client
 * with advanced analytical capabilities. These examples show how to leverage
 * ClickHouse's unique features for high-performance analytics.
 */

import { ClickHouseClient } from "@libs/database";

/**
 * Example 1: Basic Client Usage
 * Demonstrates fundamental client operations
 */
async function basicUsageExample(): Promise<void> {
  // Create a client instance
  const client = ClickHouseClient.create();

  try {
    // Basic query execution
    const userCount = await client.execute<{ count: number }[]>(
      "SELECT COUNT(*) as count FROM users WHERE created_at >= ?",
      { created_at: "2024-01-01" }
    );

    console.log(`Total users: ${userCount[0]?.count ?? 0}`);

    // Insert data
    await client.insert("user_events", [
      { user_id: 1, event_type: "login", timestamp: new Date() },
      { user_id: 2, event_type: "signup", timestamp: new Date() },
    ]);

    // Batch insert with options
    const batchResult = await client.batchInsert(
      "analytics_events",
      [
        { event_name: "page_view", properties: { page: "/home" } },
        { event_name: "button_click", properties: { button: "signup" } },
      ],
      {
        batchSize: 1000,
        maxConcurrency: 3,
        delayBetweenBatches: 100,
      }
    );

    console.log(
      `Inserted ${batchResult.totalRows} rows in ${batchResult.batchesProcessed} batches`
    );
  } finally {
    await client.disconnect();
  }
}

/**
 * Example 2: Basic Query Operations
 * Shows different types of queries and result handling
 */
async function queryOperationsExample(): Promise<void> {
  const client = ClickHouseClient.create();

  try {
    // Simple aggregation query
    const dailyStats = await client.execute<
      Array<{ date: string; users: number; events: number }>
    >(
      "SELECT toDate(timestamp) as date, COUNT(DISTINCT user_id) as users, COUNT(*) as events FROM user_events WHERE timestamp >= today() - 7 GROUP BY date ORDER BY date"
    );

    console.log("Daily statistics for the past week:");
    dailyStats.forEach((stat) => {
      console.log(`${stat.date}: ${stat.users} users, ${stat.events} events`);
    });

    // Complex query with joins
    const userActivity = await client.execute<
      Array<{
        user_id: number;
        username: string;
        total_events: number;
        last_active: string;
      }>
    >(
      "SELECT u.user_id, u.username, COUNT(e.event_id) as total_events, max(e.timestamp) as last_active FROM users u LEFT JOIN user_events e ON u.user_id = e.user_id WHERE u.active = 1 GROUP BY u.user_id, u.username ORDER BY total_events DESC LIMIT 10"
    );

    console.log("Top 10 most active users:");
    userActivity.forEach((user) => {
      console.log(
        `${user.username}: ${user.total_events} events, last active: ${user.last_active}`
      );
    });
  } finally {
    await client.disconnect();
  }
}

/**
 * Example 3: Array Operations
 * Demonstrates ClickHouse's powerful array manipulation capabilities
 */
async function arrayOperationsExample(client: ClickHouseClient): Promise<void> {
  const arrayOps = client.arrayOperations;

  // Filter events by tags containing 'error'
  const errorEvents = await arrayOps.arrayFilter(
    "user_events",
    "tags",
    "x -> x LIKE '%error%'",
    {
      select: ["user_id", "event_id", "timestamp"],
      where: { environment: "production" },
    }
  );

  console.log(`Found ${errorEvents.length} error events`);

  // Transform product prices with a 10% increase
  const updatedPrices = await arrayOps.arrayMap(
    "products",
    "price_history",
    "x -> x * 1.1",
    {
      where: { category: "electronics" },
      select: ["product_id", "name"],
    }
  );

  console.log(`Updated prices for ${updatedPrices.length} products`);

  // Count high-severity alerts per service
  const alertCounts = await arrayOps.arrayCount("system_alerts", "messages", {
    where: { severity: "high" },
    groupBy: ["service_name"],
  });

  console.log(`Alert counts by service:`, alertCounts);

  // Find users interested in specific topics
  const gamingUsers = await arrayOps.arrayHas(
    "user_profiles",
    "interests",
    "gaming",
    {
      select: ["user_id", "username", "location"],
      where: { active: true },
    }
  );

  console.log(`Found ${gamingUsers.length} gaming enthusiasts`);
}

/**
 * Example 4: Advanced Aggregations
 * Shows analytical aggregation functions for business intelligence
 */
async function advancedAggregationsExample(
  client: ClickHouseClient
): Promise<void> {
  const aggregations = client.aggregations;

  // Find best-selling products by revenue
  const topProducts = await aggregations.argMax(
    "sales_transactions",
    "product_name",
    "revenue",
    {
      where: { transaction_date: "2024-01-01" },
      groupBy: ["category"],
    }
  );

  console.log("Top products by revenue:", topProducts);

  // Top 10 customers by order value
  const topCustomers = await aggregations.topK("orders", "customer_id", 10, {
    where: { status: "completed", order_date: "2024-01-01" },
  });

  console.log("Top 10 customers:", topCustomers);

  // Top products weighted by user ratings
  const topRatedProducts = await aggregations.topKWeighted(
    "product_reviews",
    "product_id",
    "rating",
    5,
    {
      where: { verified: true },
    }
  );

  console.log("Top rated products:", topRatedProducts);

  // Response time statistics by endpoint
  const performanceStats = await aggregations.stats(
    "api_requests",
    "response_time_ms",
    {
      where: { status_code: 200 },
      groupBy: ["endpoint", "hour"],
    }
  );

  console.log("Performance statistics:", performanceStats);

  // Calculate multiple percentiles for latency analysis
  const latencyPercentiles = await aggregations.quantiles(
    "performance_metrics",
    "latency",
    [0.5, 0.95, 0.99, 0.999],
    {
      where: { service: "api-gateway" },
    }
  );

  console.log("P95 latency:", latencyPercentiles[0]?.["p95"]);
  console.log("P99 latency:", latencyPercentiles[0]?.["p99"]);
}

/**
 * Example 5: Time Series Analysis
 * Demonstrates temporal data analysis capabilities
 */
async function timeSeriesAnalysisExample(
  client: ClickHouseClient
): Promise<void> {
  const timeSeries = client.timeSeries;

  // Hourly event counts using tumbling windows
  const hourlyStats = await timeSeries.tumblingWindow(
    "user_events",
    "timestamp",
    "1 hour",
    {
      select: [
        "COUNT(*) as event_count",
        "COUNT(DISTINCT user_id) as unique_users",
      ],
      where: { event_type: "page_view" },
    }
  );

  console.log("Hourly event statistics:", hourlyStats);

  // 7-day moving average of daily active users
  const dauMovingAverage = await timeSeries.movingAverage(
    "daily_metrics",
    "active_users",
    "date",
    7, // 7-day moving average
    {
      partitionBy: ["country"],
      where: { platform: "web" },
    }
  );

  console.log("7-day moving average of DAU:", dauMovingAverage);

  // Detect anomalies in system metrics
  const memoryAnomalies = await timeSeries.detectAnomalies(
    "system_metrics",
    "memory_usage_percent",
    "timestamp",
    {
      algorithm: "zscore",
      threshold: 3.0,
      where: { host: "web-server-01" },
    }
  );

  const anomalyCount = memoryAnomalies.filter((a) => a.is_anomaly).length;
  console.log(`Detected ${anomalyCount} memory usage anomalies`);

  // Fill gaps in sensor data (missing readings)
  const completeSensorData = await timeSeries.fillGaps(
    "sensor_readings",
    "timestamp",
    "5 minutes", // Expected interval
    null, // Fill missing values with null
    {
      select: ["sensor_id", "temperature", "humidity"],
      startTime: "2024-01-01 00:00:00",
      endTime: "2024-01-01 23:59:59",
      where: { sensor_id: 123 },
    }
  );

  console.log(`Filled ${completeSensorData.length} data points`);
}

/**
 * Example 6: Sampling Operations
 * Shows efficient data sampling for large datasets
 */
async function samplingOperationsExample(
  client: ClickHouseClient
): Promise<void> {
  const sampling = client.sampling;

  // Random sample of user behavior data
  const userSample = await sampling.sample(
    "user_behavior",
    0.1, // 10% sample
    {
      select: ["user_id", "session_duration", "page_views"],
      where: { date: "2024-01-01" },
      orderBy: "user_id",
    }
  );

  console.log(`Sampled ${userSample.length} user sessions`);

  // Consistent sampling for reproducible results
  const consistentSample = await sampling.sampleConsistent(
    "transaction_logs",
    50000, // Fixed sample size
    "transaction_id", // Hash column for consistency
    {
      where: { amount: { $gt: 100 } },
    }
  );

  console.log(`Consistent sample: ${consistentSample.length} transactions`);

  // Approximate distinct count for large datasets
  const uniqueVisitors = await sampling.approximateCountDistinct(
    "website_visits",
    "visitor_id",
    0.01, // 1% sample for estimation
    {
      where: { source: "organic" },
    }
  );

  console.log(
    `Approximate unique visitors: ${uniqueVisitors.approximate_count}`
  );
  console.log(`Exact count: ${uniqueVisitors.exact_count}`);

  // Statistical analysis on sampled data
  const columnStats = await sampling.sampleStats(
    "ecommerce_orders",
    ["order_total", "item_count", "shipping_cost"],
    0.05, // 5% sample
    {
      where: { status: "completed" },
    }
  );

  columnStats.forEach((stat) => {
    console.log(`${stat.column}:`);
    console.log(`  Count: ${stat.count}`);
    console.log(`  Distinct: ${stat.distinct_count}`);
    console.log(`  Null count: ${stat.null_count}`);
    console.log(`  Average: ${stat.avg?.toFixed(2)}`);
  });
}

/**
 * Example 7: Real-World Analytics Dashboard
 * Combines multiple features for a comprehensive analytics solution
 */
async function analyticsDashboardExample(
  client: ClickHouseClient
): Promise<Record<string, unknown>> {
  // 1. Get real-time metrics with time series analysis
  const currentHourStats = await client.timeSeries.tumblingWindow(
    "events",
    "timestamp",
    "1 hour",
    {
      select: [
        "COUNT(*) as total_events",
        "COUNT(DISTINCT user_id) as unique_users",
      ],
    }
  );

  // 2. Top performing content using aggregations
  const topContent = await client.aggregations.topKWeighted(
    "content_engagement",
    "content_id",
    "engagement_score",
    10
  );

  // 3. User segmentation with array operations
  const powerUsers = await client.arrayOperations.arrayFilter(
    "user_profiles",
    "activity_scores",
    "x -> x > 80", // High activity users
    {
      select: ["user_id", "username", "last_active"],
    }
  );

  // 4. Performance monitoring with sampling
  const performanceSample = await client.sampling.sampleStats(
    "api_requests",
    ["response_time", "error_rate"],
    0.1, // 10% sample for quick analysis
    {
      where: { timestamp: { $gte: "2024-01-01 00:00:00" } },
    }
  );

  // 5. Anomaly detection for system health
  const systemAnomalies = await client.timeSeries.detectAnomalies(
    "system_metrics",
    "cpu_usage",
    "timestamp",
    {
      algorithm: "iqr",
      threshold: 1.5,
      where: { datacenter: "us-east" },
    }
  );

  // Combine results for dashboard
  const dashboard = {
    realtime: currentHourStats[0],
    topContent,
    powerUserCount: powerUsers.length,
    performance: performanceSample[0],
    anomalies: systemAnomalies.filter((a) => a.is_anomaly).length,
  };

  console.log("Analytics Dashboard:", JSON.stringify(dashboard, null, 2));
  return dashboard;
}

/**
 * Example 8: Error Handling and Resilience
 * Demonstrates proper error handling patterns with the ClickHouse client
 */
async function errorHandlingExample(): Promise<void> {
  const client = ClickHouseClient.create();

  async function executeWithRetry(
    query: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    try {
      // Execute with built-in retry logic from the client
      const result = await client.execute(query, params);
      return result;
    } catch (error) {
      console.error("Query execution failed:", error);

      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes("NETWORK")) {
          console.log("Network issue detected, connection will be retried");
        } else if (error.message.includes("TIMEOUT")) {
          console.log("Query timed out, consider optimizing the query");
        } else if (error.message.includes("UNKNOWN_TABLE")) {
          console.log("Table does not exist, check schema");
        }
      }

      throw error; // Re-throw for caller to handle
    }
  }

  try {
    const result = await executeWithRetry(
      "SELECT COUNT(*) FROM events WHERE created_at >= ?",
      { created_at: "2024-01-01" }
    );
    console.log("Query successful:", result);
  } catch (error) {
    console.error("All retry attempts failed:", error);
  }

  await client.disconnect();
}

/**
 * Example 9: Performance Monitoring
 * Shows how to monitor query performance with the ClickHouse client
 */
async function performanceMonitoringExample(): Promise<void> {
  const client = ClickHouseClient.create();

  // Execute queries with performance tracking
  async function executeWithTiming(
    query: string,
    description: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      const result = await client.execute(query);
      const duration = Date.now() - startTime;

      console.log(`${description}: ${duration}ms`);

      if (duration > 5000) {
        // Log slow queries
        console.warn(`Slow query detected: ${description} took ${duration}ms`);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Query failed after ${duration}ms: ${description}`, error);
      throw error;
    }
  }

  try {
    // Run some example queries
    await executeWithTiming("SELECT COUNT(*) FROM events", "Count all events");

    await executeWithTiming(
      "SELECT user_id, COUNT(*) FROM events GROUP BY user_id ORDER BY count DESC LIMIT 10",
      "Top users by event count"
    );

    await executeWithTiming(
      "SELECT arrayJoin(tags) as tag, COUNT(*) FROM events GROUP BY tag ORDER BY count DESC LIMIT 20",
      "Popular tags analysis"
    );

    // Health check
    const health = await client.healthCheck();
    console.log(
      `Database health: ${health.status}, latency: ${health.latency}ms`
    );
  } finally {
    await client.disconnect();
  }
}

// Export examples for testing
export {
  basicUsageExample,
  queryOperationsExample,
  arrayOperationsExample,
  advancedAggregationsExample,
  timeSeriesAnalysisExample,
  samplingOperationsExample,
  analyticsDashboardExample,
  errorHandlingExample,
  performanceMonitoringExample,
};
