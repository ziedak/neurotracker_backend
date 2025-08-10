#!/usr/bin/env bun

import { ServiceContainer } from "./src/container";

async function testContainer() {
  console.log("Testing ServiceContainer...");

  try {
    const container = ServiceContainer.getInstance();
    container.initializeServices();

    console.log("Available services:", container.getServiceNames());

    // Test getting services
    const logger = container.getService("Logger") as any;
    logger.info("Container test successful!");

    const validationService = container.getService("ValidationService");
    console.log("ValidationService loaded:", !!validationService);

    const redis = container.getService("RedisClient") as any;
    console.log("RedisClient loaded:", !!redis);

    // Test Redis connection (if available)
    try {
      console.log("Testing Redis connection...");
      await redis.ping();
      console.log("✅ Redis connection successful");
    } catch (error) {
      console.log("⚠️ Redis connection failed:", (error as Error).message);
    }

    container.cleanup();
    console.log("✅ Container test completed successfully");
  } catch (error) {
    console.error("❌ Container test failed:", error);
  }
}

testContainer();
