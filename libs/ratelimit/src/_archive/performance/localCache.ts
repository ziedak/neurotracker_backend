import { ILogger } from "@libs/monitoring";

/**
 * Cache entry with TTL and metadata
 */
interface CacheEntry<T> {
  value: T;
  expiry: number;
  hits: number;
  lastAccess: number;
  createdAt: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  evictions: number;
  averageAge: number;
}

/**
 * Local LRU cache with TTL for rate limit results
 * Reduces Redis calls for frequently accessed keys
 */
export class LocalRateLimitCache<T = any> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private totalHits = 0;
  private totalMisses = 0;
  private evictions = 0;
  private readonly logger: ILogger;

  constructor(
    maxSize: number = 1000,
    defaultTtlMs: number = 5000, // 5 second default TTL
    logger: ILogger
  ) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.logger = createLogger( "LocalRateLimitCache" });
  }

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (!entry) {
      this.totalMisses++;
      return undefined;
    }

    // Check if expired
    if (now > entry.expiry) {
      this.cache.delete(key);
      this.totalMisses++;
      return undefined;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccess = now;
    this.totalHits++;

    // Move to end for LRU (delete and re-set)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set value in cache with optional TTL
   */
  set(key: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    const now = Date.now();

    // Check if we need to evict entries
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      value,
      expiry: now + ttlMs,
      hits: 0,
      lastAccess: now,
      createdAt: now,
    };

    this.cache.set(key, entry);

    this.logger.debug("Cache entry set", {
      key,
      ttlMs,
      cacheSize: this.cache.size,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now > entry.expiry) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info("Cache cleared", { entriesRemoved: size });
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug("Cache cleanup completed", {
        entriesRemoved: removed,
        remainingSize: this.cache.size,
      });
    }

    return removed;
  }

  /**
   * Evict oldest entry based on LRU policy
   */
  private evictOldest(): void {
    // Map maintains insertion order, so first entry is oldest
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
      this.logger.debug("Cache eviction", {
        evictedKey: oldestKey,
        reason: "capacity",
      });
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const now = Date.now();
    let totalAge = 0;
    let validEntries = 0;

    // Calculate average age of valid entries
    for (const entry of this.cache.values()) {
      if (now <= entry.expiry) {
        totalAge += now - entry.createdAt;
        validEntries++;
      }
    }

    const totalRequests = this.totalHits + this.totalMisses;
    const hitRate = totalRequests > 0 ? this.totalHits / totalRequests : 0;
    const averageAge = validEntries > 0 ? totalAge / validEntries : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      evictions: this.evictions,
      averageAge,
    };
  }

  /**
   * Get entries about to expire (for proactive refresh)
   */
  getExpiringEntries(withinMs: number = 2000): string[] {
    const now = Date.now();
    const threshold = now + withinMs;
    const expiringKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry <= threshold && entry.expiry > now) {
        expiringKeys.push(key);
      }
    }

    return expiringKeys;
  }

  /**
   * Get top accessed keys
   */
  getTopKeys(limit: number = 10): Array<{ key: string; hits: number }> {
    const entries = Array.from(this.cache.entries())
      .map(([key, entry]) => ({ key, hits: entry.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);

    return entries;
  }

  /**
   * Set cache warming data (bulk operation)
   */
  warmUp(entries: Array<{ key: string; value: T; ttlMs?: number }>): void {
    const startTime = Date.now();
    let added = 0;

    for (const entry of entries) {
      if (this.cache.size < this.maxSize) {
        this.set(entry.key, entry.value, entry.ttlMs);
        added++;
      } else {
        break;
      }
    }

    const duration = Date.now() - startTime;
    this.logger.info("Cache warm-up completed", {
      entriesAdded: added,
      totalEntries: entries.length,
      durationMs: duration,
      cacheSize: this.cache.size,
    });
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanupInterval(intervalMs: number = 30000): NodeJS.Timer {
    const interval = setInterval(() => {
      this.cleanup();
    }, intervalMs);

    this.logger.info("Cache cleanup interval started", { intervalMs });
    return interval;
  }

  /**
   * Serialize cache for debugging
   */
  serialize(): Array<{
    key: string;
    value: T;
    expiry: number;
    hits: number;
    age: number;
  }> {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      value: entry.value,
      expiry: entry.expiry,
      hits: entry.hits,
      age: now - entry.createdAt,
    }));
  }
}
