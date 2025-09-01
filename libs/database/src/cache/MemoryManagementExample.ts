/**
 * Memory Management Example
 * Demonstrates accurate memory tracking and management in MemoryCache
 */

import { MemoryCache } from "./strategies/MemoryCache";

/**
 * Example demonstrating accurate memory management
 */
export class MemoryManagementExample {
  private memoryCache: MemoryCache;

  constructor() {
    // Configure memory cache with accurate tracking
    this.memoryCache = new MemoryCache(console as any, {
      enable: true,
      defaultTTL: 3600,
      maxMemoryCacheSize: 1000, // Max entries
      memoryConfig: {
        maxMemoryMB: 10, // 10MB limit
        warningThresholdPercent: 70,
        criticalThresholdPercent: 85,
        enableDetailedTracking: true,
        sizeCalculationInterval: 10,
      },
    });
  }

  /**
   * Demonstrate memory tracking accuracy
   */
  async demonstrateAccurateTracking(): Promise<void> {
    console.log("🧮 Demonstrating Accurate Memory Tracking");

    // Add entries of different sizes
    const testData = [
      { key: "small", data: "hello" },
      { key: "medium", data: "A".repeat(1000) }, // 2KB string
      {
        key: "large",
        data: {
          complex: "A".repeat(5000),
          nested: { more: "data".repeat(100) },
        },
      },
      {
        key: "array",
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: `item${i}`.repeat(10),
        })),
      },
    ];

    for (const { key, data } of testData) {
      await this.memoryCache.set(key, data);
      const memoryStats = this.memoryCache.getMemoryStats();

      console.log(`Entry "${key}":`, {
        size: this.formatBytes(memoryStats.averageEntrySize),
        totalMemory: this.formatBytes(memoryStats.totalUsageBytes),
        usagePercent: Math.round(memoryStats.usagePercent * 100) / 100,
      });
    }

    // Show detailed memory breakdown
    const detailedStats = this.memoryCache.getMemoryStats();
    console.log("\n📊 Detailed Memory Statistics:");
    console.log(
      `Total Memory: ${this.formatBytes(detailedStats.totalUsageBytes)}`
    );
    console.log(
      `Usage: ${Math.round(detailedStats.usagePercent * 100) / 100}%`
    );
    console.log(
      `Average Entry Size: ${this.formatBytes(detailedStats.averageEntrySize)}`
    );
    console.log(`Largest Entries:`);
    detailedStats.largestEntries.forEach(
      (entry: { key: string; size: number }, index: number) => {
        console.log(
          `  ${index + 1}. ${entry.key}: ${this.formatBytes(entry.size)}`
        );
      }
    );
  }

  /**
   * Demonstrate memory limits and thresholds
   */
  async demonstrateMemoryLimits(): Promise<void> {
    console.log("\n🚨 Demonstrating Memory Limits");

    // Fill cache until limits are reached
    let entryCount = 0;
    const largeData = "X".repeat(10000); // ~20KB per entry

    while (true) {
      const key = `test-entry-${entryCount}`;
      await this.memoryCache.set(key, { data: largeData, index: entryCount });

      const memoryStats = this.memoryCache.getMemoryStats();
      const health = await this.memoryCache.healthCheck();

      if (health.status === "critical" || memoryStats.usagePercent >= 90) {
        console.log(`Memory limit reached at entry ${entryCount}:`);
        console.log(`  Status: ${health.status}`);
        console.log(`  Capacity: ${health.capacity}`);
        console.log(
          `  Memory Usage: ${Math.round(memoryStats.usagePercent * 100) / 100}%`
        );
        console.log(
          `  Total Memory: ${this.formatBytes(memoryStats.totalUsageBytes)}`
        );
        break;
      }

      entryCount++;
      if (entryCount > 1000) break; // Safety limit
    }
  }

  /**
   * Demonstrate memory cleanup and invalidation
   */
  async demonstrateMemoryCleanup(): Promise<void> {
    console.log("\n🧹 Demonstrating Memory Cleanup");

    const initialStats = this.memoryCache.getMemoryStats();
    console.log(
      `Initial memory: ${this.formatBytes(initialStats.totalUsageBytes)}`
    );

    // Invalidate some entries
    await this.memoryCache.invalidate("test-entry-1");
    await this.memoryCache.invalidate("test-entry-2");

    const afterInvalidateStats = this.memoryCache.getMemoryStats();
    console.log(
      `After invalidation: ${this.formatBytes(
        afterInvalidateStats.totalUsageBytes
      )}`
    );
    console.log(
      `Memory freed: ${this.formatBytes(
        initialStats.totalUsageBytes - afterInvalidateStats.totalUsageBytes
      )}`
    );

    // Pattern invalidation
    const patternInvalidated = await this.memoryCache.invalidatePattern(
      "test-entry-*"
    );
    const afterPatternStats = this.memoryCache.getMemoryStats();
    console.log(`Pattern invalidation removed ${patternInvalidated} entries`);
    console.log(
      `Final memory: ${this.formatBytes(afterPatternStats.totalUsageBytes)}`
    );
  }

  /**
   * Demonstrate configuration updates
   */
  async demonstrateConfigurationUpdates(): Promise<void> {
    console.log("\n⚙️ Demonstrating Configuration Updates");

    const currentConfig = this.memoryCache.getMemoryConfig();
    console.log("Current config:", currentConfig);

    // Update memory limits
    this.memoryCache.updateMemoryConfig({
      maxMemoryMB: 20, // Increase limit
      warningThresholdPercent: 60,
      criticalThresholdPercent: 80,
    });

    console.log("Updated config:", this.memoryCache.getMemoryConfig());
  }

  /**
   * Compare old vs new memory tracking
   */
  demonstrateComparison(): void {
    console.log("\n📈 Old vs New Memory Tracking Comparison");

    // Simulate old rough estimation (1KB per entry)
    const entries = 150;
    const oldEstimation = entries * 1024; // 1KB per entry
    const actualData = Array.from({ length: entries }, (_, i) => ({
      id: i,
      data: "sample data".repeat(Math.floor(Math.random() * 10) + 1),
    }));

    // Calculate actual size using new method
    let actualSize = 0;
    const memoryTracker = new (require("../utils/MemoryTracker").MemoryTracker)(
      console as any
    );

    actualData.forEach((data, index) => {
      const key = `entry-${index}`;
      const memoryInfo = memoryTracker.trackEntry(key, data);
      actualSize += memoryInfo.totalSize;
    });

    console.log(`Entries: ${entries}`);
    console.log(
      `Old estimation: ${this.formatBytes(oldEstimation)} (1KB per entry)`
    );
    console.log(`New accurate: ${this.formatBytes(actualSize)}`);
    console.log(
      `Difference: ${Math.round(
        ((actualSize - oldEstimation) / oldEstimation) * 100
      )}%`
    );
    console.log(`Accuracy improvement: Much more precise size calculation`);
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Run complete memory management demonstration
   */
  async runCompleteDemo(): Promise<void> {
    console.log("🧠 Memory Management Demo");
    console.log("=".repeat(50));

    try {
      await this.demonstrateAccurateTracking();
      await this.demonstrateMemoryLimits();
      await this.demonstrateMemoryCleanup();
      await this.demonstrateConfigurationUpdates();
      this.demonstrateComparison();

      console.log("\n✅ Memory Management Demo Completed!");
      console.log("\n💡 Key Improvements:");
      console.log("  • Accurate object size calculation");
      console.log("  • Real-time memory monitoring");
      console.log("  • Configurable memory limits");
      console.log("  • Automatic threshold alerts");
      console.log("  • Detailed memory statistics");
      console.log("  • Memory-aware cache eviction");
    } catch (error) {
      console.error("❌ Demo failed:", error);
    }
  }
}

/**
 * Quick memory management example
 */
export async function quickMemoryExample(): Promise<void> {
  console.log("🚀 Quick Memory Management Example");

  const memoryCache = new MemoryCache(console as any, {
    memoryConfig: {
      maxMemoryMB: 5, // Small limit for demo
      warningThresholdPercent: 70,
      criticalThresholdPercent: 90,
    },
  });

  // Add some data
  await memoryCache.set("user:123", {
    name: "John",
    profile: "A".repeat(1000),
  });
  await memoryCache.set("session:abc", {
    token: "xyz",
    data: Array(50).fill("item"),
  });

  // Check memory usage
  const stats = memoryCache.getMemoryStats();
  console.log(`Memory Usage: ${Math.round(stats.usagePercent * 100) / 100}%`);
  console.log(`Total Memory: ${Math.round(stats.totalUsageMB * 100) / 100} MB`);
  console.log(`Average Entry: ${Math.round(stats.averageEntrySize)} bytes`);

  // Health check
  const health = await memoryCache.healthCheck();
  console.log(`Cache Health: ${health.status} (${health.capacity})`);
}
