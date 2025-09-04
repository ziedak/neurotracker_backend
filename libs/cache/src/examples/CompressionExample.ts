/**
 * Cache Compression Example
 * Demonstrates compression features for large cache objects
 */

import { container } from "@libs/utils";
import {
  MemoryCache,
  DEFAULT_MEMORY_CACHE_CONFIG,
} from "../strategies/MemoryCache";
import {
  CacheCompressor,
  type CompressionConfig,
} from "../utils/CacheCompressor";
import type { ILogger } from "@libs/monitoring";

// Mock logger for demonstration
const mockLogger: ILogger = {
  info: (...data: any[]) => console.info(...data),
  warn: (...data: any[]) => console.warn(...data),
  error: (...data: any[]) => console.error(...data),
  debug: (...data: any[]) => console.debug(...data),
  child: () => mockLogger,
  setLevel: () => {},
  setTransports: () => {},
  setFormatter: () => {},
  setCustomTransport: () => {},
};

// Register dependencies
container.register("ILogger", { useValue: mockLogger });

/**
 * Example: Large data object that benefits from compression
 */
interface LargeUserData {
  id: string;
  profile: {
    name: string;
    email: string;
    bio: string;
    preferences: Record<string, any>;
    history: Array<{
      action: string;
      timestamp: number;
      metadata: Record<string, any>;
    }>;
  };
  stats: {
    loginCount: number;
    lastLogin: number;
    sessionData: Record<string, any>;
  };
  relationships: {
    friends: string[];
    followers: string[];
    following: string[];
    blocked: string[];
  };
}

/**
 * Generate large user data for testing
 */
function generateLargeUserData(userId: string): LargeUserData {
  const history = [];
  for (let i = 0; i < 100; i++) {
    history.push({
      action: `action_${i}`,
      timestamp: Date.now() - Math.random() * 86400000, // Random time in last 24h
      metadata: {
        ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        location: {
          country: "US",
          city: "New York",
          coordinates: {
            lat: 40.7128 + (Math.random() - 0.5) * 0.1,
            lng: -74.006 + (Math.random() - 0.5) * 0.1,
          },
        },
      },
    });
  }

  const friends = [];
  const followers = [];
  const following = [];
  const blocked = [];

  for (let i = 0; i < 500; i++) {
    friends.push(`user_${Math.floor(Math.random() * 10000)}`);
    followers.push(`user_${Math.floor(Math.random() * 10000)}`);
    following.push(`user_${Math.floor(Math.random() * 10000)}`);
    if (Math.random() < 0.1) {
      blocked.push(`user_${Math.floor(Math.random() * 10000)}`);
    }
  }

  return {
    id: userId,
    profile: {
      name: `User ${userId}`,
      email: `${userId}@example.com`,
      bio: "This is a very long bio that contains a lot of text to make the object larger. ".repeat(
        50
      ),
      preferences: {
        theme: "dark",
        notifications: {
          email: true,
          push: false,
          sms: true,
          marketing: false,
        },
        privacy: {
          profileVisibility: "public",
          showOnlineStatus: true,
          allowMessages: true,
        },
        language: "en",
        timezone: "America/New_York",
      },
      history,
    },
    stats: {
      loginCount: Math.floor(Math.random() * 1000),
      lastLogin: Date.now() - Math.random() * 604800000, // Random time in last week
      sessionData: {
        currentSessionId: `session_${Math.random().toString(36).substr(2, 9)}`,
        deviceInfo: {
          type: "desktop",
          os: "Windows",
          browser: "Chrome",
        },
        security: {
          twoFactorEnabled: Math.random() > 0.5,
          lastPasswordChange: Date.now() - Math.random() * 2592000000, // Random time in last 30 days
        },
      },
    },
    relationships: {
      friends,
      followers,
      following,
      blocked,
    },
  };
}

/**
 * Example: Cache compression demonstration
 */
