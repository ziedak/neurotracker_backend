# Memory Management

Advanced memory management system for accurate cache memory tracking and optimization.

## Features

- **Accurate Memory Tracking**: Precise calculation of object sizes in memory
- **Memory Limits**: Configurable memory limits with automatic enforcement
- **Threshold Monitoring**: Warning and critical thresholds with alerts
- **Detailed Statistics**: Comprehensive memory usage analytics
- **Memory-Aware Operations**: Smart cache operations based on memory usage
- **Performance Monitoring**: Real-time memory performance metrics

## Quick Start

```typescript
import { MemoryCache } from "./strategies/MemoryCache";

const memoryCache = new MemoryCache(logger, {
  enable: true,
  defaultTTL: 3600,
  maxMemoryCacheSize: 10000,
  memoryConfig: {
    maxMemoryMB: 50, // 50MB memory limit
    warningThresholdPercent: 75, // Warn at 75%
    criticalThresholdPercent: 90, // Critical at 90%
    enableDetailedTracking: true,
    sizeCalculationInterval: 50, // Recalculate every 50 ops
  },
});

// Cache will automatically track memory usage
await memoryCache.set("key", largeObject);

// Check memory statistics
const stats = memoryCache.getMemoryStats();
console.log(`Memory Usage: ${stats.usagePercent}%`);
```

## Memory Tracking

### Accurate Size Calculation

The system calculates memory usage for different data types:

- **Primitives**: Exact byte sizes (boolean: 4B, number: 8-16B, string: 2B/char)
- **Objects**: Recursive calculation of all properties
- **Arrays**: Overhead + size of all elements
- **Metadata**: Cache entry metadata (timestamps, TTL, etc.)

### Memory Information

```typescript
interface MemoryInfo {
  keySize: number; // Size of cache key
  valueSize: number; // Size of cached value
  metadataSize: number; // Size of cache metadata
  totalSize: number; // Total memory usage
  lastCalculated: number; // When size was calculated
}
```

## Configuration

```typescript
interface MemoryTrackerConfig {
  maxMemoryMB: number; // Maximum memory in MB
  warningThresholdPercent: number; // Warning threshold (default: 80%)
  criticalThresholdPercent: number; // Critical threshold (default: 95%)
  enableDetailedTracking: boolean; // Per-entry tracking (default: true)
  sizeCalculationInterval: number; // Recalculation frequency (default: 100)
}
```

## Memory Statistics

```typescript
const stats = memoryCache.getMemoryStats();

// Basic metrics
stats.totalUsageBytes; // Total memory in bytes
stats.totalUsageMB; // Total memory in MB
stats.usagePercent; // Percentage of limit used
stats.entryCount; // Number of entries
stats.averageEntrySize; // Average size per entry
stats.isWithinLimits; // Whether within limits

// Largest entries
stats.largestEntries.forEach((entry) => {
  console.log(`${entry.key}: ${entry.size} bytes`);
});
```

## Memory Limits

### Automatic Enforcement

When memory limits are reached:

1. **Warning Threshold**: Logs warnings, continues operation
2. **Critical Threshold**: Prevents new entries, logs errors
3. **Health Check**: Reports degraded/critical status

### Memory-Aware Operations

```typescript
// Check if operation would exceed limits
const canAdd = memoryCache.checkMemoryLimits(key, data);
if (!canAdd) {
  console.log("Memory limit would be exceeded");
  return;
}

// Add with automatic tracking
await memoryCache.set(key, data);
```

## Health Monitoring

### Cache Health Status

```typescript
const health = await memoryCache.healthCheck();

if (health.status === "critical") {
  // Memory limit exceeded
  console.error("Critical memory usage");
} else if (health.status === "degraded") {
  // Near memory limit
  console.warn("High memory usage");
}
```

### Automatic Alerts

The system automatically logs:

- **Warning**: When usage exceeds warning threshold
- **Critical**: When usage exceeds critical threshold
- **Recovery**: When usage drops below thresholds

## Performance Optimization

### Memory-Efficient Operations

- **Lazy Calculation**: Memory sizes calculated only when needed
- **Batch Processing**: Efficient bulk operations
- **Smart Cleanup**: Automatic memory cleanup on invalidation
- **Size Caching**: Cached size calculations to reduce overhead

### Configuration Tuning

