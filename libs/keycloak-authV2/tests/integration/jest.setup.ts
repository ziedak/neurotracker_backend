/**
 * Jest Setup for Integration Tests
 * Runs before all integration tests
 */

import { preflightChecks } from "./setup";

// Global test timeout
jest.setTimeout(60000);

// Run preflight checks before all tests
beforeAll(async () => {
  console.log("\n🚀 Starting Integration Tests...\n");
  console.log("Checking connectivity to services...\n");

  const checks = await preflightChecks();

  if (!checks.ready) {
    const errors: string[] = [];

    if (!checks.keycloak) {
      errors.push(
        "❌ Keycloak is not accessible. Make sure Docker Compose is running."
      );
    }

    if (!checks.database) {
      errors.push(
        "❌ PostgreSQL is not accessible. Make sure Docker Compose is running."
      );
    }

    console.error("\n" + errors.join("\n") + "\n");
    console.error(
      "Please run: docker-compose -f docker-compose.dev.yml up -d\n"
    );

    throw new Error("Service connectivity check failed");
  }

  console.log("✅ Keycloak is accessible");
  console.log("✅ PostgreSQL is accessible");
  console.log("\n📋 Running integration tests...\n");
}, 30000);

// Cleanup after all tests
afterAll(async () => {
  console.log("\n✅ Integration tests completed\n");

  // Give time for async operations to complete and cleanup
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Force close any remaining connections
  // This will be caught by individual test cleanup handlers
}, 15000);

// Handle unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
