/**
 * Integration Test Setup
 * Configures test environment with real Keycloak and PostgreSQL from Docker Compose
 */

import { PostgreSQLClient, CacheService, RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { KeycloakIntegrationServiceBuilder } from "../../src/services/integration/IntegrationServiceBuilder";
import type { KeycloakIntegrationService } from "../../src/services/integration/KeycloakIntegrationService";
import { UserSyncService } from "../../src/services/user/sync/UserSyncService";
import { KeycloakUserService } from "../../src/services/user/KeycloakUserService";
import { KeycloakClient } from "../../src/client/KeycloakClient";
import { createMockMetricsCollector } from "./mocks";

const logger = createLogger("IntegrationTestSetup");

export interface TestEnvironment {
  service: KeycloakIntegrationService;
  dbClient: PostgreSQLClient;
  cacheService?: CacheService;
  redisClient?: RedisClient;
  syncService?: UserSyncService;
  cleanup: () => Promise<void>;
}

/**
 * Test configuration from environment variables
 */
export const TEST_CONFIG = {
  keycloak: {
    serverUrl: process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080",
    realm: process.env.KEYCLOAK_REALM || "test-realm",
    clientId: process.env.KEYCLOAK_CLIENT_ID || "test-client",
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || "test-secret",
    jwksEndpoint:
      process.env.KEYCLOAK_JWKS_ENDPOINT ||
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/realms/${
        process.env.KEYCLOAK_REALM || "test-realm"
      }/protocol/openid-connect/certs`,
    issuer:
      process.env.KEYCLOAK_ISSUER ||
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/realms/${
        process.env.KEYCLOAK_REALM || "test-realm"
      }`,
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://postgres:TEST@localhost:5432/neurotracker",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  test: {
    timeout: 30000, // 30 seconds for integration tests
    cleanupAfterEach: true,
  },
};

/**
 * Setup test environment with real dependencies
 */
export async function setupTestEnvironment(
  options: {
    withCache?: boolean;
    withMetrics?: boolean;
    withSync?: boolean; // Enable async sync service for performance
  } = {}
): Promise<TestEnvironment> {
  logger.info("Setting up integration test environment", options);

  // 1. Initialize Database Client
  const dbClient = new PostgreSQLClient({
    connectionString: TEST_CONFIG.database.url,
  });
  await dbClient.connect();
  logger.info("Database connected");

  // 2. Initialize Cache Service (optional)
  let cacheService: CacheService | undefined;
  if (options.withCache) {
    cacheService = new CacheService();
    logger.info("Cache service initialized");
  }

  // 3. Initialize Sync Service with REAL Redis (for real-world scenarios)
  let syncService: UserSyncService | undefined;
  let redisClient: RedisClient | undefined;

  if (options.withSync) {
    try {
      logger.info(
        "Initializing sync service with real Redis for performance..."
      );

      // Create real Redis client for sync operations
      redisClient = RedisClient.create(
        {
          // Parse Redis URL or use defaults
          host: TEST_CONFIG.redis.url.includes("://")
            ? new URL(TEST_CONFIG.redis.url).hostname
            : "localhost",
          port: TEST_CONFIG.redis.url.includes("://")
            ? parseInt(new URL(TEST_CONFIG.redis.url).port || "6379")
            : 6379,
          db: 1, // Use DB 1 for tests (separate from production DB 0)
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 3,
        },
        createMockMetricsCollector()
      );

      // Create Keycloak client for sync service
      const keycloakClient = new KeycloakClient({
        serverUrl: TEST_CONFIG.keycloak.serverUrl,
        realm: TEST_CONFIG.keycloak.realm,
        clientId: TEST_CONFIG.keycloak.clientId,
        clientSecret: TEST_CONFIG.keycloak.clientSecret,
        enableJwtValidation: false, // Simplified for tests
      });

      // Create Keycloak user service
      const keycloakUserService = KeycloakUserService.create(
        keycloakClient,
        dbClient.prisma,
        cacheService,
        createMockMetricsCollector()
      );

      // Create sync service with test-optimized settings
      syncService = new UserSyncService(
        redisClient,
        keycloakUserService,
        {
          batchSize: 10, // Process 10 users at a time
          batchInterval: 50, // Very fast for tests (50ms)
          maxRetries: 2, // Quick retries
          retryDelay: 100, // Short retry delay (100ms)
          workerConcurrency: 2, // 2 workers for parallel processing
          workerPollInterval: 100, // Check queue every 100ms
          enableHealthCheck: false, // Skip health checks in tests
          enableMetrics: false, // Skip metrics in tests
        },
        logger,
        createMockMetricsCollector()
      );

      // Start the sync worker
      await syncService.start();

      logger.info(
        "✅ Sync service initialized with real Redis - async mode enabled!"
      );
    } catch (error) {
      logger.warn(
        "Failed to initialize sync service, falling back to synchronous mode",
        { error }
      );
      // Cleanup Redis if it was created
      if (redisClient) {
        await redisClient.disconnect();
        redisClient = undefined;
      }
      syncService = undefined;
    }
  }

  // 4. Build Integration Service
  const builder = new KeycloakIntegrationServiceBuilder()
    .withKeycloakConfig({
      serverUrl: TEST_CONFIG.keycloak.serverUrl,
      realm: TEST_CONFIG.keycloak.realm,
      clientId: TEST_CONFIG.keycloak.clientId,
      clientSecret: TEST_CONFIG.keycloak.clientSecret,
      // Disable JWT validation for tests to simplify configuration
      // In production, you would set enableJwtValidation: true and provide jwksEndpoint and issuer
      enableJwtValidation: false,
    })
    .withDatabase(dbClient)
    .withMetrics(createMockMetricsCollector());

  if (cacheService) {
    builder.withCache(cacheService);
  }

  if (syncService) {
    builder.withSync(syncService);
    logger.info("✅ Sync service enabled - Keycloak operations will be async!");
  } else {
    logger.warn(
      "⚠️  Sync service NOT enabled - Keycloak operations will be synchronous (slower)"
    );
  }

  const service = builder.build();
  await service.initialize();
  logger.info("KeycloakIntegrationService initialized");

  // 5. Return environment with cleanup function
  return {
    service,
    dbClient,
    cacheService,
    redisClient,
    syncService,
    cleanup: async () => {
      logger.info("Cleaning up test environment");
      try {
        if (syncService) {
          logger.info("Stopping sync service...");
          await syncService.stop();
          await syncService.dispose();
        }
        if (redisClient) {
          logger.info("Disconnecting Redis...");
          await redisClient.disconnect();
        }
        await service.cleanup();
        await dbClient.disconnect();
        if (cacheService) {
          await cacheService.dispose();
        }
        logger.info("Cleanup completed");
      } catch (error) {
        logger.error("Cleanup failed", { error });
        throw error;
      }
    },
  };
}

/**
 * Create test user data
 */
export function createTestUser(suffix: string = "") {
  const timestamp = Date.now();
  return {
    username: `testuser_${timestamp}${suffix}`,
    email: `testuser_${timestamp}${suffix}@example.com`,
    password: "TestPassword123!",
    firstName: "Test",
    lastName: `User${suffix}`,
  };
}

/**
 * Create multiple test users
 */
export function createTestUsers(count: number) {
  return Array.from({ length: count }, (_, i) => createTestUser(`_${i + 1}`));
}

/**
 * Wait for async operations to complete
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  maxWaitMs: number = 5000,
  intervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Clean up test users from database
 */
export async function cleanupTestUsers(
  dbClient: PostgreSQLClient,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    await dbClient.prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
    logger.info("Test users cleaned up", { count: userIds.length });
  } catch (error) {
    logger.warn("Failed to cleanup test users", { error });
  }
}

/**
 * Verify Keycloak is accessible
 */
export async function verifyKeycloakConnectivity(): Promise<boolean> {
  try {
    const response = await fetch(
      `${TEST_CONFIG.keycloak.serverUrl}/realms/${TEST_CONFIG.keycloak.realm}`
    );
    return response.ok;
  } catch (error) {
    logger.error("Keycloak not accessible", { error });
    return false;
  }
}

/**
 * Verify database is accessible
 */
export async function verifyDatabaseConnectivity(): Promise<boolean> {
  try {
    const client = new PostgreSQLClient({
      connectionString: TEST_CONFIG.database.url,
    });
    await client.connect();
    await client.disconnect();
    return true;
  } catch (error) {
    logger.error("Database not accessible", { error });
    return false;
  }
}

/**
 * Pre-flight checks before running tests
 */
export async function preflightChecks(): Promise<{
  keycloak: boolean;
  database: boolean;
  ready: boolean;
}> {
  logger.info("Running preflight checks...");

  const keycloak = await verifyKeycloakConnectivity();
  const database = await verifyDatabaseConnectivity();
  const ready = keycloak && database;

  logger.info("Preflight check results", { keycloak, database, ready });

  return { keycloak, database, ready };
}
