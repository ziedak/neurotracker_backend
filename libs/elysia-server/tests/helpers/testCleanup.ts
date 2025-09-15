/**
 * Test cleanup utilities to prevent memory leaks in integration tests
 */

import { RateLimitHttpMiddleware } from "../../src/middleware/rateLimit/rateLimit.http.Middleware";
import { RateLimitWebSocketMiddleware } from "../../src/middleware/rateLimit/rateLimit.websocket.middleware";
import { AdvancedElysiaServerBuilder } from "../../src/server";

export class TestCleanupManager {
  private middlewareInstances: Array<{
    cleanup: () => Promise<void>;
  }> = [];

  private serverBuilders: AdvancedElysiaServerBuilder[] = [];

  /**
   * Register middleware instances for cleanup
   */
  registerMiddleware(...middleware: Array<{ cleanup: () => Promise<void> }>) {
    this.middlewareInstances.push(...middleware);
  }

  /**
   * Register server builders for cleanup
   */
  registerServerBuilder(...builders: AdvancedElysiaServerBuilder[]) {
    this.serverBuilders.push(...builders);
  }

  /**
   * Clean up all registered instances
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises: Promise<void>[] = [];

    // Cleanup middleware instances
    for (const middleware of this.middlewareInstances) {
      try {
        cleanupPromises.push(middleware.cleanup());
      } catch (error) {
        console.warn("Failed to cleanup middleware:", error);
      }
    }

    // Cleanup server builders
    for (const builder of this.serverBuilders) {
      try {
        cleanupPromises.push(builder.cleanup());
      } catch (error) {
        console.warn("Failed to cleanup server builder:", error);
      }
    }

    // Wait for all cleanups to complete
    await Promise.allSettled(cleanupPromises);

    // Clear the registries
    this.middlewareInstances = [];
    this.serverBuilders = [];
  }
}

/**
 * Global test cleanup manager instance
 */
let globalCleanupManager: TestCleanupManager | null = null;

/**
 * Get or create the global cleanup manager
 */
export function getTestCleanupManager(): TestCleanupManager {
  if (!globalCleanupManager) {
    globalCleanupManager = new TestCleanupManager();
  }
  return globalCleanupManager;
}

/**
 * Setup Jest hooks for automatic cleanup
 */
export function setupTestCleanup() {
  afterEach(async () => {
    const manager = getTestCleanupManager();
    await manager.cleanupAll();
  });

  afterAll(async () => {
    const manager = getTestCleanupManager();
    await manager.cleanupAll();
    globalCleanupManager = null;
  });
}

/**
 * Helper function to create RateLimitHttpMiddleware with automatic cleanup
 */
export function createRateLimitHttpMiddleware(
  ...args: ConstructorParameters<typeof RateLimitHttpMiddleware>
): RateLimitHttpMiddleware {
  const middleware = new RateLimitHttpMiddleware(...args);
  getTestCleanupManager().registerMiddleware(middleware);
  return middleware;
}

/**
 * Helper function to create RateLimitWebSocketMiddleware with automatic cleanup
 */
export function createRateLimitWebSocketMiddleware(
  ...args: ConstructorParameters<typeof RateLimitWebSocketMiddleware>
): RateLimitWebSocketMiddleware {
  const middleware = new RateLimitWebSocketMiddleware(...args);
  getTestCleanupManager().registerMiddleware(middleware);
  return middleware;
}

/**
 * Helper function to create AdvancedElysiaServerBuilder with automatic cleanup
 */
export function createAdvancedElysiaServerBuilder(
  ...args: ConstructorParameters<typeof AdvancedElysiaServerBuilder>
): AdvancedElysiaServerBuilder {
  const builder = new AdvancedElysiaServerBuilder(...args);
  getTestCleanupManager().registerServerBuilder(builder);
  return builder;
}