async function demonstrateCacheCompression() {
  console.log("🚀 Cache Compression Demonstration\n");

  // Create cache instances with compression enabled
  const compressionConfig: Partial<CompressionConfig> = {
    algorithm: "gzip",
    level: 6,
    thresholdBytes: 1024, // Compress objects > 1KB
    enableCompression: true,
    fallbackOnError: true,
  };

  const memoryCache = new MemoryCache(mockLogger, {
    ...DEFAULT_MEMORY_CACHE_CONFIG,
    compressionConfig,
  });

  // Note: Redis cache would need actual Redis connection
  // const redisCache = new RedisCache(mockLogger, redisClient, {
  //   ...DEFAULT_REDIS_CACHE_CONFIG,
  //   compressionConfig,
  // });

  console.log("📊 Generating test data...");

  // Generate test data
  const testUsers = [];
  for (let i = 1; i <= 10; i++) {
    testUsers.push(generateLargeUserData(`user_${i}`));
  }

  console.log(`✅ Generated ${testUsers.length} large user objects`);

  // Test compression with individual objects
  console.log("\n🔍 Testing compression on individual objects...");

  for (let i = 0; i < Math.min(3, testUsers.length); i++) {
    const user = testUsers[i];
    if (!user) continue;

    const key = `user:${user.id}`;

    console.log(`\n📝 Processing ${key}...`);

    // Calculate original size
    const originalSize = JSON.stringify(user).length;
    console.log(
      `   Original size: ${Math.round((originalSize / 1024) * 100) / 100} KB`
    );

    // Set in cache (this will trigger compression)
    await memoryCache.set(key, user, 3600);

    // Get from cache (this will trigger decompression)
    const result = await memoryCache.get<LargeUserData>(key);

    if (result.data) {
      console.log(`   ✅ Successfully cached and retrieved`);
      console.log(`   Compressed: ${result.compressed}`);
      console.log(
        `   Data integrity: ${
          JSON.stringify(result.data).length === originalSize ? "✅" : "❌"
        }`
      );
    } else {
      console.log(`   ❌ Failed to retrieve from cache`);
    }
  }

  // Display compression statistics
  console.log("\n📈 Compression Statistics:");
  const compressionStats = memoryCache.getCompressionStats();
  console.log(`   Total compressed: ${compressionStats.totalCompressed}`);
  console.log(`   Total uncompressed: ${compressionStats.totalUncompressed}`);
  console.log(
    `   Average compression ratio: ${Math.round(
      compressionStats.compressionRatio * 100
    )}%`
  );
  console.log(
    `   Average compression time: ${
      Math.round(compressionStats.averageCompressionTime * 100) / 100
    }ms`
  );
  console.log(`   Compression errors: ${compressionStats.compressionErrors}`);
  console.log(
    `   Decompression errors: ${compressionStats.decompressionErrors}`
  );

  // Display memory statistics
  console.log("\n💾 Memory Statistics:");
  const memoryStats = memoryCache.getMemoryStats();
  console.log(
    `   Total memory usage: ${
      Math.round(memoryStats.totalUsageMB * 100) / 100
    } MB`
  );
  console.log(
    `   Memory usage percent: ${
      Math.round(memoryStats.usagePercent * 100) / 100
    }%`
  );
  console.log(
    `   Average entry size: ${Math.round(memoryStats.averageEntrySize)} bytes`
  );
  console.log(`   Entry count: ${memoryStats.entryCount}`);

  // Test compression configuration changes
  console.log("\n⚙️  Testing compression configuration changes...");

  // Disable compression
  memoryCache.updateCompressionConfig({ enableCompression: false });
  console.log("   Disabled compression");

  const testUser = generateLargeUserData("config_test");
  await memoryCache.set("config_test", testUser, 3600);
  const configResult = await memoryCache.get<LargeUserData>("config_test");

  console.log(
    `   Compression after disable: ${
      configResult.compressed ? "❌ (unexpected)" : "✅ (expected)"
    }`
  );

  // Re-enable compression with different algorithm
  memoryCache.updateCompressionConfig({
    enableCompression: true,
    algorithm: "deflate",
    level: 9,
  });
  console.log("   Re-enabled compression with deflate algorithm");

  await memoryCache.set("config_test_2", testUser, 3600);
  const configResult2 = await memoryCache.get<LargeUserData>("config_test_2");

  console.log(
    `   Compression with new config: ${configResult2.compressed ? "✅" : "❌"}`
  );

  // Display final statistics
  console.log("\n📊 Final Statistics:");
  const finalCompressionStats = memoryCache.getCompressionStats();
  const finalMemoryStats = memoryCache.getMemoryStats();

  console.log(`   Cache entries: ${finalMemoryStats.entryCount}`);
  console.log(
    `   Memory usage: ${
      Math.round(finalMemoryStats.totalUsageMB * 100) / 100
    } MB`
  );
  console.log(
    `   Compression ratio: ${Math.round(
      finalCompressionStats.compressionRatio * 100
    )}%`
  );
  console.log(
    `   Total compressions: ${finalCompressionStats.totalCompressed}`
  );

  console.log("\n🎉 Cache compression demonstration completed!");
}