```typescript
// High-performance configuration
const highPerfConfig = {
  maxMemoryMB: 100,
  warningThresholdPercent: 70,
  criticalThresholdPercent: 85,
  enableDetailedTracking: false, // Disable for better performance
  sizeCalculationInterval: 200, // Less frequent recalculation
};

// Memory-intensive configuration
const memoryIntensiveConfig = {
  maxMemoryMB: 500,
  warningThresholdPercent: 80,
  criticalThresholdPercent: 95,
  enableDetailedTracking: true, // Full tracking
  sizeCalculationInterval: 50, // Frequent recalculation
};
```

## Advanced Usage

### Custom Memory Limits

```typescript
// Update memory configuration at runtime
memoryCache.updateMemoryConfig({
  maxMemoryMB: 100, // Increase limit
  warningThresholdPercent: 60, // Lower warning threshold
});

// Get current configuration
const config = memoryCache.getMemoryConfig();
```

### Memory Analysis

```typescript
// Get detailed memory breakdown
const memoryStats = memoryCache.getMemoryStats();

// Analyze memory distribution
console.log("Memory Distribution:");
memoryStats.largestEntries.forEach((entry, index) => {
  const percentage = (entry.size / memoryStats.totalUsageBytes) * 100;
  console.log(`${index + 1}. ${entry.key}: ${percentage.toFixed(1)}%`);
});
```

### Memory Cleanup

```typescript
// Automatic cleanup on invalidation
await memoryCache.invalidate("large-entry");
// Memory tracking automatically updated

// Pattern cleanup
const removed = await memoryCache.invalidatePattern("temp-*");
// All matching entries removed with memory tracking updated
```

## Comparison: Old vs New

| Feature          | Old Implementation | New Implementation              |
| ---------------- | ------------------ | ------------------------------- |
| Size Calculation | Rough 1KB estimate | Accurate byte-level calculation |
| Memory Tracking  | Basic entry count  | Detailed per-entry tracking     |
| Limits           | Entry count only   | Memory-based limits             |
| Monitoring       | Basic statistics   | Comprehensive analytics         |
| Health Checks    | Entry count only   | Memory-aware health status      |
| Performance      | Simple operations  | Optimized with caching          |

### Accuracy Improvement

```typescript
// Old method: Rough estimation
const oldSize = entries * 1024; // 1KB per entry

// New method: Accurate calculation
const memoryTracker = new MemoryTracker(logger);
const accurateSize = memoryTracker.calculateObjectSize(complexObject);

// Result: Much more accurate memory usage tracking
```

## Best Practices

### Configuration Guidelines

1. **Set Realistic Limits**: Base on your application's memory constraints
2. **Tune Thresholds**: Set warning/critical thresholds based on your monitoring
3. **Balance Accuracy vs Performance**: Use detailed tracking for memory-critical apps
4. **Monitor Regularly**: Check memory statistics in production

### Memory Optimization

1. **Use Appropriate Data Types**: Prefer primitives over complex objects when possible
2. **Implement Cleanup**: Regularly invalidate expired/unused entries
3. **Monitor Growth**: Watch for memory leaks in long-running applications
4. **Scale Limits**: Adjust memory limits based on system resources

### Performance Considerations

1. **Detailed Tracking**: Enable for development, consider disabling for high-throughput production
2. **Size Calculation Frequency**: Increase interval for better performance
3. **Batch Operations**: Use batch operations for better memory efficiency
4. **Memory Monitoring**: Implement alerts for memory threshold breaches

## Troubleshooting

### Common Issues

1. **High Memory Usage**

   - Check largest entries: `memoryStats.largestEntries`
   - Review data structures for optimization opportunities
   - Consider increasing memory limits or implementing cleanup

2. **Performance Impact**

   - Reduce `sizeCalculationInterval` for less frequent calculations
   - Disable `enableDetailedTracking` for high-throughput scenarios
   - Use batch operations instead of individual operations

3. **Memory Leaks**
   - Monitor `memoryStats.entryCount` over time
   - Check for entries not being invalidated
   - Implement regular cleanup routines

### Debug Information

```typescript
// Enable detailed logging
const memoryCache = new MemoryCache(logger, {
  memoryConfig: {
    // ... config
  },
});

// Get comprehensive debug info
console.log("Memory Stats:", memoryCache.getMemoryStats());
console.log("Memory Config:", memoryCache.getMemoryConfig());
console.log("Cache Health:", await memoryCache.healthCheck());
```

## Integration

The memory management system integrates seamlessly with:

- **Cache Warming**: Memory-aware warming strategies
- **Health Monitoring**: Memory-based health checks
- **Performance Metrics**: Detailed memory analytics
- **Error Handling**: Memory-related error detection and reporting

This provides a comprehensive memory management solution that ensures optimal cache performance while preventing memory-related issues.
