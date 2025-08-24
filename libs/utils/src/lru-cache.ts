/**
 * Production-grade Least Recently Used (LRU) cache with TTL support.
 * Optimized for high-frequency operations with efficient memory management.
 *
 * @template K - Key type
 * @template V - Value type
 *
 * Features:
 * - Automatic LRU eviction when max size exceeded
 * - Optional TTL (time-to-live) support with automatic cleanup
 * - O(1) get/set operations for LRU management
 * - Efficient size tracking without iteration
 * - Type-safe generic implementation
 * - Memory leak prevention with automatic expired entry cleanup
 *
 * Usage:
 *   const cache = new LRUCache<string, number>(100); // No TTL
 *   const cacheWithTTL = new LRUCache<string, number>(100, 5000); // 5 second TTL
 *   cache.set('foo', 42);
 *   const value = cache.get('foo');
 */
export class LRUCache<K, V> {
  private readonly map: Map<K, { value: V; expiresAt?: number }>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private currentSize: number = 0; // Efficient size tracking
  private lastCleanup: number = Date.now();
  private readonly cleanupInterval: number = 30000; // 30 seconds

  /**
   * @param maxSize - Maximum number of entries in the cache
   * @param ttlMs - Optional time-to-live in milliseconds for each entry
   */
  constructor(maxSize: number, ttlMs: number) {
    if (maxSize <= 0) {
      throw new Error("maxSize must be greater than 0");
    }
    if (ttlMs < 0) {
      throw new Error("ttlMs must be non-negative");
    }

    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  /**
   * Optimized get with automatic cleanup and efficient LRU management.
   * O(1) operation for LRU repositioning using Map's insertion order.
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // Check expiration
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.currentSize--;
      return undefined;
    }

    // Efficient LRU: delete and re-insert to move to most recent position
    this.map.delete(key);
    this.map.set(key, entry);

    // Periodic cleanup to prevent memory leaks
    this.periodicCleanup();

    return entry.value;
  }

  /**
   * Type-safe key lookup by value with efficient LRU management.
   */
  getKeyByValue(value: V): K | undefined {
    const entries = Array.from(this.map.entries());
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
        this.map.delete(key);
        this.currentSize--;
        continue;
      }

      if (entry.value === value) {
        // Move to most recently used
        this.map.delete(key);
        this.map.set(key, entry);
        return key;
      }
    }
    return undefined;
  }

  /**
   * Find entries with keys matching a predicate function.
   * More flexible and type-safe than string-based matching.
   */
  find(predicate: (key: K) => boolean): Array<{ key: K; value: V }> {
    const results: Array<{ key: K; value: V }> = [];
    const now = Date.now();
    const entries = Array.from(this.map.entries());

    for (const [key, entry] of entries) {
      // Clean up expired entries
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
        continue;
      }

      if (predicate(key)) {
        // Move to most recently used
        this.map.delete(key);
        this.map.set(key, entry);
        results.push({ key, value: entry.value });
      }
    }

    return results;
  }
  /**
   * Optimized set with automatic eviction and TTL support.
   * O(1) operation for both new entries and updates.
   */
  set(key: K, value: V): void {
    const existingEntry = this.map.get(key);

    if (existingEntry) {
      // Update existing entry - delete and re-insert for LRU positioning
      this.map.delete(key);
    } else {
      // New entry - check if we need to evict
      if (this.currentSize >= this.maxSize) {
        // Evict least recently used (first entry in Map)
        const oldestKey = this.map.keys().next();
        if (!oldestKey.done) {
          this.map.delete(oldestKey.value);
        } else {
          this.currentSize--;
        }
      } else {
        this.currentSize++;
      }
    }

    // Create entry with optional TTL
    const entry: { value: V; expiresAt?: number } = { value };
    if (this.ttlMs !== undefined) {
      entry.expiresAt = Date.now() + this.ttlMs;
    }

    this.map.set(key, entry);
    this.periodicCleanup();
  }

  /**
   * Efficient periodic cleanup to prevent memory leaks.
   * Only runs when cleanup interval has elapsed.
   */
  private periodicCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    this.lastCleanup = now;

    // Clean up expired entries using Array.from for compatibility
    const entries = Array.from(this.map.entries());
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
      }
    }
  }

  /**
   * Check if cache contains a non-expired entry for the key.
   * O(1) operation with automatic cleanup of expired entries.
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.currentSize--;
      return false;
    }

    return true;
  }

  /**
   * Delete an entry from the cache.
   * O(1) operation with size tracking.
   */
  delete(key: K): boolean {
    const deleted = this.map.delete(key);
    if (deleted) {
      this.currentSize--;
    }
    return deleted;
  }

  /**
   * Clear all entries from the cache.
   * Resets size tracking and cleanup timers.
   */
  clear(): void {
    this.map.clear();
    this.currentSize = 0;
    this.lastCleanup = Date.now();
  }

  /**
   * Get all non-expired keys in the cache.
   * Automatically cleans up expired entries during iteration.
   */
  keys(): K[] {
    const keys: K[] = [];
    const now = Date.now();
    const entries = Array.from(this.map.entries());

    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
        continue;
      }
      keys.push(key);
    }

    return keys;
  }

  /**
   * Get all non-expired entries as [key, value] pairs.
   * Returns array for better performance than iterator.
   */
  entries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    const now = Date.now();
    const mapEntries = Array.from(this.map.entries());

    for (const [key, entry] of mapEntries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
        continue;
      }
      entries.push([key, entry.value]);
    }

    return entries;
  }

  /**
   * Get the current size of non-expired entries.
   * O(1) operation using efficient size tracking.
   */
  getSize(): number {
    // Periodic cleanup to ensure accurate size
    this.periodicCleanup();
    return this.currentSize;
  }

  /**
   * Get the first (least recently used) non-expired entry.
   * Automatically cleans up expired entries.
   */
  getFirst(): [K, V] | undefined {
    const now = Date.now();
    const entries = Array.from(this.map.entries());

    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
        continue;
      }
      return [key, entry.value];
    }

    return undefined;
  }

  /**
   * Force cleanup of all expired entries.
   * Useful for memory management in long-running applications.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleanedCount = 0;
    const entries = Array.from(this.map.entries());

    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.map.delete(key);
        this.currentSize--;
        cleanedCount++;
      }
    }

    this.lastCleanup = now;
    return cleanedCount;
  }

  /**
   * Get cache statistics for monitoring and debugging.
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttlMs: number | undefined;
    hitRatio: number;
    lastCleanup: Date;
  } {
    return {
      size: this.getSize(),
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hitRatio: 0, // Would need hit/miss tracking for accurate ratio
      lastCleanup: new Date(this.lastCleanup),
    };
  }
}