/**
 * Example: Direct compressor usage
 */
async function demonstrateDirectCompression() {
  console.log("\n🔧 Direct Compressor Usage Example\n");

  const compressor = new CacheCompressor(mockLogger, {
    algorithm: "gzip",
    level: 6,
    thresholdBytes: 512, // Lower threshold for demo
    enableCompression: true,
  });

  // Test with different data sizes
  const testData = [
    { name: "Small object", data: { id: 1, name: "test" } },
    { name: "Medium object", data: generateLargeUserData("medium_test") },
    { name: "Large string", data: "x".repeat(2000) },
    {
      name: "Large array",
      data: Array.from({ length: 1000 }, (_, i) => ({
        index: i,
        value: Math.random(),
      })),
    },
  ];

  for (const { name, data } of testData) {
    console.log(`📝 Testing ${name}...`);

    const originalSize = JSON.stringify(data).length;
    console.log(`   Original size: ${originalSize} bytes`);

    try {
      const result = await compressor.compress(data);

      console.log(`   Compressed: ${result.compressed}`);
      console.log(`   Compressed size: ${result.compressedSize} bytes`);
      console.log(
        `   Compression ratio: ${Math.round(
          (result.compressedSize / result.originalSize) * 100
        )}%`
      );
      console.log(
        `   Compression time: ${
          Math.round(result.compressionTime * 100) / 100
        }ms`
      );
      console.log(`   Algorithm: ${result.algorithm}`);

      // Test decompression
      const decompressed = await compressor.decompress(
        result.data,
        result.algorithm
      );
      const decompressedSize = JSON.stringify(decompressed).length;
      console.log(
        `   Decompression successful: ${
          originalSize === decompressedSize ? "✅" : "❌"
        }`
      );
    } catch (error) {
      console.log(
        `   ❌ Compression failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    console.log("");
  }

  // Display compressor statistics
  console.log("📈 Compressor Statistics:");
  const stats = compressor.getCompressionStats();
  console.log(`   Total compressed: ${stats.totalCompressed}`);
  console.log(
    `   Compression ratio: ${Math.round(stats.compressionRatio * 100)}%`
  );
  console.log(
    `   Average compression time: ${
      Math.round(stats.averageCompressionTime * 100) / 100
    }ms`
  );
  console.log(`   Compression errors: ${stats.compressionErrors}`);
  console.log(`   Decompression errors: ${stats.decompressionErrors}`);
}

/**
 * Run all compression examples
 */
async function runCompressionExamples() {
  try {
    await demonstrateDirectCompression();
    await demonstrateCacheCompression();
  } catch (error) {
    console.error("❌ Example failed:", error);
  }
}

// Export for use in other files
export {
  demonstrateCacheCompression,
  demonstrateDirectCompression,
  runCompressionExamples,
  generateLargeUserData,
  type LargeUserData,
};

// Run examples if this file is executed directly
if (require.main === module) {
  runCompressionExamples();
}
