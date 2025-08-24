/**
 * @fileoverview Generic Object Pool - Memory-efficient object reuse utility
 * @module utils/object-pool
 * @version 1.0.0
 *
 * SINGLE RESPONSIBILITY: Efficient object pooling for memory optimization
 */

/**
 * Generic object pool interface following SOLID principles
 */
export interface IObjectPool<T> {
  /**
   * Get an object from the pool or create a new one
   */
  acquire(): T;

  /**
   * Return an object to the pool for reuse
   */
  release(object: T): void;

  /**
   * Get pool statistics for monitoring
   */
  getStats(): IPoolStats;

  /**
   * Clear all objects from the pool
   */
  clear(): void;
}

/**
 * Pool performance statistics
 */
export interface IPoolStats {
  poolSize: number;
  maxPoolSize: number;
  utilization: number;
  totalAcquires: number;
  totalReleases: number;
  totalCreations: number;
}

/**
 * Factory function type for creating new objects
 */
export type ObjectFactory<T> = () => T;

/**
 * Reset function type for cleaning objects before reuse
 */
export type ObjectResetter<T> = (object: T) => void;

/**
 * Generic object pool implementation
 * Follows SOLID principles with dependency injection for factories
 */
export class ObjectPool<T> implements IObjectPool<T> {
  private readonly pool: T[] = [];
  private stats: IPoolStats = {
    poolSize: 0,
    maxPoolSize: 0,
    utilization: 0,
    totalAcquires: 0,
    totalReleases: 0,
    totalCreations: 0,
  };

  constructor(
    private readonly factory: ObjectFactory<T>,
    private readonly resetter: ObjectResetter<T>,
    private readonly maxSize: number = 10
  ) {
    this.stats.maxPoolSize = maxSize;
  }

  /**
   * Acquire an object from the pool
   */
  acquire(): T {
    this.stats.totalAcquires++;

    const pooledObject = this.pool.pop();

    if (pooledObject !== undefined) {
      this.stats.poolSize = this.pool.length;
      this.updateUtilization();
      return pooledObject;
    }

    // Create new object if pool is empty
    this.stats.totalCreations++;
    return this.factory();
  }

  /**
   * Release an object back to the pool
   */
  release(object: T): void {
    if (this.pool.length < this.maxSize) {
      // Reset object state before returning to pool
      this.resetter(object);

      this.pool.push(object);
      this.stats.totalReleases++;
      this.stats.poolSize = this.pool.length;
      this.updateUtilization();
    }
    // If pool is full, let object be garbage collected
  }

  /**
   * Get pool statistics
   */
  getStats(): IPoolStats {
    return { ...this.stats };
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool.length = 0;
    this.stats.poolSize = 0;
    this.updateUtilization();
  }

  /**
   * Update utilization percentage
   */
  private updateUtilization(): void {
    this.stats.utilization = (this.maxSize - this.pool.length) / this.maxSize;
  }
}

/**
 * Factory functions for common object types
 */
export const ObjectPoolFactories = {
  /**
   * Factory for Set<string> objects
   */
  stringSet: (): Set<string> => new Set<string>(),

  /**
   * Factory for Map<string, any> objects
   */
  stringMap: <V>(): Map<string, V> => new Map<string, V>(),

  /**
   * Factory for Array<T> objects
   */
  array: <T>(): T[] => [],
} as const;

/**
 * Reset functions for common object types
 */
export const ObjectPoolResetters = {
  /**
   * Resetter for Set objects
   */
  set: <T>(set: Set<T>): void => {
    set.clear();
  },

  /**
   * Resetter for Map objects
   */
  map: <K, V>(map: Map<K, V>): void => {
    map.clear();
  },

  /**
   * Resetter for Array objects
   */
  array: <T>(array: T[]): void => {
    array.length = 0;
  },
} as const;

/**
 * Pre-configured pools for common use cases
 */
export class CommonObjectPools {
  /**
   * Shared pool for Set<string> objects
   */
  static readonly stringSetPool = new ObjectPool(
    ObjectPoolFactories.stringSet,
    ObjectPoolResetters.set,
    20 // Higher limit for frequently used sets
  );

  /**
   * Shared pool for string arrays
   */
  static readonly stringArrayPool = new ObjectPool(
    ObjectPoolFactories.array<string>,
    ObjectPoolResetters.array,
    15
  );
}
