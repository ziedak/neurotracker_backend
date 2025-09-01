/**
 * Cache Warming Example
 * Demonstrates how to use the advanced cache warming strategies
 */

import { CacheService } from "../cache.service";

/**
 * Example usage of cache warming strategies
 */
export class CacheWarmingExample {
  private cacheService: CacheService;

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Demonstrate static cache warming
   */
  async demonstrateStaticWarming(): Promise<void> {
    console.log("🚀 Demonstrating Static Cache Warming");

    const result = await this.cacheService.warmup("static");
    console.log("Static warmup result:", {
      success: result.success,
      keysProcessed: result.keysProcessed,
      duration: Math.round(result.duration),
    });
  }

  /**
   * Demonstrate adaptive cache warming
   */
  async demonstrateAdaptiveWarming(): Promise<void> {
    console.log("🧠 Demonstrating Adaptive Cache Warming");

    // Simulate some cache access patterns
    await this.simulateAccessPatterns();

    const result = await this.cacheService.warmup("adaptive");
    console.log("Adaptive warmup result:", {
      success: result.success,
      keysProcessed: result.keysProcessed,
      duration: Math.round(result.duration),
    });

    // Show learned patterns
    const stats = this.cacheService.getWarmingStats();
    console.log("Adaptive learning stats:", stats.adaptiveStats);
  }

  /**
   * Demonstrate background warming
   */
  async demonstrateBackgroundWarming(): Promise<void> {
    console.log("🔄 Demonstrating Background Cache Warming");

    // Start background warming
    this.cacheService.startBackgroundWarming();
    console.log("Background warming started");

    // Let it run for a bit
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check status
    const status = this.cacheService.getWarmingStats();
    console.log("Background warming status:", status.backgroundStatus);

    // Stop background warming
    this.cacheService.stopBackgroundWarming();
    console.log("Background warming stopped");
  }

  /**
   * Demonstrate all warming strategies
   */
  async demonstrateAllStrategies(): Promise<void> {
    console.log("🎯 Demonstrating All Cache Warming Strategies");

    const results = await this.cacheService.warmupAll();
    console.log("All strategies warmup results:");

    for (const [strategy, result] of results.entries()) {
      console.log(`  ${strategy}:`, {
        success: result.success,
        keysProcessed: result.keysProcessed,
        duration: Math.round(result.duration),
      });
    }
  }

  /**
   * Show recommended keys for warming
   */
  showRecommendedKeys(): void {
    console.log("📋 Recommended Keys for Warming");

    const recommendations = this.cacheService.getRecommendedKeys();
    for (const [strategy, keys] of recommendations.entries()) {
      console.log(`${strategy} strategy recommends:`, keys.slice(0, 5));
    }
  }

  /**
   * Simulate realistic access patterns for adaptive learning
   */
  private async simulateAccessPatterns(): Promise<void> {
    const patterns = [
      { key: "user:profile:123", frequency: 10 },
      { key: "session:active:456", frequency: 8 },
      { key: "permissions:read", frequency: 15 },
      { key: "user:roles:789", frequency: 5 },
      { key: "auth:config:ttl", frequency: 3 },
    ];

    for (const pattern of patterns) {
      for (let i = 0; i < pattern.frequency; i++) {
        await this.cacheService.get(pattern.key);
        // Small delay to simulate real usage
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  /**
   * Run complete demonstration
   */
  async runCompleteDemo(): Promise<void> {
    console.log("🎪 Starting Complete Cache Warming Demo");
    console.log("=".repeat(50));

    try {
      // Show initial state
      this.showRecommendedKeys();
      console.log();

      // Demonstrate static warming
      await this.demonstrateStaticWarming();
      console.log();

      // Demonstrate adaptive warming
      await this.demonstrateAdaptiveWarming();
      console.log();

      // Demonstrate background warming
      await this.demonstrateBackgroundWarming();
      console.log();

      // Demonstrate all strategies
      await this.demonstrateAllStrategies();
      console.log();

      // Final recommendations
      this.showRecommendedKeys();

      console.log("✅ Cache Warming Demo Completed Successfully!");
    } catch (error) {
      console.error("❌ Demo failed:", error);
    }
  }
}

/**
 * Quick start example
 */
export async function quickStartExample(): Promise<void> {
  console.log("🚀 Cache Warming Quick Start");

  // Create cache service with warming enabled
  const cacheService = new CacheService(console as any, {} as any, {
    enable: true,
    defaultTTL: 3600,
    warmupOnStart: true,
    warmingConfig: {
      enableBackgroundWarming: true,
      backgroundWarmingInterval: 300, // 5 minutes
      adaptiveWarming: true,
      maxWarmupKeys: 100,
    },
  });

  // Wait for initial warmup
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Use cache normally - it will learn access patterns
  await cacheService.set("user:profile:123", {
    name: "John Doe",
    role: "admin",
  });
  const profile = await cacheService.get("user:profile:123");
  console.log("Cached profile:", profile.data);

  // Get warming statistics
  const stats = cacheService.getWarmingStats();
  console.log("Warming stats:", stats);

  // Cleanup
  cacheService.stopBackgroundWarming();
}
