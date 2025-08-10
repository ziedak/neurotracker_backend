#!/usr/bin/env bun

import { ServiceContainer } from "./src/container";

async function testClickHouseInsert() {
  console.log("Testing ClickHouse insert...");

  try {
    const container = ServiceContainer.getInstance();
    container.initializeServices();

    console.log("Available services:", container.getServiceNames());

    // Test getting services
    const logger = container.getService("Logger") as any;
    logger.info("Container test successful!");

    const clickhouse = container.getService("ClickHouseClient") as any;

    // Test connection first
    console.log("Testing ClickHouse connection...");
    const pingResult = await clickhouse.ping();
    console.log("Ping result:", pingResult);

    // Test insert with properly formatted data
    const testEvent = {
      userId: "test-user-123",
      eventType: "page_view",
      timestamp: 1754795456000,
      metadata: JSON.stringify({ page: "/home", source: "web" }), // Serialize metadata as JSON string
    };

    console.log("Inserting test event:", testEvent);

    await clickhouse.insert("raw_events", [testEvent]);
    console.log("✅ Insert successful!");

    // Verify the insert
    const result = await clickhouse.execute("SELECT * FROM raw_events LIMIT 5");
    console.log("Query result:", result);
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testClickHouseInsert();
