/**
 * DEBUG: Minimal session test to identify hanging point
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  type TestEnvironment,
} from "./setup";

describe("Session Debug Test", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    console.log("🔍 Setting up test environment...");
    env = await setupTestEnvironment({ withCache: true });
    console.log("✅ Test environment ready");
  }, 60000);

  afterAll(async () => {
    console.log("🧹 Cleaning up...");
    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
    console.log("✅ Cleanup complete");
  }, 30000);

  it("should register user successfully", async () => {
    console.log("📝 Creating test user...");
    const userData = createTestUser();
    console.log("✅ Test user data created:", userData.username);

    console.log("📤 Registering user...");
    const users = await env.service.batchRegisterUsers([userData]);
    console.log("✅ User registration response received");

    const userId = users.results[0]?.data?.id!;
    expect(userId).toBeDefined();
    testUserIds.push(userId);

    console.log("✅ User registered successfully:", userId);
  }, 30000);

  it("should authenticate user with password", async () => {
    console.log("📝 Creating test user...");
    const userData = createTestUser();

    console.log("📤 Registering user...");
    const users = await env.service.batchRegisterUsers([userData]);
    const userId = users.results[0]?.data?.id!;
    testUserIds.push(userId);
    console.log("✅ User registered:", userId);

    console.log("⏳ Waiting 2 seconds for Keycloak sync...");
    // Performance optimization: Removed unnecessary 2s delay
    console.log("✅ Wait complete");

    console.log("🔐 Attempting authentication...");
    console.log("   Username:", userData.username);
    console.log("   Password:", userData.password);
    console.log(
      "   Context: { ipAddress: '127.0.0.1', userAgent: 'Debug-Test' }"
    );

    const authResult = await env.service.authenticateWithPassword(
      userData.username,
      userData.password,
      {
        ipAddress: "127.0.0.1",
        userAgent: "Debug-Test",
      }
    );

    console.log("✅ Authentication response received");
    console.log("   Success:", authResult.success);
    console.log("   Has session:", !!authResult.session);

    expect(authResult.success).toBe(true);
    expect(authResult.session).toBeDefined();
  }, 45000);
});
