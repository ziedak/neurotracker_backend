/**
 * Integration Tests: System Health & Monitoring
 * Tests health checks, statistics, and system information
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestEnvironment,
  createTestUser,
  cleanupTestUsers,
  type TestEnvironment,
} from "./setup";

describe("KeycloakIntegrationService - System Health", () => {
  let env: TestEnvironment;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: true, withMetrics: true });
  }, 60000);

  afterAll(async () => {
    await cleanupTestUsers(env.dbClient, testUserIds);
    await env.cleanup();
  }, 30000);

  describe("Health Checks", () => {
    it("should report system health status", async () => {
      const health = await env.service.checkHealth();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(["healthy", "degraded", "unhealthy"]).toContain(health.status);
      expect(health.details).toBeDefined();
      expect(health.timestamp).toBeDefined();

      console.log("✅ System health check successful", {
        status: health.status,
        timestamp: health.timestamp,
      });
    }, 10000);

    it("should provide resource statistics", async () => {
      const resourceStats = env.service.getResourceStats();

      expect(resourceStats).toBeDefined();
      expect(resourceStats.connections).toBeDefined();
      expect(resourceStats.connections.keycloak).toBeDefined();
      expect(resourceStats.connections.database).toBeDefined();
      expect(resourceStats.memory).toBeDefined();
      expect(resourceStats.uptime).toBeDefined();

      console.log("✅ Resource statistics available", {
        keycloakConnected: resourceStats.connections.keycloak,
        databaseConnected: resourceStats.connections.database,
        memoryUsed: `${(resourceStats.memory.heapUsed / 1024 / 1024).toFixed(
          2
        )}MB`,
        uptime: `${resourceStats.uptime}s`,
      });
    }, 10000);
  });

  describe("System Statistics", () => {
    it("should get comprehensive integration statistics", async () => {
      const stats = await env.service.getStats();

      expect(stats).toBeDefined();

      // Session stats
      expect(stats.session).toBeDefined();
      expect(typeof stats.session.active).toBe("number");
      expect(typeof stats.session.total).toBe("number");

      // Client stats
      expect(stats.client).toBeDefined();
      expect(typeof stats.client.discoveryLoaded).toBe("boolean");
      expect(typeof stats.client.cacheEnabled).toBe("boolean");

      // Token stats
      expect(stats.token).toBeDefined();
      expect(typeof stats.token.validationCount).toBe("number");

      // API key stats (if available)
      if (stats.apiKey) {
        expect(typeof stats.apiKey.totalKeys).toBe("number");
        expect(typeof stats.apiKey.validationCount).toBe("number");
      }

      console.log("✅ Integration statistics complete", {
        activeSessions: stats.session.active,
        totalSessions: stats.session.total,
        cacheEnabled: stats.client.cacheEnabled,
        tokenValidations: stats.token.validationCount,
      });
    }, 10000);

    it("should get system information", async () => {
      const sysInfo = env.service.getSystemInfo();

      expect(sysInfo).toBeDefined();
      expect(sysInfo.version).toBeDefined();
      expect(sysInfo.components).toBeDefined();
      expect(Array.isArray(sysInfo.components)).toBe(true);
      expect(sysInfo.configuration).toBeDefined();
      expect(sysInfo.architecture).toBeDefined();

      console.log("✅ System information available", {
        version: sysInfo.version,
        componentCount: sysInfo.components.length,
        architecture: sysInfo.architecture,
      });
    }, 10000);
  });

  describe("Performance Monitoring", () => {
    it("should track operation metrics", async () => {
      // Perform various operations to generate metrics
      const userData = createTestUser();

      // User registration
      const users = await env.service.batchRegisterUsers([userData]);
      const userId = users.results[0]?.data?.id!;
      testUserIds.push(userId);

      // API key creation
      await env.service.createAPIKey({
        userId,
        name: "Metrics Test Key",
      });

      // Get stats to verify metrics are being collected
      const stats = await env.service.getStats();

      expect(stats.client.requestCount).toBeGreaterThan(0);

      console.log("✅ Operation metrics tracked", {
        requestCount: stats.client.requestCount,
      });
    }, 30000);
  });

  describe("Connection Status", () => {
    it("should verify Keycloak connection", async () => {
      const resourceStats = env.service.getResourceStats();

      expect(resourceStats.connections.keycloak).toBe(true);

      console.log("✅ Keycloak connection verified");
    }, 10000);

    it("should verify database connection", async () => {
      const resourceStats = env.service.getResourceStats();

      expect(resourceStats.connections.database).toBe(true);

      console.log("✅ Database connection verified");
    }, 10000);

    it("should track active sessions count", async () => {
      const resourceStats = env.service.getResourceStats();

      expect(typeof resourceStats.connections.sessions).toBe("number");
      expect(resourceStats.connections.sessions).toBeGreaterThanOrEqual(0);

      console.log("✅ Active sessions tracked", {
        count: resourceStats.connections.sessions,
      });
    }, 10000);
  });
});
