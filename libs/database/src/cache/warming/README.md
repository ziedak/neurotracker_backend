# Cache Warming Strategies

This module provides intelligent cache warming strategies for frequently accessed data, improving application performance by pre-populating caches with hot data.

## Features

- **Static Warming**: Predefined keys based on known access patterns
- **Adaptive Warming**: Learns from access patterns and warms frequently accessed data
- **Background Warming**: Continuous warming at regular intervals
- **Multi-strategy Support**: Combine different warming approaches
- **Performance Monitoring**: Track warming effectiveness and metrics

## Quick Start

```typescript
import { CacheService } from "./cache.service";

// Create cache with warming enabled
const cache = new CacheService(logger, redisClient, {
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

// Cache will automatically warm on startup
// Access patterns are learned automatically
await cache.set("user:profile:123", userData);
const data = await cache.get("user:profile:123");
```

## Warming Strategies

### 1. Static Warming

Pre-warms cache with predefined frequently accessed keys.

```typescript
// Warm cache with static strategy
const result = await cache.warmup("static");
console.log(`Warmed ${result.keysProcessed} keys in ${result.duration}ms`);
```

### 2. Adaptive Warming

Learns from access patterns and warms cache with frequently accessed data.

```typescript
// Simulate access patterns
for (let i = 0; i < 10; i++) {
  await cache.get("hot:key");
}

// Warm based on learned patterns
const result = await cache.warmup("adaptive");
```

### 3. Background Warming

Continuously warms cache at regular intervals.

```typescript
// Start background warming
cache.startBackgroundWarming();

// Check status
const stats = cache.getWarmingStats();
console.log("Background status:", stats.backgroundStatus);

// Stop when needed
cache.stopBackgroundWarming();
```

## Configuration

```typescript
interface CacheWarmingConfig {
  enableBackgroundWarming?: boolean; // Enable periodic warming
  backgroundWarmingInterval?: number; // Interval in seconds (default: 300)
  adaptiveWarming?: boolean; // Enable pattern learning (default: true)
  maxWarmupKeys?: number; // Max keys to warm (default: 100)
  warmupBatchSize?: number; // Batch size for warming (default: 10)
  enablePatternLearning?: boolean; // Learn from access patterns (default: true)
}
```

## Advanced Usage

### Custom Data Provider

```typescript
import { WarmupDataProvider } from "./interfaces/ICache";

class CustomDataProvider implements WarmupDataProvider {
  async getWarmupKeys(): Promise<string[]> {
    return ["custom:key:1", "custom:key:2"];
  }

  async loadDataForKey(key: string): Promise<any> {
    // Load data from your data source
    return await database.load(key);
  }

  getKeyPriority(key: string): number {
    // Return priority (higher = more important)
    return key.includes("important") ? 10 : 1;
  }
}
```

### Custom Warming Strategy

```typescript
import { BaseCacheWarmingStrategy } from "./warming/BaseCacheWarmingStrategy";

class CustomWarmingStrategy extends BaseCacheWarmingStrategy {
  readonly name = "Custom";

  async warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult> {
    const keys = await provider.getWarmupKeys();
    // Custom warming logic
    return this.executeWarmup(cache, provider, keys);
  }

  getRecommendedKeys(): string[] {
    return ["recommended:key"];
  }
}
```

## Monitoring

### Warming Statistics

```typescript
const stats = cache.getWarmingStats();
console.log("Warming Statistics:", {
  strategies: stats.strategies,
  backgroundStatus: stats.backgroundStatus,
  adaptiveStats: stats.adaptiveStats,
});
```

### Recommended Keys

```typescript
const recommendations = cache.getRecommendedKeys();
for (const [strategy, keys] of recommendations) {
  console.log(`${strategy} recommends:`, keys);
}
```

## Performance Benefits

- **Reduced Cold Starts**: Pre-warmed cache eliminates initial cache misses
- **Improved Hit Rates**: Frequently accessed data is always available
- **Lower Latency**: Hot data served from memory/Redis
- **Adaptive Learning**: System learns and optimizes automatically
- **Background Processing**: Warming doesn't impact application performance

## Best Practices

1. **Start Simple**: Begin with static warming for known hot keys
2. **Monitor Performance**: Track hit rates and warming effectiveness
3. **Tune Intervals**: Adjust background warming intervals based on data patterns
4. **Resource Management**: Set appropriate limits for memory and concurrent operations
5. **Error Handling**: Implement proper error handling for warming failures

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce `maxWarmupKeys` or increase TTL
2. **Slow Warming**: Increase `warmupBatchSize` or reduce concurrent operations
3. **Pattern Learning Not Working**: Ensure `enablePatternLearning` is true
4. **Background Warming Not Starting**: Check `enableBackgroundWarming` configuration

### Debug Information

```typescript
// Enable detailed logging
const cache = new CacheService(logger, redisClient, {
  // ... config
});

// Check warming status
console.log(cache.getWarmingStats());
console.log(cache.getRecommendedKeys());
```
