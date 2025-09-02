/**
 * @fileoverview Database Integration Example
 * Shows how to use the production database integration with PostgreSQL and Redis
 *
 * @version 1.0.0
 * @author Enterprise Auth Foundation
 */

import { DatabaseUtils, createDatabaseUtils } from "../utils/database-utils";

/**
 * Example showing database integration with PostgreSQL and Redis
 */
export class DatabaseIntegrationExample {
  private dbUtils: DatabaseUtils;

  constructor() {
    this.dbUtils = createDatabaseUtils();
  }

  /**
   * Test database connectivity
   */
  async testConnectivity(): Promise<void> {
    console.log("🔍 Testing database connectivity...");

    try {
      const health = await this.dbUtils.healthCheck();
      console.log("✅ Database health check:", health);
    } catch (error) {
      console.error("❌ Database connectivity failed:", error);
      throw error;
    }
  }

  /**
   * Example user operations with caching
   */
  async testUserOperations(): Promise<void> {
    console.log("👤 Testing user operations with Redis caching...");

    try {
      // Test getting user by email (should hit database)
      console.log("📄 Testing getUserByEmail...");
      const testUser = await this.dbUtils.getUserByEmail("test@example.com");

      if (testUser) {
        console.log("✅ Found test user:", testUser.email);

        // Test getting user by ID (should use cache on second call)
        console.log("📄 Testing getUserById with caching...");
        const userFromDb = await this.dbUtils.getUserById(testUser.id);
        const userFromCache = await this.dbUtils.getUserById(testUser.id);

        console.log("✅ User from database/cache:", userFromDb?.email);
      } else {
        console.log(
          "ℹ️  No test user found. This is expected if database is empty."
        );
      }
    } catch (error) {
      console.error("❌ User operations failed:", error);
      throw error;
    }
  }

  /**
   * Example session operations with Redis
   */
  async testSessionOperations(): Promise<void> {
    console.log("🔐 Testing session operations with Redis...");

    const testSessionId = `test-session-${Date.now()}`;
    const testUserId = "test-user-123";

    try {
      // Create a test session
      console.log("📄 Creating test session...");
      const session = await this.dbUtils.createSession({
        userId: testUserId,
        sessionId: testSessionId,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
        metadata: { test: true },
      });
      console.log("✅ Session created:", session.sessionId);

      // Get session (should hit Redis cache)
      console.log("📄 Retrieving session from cache...");
      const retrievedSession = await this.dbUtils.getSession(testSessionId);
      console.log("✅ Session retrieved:", retrievedSession?.sessionId);

      // Delete session
      console.log("📄 Deleting test session...");
      await this.dbUtils.deleteSession(testSessionId);
      console.log("✅ Session deleted");

      // Try to get deleted session (should return null/undefined)
      const deletedSession = await this.dbUtils.getSession(testSessionId);
      console.log(
        "✅ Deleted session check:",
        deletedSession ? "Still exists" : "Properly deleted"
      );
    } catch (error) {
      console.error("❌ Session operations failed:", error);
      throw error;
    }
  }

  /**
   * Example permission caching with Redis
   */
  async testPermissionCaching(): Promise<void> {
    console.log("🔒 Testing permission caching with Redis...");

    const testUserId = "test-user-permissions";
    const testPermissions = ["read:users", "write:posts", "delete:comments"];

    try {
      // Cache permissions
      console.log("📄 Caching user permissions...");
      await this.dbUtils.cacheUserPermissions(testUserId, testPermissions, 300); // 5 minutes
      console.log("✅ Permissions cached");

      // Retrieve cached permissions
      console.log("📄 Retrieving cached permissions...");
      const cachedPermissions = await this.dbUtils.getCachedUserPermissions(
        testUserId
      );
      console.log("✅ Cached permissions:", cachedPermissions);

      // Verify permissions match
      if (
        JSON.stringify(cachedPermissions) === JSON.stringify(testPermissions)
      ) {
        console.log("✅ Permission caching working correctly");
      } else {
        console.log("⚠️  Permission caching mismatch");
      }
    } catch (error) {
      console.error("❌ Permission caching failed:", error);
      throw error;
    }
  }

  /**
   * Example security event logging
   */
  async testSecurityLogging(): Promise<void> {
    console.log("📝 Testing security event logging...");

    try {
      // Log a test security event
      console.log("📄 Logging security event...");
      const event = await this.dbUtils.logSecurityEvent(
        "test-user-log",
        "LOGIN_ATTEMPT",
        {
          ipAddress: "192.168.1.1",
          userAgent: "test-browser",
          timestamp: new Date(),
          success: true,
        }
      );
      console.log("✅ Security event logged:", event.eventType);
    } catch (error) {
      console.error("❌ Security logging failed:", error);
      throw error;
    }
  }

  /**
   * Run all integration tests
   */
  async runAllTests(): Promise<void> {
    console.log("🚀 Starting Database Integration Tests...\n");

    try {
      await this.testConnectivity();
      console.log();

      await this.testUserOperations();
      console.log();

      await this.testSessionOperations();
      console.log();

      await this.testPermissionCaching();
      console.log();

      await this.testSecurityLogging();
      console.log();

      console.log("🎉 All database integration tests completed successfully!");
    } catch (error) {
      console.error("💥 Database integration tests failed:", error);
      throw error;
    }
  }
}

/**
 * Run the database integration example
 * This can be used for testing the production database integration
 */
export async function runDatabaseIntegrationExample(): Promise<void> {
  const example = new DatabaseIntegrationExample();
  await example.runAllTests();
}

// Export for direct usage
export default DatabaseIntegrationExample;
